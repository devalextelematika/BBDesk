import "./scripts/test-loader.mjs";
import { parseChatFileLink, resolveChatFilePath } from "./chat-file-links.ts";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html lang='ru'><body></body></html>", { url: "http://localhost" });
for (const name of ["window", "document", "HTMLElement", "Element", "Node", "MutationObserver", "getComputedStyle"]) globalThis[name] = name === "getComputedStyle" ? dom.window.getComputedStyle.bind(dom.window) : dom.window[name];
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { loadPluginApp, renderSlot } = await import("@get-bb/plugin-sdk/testing/app");
const { fireEvent, cleanup, within, act } = await import("@testing-library/react");
const { createElement } = await import("react");
const app = await loadPluginApp(() => import("./app.tsx"));

test("chat file hrefs preserve Windows paths, encoded names and line locations", () => {
  assert.deepEqual(parseChatFileLink("/E:/Development/BBDesk/CHANGELOG.md"), { path: "E:/Development/BBDesk/CHANGELOG.md", location: null });
  assert.deepEqual(parseChatFileLink("file:///E:/My%20Project/report.md#L8-L12"), { path: "E:/My Project/report.md", location: { kind: "range", startLine: 8, endLine: 12 } });
  assert.deepEqual(parseChatFileLink("E:\\Project\\app.tsx:12:3"), { path: "E:/Project/app.tsx", location: { kind: "line", line: 12, column: 3 } });
  assert.equal(resolveChatFilePath("../verification/report.md", "E:\\Development\\BBDesk\\plugin"), "E:/Development/BBDesk/verification/report.md");
  assert.equal(resolveChatFilePath("/tmp/report.md", "E:/Project"), "/tmp/report.md");
  assert.equal(resolveChatFilePath("../../../report.md", "E:/Project"), null);
  for (const href of ["https://example.com/report.md", "http://localhost:1234/", "plugin://dashboard/home", "/api/attachments/test.zip", "/plugins/dashboard/home", "#L2", "//example.com/a.md", "file://server/a.md", "/bad%00.md", "/bad%ZZ.md", "app.ts:0", "app.ts#L8-L2"]) assert.equal(parseChatFileLink(href), null, href);
});

async function mountFileSurface({ href = "/E:/Development/BBDesk/CHANGELOG.md", sdk = {}, accepts = true } = {}) {
  const { definePluginApp } = await import("@get-bb/plugin-sdk/app");
  const { ChatFileSurface } = await import("./chat-file-surface.tsx");
  const fixture = await loadPluginApp(() => Promise.resolve({ default: definePluginApp(builder => {
    builder.slots.navPanel({ id: "files", title: "Files", icon: "File", path: "files", component: ({ subPath }) => createElement(ChatFileSurface, { threadId: subPath || "thread-a" }, createElement("a", { href, target: "_blank" }, createElement("span", null, "Open report"))) });
  }) }));
  return renderSlot(fixture.navPanels[0], { subPath: "" }, {
    settings: { language: "en" }, openFilePreview: () => accepts,
    sdk: { threads: { get: async () => ({ environmentId: "env-a" }) }, environments: { get: async () => ({ hostId: "machine-a", path: "E:/Development/BBDesk" }) }, ...sdk },
  });
}

test("local result links open a native file preview on the thread's machine and suppress web navigation", async () => {
  const slot = await mountFileSurface();
  let allowed;
  await act(async () => { allowed = fireEvent.click(slot.getByText("Open report")); });
  assert.equal(allowed, false);
  assert.deepEqual(slot.inspection.navigateCalls, [{ method: "experimental_openFilePreview", options: { target: { kind: "host", hostId: "machine-a", path: "E:/Development/BBDesk/CHANGELOG.md" }, location: null } }]);
});

test("relative file links and middle clicks use the environment root and preserve line numbers", async () => {
  const slot = await mountFileSurface({ href: "../verification/report.md:9" });
  await act(async () => { fireEvent(slot.getByText("Open report"), new window.MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 })); });
  assert.deepEqual(slot.inspection.navigateCalls[0]?.options, { target: { kind: "host", hostId: "machine-a", path: "E:/Development/verification/report.md" }, location: { kind: "line", line: 9, column: null } });
});

test("web links keep native handling and make no file or environment requests", async () => {
  const slot = await mountFileSurface({ href: "https://example.com/report.md" });
  // Cancel at bubble phase to avoid jsdom launching a web navigation itself.
  let intercepted;
  slot.getByText("Open report").closest("a").addEventListener("click", event => { intercepted = event.defaultPrevented; event.preventDefault(); });
  await act(async () => { fireEvent.click(slot.getByText("Open report")); });
  assert.equal(intercepted, false);
  assert.equal(slot.inspection.navigateCalls.length, 0);
  assert.equal(slot.inspection.sdkCalls.length, 0);
});

test("preview rejection and disconnected hosts show an error without falling back to the web", async () => {
  for (const options of [{ accepts: false }, { sdk: { threads: { get: async () => { throw new Error("offline"); } } } }]) {
    const slot = await mountFileSurface(options);
    let allowed;
    await act(async () => { allowed = fireEvent.click(slot.getByText("Open report")); });
    assert.equal(allowed, false);
    assert.match(slot.getByRole("alert").textContent, /Could not open the file preview/);
    slot.lifecycle.unmount();
  }
});

test("a pending file activation cannot open a preview after the chat unmounts", async () => {
  let complete;
  const slot = await mountFileSurface({ sdk: { threads: { get: () => new Promise(resolve => { complete = resolve; }) } } });
  await act(async () => { fireEvent.click(slot.getByText("Open report")); });
  slot.lifecycle.unmount();
  await act(async () => { complete({ environmentId: "env-a" }); });
  assert.equal(slot.inspection.navigateCalls.length, 0);
});
afterEach(() => { cleanup(); window.localStorage.removeItem("bb-dashboard:launcher-layout:v1"); window.sessionStorage.clear(); window.localStorage.removeItem("bb-dashboard:split-layout:v1"); });
const project = { id: "p1", name: "Тестовый проект", isPersonal: false, href: "/projects/p1", settingsHref: "/projects/p1/settings" };
const item = { id: "notes/home", pluginId: "notes", label: "Заметки", icon: { kind: "plugin", pluginId: "notes", icon: null }, action: { kind: "plugin-panel", path: "home", pluginId: "notes" }, isDisabled: false, isLoading: false, isVisible: true, shortcut: null, badge: null };
function mount({ connected = false, launcher = [], threads = [], hiddenIds = [], draftThreadIds = [], projects = [project], sdk = {}, navigationItems = [item], withNavigation = true, language = "ru", rpcOverrides = {}, threadStatus = "ready", providers = undefined } = {}) {
  // Existing regression scenarios explicitly exercise Russian. null omits the preference.
  const languageSettings = language === null ? {} : { language };
  let snapshot = { config: { projects: connected ? projects.map(p => ({ id: p.id, enabled: true, connectedAt: 100 })) : [], launcher }, tracked: threads.map(t => ({ id: t.id, projectId: t.projectId, visible: !hiddenIds.includes(t.id), latestAttentionAt: t.latestAttentionAt, hiddenAttentionAt: hiddenIds.includes(t.id) ? t.latestAttentionAt : 0 })), syncError: null, syncedAt: 150 };
  const navigation = withNavigation ? renderSlot(app.experimentalSidebarNavigations[0], {
    isCompactViewport: false, placement: "rail", experimental_Original: () => null,
  }, { pluginId: "dashboard", sidebarNavigation: { items: navigationItems } }) : null;
  const slot = renderSlot(app.navPanels[0], { subPath: "" }, {
    pluginId: "dashboard",
    settings: languageSettings,
    sidebarThreads: { status: threadStatus, projects, threads },
    providers,
    sidebarDraftThreadIds: draftThreadIds,
    // Pages have no sidebar navigation context in BB. Only the bridge above does.
    sdk: { subscribe: () => () => {}, ...sdk },
    rpc: {
      snapshot: () => structuredClone(snapshot),
      projects_set: ({ ids }) => { snapshot.config.projects = ids.map(id => ({ id, enabled: true, connectedAt: 100 })); return snapshot.config; },
      launcher_set: ({ items }) => { snapshot.config.launcher = items; return snapshot.config; },
      thread_hide: ({ threadId }) => {
        const row = snapshot.tracked.find(t => t.id === threadId);
        if (!row) return { hidden: false };
        row.visible = false; row.hiddenAttentionAt = row.latestAttentionAt;
        return { hidden: true, undoToken: `undo-${threadId}` };
      },
      thread_restore: ({ threadId }) => {
        const row = snapshot.tracked.find(t => t.id === threadId);
        if (!row) return { restored: false };
        row.visible = true; return { restored: true };
      },
      ...rpcOverrides,
    },
  });
  const unmount = slot.lifecycle.unmount;
  slot.lifecycle.unmount = () => { unmount(); navigation?.lifecycle.unmount(); };
  return Object.assign(slot, { navigation, async setLanguage(value) {
    languageSettings.language = value;
    await act(async () => slot.lifecycle.rerender(createElement(app.navPanels[0].component, { subPath: "" })));
  } });
}
test("real page source renders Russian empty state and authored SVG controls", async () => {
  const slot = mount();
  await slot.findByText("Выберите проекты для работы");
  assert.equal(app.navPanels[0].title, "BBDesk");
  assert.equal(app.navPanels[0].icon, "dashboard/mark");
  assert.equal(slot.queryByRole("heading", { level: 1 }), null);
  assert.equal(slot.queryByText("Мои проекты"), null);
  const header = slot.getByRole("banner");
  assert.ok(header.contains(slot.getByRole("combobox", { name: "Показывать треды" })));
  assert.equal(within(header).queryByRole("button", { name: "Выбрать проекты" }), null);
  const projectControl = within(slot.container.querySelector(".db-project-bar")).getByRole("button", { name: "Выбрать проекты" });
  assert.ok(header.contains(slot.getByRole("button", { name: "Поиск тредов" })));
  const control = slot.getByRole("button", { name: "Настроить приложения" });
  assert.equal(projectControl.querySelector("svg").innerHTML, control.querySelector("svg").innerHTML);
  assert.equal(control.querySelector("svg").getAttribute("viewBox"), "0 0 24 24");
  assert.ok(!/(?:Рџ|Рњ|СЃ|С‚|�)/u.test(slot.container.textContent));
});

test("application drag handles reorder the draft both ways and save ids with renamed labels", async () => {
  const launcher = [{ id: "a/home", label: "Alpha" }, { id: "b/home", label: "Beta" }, { id: "c/home", label: "Gamma" }];
  let saved;
  const slot = mount({ language: "en", launcher, rpcOverrides: { launcher_set: ({ items }) => { saved = items; return { projects: [], launcher: items }; } } });
  fireEvent.click(await slot.findByRole("button", { name: "Configure applications" }));
  const rows = () => [...slot.container.querySelectorAll(".db-edit-app")];
  const labels = () => rows().map(row => row.querySelector("input").value);
  const transfer = { setData() {}, setDragImage() {} };
  function drag(from, to, after) {
    const source = rows()[from].querySelector(".db-app-drag");
    const target = rows()[to];
    target.getBoundingClientRect = () => ({ top: 10, height: 30 });
    fireEvent.dragStart(source, { dataTransfer: transfer });
    fireEvent.dragOver(target, { dataTransfer: transfer, clientY: after ? 39 : 11 });
    assert.equal(target.dataset.drop, after ? "after" : "before");
    fireEvent.drop(target, { dataTransfer: transfer, clientY: after ? 39 : 11 });
    fireEvent.dragEnd(source);
  }
  // jsdom has no native DragEvent, so provide mouse coordinates for midpoint detection.
  const previousDragEvent = window.DragEvent;
  window.DragEvent = window.MouseEvent;
  try {
    fireEvent.change(slot.getByLabelText("Application name 1"), { target: { value: "Renamed Alpha" } });
    drag(0, 2, true);
    assert.deepEqual(labels(), ["Beta", "Gamma", "Renamed Alpha"]);
    assert.equal(saved, undefined);
    drag(2, 0, false);
    assert.deepEqual(labels(), ["Renamed Alpha", "Beta", "Gamma"]);
    assert.equal(slot.container.querySelector("[data-drop]"), null);
    fireEvent.click(slot.getByRole("button", { name: "Save" }));
    await slot.findByText("Settings saved.");
    assert.deepEqual(saved, [{ id: "a/home", label: "Renamed Alpha" }, launcher[1], launcher[2]]);
  } finally { window.DragEvent = previousDragEvent; }
});

test("cancelled and external application drags preserve order; handles support keyboard moves", async () => {
  const launcher = [{ id: "a/home", label: "Alpha" }, { id: "b/home", label: "Beta" }];
  const slot = mount({ language: "en", launcher });
  fireEvent.click(await slot.findByRole("button", { name: "Configure applications" }));
  const rows = () => [...slot.container.querySelectorAll(".db-edit-app")];
  const handle = rows()[0].querySelector(".db-app-drag");
  const transfer = { setData() {}, setDragImage() {} };
  fireEvent.dragStart(handle, { dataTransfer: transfer });
  fireEvent.dragOver(rows()[1], { dataTransfer: transfer });
  fireEvent.dragEnd(handle);
  fireEvent.drop(rows()[1], { dataTransfer: transfer });
  assert.deepEqual(rows().map(row => row.querySelector("input").value), ["Alpha", "Beta"]);
  assert.equal(slot.container.querySelector("[data-drop], [data-dragging]"), null);
  fireEvent.keyDown(handle, { key: "ArrowDown" });
  assert.deepEqual(rows().map(row => row.querySelector("input").value), ["Beta", "Alpha"]);
  fireEvent.click(slot.getByRole("button", { name: "Cancel" }));
  fireEvent.click(slot.getByRole("button", { name: "Configure applications" }));
  assert.deepEqual(rows().map(row => row.querySelector("input").value), ["Alpha", "Beta"]);
});

test("project settings reorder by drag, keyboard and buttons, save tab order and cancel draft changes", async () => {
  const projects = [project, { ...project, id: "p2", name: "Second project" }, { ...project, id: "p3", name: "Third project" }];
  const slot = mount({ connected: true, language: "en", projects });
  const open = () => fireEvent.click(within(slot.container.querySelector(".db-project-bar")).getByRole("button", { name: "Select projects" }));
  await slot.findByRole("button", { name: "Select projects" });
  open();
  const rows = () => [...slot.container.querySelectorAll(".db-edit-project")];
  const names = () => rows().map(row => row.querySelector(".db-project-name").textContent);
  const transfer = { setData() {}, setDragImage() {} };
  const previousDragEvent = window.DragEvent;
  window.DragEvent = window.MouseEvent;
  try {
    function drag(from, to, after) {
      const source = rows()[from].querySelector(".db-project-drag");
      const target = rows()[to];
      target.getBoundingClientRect = () => ({ top: 10, height: 30 });
      fireEvent.dragStart(source, { dataTransfer: transfer });
      fireEvent.dragOver(target, { dataTransfer: transfer, clientY: after ? 39 : 11 });
      assert.equal(target.dataset.drop, after ? "after" : "before");
      fireEvent.drop(target, { dataTransfer: transfer, clientY: after ? 39 : 11 });
      fireEvent.dragEnd(source);
    }
    drag(0, 2, true);
    assert.deepEqual(names(), [projects[1].name, projects[2].name, project.name]);
    drag(2, 0, false);
    assert.deepEqual(names(), projects.map(p => p.name));
    const handle = rows()[0].querySelector(".db-project-drag");
    fireEvent.dragStart(handle, { dataTransfer: transfer });
    fireEvent.dragOver(rows()[1], { dataTransfer: transfer });
    fireEvent.dragEnd(handle);
    fireEvent.drop(rows()[1], { dataTransfer: transfer });
    assert.deepEqual(names(), projects.map(p => p.name));
    assert.equal(slot.container.querySelector("[data-drop], [data-dragging]"), null);
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    fireEvent.click(slot.getByRole("button", { name: `Move ${project.name} down` }));
    assert.deepEqual(names(), [projects[1].name, projects[2].name, project.name]);
    assert.ok(!slot.inspection.rpcCalls.some(call => call.method === "projects_set"));
    fireEvent.click(slot.getByRole("button", { name: "Save" }));
    await slot.findByText("Settings saved.");
    assert.deepEqual(slot.inspection.rpcCalls.find(call => call.method === "projects_set").input.ids, ["p2", "p3", "p1"]);
    assert.deepEqual([...slot.getAllByRole("tab")].filter(tab => tab.id.startsWith("db-project-tab")).map(tab => tab.textContent), [projects[1].name, projects[2].name, project.name]);
    open();
    assert.deepEqual(names(), [projects[1].name, projects[2].name, project.name]);
    fireEvent.click(slot.getByRole("button", { name: "Remove Second project from the dashboard" }));
    assert.equal(slot.getByRole("checkbox", { name: "Second project" }).checked, false);
    fireEvent.click(slot.getByRole("button", { name: "Cancel" }));
    open();
    assert.deepEqual(names(), [projects[1].name, projects[2].name, project.name]);
  } finally { window.DragEvent = previousDragEvent; }
});

test("a missing language preference uses English even with a Russian document language", async () => {
  const slot = mount({ language: null });
  await slot.findByText("Choose projects to follow");
  assert.equal(slot.container.querySelector(".db-root").lang, "en");
  assert.ok(slot.getByRole("combobox", { name: "Show threads" }));
  assert.ok(slot.getByRole("button", { name: "Configure applications" }));
  assert.equal(slot.queryByText("Выберите проекты для работы"), null);
});

test("switching language preserves the mounted chat, search, filter, and launcher draft", async () => {
  const slot = mount({ language: "en", connected: true, threads: [thread("t1", "p1", "Тред", { isUnread: true })], launcher: [{ id: item.id, label: "Мои заметки" }] });
  const chat = await slot.findByTestId("bb-thread-chat");
  fireEvent.click(slot.getByRole("button", { name: "Search threads" }));
  fireEvent.change(slot.getByRole("searchbox"), { target: { value: "Тред" } });
  fireEvent.change(slot.getByRole("combobox", { name: "Show threads" }), { target: { value: "attention" } });
  fireEvent.click(slot.getByRole("button", { name: "Configure applications" }));
  const draft = slot.getByLabelText("Application name 1");
  fireEvent.change(draft, { target: { value: "Personal shortcut" } });
  await slot.setLanguage("ru");
  assert.equal(slot.container.querySelector(".db-root").lang, "ru");
  assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  assert.equal(slot.getByRole("searchbox").value, "Тред");
  assert.equal(slot.getByRole("combobox", { name: "Показывать треды" }).value, "attention");
  assert.equal(slot.getByLabelText("Название приложения 1").value, "Personal shortcut");
  assert.ok(slot.getByText("Тестовый проект"));
  await slot.setLanguage("en");
  assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  assert.equal(slot.getByLabelText("Application name 1").value, "Personal shortcut");
});

test("plugin-owned errors are translated again when language changes", async () => {
  const slot = mount({ language: "en", rpcOverrides: { projects_set: () => { throw new Error("DASHBOARD_PROJECT_UNAVAILABLE"); } } });
  await slot.findByText("Choose projects to follow");
  fireEvent.click(within(slot.container.querySelector(".db-project-bar")).getByRole("button", { name: "Select projects" }));
  fireEvent.click(slot.getByRole("button", { name: "Save" }));
  await slot.findByText("This project is no longer available. Refresh the list.");
  await slot.setLanguage("ru");
  assert.ok(slot.getByText("Проект больше не доступен. Обновите список."));
  assert.equal(slot.queryByText("This project is no longer available. Refresh the list."), null);
});

test("launcher collapse preserves the mounted chat, restores focus and persists across remounts", async () => {
  const slot = mount({ connected: true, threads: [thread("t1", "p1", "Тред", { isUnread: true })] });
  const chat = await slot.findByTestId("bb-thread-chat");
  const toggle = slot.getByRole("button", { name: "Скрыть приложения" });
  const settings = slot.getByRole("button", { name: "Настроить приложения" });
  settings.focus();
  fireEvent.keyDown(settings, { key: "Escape" });
  assert.equal(document.activeElement, toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  const panel = document.getElementById(toggle.getAttribute("aria-controls"));
  assert.equal(panel.getAttribute("aria-hidden"), "true");
  assert.ok(panel.hasAttribute("inert"));
  assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  slot.lifecycle.unmount();
  const next = mount();
  const reopen = await next.findByRole("button", { name: "Показать приложения" });
  fireEvent.click(reopen);
  assert.equal(reopen.getAttribute("aria-expanded"), "true");
  assert.equal(next.getByRole("separator").getAttribute("aria-valuenow"), "208");
});

test("launcher drag and keyboard resizing are bounded and remembered with its open state", async () => {
  const slot = mount();
  const resize = await slot.findByRole("separator", { name: "Ширина панели приложений" });
  resize.setPointerCapture = () => {};
  resize.hasPointerCapture = () => true;
  resize.releasePointerCapture = () => {};
  const pointer = (type, x, extra = {}) => {
    const event = new dom.window.MouseEvent(type, { bubbles: true, clientX: x, button: 0 });
    Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true }, ...extra });
    fireEvent(resize, event);
  };
  pointer("pointerdown", 208);
  pointer("pointermove", 328);
  assert.equal(resize.getAttribute("aria-valuenow"), "328");
  pointer("pointerup", 328);
  assert.equal(JSON.parse(window.localStorage.getItem("bb-dashboard:launcher-layout:v1")).width, 328);
  fireEvent.keyDown(resize, { key: "End" });
  assert.equal(resize.getAttribute("aria-valuenow"), "480");
  fireEvent.keyDown(resize, { key: "ArrowRight" });
  assert.equal(resize.getAttribute("aria-valuenow"), "480");
  fireEvent.keyDown(resize, { key: "Home" });
  fireEvent.keyDown(resize, { key: "ArrowLeft" });
  assert.equal(resize.getAttribute("aria-valuenow"), "176");
  fireEvent.keyDown(resize, { key: "ArrowRight", shiftKey: true });
  fireEvent.click(slot.getByRole("button", { name: "Скрыть приложения" }));
  slot.lifecycle.unmount();
  const next = mount();
  fireEvent.click(await next.findByRole("button", { name: "Показать приложения" }));
  assert.equal(next.getByRole("separator").getAttribute("aria-valuenow"), "226");
});

test("invalid saved layout falls back safely and unavailable storage does not break controls", async () => {
  window.localStorage.setItem("bb-dashboard:launcher-layout:v1", "{bad json");
  const slot = mount();
  const resize = await slot.findByRole("separator");
  assert.equal(resize.getAttribute("aria-valuenow"), "208");
  const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("Storage disabled"); } });
  try {
    fireEvent.keyDown(resize, { key: "ArrowRight" });
    fireEvent.click(slot.getByRole("button", { name: "Скрыть приложения" }));
    assert.ok(slot.getByRole("button", { name: "Показать приложения" }));
    slot.lifecycle.unmount();
    const next = mount();
    assert.ok(await next.findByRole("button", { name: "Скрыть приложения" }));
  } finally { Object.defineProperty(window, "localStorage", descriptor); }
});

test("narrow panes constrain width without overwriting the preference and expose launcher settings", async () => {
  const originalObserver = globalThis.ResizeObserver;
  const callbacks = new Map();
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe(element) { callbacks.set(element, this.callback); }
    disconnect() {}
  };
  window.localStorage.setItem("bb-dashboard:launcher-layout:v1", JSON.stringify({ open: true, width: 400 }));
  try {
    const slot = mount();
    const resize = await slot.findByRole("separator");
    const root = slot.container.querySelector(".db-root");
    let width = 300;
    Object.defineProperty(root, "clientWidth", { get: () => width });
    await act(async () => callbacks.get(root)());
    assert.equal(resize.getAttribute("aria-valuenow"), "256");
    assert.equal(JSON.parse(window.localStorage.getItem("bb-dashboard:launcher-layout:v1")).width, 400);
    assert.ok(slot.getByRole("button", { name: "Показать приложения" }));
    fireEvent.click(slot.getByRole("button", { name: "Показать приложения" }));
    fireEvent.click(slot.getByRole("button", { name: "Настроить приложения" }));
    assert.equal(slot.getByRole("button", { name: "Скрыть приложения" }).getAttribute("aria-expanded"), "true");
    assert.ok(slot.getByRole("dialog", { name: "Настройка приложений" }));
    width = 1200;
    await act(async () => callbacks.get(root)());
    assert.equal(resize.getAttribute("aria-valuenow"), "400");
    fireEvent.click(slot.container.querySelector(".db-launcher-backdrop"));
    assert.ok(slot.getByRole("button", { name: "Показать приложения" }));
  } finally {
    if (originalObserver === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = originalObserver;
  }
});
test("narrow mode collapses automatically and restores the desktop layout after temporary interactions", async () => {
  const originalObserver = globalThis.ResizeObserver;
  const callbacks = new Map();
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe(target) { callbacks.set(target, this.callback); }
    disconnect() {}
  };
  try {
    for (const open of [true, false]) {
      const saved = { open, width: 400 };
      window.localStorage.setItem("bb-dashboard:launcher-layout:v1", JSON.stringify(saved));
      const slot = mount({ connected: true, threads: [thread("t1", "p1", "Тред", { isUnread: true })] });
      const chat = await slot.findByTestId("bb-thread-chat");
      const root = slot.container.querySelector(".db-root");
      const resize = slot.getByRole("separator", { hidden: true });
      let width = 1200;
      Object.defineProperty(root, "clientWidth", { get: () => width });
      const measure = callbacks.get(root);
      await act(async () => measure());
      for (const narrowWidth of [680, 480]) {
        width = narrowWidth;
        await act(async () => measure());
        assert.equal(slot.container.querySelector(".db-layout").dataset.launcherOpen, "false");
        fireEvent.click(slot.getByRole("button", { name: "Показать приложения" }));
        fireEvent.keyDown(resize, { key: "Home" });
        fireEvent.click(slot.container.querySelector(".db-launcher-backdrop"));
        assert.deepEqual(JSON.parse(window.localStorage.getItem("bb-dashboard:launcher-layout:v1")), saved);
        width = 1200;
        await act(async () => measure());
        assert.equal(slot.container.querySelector(".db-layout").dataset.launcherOpen, String(open));
        assert.equal(resize.getAttribute("aria-valuenow"), "400");
        assert.equal(slot.getByTestId("bb-thread-chat"), chat);
      }
      slot.lifecycle.unmount();
    }
  } finally {
    if (originalObserver === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = originalObserver;
  }
});

test("project settings render in Russian and save the selected project", async () => {
  const slot = mount();
  await slot.findByText("Выберите проекты для работы");
  fireEvent.click(within(slot.container.querySelector(".db-project-bar")).getByRole("button", { name: "Выбрать проекты", exact: true }));
  fireEvent.click(slot.getByRole("checkbox", { name: "Тестовый проект" }));
  fireEvent.click(slot.getByRole("button", { name: "Сохранить", exact: true }));
  await slot.findByText("Настройки сохранены.");
  assert.ok(slot.inspection.rpcCalls.some(call => call.method === "projects_set" && call.input.ids[0] === "p1"));
  assert.ok(slot.getByText("Сейчас нет активных тредов. Можно создать новый."));
});
test("launcher main and adjacent-area controls issue separate native targets", async () => {
  const slot = mount({ launcher: [{ id: item.id, label: item.label }] });
  await slot.findByText("Заметки");
  fireEvent.click(slot.getByRole("button", { name: "Заметки", exact: true }));
  fireEvent.click(slot.getByRole("button", { name: "Открыть Заметки рядом", exact: true }));
  const calls = slot.navigation.inspection.sidebarNavigationCalls;
  assert.equal(calls.length, 2);
  assert.match(JSON.stringify(calls[0]), /current/);
  assert.match(JSON.stringify(calls[1]), /split/);
  assert.equal(slot.inspection.sidebarNavigationCalls.length, 0);
});

test("launcher discovers hidden plugin screens through the sidebar bridge and persists their ids", async () => {
  const slot = mount({ navigationItems: [{ ...item, isVisible: false }, { ...item, id: "dashboard/dashboard", pluginId: "dashboard", label: "BBDesk" }] });
  await slot.findByText("Выберите проекты для работы");
  fireEvent.click(slot.getByRole("button", { name: "Настроить приложения" }));
  fireEvent.click(slot.getByRole("checkbox", { name: "Заметки" }));
  assert.equal(slot.queryByRole("checkbox", { name: "BBDesk" }), null);
  fireEvent.click(slot.getByRole("button", { name: "Сохранить", exact: true }));
  await slot.findByText("Настройки сохранены.");
  assert.ok(slot.getByRole("button", { name: "Заметки", exact: true }));
  assert.deepEqual(slot.inspection.rpcCalls.find(call => call.method === "launcher_set").input.items, [{ id: item.id, label: item.label }]);
});

test("navigation wrapper preserves the original rail and releases stale actions when unmounted", async () => {
  const slot = mount({ launcher: [{ id: item.id, label: item.label }] });
  await slot.findByText("Заметки");
  assert.equal(slot.getByRole("button", { name: "Заметки", exact: true }).disabled, false);
  await act(async () => slot.navigation.lifecycle.unmount());
  assert.equal(slot.getByRole("button", { name: "Открыть Заметки рядом" }).disabled, true);
  fireEvent.click(slot.getByRole("button", { name: "Настроить приложения" }));
  assert.ok(slot.getByText(/выберите «BBDesk»/));
  assert.equal(slot.queryByText(/Установите плагин/), null);
  cleanup();
  const rail = renderSlot(app.experimentalSidebarNavigations[0], { isCompactViewport: false, placement: "rail", experimental_Original: () => createElement("span", null, "Original rail") }, { sidebarNavigation: { items: [] } });
  assert.ok(rail.getByText("Original rail"));
});

test("missing, loading and disabled destinations keep saved shortcuts disabled", async () => {
  const slot = mount({ launcher: [{ id: item.id, label: item.label }], navigationItems: [{ ...item, isDisabled: true }] });
  await slot.findByText("Заметки");
  assert.equal(slot.getByRole("button", { name: "Открыть Заметки рядом" }).disabled, true);
  slot.lifecycle.unmount();
  const missing = mount({ launcher: [{ id: item.id, label: item.label }], navigationItems: [] });
  await missing.findByText("Заметки");
  assert.equal(missing.getByRole("button", { name: "Открыть Заметки рядом" }).disabled, true);
  missing.lifecycle.unmount();
  const loading = mount({ launcher: [{ id: item.id, label: item.label }], navigationItems: [{ ...item, isLoading: true }] });
  await loading.findByText("Заметки");
  assert.equal(loading.getByRole("button", { name: "Открыть Заметки рядом" }).disabled, true);
});
test("long application labels stay intact in the DOM and split remains an independent button", async () => {
  const label = "Приложение с очень длинным названием для проверки узкой панели";
  const slot = mount({ launcher: [{ id: item.id, label }] });
  await slot.findByText(label);
  assert.equal(slot.getByRole("button", { name: label, exact: true }).querySelector("button"), null);
  assert.ok(slot.getByRole("button", { name: `Открыть ${label} рядом` }));
});
test("thread heading renders Russian status with environment only in the tooltip", async () => {
  const slot = mount({ connected: true, threads: [{
    id: "t1", projectId: "p1", displayTitle: "Проверка русского треда", status: "idle", runtimeStatus: "idle",
    queuedWork: "none", hasPendingInteraction: false, isUnread: false, isHidden: false, isArchived: false,
    latestAttentionAt: 150, activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    environment: { name: "Основное окружение" }, host: null,
  }] });
  await slot.findByTestId("bb-thread-chat");
  assert.ok(slot.getByText("Просмотрено"));
  const heading = slot.container.querySelector(".db-thread-open");
  assert.equal(within(heading).queryByText("Основное окружение"), null);
  assert.ok(heading.title.includes("Основное окружение"));
  assert.ok(slot.getByRole("button", { name: "Убрать «Проверка русского треда» с рабочего стола" }));
});
const secondProject = { ...project, id: "p2", name: "Второй проект" };
function thread(id, projectId, displayTitle, changes = {}) {
  return { id, projectId, displayTitle, status: "idle", runtimeStatus: "idle", queuedWork: "none", hasPendingInteraction: false,
    isUnread: false, isHidden: false, isArchived: false, latestAttentionAt: 150,
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    environment: { name: "Основное окружение" }, host: null, ...changes };
}

test("previous threads use BB update order, show compact titles and keep the selected chat when the panel closes", async () => {
  const previous = Array.from({ length: 12 }, (_, i) => thread(`old${i}`, "p1", `Прошлый ${i}`, { latestAttentionAt: 200 + i, updatedAt: 400 - i }));
  const slot = mount({ connected: true, threads: [thread("active", "p1", "Текущий"), ...previous], hiddenIds: previous.map(t => t.id) });
  const toggle = await slot.findByRole("button", { name: "Показать последние 10 тредов" });
  assert.equal(toggle.querySelector("path").getAttribute("d"), "m6 15 6-6 6 6");
  assert.equal(slot.queryByText("Прошлый 11"), null);
  fireEvent.click(toggle);
  const history = slot.getByRole("region", { name: "Прошлые треды" });
  assert.equal(toggle.querySelector("path").getAttribute("d"), "m6 9 6 6 6-6");
  assert.equal(history.querySelectorAll(".db-history-thread .db-state, .db-history-thread svg").length, 0);
  assert.ok(history.querySelector(".db-conversation-meta time"));
  assert.deepEqual([...history.querySelectorAll(".db-thread-title")].map(el => el.textContent), previous.slice(2).reverse().map(t => t.displayTitle));
  fireEvent.click(within(history).getByRole("button", { name: "Прошлый 11", exact: true }));
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "old11");
  assert.equal(slot.container.querySelectorAll(".db-thread-indicator").length, 1);
  assert.equal(slot.container.querySelector(".db-project").getAttribute("data-single-chat"), "false");
  fireEvent.click(within(history).getByRole("button", { name: "Прошлый 10", exact: true }));
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "old10");
  const selectedChat = slot.getByTestId("bb-thread-chat");
  fireEvent.click(within(history).getByRole("button", { name: "Прошлый 10", exact: true }));
  assert.equal(slot.getByTestId("bb-thread-chat"), selectedChat);
  fireEvent.click(slot.getByRole("button", { name: "Скрыть прошлые треды" }));
  assert.equal(slot.queryByRole("region", { name: "Прошлые треды" }), null);
  assert.equal(slot.getByTestId("bb-thread-chat"), selectedChat);
  fireEvent.click(slot.getByRole("button", { name: "Показать последние 10 тредов" }));
  assert.equal(slot.getByTestId("bb-thread-chat"), selectedChat);
  assert.equal(slot.container.querySelectorAll(".db-thread-indicator").length, 1);
});

test("history excludes other projects, archived, hidden BB threads and subagents", async () => {
  const previous = [
    thread("previous", "p1", "Доступный прошлый"),
    thread("archived", "p1", "Архивный", { isArchived: true }),
    thread("hidden", "p1", "Скрытый BB", { isHidden: true }),
    thread("worker", "p1", "Субагент", { parentThreadId: "previous" }),
    thread("other", "p2", "Другой проект"),
  ];
  const slot = mount({ connected: true, threads: previous, hiddenIds: previous.map(t => t.id) });
  fireEvent.click(await slot.findByRole("button", { name: "Показать последние 10 тредов" }));
  const history = slot.getByRole("region", { name: "Прошлые треды" });
  assert.deepEqual([...history.querySelectorAll(".db-thread-title")].map(el => el.textContent), ["Доступный прошлый"]);
});

test("empty history has a localized empty state", async () => {
  const slot = mount({ connected: true, language: "en" });
  fireEvent.click(await slot.findByRole("button", { name: "Show last 10 threads" }));
  assert.ok(slot.getByText("No previous threads in this project."));
  await slot.setLanguage("ru");
  assert.ok(slot.getByText("В этом проекте пока нет прошлых тредов."));
});

test("subagents have indicators without rows and completion returns the open chat to the manager", async () => {
  const threads = [
    thread("manager", "p1", "Менеджер", { status: "active" }),
    thread("worker", "p1", "Research", { parentThreadId: "manager", status: "active" }),
  ];
  const slot = mount({ connected: true, threads });
  assert.equal((await slot.findByTestId("bb-thread-chat")).dataset.threadId, "manager");
  const tab = slot.getByRole("tab", { name: /^Тестовый проект,/ });
  const strip = slot.getByRole("group", { name: /^Треды всех проектов/ });
  assert.equal(tab.querySelectorAll(".db-dot").length, 2);
  assert.equal(slot.container.querySelectorAll(".db-thread-line").length, 1);
  assert.equal(slot.queryByRole("button", { name: /^Research/ }), null);
  fireEvent.click(within(strip).getByRole("button", { name: "Тестовый проект · Research: Субагент работает" }));
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "worker");
  assert.equal(slot.container.querySelectorAll(".db-thread-line").length, 1);
  threads[1] = { ...threads[1], status: "idle", isUnread: true, latestAttentionAt: 200 };
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "manager");
  assert.equal(tab.querySelectorAll(".db-dot").length, 1);
  assert.equal(strip.querySelectorAll(".db-dot").length, 1);
  assert.equal(slot.queryByText("Research"), null);
  assert.equal(slot.inspection.sdkCalls.filter(call => /archive|delete|stop|send/.test(call.method)).length, 0);
  threads[1] = { ...threads[1], status: "active" };
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(tab.querySelectorAll(".db-dot").length, 2);
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "manager");
});

test("finished subagents stay absent on mount while independent forks retain their rows", async () => {
  const slot = mount({ connected: true, threads: [
    thread("worker", "p1", "Завершённый Research", { parentThreadId: "manager", isUnread: true }),
    thread("fork", "p1", "Самостоятельная ветка", { parentThreadId: "manager", originKind: "fork", isUnread: true }),
  ] });
  assert.equal((await slot.findByTestId("bb-thread-chat")).dataset.threadId, "fork");
  assert.equal(slot.container.querySelectorAll(".db-thread-line").length, 1);
  assert.equal(slot.getByRole("tab", { name: /^Тестовый проект,/ }).querySelectorAll(".db-dot").length, 1);
  assert.equal(slot.queryByText("Завершённый Research"), null);
});

test("a project with only a subagent shows its indicator without auto-opening its chat", async () => {
  const threads = [thread("worker", "p1", "Research", { parentThreadId: "manager", status: "active" })];
  const slot = mount({ connected: true, threads });
  await slot.findByRole("tab", { name: /^Тестовый проект,/ });
  assert.equal(slot.container.querySelectorAll(".db-thread-line").length, 0);
  assert.equal(slot.queryByTestId("bb-thread-chat"), null);
  assert.equal(slot.getByRole("tab", { name: /^Тестовый проект,/ }).querySelectorAll(".db-dot").length, 1);
  fireEvent.click(slot.getByRole("button", { name: "Тестовый проект · Research: Субагент работает" }));
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "worker");
  threads[0] = { ...threads[0], status: "idle" };
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(slot.queryByTestId("bb-thread-chat"), null);
  assert.equal(slot.getByRole("tab", { name: /^Тестовый проект,/ }).querySelectorAll(".db-dot").length, 0);
});
test("project tabs show only the selected project's threads", async () => {
  const slot = mount({ connected: true, projects: [project, secondProject], threads: [thread("t1", "p1", "Задача первого проекта"), thread("t2", "p2", "Задача второго проекта")] });
  await slot.findByRole("tab", { name: /^Тестовый проект,/ });
  assert.equal(slot.getAllByRole("tabpanel").length, 1);
  assert.ok(slot.getAllByText("Задача первого проекта"));
  assert.equal(slot.queryByText("Задача второго проекта"), null);
  fireEvent.click(slot.getByRole("tab", { name: /^Второй проект,/ }));
  assert.ok(slot.getAllByText("Задача второго проекта"));
  assert.equal(slot.queryByText("Задача первого проекта"), null);
  assert.equal(slot.getByRole("tab", { name: /^Второй проект,/ }).getAttribute("aria-selected"), "true");
});
test("header strip represents every thread once without visible labels or project grouping", async () => {
  const slot = mount({ connected: true, projects: [project, secondProject], threads: [
    thread("t1", "p1", "Первая работа", { status: "active" }),
    thread("t2", "p1", "Вторая работа", { status: "active", queuedWork: "waiting" }),
    thread("t3", "p1", "Нужен ответ", { status: "active", hasPendingInteraction: true }),
    thread("t4", "p1", "Готовый результат"),
    thread("t5", "p1", "Закрытый результат", { isArchived: true }),
  ] });
  const first = await slot.findByRole("tab", { name: /^Тестовый проект,/ });
  assert.equal(first.textContent, project.name);
  assert.equal(first.querySelectorAll(".db-dot").length, 4);
  assert.equal(first.querySelectorAll(".db-dot.running").length, 2);
  assert.equal(first.querySelectorAll(".db-dot.attention").length, 1);
  assert.equal(first.querySelectorAll(".db-dot.read").length, 1);
  assert.equal(first.querySelector(".db-dot.read").title, "Готовый результат: Просмотрено");
  const strip = within(slot.getByRole("banner")).getByRole("group", { name: /^Треды всех проектов/ });
  assert.equal(strip.textContent, "");
  assert.equal(strip.querySelectorAll(".db-dot").length, 4);
  assert.equal(strip.querySelectorAll(".db-dot.running").length, 2);
  assert.equal(strip.querySelectorAll(".db-dot.attention").length, 1);
  assert.equal(strip.querySelectorAll(".db-dot.read").length, 1);
  assert.equal(strip.querySelector(".db-dot.read").closest("button").title, "Тестовый проект · Готовый результат: Просмотрено");
  assert.ok(first.getAttribute("aria-label").includes("Готовый результат: Просмотрено"));
  const empty = slot.getByRole("tab", { name: /^Второй проект,/ });
  assert.equal(empty.querySelectorAll(".db-dot").length, 0);
  assert.equal(empty.textContent, secondProject.name);
  assert.ok(empty.title.includes("Нет активности"));
  fireEvent.change(slot.getByRole("combobox", { name: "Показывать треды" }), { target: { value: "attention" } });
  assert.equal(strip.querySelectorAll(".db-dot").length, 4);
  assert.equal(first.querySelectorAll(".db-dot").length, 4);
});

test("header indicators separate work, results and blocking decisions", async () => {
  const threads = [
    thread("work", "p1", "Работа", { status: "active" }),
    thread("queued", "p1", "Очередь", { queuedWork: "waiting" }),
    thread("result", "p1", "Новый результат", { isUnread: true }),
    thread("decision", "p1", "Разрешение", { status: "active", hasPendingInteraction: true }),
    thread("error", "p1", "Ошибка", { status: "error" }),
    thread("unknown", "p1", "Неизвестный статус", { status: "future-state" }),
    thread("read", "p1", "Просмотренный результат"),
  ];
  const slot = mount({ connected: true, threads });
  await slot.findByRole("tab", { name: /^Тестовый проект, в работе: 1, требуют внимания: 1, в очереди: 1, результаты: 2/ });
  const tab = slot.getByRole("group", { name: /^Треды всех проектов/ });
  const projectTab = slot.getByRole("tab", { name: /^Тестовый проект,/ });
  assert.equal(tab.querySelectorAll(".db-dot").length, 7);
  assert.equal(projectTab.querySelectorAll(".db-dot").length, 7);
  for (const tone of ["running", "waiting", "result", "attention", "error", "unknown", "read"]) {
    assert.equal(tab.querySelectorAll(`.db-dot.${tone}`).length, 1);
    assert.equal(projectTab.querySelectorAll(`.db-dot.${tone}`).length, 1);
  }
  assert.equal(tab.querySelectorAll(".db-working-ring").length, 2);
  assert.ok(tab.querySelector(".db-dot.running svg"));
  assert.ok(tab.querySelector(".db-dot.waiting svg"));
  assert.equal(tab.querySelector(".db-dot.result svg"), null);
  assert.equal(tab.querySelector(".db-dot.attention svg"), null);
  assert.equal(tab.querySelector(".db-dot.result").closest("button").title, "Тестовый проект · Новый результат: Новый ответ");
  assert.equal(tab.querySelector(".db-dot.attention").closest("button").title, "Тестовый проект · Разрешение: Нужно действие");
  threads[3] = { ...threads[3], hasPendingInteraction: false };
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(tab.querySelectorAll(".db-dot.attention").length, 0);
  assert.equal(tab.querySelectorAll(".db-dot.running").length, 2);
  assert.equal(projectTab.querySelectorAll(".db-dot.attention").length, 0);
  assert.equal(projectTab.querySelectorAll(".db-dot.running").length, 2);
  threads[0] = { ...threads[0], status: "idle", isUnread: true };
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(tab.querySelectorAll(".db-dot.result").length, 2);
  assert.equal(tab.querySelectorAll(".db-working-ring").length, 2);
  threads[0] = { ...threads[0], isUnread: false };
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(tab.querySelectorAll(".db-dot.read").length, 2);
  assert.equal(projectTab.querySelectorAll(".db-dot.read").length, 2);
});

test("header opens a specific thread across projects despite filters and keeps stable indicator order", async () => {
  const threads = [thread("t3", "p2", "Выбранный тред"), thread("t1", "p1", "Первый тред"), thread("t2", "p2", "Другой тред")];
  const slot = mount({ connected: true, projects: [project, secondProject], threads });
  await slot.findByRole("tab", { name: /^Тестовый проект,/ });
  const strip = slot.getByRole("group", { name: /^Треды всех проектов/ });
  const ids = () => [...strip.querySelectorAll("button")].map(button => button.dataset.threadId);
  assert.deepEqual(ids(), ["t1", "t2", "t3"]);
  fireEvent.change(slot.getByRole("combobox", { name: "Показывать треды" }), { target: { value: "attention" } });
  fireEvent.click(slot.getByRole("button", { name: "Поиск тредов" }));
  fireEvent.change(slot.getByRole("searchbox"), { target: { value: "нет совпадений" } });
  const indicator = within(strip).getByRole("button", { name: "Второй проект · Выбранный тред: Просмотрено" });
  fireEvent.click(indicator);
  assert.equal(slot.getByRole("tab", { name: /^Второй проект,/ }).getAttribute("aria-selected"), "true");
  const chat = slot.getByTestId("bb-thread-chat");
  assert.equal(chat.getAttribute("data-thread-id"), "t3");
  assert.equal(indicator.getAttribute("aria-pressed"), "true");
  threads[0] = { ...threads[0], status: "active" };
  threads.reverse();
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.deepEqual(ids(), ["t1", "t2", "t3"]);
  assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  assert.equal(indicator.getAttribute("aria-pressed"), "true");
});

test("project tabs show one quiet provider icon for each distinct provider among open threads", async () => {
  const slot = mount({
    connected: true, language: "en", projects: [project, secondProject], hiddenIds: ["z"],
    providers: { status: "ready", providers: [
      { id: "claude", displayName: "Claude", logoUrl: "/logos/claude.svg", icon: { glyph: "Sparkle" }, strings: { iconTint: { light: "#111111", dark: "#eeeeee" } } },
      { id: "codex", displayName: "Codex", logoUrl: null },
      { id: "worker", displayName: "Worker", logoUrl: null },
    ] },
    threads: [
      thread("b", "p1", "Beta", { providerId: "claude" }),
      thread("a", "p1", "Alpha", { providerId: "codex" }),
      thread("c", "p1", "Gamma", { providerId: "claude" }),
      thread("sub", "p1", "Helper", { providerId: "worker", parentThreadId: "a", status: "active" }),
      thread("done", "p1", "Finished helper", { providerId: "retired", parentThreadId: "a" }),
      thread("z", "p1", "Hidden", { providerId: "ghost" }),
      thread("other", "p2", "Elsewhere", { providerId: "codex" }),
    ],
  });
  const tab = await slot.findByRole("tab", { name: /^Тестовый проект,/ });
  const icons = [...tab.querySelectorAll(".db-project-provider")];
  assert.deepEqual(icons.map(icon => icon.getAttribute("data-provider-id")), ["codex", "claude", "worker"]);
  assert.equal(icons[0].parentElement.getAttribute("title"), "Codex: Alpha");
  assert.equal(icons[1].parentElement.getAttribute("title"), "Claude: Beta, Gamma");
  assert.equal(icons[1].getAttribute("data-provider-logo"), "/logos/claude.svg");
  assert.equal(icons[1].getAttribute("data-provider-glyph"), "Sparkle");
  assert.equal(icons[1].getAttribute("data-provider-kind"), "agent");
  assert.equal(icons[0].getAttribute("aria-hidden"), "true");
  assert.equal(tab.querySelectorAll(".db-dot").length, 4);
  const name = tab.querySelector(".db-project-tab-name");
  assert.equal(name.textContent, "Тестовый проект");
  assert.ok(icons[0].compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(name.compareDocumentPosition(tab.querySelector(".db-project-tab-states")) & Node.DOCUMENT_POSITION_FOLLOWING);
  assert.match(tab.getAttribute("aria-label"), /Alpha: Read \(Codex\).*Beta: Read \(Claude\).*Gamma: Read \(Claude\).*Helper: Subagent working \(Worker\)/);
  assert.doesNotMatch(tab.getAttribute("aria-label"), /Finished helper|Hidden|Elsewhere/);
  const second = slot.getByRole("tab", { name: /^Второй проект,/ });
  assert.deepEqual([...second.querySelectorAll(".db-project-provider")].map(icon => icon.getAttribute("data-provider-id")), ["codex"]);
});
test("tabs expose live project status and support arrows, Home and End", async () => {
  const slot = mount({ connected: true, projects: [project, secondProject], threads: [thread("t1", "p1", "Работа", { status: "active" }), thread("t2", "p2", "Вопрос", { hasPendingInteraction: true })] });
  const first = await slot.findByRole("tab", { name: /^Тестовый проект, в работе: 1/ });
  const second = slot.getByRole("tab", { name: /^Второй проект, в работе: 0, требуют внимания: 1/ });
  fireEvent.keyDown(first, { key: "ArrowRight" });
  assert.equal(second.getAttribute("aria-selected"), "true");
  assert.equal(document.activeElement, second);
  fireEvent.keyDown(second, { key: "Home" });
  assert.equal(first.getAttribute("aria-selected"), "true");
  fireEvent.keyDown(first, { key: "End" });
  assert.equal(second.getAttribute("aria-selected"), "true");
});
test("plus on an inactive project tab selects it and opens its own new-thread composer", async () => {
  const slot = mount({ connected: true, projects: [project, secondProject] });
  const create = await slot.findByRole("button", { name: "Новый тред в проекте «Второй проект»" });
  assert.equal(create.closest('[role="tab"]'), null);
  fireEvent.click(create);
  assert.equal(slot.getByRole("tab", { name: /^Второй проект,/ }).getAttribute("aria-selected"), "true");
  assert.ok(slot.getByText("Новый тред · Второй проект"));
  assert.equal(slot.inspection.sdkCalls.filter(call => call.method === "threads.spawn").length, 0);
});
test("header search and filter apply to the selected project without moving controls into the workspace", async () => {
  const slot = mount({ connected: true, threads: [thread("t1", "p1", "Нужен ответ", { hasPendingInteraction: true }), thread("t2", "p1", "Прочитанный результат")] });
  await slot.findByText("Прочитанный результат");
  await slot.findByTestId("bb-thread-chat");
  fireEvent.click(slot.getByRole("button", { name: /^Нужен ответ/, expanded: true }));
  fireEvent.change(slot.getByRole("combobox", { name: "Показывать треды" }), { target: { value: "attention" } });
  assert.equal(slot.queryByText("Прочитанный результат"), null);
  assert.ok(slot.getByText("Нужен ответ"));
  fireEvent.click(slot.getByRole("button", { name: "Поиск тредов" }));
  fireEvent.change(slot.getByRole("searchbox", { name: "Найти тред" }), { target: { value: "нет совпадений" } });
  assert.ok(slot.getByText("Треды не найдены."));
  fireEvent.click(slot.getByRole("button", { name: "Закрыть поиск" }));
  assert.ok(slot.getByText("Нужен ответ"));
});

test("project conversation memory survives navigation and remounts and falls back when a conversation disappears", async () => {
  const threads = [thread("a", "p1", "Running", { status: "active" }), thread("b", "p1", "Reading"), thread("c", "p2", "Other")];
  let slot = mount({ connected: true, projects: [project, secondProject], threads });
  await slot.findByTestId("bb-thread-chat");
  fireEvent.click(slot.getByRole("tab", { name: "Reading: Просмотрено" }));
  fireEvent.click(slot.getByRole("tab", { name: /^Второй проект,/ }));
  fireEvent.click(slot.getByRole("tab", { name: /^Тестовый проект,/ }));
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "b");
  slot.lifecycle.unmount();
  slot = mount({ connected: true, projects: [project, secondProject], threads });
  assert.equal((await slot.findByTestId("bb-thread-chat")).dataset.threadId, "b");
  slot.lifecycle.unmount();
  slot = mount({ connected: true, projects: [project, secondProject], threads: threads.filter(t => t.id !== "b") });
  assert.equal((await slot.findByTestId("bb-thread-chat")).dataset.threadId, "a");
});

test("history selection survives remount without importing the historical thread into working tabs", async () => {
  const threads = [thread("a", "p1", "Running", { status: "active" }), thread("old", "p1", "Previous", { latestAttentionAt: 10 })];
  let slot = mount({ connected: true, threads, hiddenIds: ["old"] });
  await slot.findByTestId("bb-thread-chat");
  fireEvent.click(slot.getByRole("button", { name: "Показать последние 10 тредов" }));
  fireEvent.click(within(slot.getByRole("region", { name: "Прошлые треды" })).getByRole("button", { name: "Previous" }));
  slot.lifecycle.unmount();
  slot = mount({ connected: true, threads, hiddenIds: ["old"] });
  assert.equal((await slot.findByTestId("bb-thread-chat")).dataset.threadId, "old");
  assert.equal(within(slot.getByRole("tablist", { name: "Треды проекта" })).queryByRole("tab", { name: /^Previous/ }), null);
});

test("unified search finds history beyond ten and keeps the native chat mounted while typing", async () => {
  const old = Array.from({ length: 14 }, (_, i) => thread(`old${i}`, "p1", `Archive candidate ${i}`, { latestAttentionAt: i + 1 }));
  const threads = [thread("work", "p1", "Working", { status: "active" }), ...old,
    thread("archived", "p1", "Archive candidate archived", { isArchived: true }),
    thread("hidden", "p1", "Archive candidate hidden", { isHidden: true }),
    thread("child", "p1", "Archive candidate child", { parentThreadId: "work", status: "active" }),
    thread("other", "p2", "Archive candidate other")];
  const slot = mount({ connected: true, projects: [project, secondProject], threads, hiddenIds: old.map(t => t.id) });
  const chat = await slot.findByTestId("bb-thread-chat");
  const opener = slot.getByRole("button", { name: "Поиск тредов" }); opener.focus(); fireEvent.click(opener);
  fireEvent.change(slot.getByRole("searchbox"), { target: { value: "Archive candidate" } });
  const results = slot.getByRole("region", { name: "Поиск в проекте «Тестовый проект»" });
  assert.equal(results.querySelectorAll('.db-history-thread').length, 14);
  assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  fireEvent.change(slot.getByRole("combobox", { name: "Показывать треды" }), { target: { value: "attention" } });
  assert.ok(within(results).getByText("Треды не найдены."));
  fireEvent.change(slot.getByRole("combobox", { name: "Показывать треды" }), { target: { value: "all" } });
  fireEvent.click(within(results).getByRole("button", { name: "Archive candidate 0", exact: true }));
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "old0");
  assert.equal(slot.queryByRole("searchbox"), null);
  assert.equal(slot.queryByRole("tab", { name: /^Archive candidate 0:/ }), null);
  assert.equal(slot.inspection.sdkCalls.filter(call => /send|spawn/.test(call.method)).length, 0);
});

test("search renders bounded batches and distinguishes loading failure from no matches", async () => {
  const threads = Array.from({ length: 110 }, (_, i) => thread(`old${i}`, "p1", `History ${i}`, { latestAttentionAt: i + 1 }));
  const slot = mount({ connected: true, threads, hiddenIds: threads.map(t => t.id) });
  fireEvent.click(await slot.findByRole("button", { name: "Поиск тредов" }));
  const panel = slot.getByRole("region", { name: "Поиск в проекте «Тестовый проект»" });
  assert.equal(panel.querySelectorAll('.db-history-thread').length, 50);
  fireEvent.click(within(panel).getByRole("button", { name: "Показать ещё (осталось 60)" }));
  assert.equal(panel.querySelectorAll('.db-history-thread').length, 100);
  fireEvent.change(slot.getByRole("searchbox"), { target: { value: "History 0" } });
  assert.equal(panel.querySelectorAll('.db-history-thread').length, 1);
  slot.lifecycle.unmount();
  const failed = mount({ connected: true, threads, threadStatus: "error" });
  fireEvent.click(await failed.findByRole("button", { name: "Поиск тредов" }));
  const failedPanel = await failed.findByRole("region", { name: "Поиск в проекте «Тестовый проект»" });
  assert.match(within(failedPanel).getByRole("alert").textContent, /Не удалось загрузить/);
});

test("settings and search focus return on Escape and handled native keys leave settings open", async () => {
  const slot = mount({ connected: true, threads: [thread("t1", "p1", "Thread")] });
  const opener = await slot.findByRole("button", { name: "Выбрать проекты" });
  opener.focus(); fireEvent.click(opener);
  const dialog = slot.getByRole("dialog", { name: "Выбор проектов" });
  assert.ok(dialog.contains(document.activeElement));
  const event = new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }); event.preventDefault();
  fireEvent(document.activeElement, event);
  assert.ok(slot.getByRole("dialog", { name: "Выбор проектов" }));
  fireEvent.keyDown(document.activeElement, { key: "Escape" });
  assert.equal(slot.queryByRole("dialog"), null);
  assert.equal(document.activeElement, opener);
  const search = slot.getByRole("button", { name: "Поиск тредов" }); search.focus(); fireEvent.click(search);
  assert.equal(document.activeElement, slot.getByRole("searchbox"));
  fireEvent.keyDown(document.activeElement, { key: "ArrowDown" });
  assert.ok(slot.container.querySelector('.db-search-results').contains(document.activeElement));
  fireEvent.keyDown(document.activeElement, { key: "Escape" });
  assert.equal(slot.queryByRole("searchbox"), null);
  assert.equal(document.activeElement, search);
});

test("narrow history overlays the workspace, closes after selection and restores focus", async () => {
  const originalObserver = globalThis.ResizeObserver;
  const callbacks = new Map();
  globalThis.ResizeObserver = class { constructor(callback) { this.callback = callback; } observe(el) { callbacks.set(el, this.callback); } disconnect() {} };
  try {
    const slot = mount({ connected: true, threads: [thread("work", "p1", "Working", { status: "active" }), thread("old", "p1", "History")], hiddenIds: ["old"] });
    await slot.findByTestId("bb-thread-chat");
    const main = slot.container.querySelector('.db-main'); Object.defineProperty(main, "clientWidth", { value: 480 });
    await act(async () => callbacks.get(main)());
    const toggle = slot.getByRole("button", { name: "Показать последние 10 тредов" }); toggle.focus(); fireEvent.click(toggle);
    const history = slot.getByRole("region", { name: "Прошлые треды" });
    assert.ok(history.contains(document.activeElement));
    assert.equal(slot.container.querySelector('.db-thread-workspace').hasAttribute('inert'), true);
    assert.ok(slot.container.querySelector('.db-history-backdrop'));
    fireEvent.click(within(history).getByRole("button", { name: "History" }));
    assert.equal(slot.queryByRole("region", { name: "Прошлые треды" }), null);
    assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "old");
    assert.equal(document.activeElement, toggle);
    assert.equal(slot.container.querySelector('.db-thread-workspace').hasAttribute('inert'), false);
  } finally { if (originalObserver === undefined) delete globalThis.ResizeObserver; else globalThis.ResizeObserver = originalObserver; }
});

test("undo restores a background tab without switching chat; failed undo keeps the action available", async () => {
  let fail = true;
  const slot = mount({ connected: true, threads: [thread("a", "p1", "Selected", { isUnread: true }), thread("b", "p1", "Background")],
    rpcOverrides: { thread_restore: () => { if (fail) throw new Error("offline"); return { restored: true }; } } });
  const chat = await slot.findByTestId("bb-thread-chat");
  fireEvent.click(slot.getByRole("button", { name: /Убрать «Background»/ }));
  const undo = await slot.findByRole("button", { name: "Вернуть «Background»" });
  assert.equal(undo.closest('.db-thread-tab-item').dataset.undo, "true");
  assert.ok(undo.querySelector('svg'));
  assert.equal(slot.container.querySelector('.db-undo-notice'), null);
  assert.equal(slot.queryByRole("tab", { name: /^Background:/ }), null);
  fireEvent.click(undo); await slot.findByRole("alert");
  assert.ok(slot.getByRole("button", { name: "Вернуть «Background»" }));
  fail = false; act(() => undo.focus()); fireEvent.click(undo); await slot.findByText("Тред возвращён на рабочий стол.");
  assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  assert.equal(slot.queryByRole("button", { name: "Вернуть «Background»" }), null);
  assert.equal(document.activeElement, slot.getByRole("tab", { name: /^Selected:/, selected: true }));
  assert.ok(slot.inspection.rpcCalls.some(call => call.method === "thread_restore" && call.input.threadId === "b"));
});

test("undo returns the hidden tab and only the most recent hiding has an action", async () => {
  const slot = mount({ connected: true, threads: [thread("a", "p1", "First", { isUnread: true }), thread("b", "p1", "Second"), thread("c", "p1", "Third")] });
  await slot.findByTestId("bb-thread-chat");
  fireEvent.click(slot.getByRole("button", { name: /Убрать «Second»/ })); await slot.findByRole("button", { name: "Вернуть «Second»" });
  fireEvent.click(slot.getByRole("button", { name: /Убрать «Third»/ })); await act(async () => {});
  fireEvent.click(slot.getByRole("button", { name: "Вернуть «Third»" }));
  await slot.findByRole("tab", { name: /^Third:/ });
  assert.equal(slot.queryByRole("tab", { name: /^Second:/ }), null);
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "a");
});

test("hidden tab keeps its slot, pauses expiration on hover, and disappears after its undo window", async context => {
  const slot = mount({ connected: true, threads: [thread("a", "p1", "First", { isUnread: true }), thread("b", "p1", "Second"), thread("c", "p1", "Third")] });
  await slot.findByTestId("bb-thread-chat");
  context.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  await act(async () => fireEvent.click(slot.getByRole("button", { name: /Убрать «Second»/ })));
  const undo = slot.getByRole("button", { name: "Вернуть «Second»" });
  const items = () => [...slot.container.querySelectorAll('.db-thread-tab-item')];
  assert.equal(items().indexOf(undo.parentElement), 1);
  act(() => context.mock.timers.tick(6000));
  fireEvent.mouseEnter(undo);
  act(() => context.mock.timers.tick(20000));
  assert.ok(slot.getByRole("button", { name: "Вернуть «Second»" }));
  fireEvent.mouseLeave(undo);
  act(() => context.mock.timers.tick(6001));
  assert.equal(slot.queryByRole("button", { name: "Вернуть «Second»" }), null);
  assert.equal(items().length, 2);
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "a");
});

test("green thread opens on project entry, respects manual collapse and reopens on return", async () => {
  const slot = mount({ connected: true, projects: [project, secondProject], threads: [
    thread("t1", "p1", "Первый тред", { isUnread: true }), thread("t2", "p2", "Второй тред", { status: "active" }),
  ] });
  assert.equal((await slot.findByTestId("bb-thread-chat")).dataset.threadId, "t1");
  fireEvent.click(slot.getByRole("button", { name: /^Первый тред/, expanded: true }));
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(slot.queryByTestId("bb-thread-chat"), null);
  fireEvent.click(slot.getByRole("tab", { name: /^Второй проект,/ }));
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "t2");
  fireEvent.click(slot.getByRole("tab", { name: /^Тестовый проект,/ }));
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "t1");
});

test("first project entry prioritizes attention and later returns preserve the conversation despite status changes", async () => {
  const threads = [
    thread("green", "p1", "Зелёный", { status: "active", latestAttentionAt: 900 }),
    thread("yellow-old", "p1", "Первый по времени", { hasPendingInteraction: true, latestAttentionAt: 200 }),
    thread("yellow-new", "p1", "Первый в списке", { hasPendingInteraction: true, latestAttentionAt: 300 }),
    thread("error", "p1", "Ошибка", { status: "error", latestAttentionAt: 1000 }),
    thread("read", "p1", "Прочитан"),
    thread("result", "p1", "Готовый результат", { isUnread: true, latestAttentionAt: 100 }),
  ];
  const slot = mount({ connected: true, projects: [project, secondProject], threads });
  assert.equal((await slot.findByTestId("bb-thread-chat")).dataset.threadId, "yellow-new");
  fireEvent.click(slot.getByRole("button", { name: /^Первый в списке/, expanded: true }));
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(slot.queryByTestId("bb-thread-chat"), null);
  fireEvent.click(slot.getByRole("tab", { name: /^Тестовый проект,/ }));
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "yellow-new");
  threads[1] = { ...threads[1], hasPendingInteraction: false };
  threads[2] = { ...threads[2], hasPendingInteraction: false };
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "yellow-new");
  fireEvent.click(slot.getByRole("tab", { name: /^Второй проект,/ }));
  fireEvent.click(slot.getByRole("tab", { name: /^Тестовый проект,/ }));
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "yellow-new");
  threads[5] = { ...threads[5], isUnread: false };
  await slot.behavior.emitRealtime("dashboard-changed", {});
  fireEvent.click(slot.getByRole("tab", { name: /^Тестовый проект,/ }));
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "yellow-new");
  for (const changes of [{ status: "pending" }, { status: "idle", isUnread: true }, { status: "idle", isUnread: false }]) {
    threads[0] = { ...threads[0], ...changes };
    await slot.behavior.emitRealtime("dashboard-changed", {});
    fireEvent.click(slot.getByRole("tab", { name: /^Тестовый проект,/ }));
    assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "yellow-new");
  }
});

test("project entry falls back to the latest read result and preserves manual collapse until return", async () => {
  const threads = [
    thread("old", "p1", "Старый результат", { latestAttentionAt: 200, updatedAt: 1000 }),
    thread("latest", "p1", "Последний результат", { latestAttentionAt: 400, updatedAt: 500 }),
    thread("other", "p2", "Другой проект", { latestAttentionAt: 900 }),
    thread("hidden", "p1", "Скрытый", { latestAttentionAt: 1100, isHidden: true }),
    thread("archived", "p1", "Архивный", { latestAttentionAt: 1200, isArchived: true }),
    thread("child", "p1", "Завершённый агент", { latestAttentionAt: 1300, parentThreadId: "latest" }),
  ];
  const slot = mount({ connected: true, projects: [project, secondProject], threads });
  assert.equal((await slot.findByTestId("bb-thread-chat")).dataset.threadId, "latest");
  fireEvent.click(slot.getByRole("button", { name: /^Последний результат/, expanded: true }));
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(slot.queryByTestId("bb-thread-chat"), null);
  fireEvent.click(slot.getByRole("tab", { name: /^Второй проект,/ }));
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "other");
  fireEvent.click(slot.getByRole("tab", { name: /^Тестовый проект,/ }));
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "latest");
});

test("chat fills the workspace with one or multiple threads, including when filtered", async () => {
  const threads = [thread("t1", "p1", "Работа", { status: "active" })];
  const slot = mount({ connected: true, threads });
  const chat = await slot.findByTestId("bb-thread-chat");
  assert.equal(chat.dataset.layout, "contained");
  threads.push(thread("t2", "p1", "Другой тред"));
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  assert.equal(chat.dataset.layout, "contained");
  fireEvent.change(slot.getByRole("combobox", { name: "Показывать треды" }), { target: { value: "attention" } });
  assert.equal(slot.queryByText("Другой тред"), null);
  assert.equal(chat.dataset.layout, "contained");
  threads.pop();
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  assert.equal(chat.dataset.layout, "contained");
});

test("a single gray or red thread opens as the last worked thread on project entry", async () => {
  for (const changes of [{}, { status: "error" }]) {
    const slot = mount({ connected: true, threads: [thread("t1", "p1", "Тред", changes)] });
    assert.equal((await slot.findByTestId("bb-thread-chat")).dataset.threadId, "t1");
    slot.lifecycle.unmount();
  }
});

test("accepted prompts and work transitions keep the same chat mounted until manually closed", async () => {
  const subscriptions = new Set();
  const threads = [thread("t1", "p1", "Открытый тред"), thread("t2", "p1", "Другой тред")];
  const slot = mount({ connected: true, threads, sdk: {
    subscribe: subscription => { subscriptions.add(subscription); return () => subscriptions.delete(subscription); },
  } });
  const chat = await slot.findByTestId("bb-thread-chat");
  assert.equal(chat.dataset.threadId, "t1");
  await act(async () => {
    for (const subscription of subscriptions) subscription.callback({ metadata: { eventTypes: ["turn/input/accepted"] } });
  });
  assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  for (const changes of [
    { status: "starting" }, { status: "active", queuedWork: "waiting" },
    { hasPendingInteraction: true }, { hasPendingInteraction: false, queuedWork: "none" }, { status: "idle" },
  ]) {
    threads[0] = { ...threads[0], ...changes };
    await slot.behavior.emitRealtime("dashboard-changed", {});
    assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  }
  fireEvent.click(slot.getByRole("button", { name: "Поиск тредов" }));
  fireEvent.change(slot.getByRole("searchbox", { name: "Найти тред" }), { target: { value: "нет совпадений" } });
  assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  fireEvent.click(slot.getByRole("button", { name: /^Открытый тред/, expanded: true }));
  assert.equal(slot.queryByTestId("bb-thread-chat"), null);
});

test("opening the new-thread composer takes precedence over single-thread auto-open", async () => {
  const slot = mount({ connected: true, projects: [project, secondProject], threads: [thread("t2", "p2", "Второй тред")] });
  fireEvent.click(await slot.findByRole("button", { name: "Новый тред в проекте «Второй проект»" }));
  assert.ok(slot.getByText("Новый тред · Второй проект"));
  assert.equal(slot.queryByTestId("bb-thread-chat"), null);
});

test("first prompt opens the returned thread before the sidebar catches up and retains it through startup", async () => {
  const threads = [thread("t1", "p1", "Старый тред"), thread("t2", "p1", "Другой тред")];
  const slot = mount({ connected: true, threads, sdk: { threads: { spawn: async () => ({ id: "created" }) } } });
  fireEvent.click(await slot.findByRole("button", { name: "Поиск тредов" }));
  fireEvent.change(slot.getByRole("searchbox", { name: "Найти тред" }), { target: { value: "нет совпадений" } });
  fireEvent.change(slot.getByRole("combobox", { name: "Показывать треды" }), { target: { value: "attention" } });
  fireEvent.click(within(slot.container.querySelector(".db-thread-dock")).getByRole("button", { name: "Новый тред в проекте «Тестовый проект»" }));
  fireEvent.change(slot.getByTestId("bb-new-thread-composer-input"), { target: { value: "Первый промпт" } });
  await act(async () => { fireEvent.click(slot.getByTestId("bb-new-thread-composer-submit")); });
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "created");
  assert.equal(slot.queryByTestId("bb-new-thread-composer"), null);
  assert.ok(slot.getByText("Тред создан. Обновляем состояние…"));
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "created");
  threads.push(thread("created", "p1", "Созданный тред", { status: "starting" }));
  await slot.behavior.emitRealtime("dashboard-changed", {});
  const chat = slot.getByTestId("bb-thread-chat");
  assert.equal(chat.dataset.threadId, "created");
  assert.ok(slot.getByText("Запускается"));
  assert.equal(slot.queryByText("Тред создан. Обновляем состояние…"), null);
  for (const status of ["active", "idle"]) {
    threads[2] = { ...threads[2], status };
    await slot.behavior.emitRealtime("dashboard-changed", {});
    assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  }
  fireEvent.click(slot.getByRole("button", { name: /^Созданный тред/, expanded: true }));
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(slot.queryByTestId("bb-thread-chat"), null);
});

test("new thread opens when sidebar arrives before the spawn response", async () => {
  let resolveSpawn;
  const threads = [thread("t1", "p1", "Старый тред")];
  const slot = mount({ connected: true, threads, sdk: { threads: { spawn: () => new Promise(resolve => { resolveSpawn = resolve; }) } } });
  fireEvent.click((await slot.findAllByRole("button", { name: "Новый тред в проекте «Тестовый проект»" }))[0]);
  fireEvent.click(slot.getByTestId("bb-new-thread-composer-submit"));
  threads.push(thread("created", "p1", "Созданный тред", { status: "active" }));
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.ok(slot.getByTestId("bb-new-thread-composer"));
  await act(async () => { resolveSpawn({ id: "created" }); });
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "created");
  assert.equal(slot.queryByTestId("bb-new-thread-composer"), null);
});

for (const action of ["switch project", "close composer", "open existing thread"]) test(`late spawn response respects the user's decision to ${action}`, async () => {
  let resolveSpawn;
  const slot = mount({ connected: true, projects: [project, secondProject], threads: [thread("t1", "p1", "Старый тред"), thread("t2", "p1", "Другой тред")], sdk: { threads: { spawn: () => new Promise(resolve => { resolveSpawn = resolve; }) } } });
  fireEvent.click((await slot.findAllByRole("button", { name: "Новый тред в проекте «Тестовый проект»" }))[0]);
  fireEvent.click(slot.getByTestId("bb-new-thread-composer-submit"));
  if (action === "switch project") fireEvent.click(slot.getByRole("tab", { name: /^Второй проект,/ }));
  else if (action === "open existing thread") fireEvent.click(slot.getByRole("tab", { name: /^Старый тред/ }));
  else fireEvent.click(slot.getByRole("button", { name: "Закрыть создание треда" }));
  await act(async () => { resolveSpawn({ id: "created" }); });
  if (action === "open existing thread") assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "t1");
  else assert.equal(slot.queryByTestId("bb-thread-chat"), null);
  assert.equal(slot.queryByTestId("bb-new-thread-composer"), null);
  if (action === "switch project") assert.equal(slot.getByRole("tab", { name: /^Второй проект,/ }).getAttribute("aria-selected"), "true");
});

function splitTransfer(projectId, threadId) {
  const data = new Map([["application/x-bbdesk-thread", JSON.stringify({ projectId, threadId })]]);
  return { types: [...data.keys()], getData: type => data.get(type) ?? "", setData: (type, value) => data.set(type, value) };
}
function dropSplit(slot, transfer) {
  const previous = window.DragEvent;
  window.DragEvent = window.MouseEvent;
  try { fireEvent.drop(splitPanes(slot)[0], { dataTransfer: transfer, clientX: 40 }); }
  finally { window.DragEvent = previous; }
}
const splitPanes = slot => [...slot.container.querySelectorAll(".db-split-pane")];
const splitIds = slot => splitPanes(slot).map(node => node.dataset.threadId);

test("split drag inserts columns, focuses duplicates and replaces only the active column on tab click", async () => {
  const threads = [thread("a", "p1", "Alpha", { isUnread: true }), thread("b", "p1", "Beta"), thread("c", "p1", "Gamma"), thread("d", "p1", "Delta")];
  const slot = mount({ connected: true, language: "en", threads });
  const original = await slot.findByTestId("bb-thread-chat");
  const beta = slot.getByRole("tab", { name: /^Beta:/ });
  const transfer = splitTransfer("p1", "b");
  fireEvent.dragStart(beta, { dataTransfer: transfer });
  fireEvent.dragOver(splitPanes(slot)[0], { dataTransfer: transfer });
  assert.ok(splitPanes(slot)[0].dataset.drop);
  dropSplit(slot, transfer);
  assert.deepEqual(splitIds(slot), ["a", "b"]);
  assert.equal(slot.getAllByTestId("bb-thread-chat")[0], original);
  fireEvent.keyDown(slot.getByRole("tab", { name: /^Gamma:/ }), { key: "Enter", altKey: true });
  assert.deepEqual(splitIds(slot), ["a", "b", "c"]);
  fireEvent.keyDown(beta, { key: "Enter", altKey: true });
  assert.deepEqual(splitIds(slot), ["a", "b", "c"]);
  assert.equal(splitPanes(slot)[1].dataset.active, "true");
  const gammaChat = slot.getAllByTestId("bb-thread-chat")[2];
  fireEvent.click(slot.getByRole("tab", { name: /^Delta:/ }));
  assert.deepEqual(splitIds(slot), ["a", "d", "c"]);
  assert.equal(slot.getAllByTestId("bb-thread-chat")[0], original);
  assert.equal(slot.getAllByTestId("bb-thread-chat")[2], gammaChat);
  fireEvent.click(slot.getByRole("button", { name: "Remove “Delta” from split view" }));
  assert.deepEqual(splitIds(slot), ["a", "c"]);
  fireEvent.click(slot.getByRole("button", { name: "Remove “Alpha” from split view" }));
  assert.deepEqual(splitIds(slot), ["c"]);
  assert.equal(slot.queryByRole("separator", { name: /Resize adjacent/ }), null);
  assert.equal(slot.getByTestId("bb-thread-chat"), gammaChat);
  assert.equal(slot.inspection.rpcCalls.filter(call => call.method === "thread_hide").length, 0);
});

test("history drag opens an untracked conversation alongside and removes its temporary tab on close", async () => {
  const slot = mount({ connected: true, language: "en", threads: [thread("a", "p1", "Current"), thread("old", "p1", "Historical")], hiddenIds: ["old"] });
  const original = await slot.findByTestId("bb-thread-chat");
  fireEvent.click(slot.getByRole("button", { name: "Show last 10 threads" }));
  const history = slot.getByRole("region", { name: "Previous threads" });
  const source = within(history).getByRole("button", { name: "Historical", exact: true });
  const transfer = splitTransfer("p1", "old");
  fireEvent.dragStart(source, { dataTransfer: transfer });
  dropSplit(slot, transfer);
  assert.deepEqual(splitIds(slot), ["a", "old"]);
  assert.equal(slot.getAllByTestId("bb-thread-chat")[0], original);
  assert.ok(slot.getByRole("tab", { name: /^Historical:/ }));
  fireEvent.click(slot.getByRole("button", { name: "Remove “Historical” from split view" }));
  assert.deepEqual(splitIds(slot), ["a"]);
  assert.equal(slot.queryByRole("tab", { name: /^Historical:/ }), null);
  assert.ok(within(history).getByRole("button", { name: "Historical", exact: true }));
  fireEvent.click(within(history).getByRole("button", { name: "Open Historical alongside" }));
  assert.deepEqual(splitIds(slot), ["a", "old"]);
});

test("split resizing changes adjacent widths, supports equalization and survives project return and reload", async () => {
  const threads = [thread("a", "p1", "Alpha"), thread("b", "p1", "Beta"), thread("c", "p2", "Other project")];
  let slot = mount({ connected: true, language: "en", projects: [project, secondProject], threads });
  await slot.findByTestId("bb-thread-chat");
  fireEvent.keyDown(slot.getByRole("tab", { name: /^Beta:/ }), { key: "Enter", altKey: true });
  const [left, right] = splitPanes(slot);
  left.getBoundingClientRect = right.getBoundingClientRect = () => ({ width: 600 });
  const separator = slot.getByRole("separator", { name: /Resize adjacent/ });
  fireEvent.keyDown(separator, { key: "ArrowRight" });
  const memory = () => JSON.parse(window.localStorage.getItem("bb-dashboard:split-layout:v1")).p1;
  assert.deepEqual(memory().sizes, { a: 616, b: 584 });
  const previous = window.PointerEvent;
  window.PointerEvent = window.MouseEvent;
  separator.setPointerCapture = () => {};
  try {
    fireEvent.pointerDown(separator, { button: 0, clientX: 600 });
    fireEvent.pointerMove(separator, { clientX: 800 });
    fireEvent.pointerUp(separator);
    assert.deepEqual(memory().sizes, { a: 800, b: 400 });
  } finally { window.PointerEvent = previous; }
  fireEvent.doubleClick(separator);
  assert.deepEqual(memory().sizes, { a: 600, b: 600 });
  fireEvent.click(slot.getByRole("tab", { name: /^Второй проект/ }));
  assert.deepEqual(splitIds(slot), ["c"]);
  fireEvent.click(slot.getByRole("tab", { name: /^Тестовый проект/ }));
  assert.deepEqual(splitIds(slot), ["a", "b"]);
  slot.lifecycle.unmount();
  slot = mount({ connected: true, language: "en", projects: [project, secondProject], threads });
  await slot.findAllByTestId("bb-thread-chat");
  assert.deepEqual(splitIds(slot), ["a", "b"]);
  assert.deepEqual(memory().sizes, { a: 600, b: 600 });
});

test("split ignores foreign and invalid drops and opens no duplicate native chat", async () => {
  const slot = mount({ connected: true, language: "en", threads: [thread("a", "p1", "Alpha"), thread("b", "p1", "Beta")] });
  await slot.findByTestId("bb-thread-chat");
  for (const transfer of [splitTransfer("p2", "b"), splitTransfer("p1", "missing"), { types: ["text/plain"], getData: () => "b" }, { types: ["application/x-bbdesk-thread"], getData: () => "broken" }]) {
    dropSplit(slot, transfer);
    assert.deepEqual(splitIds(slot), ["a"]);
  }
  fireEvent.keyDown(slot.getByRole("tab", { name: /^Beta:/ }), { key: "Enter", altKey: true });
  fireEvent.click(slot.getByRole("tab", { name: /^Alpha:/ }));
  assert.deepEqual(splitIds(slot), ["a", "b"]);
  assert.equal(slot.getAllByTestId("bb-thread-chat").length, 2);
});

test("history drag unlocks a compact workspace and closes the overlay only after drop", async () => {
  const originalObserver = globalThis.ResizeObserver;
  const callbacks = new Map();
  globalThis.ResizeObserver = class { constructor(callback) { this.callback = callback; } observe(el) { callbacks.set(el, this.callback); } disconnect() {} };
  try {
    const slot = mount({ connected: true, language: "en", threads: [thread("a", "p1", "Current"), thread("old", "p1", "Historical")], hiddenIds: ["old"] });
    await slot.findByTestId("bb-thread-chat");
    const main = slot.container.querySelector('.db-main');
    Object.defineProperty(main, "clientWidth", { value: 480 });
    await act(async () => callbacks.get(main)());
    fireEvent.click(slot.getByRole("button", { name: "Show last 10 threads" }));
    const workspace = slot.container.querySelector('.db-thread-workspace');
    assert.ok(workspace.hasAttribute('inert'));
    const history = slot.getByRole("region", { name: "Previous threads" });
    const transfer = splitTransfer("p1", "old");
    fireEvent.dragStart(within(history).getByRole("button", { name: "Historical", exact: true }), { dataTransfer: transfer });
    assert.equal(workspace.hasAttribute('inert'), false);
    assert.ok(history.isConnected);
    dropSplit(slot, transfer);
    assert.deepEqual(splitIds(slot), ["a", "old"]);
    assert.equal(slot.queryByRole("region", { name: "Previous threads" }), null);
    assert.equal(workspace.hasAttribute('inert'), false);
    fireEvent.click(slot.getByRole("button", { name: "Show last 10 threads" }));
    assert.ok(workspace.hasAttribute('inert'));
  } finally { if (originalObserver === undefined) delete globalThis.ResizeObserver; else globalThis.ResizeObserver = originalObserver; }
});

test("split closes unavailable columns and hiding the active tab keeps the remaining column selected", async () => {
  const threads = [thread("a", "p1", "Alpha"), thread("b", "p1", "Beta"), thread("c", "p1", "Gamma")];
  const slot = mount({ connected: true, language: "en", threads });
  await slot.findByTestId("bb-thread-chat");
  fireEvent.keyDown(slot.getByRole("tab", { name: /^Beta:/ }), { key: "Enter", altKey: true });
  fireEvent.keyDown(slot.getByRole("tab", { name: /^Gamma:/ }), { key: "Enter", altKey: true });
  fireEvent.click(slot.getByRole("button", { name: "Hide “Gamma” from the dashboard" }));
  await slot.findByText("Thread hidden from the dashboard. A new reply or activity will bring it back.");
  assert.deepEqual(splitIds(slot), ["a", "b"]);
  assert.ok(slot.getByRole("tab", { name: /^Alpha:/, selected: true }));
  threads[1] = { ...threads[1], isArchived: true };
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.deepEqual(splitIds(slot), ["a"]);
  assert.equal(slot.queryByRole("separator", { name: /Resize adjacent/ }), null);
  fireEvent.click(slot.container.querySelector('.db-thread-open'));
  assert.equal(slot.queryByTestId("bb-thread-chat"), null);
});

test("split persistence validates saved layouts and tolerates unavailable browser storage", async () => {
  const { readSplitLayouts, saveSplitLayouts } = await import("./split-layout.ts");
  const key = "bb-dashboard:split-layout:v1";
  window.localStorage.setItem(key, JSON.stringify({ p1: { ids: ["a", "b", "a"], active: "missing", sizes: { a: -2, b: "bad" } }, p2: { ids: [null] } }));
  assert.deepEqual(readSplitLayouts(), { p1: { ids: ["a", "b"], active: "a", sizes: { a: 1, b: 1 } } });
  window.localStorage.setItem(key, "broken");
  assert.deepEqual(readSplitLayouts(), {});
  const storage = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
  try {
    assert.deepEqual(readSplitLayouts(), {});
    assert.doesNotThrow(() => saveSplitLayouts({}));
  } finally { Object.defineProperty(window, "localStorage", storage); }
});

test("bottom tabs switch chats, keep stable order on status updates and never collapse on repeated selection", async () => {
  const threads = [thread("t2", "p1", "Second", { createdAt: 100 }), thread("t1", "p1", "First", { createdAt: 200 })];
  const slot = mount({ connected: true, language: "en", threads });
  await slot.findByTestId("bb-thread-chat");
  const tabs = within(slot.getByRole("tablist", { name: "Project threads" }));
  assert.deepEqual(tabs.getAllByRole("tab").map(el => el.textContent), ["First", "Second"]);
  fireEvent.click(tabs.getByRole("tab", { name: /^Second:/ }));
  const chat = slot.getByTestId("bb-thread-chat");
  assert.equal(chat.dataset.threadId, "t2");
  fireEvent.click(tabs.getByRole("tab", { name: /^Second:/ }));
  assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  threads[0] = { ...threads[0], hasPendingInteraction: true };
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.deepEqual(tabs.getAllByRole("tab").map(el => el.textContent), ["First", "Second"]);
  assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  fireEvent.keyDown(tabs.getByRole("tab", { name: /^Second:/ }), { key: "Home" });
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "t1");
  assert.equal(document.activeElement, tabs.getByRole("tab", { name: /^First:/ }));
});

test("bottom tabs show newest first and retain chronological neighbors and undo placement", async () => {
  const threads = [thread("a", "p1", "Oldest", { createdAt: 100 }), thread("b", "p1", "Middle", { createdAt: 200 }), thread("c", "p1", "Newest", { createdAt: 300 })];
  const slot = mount({ connected: true, language: "en", threads });
  await slot.findByTestId("bb-thread-chat");
  const tabs = within(slot.getByRole("tablist", { name: "Project threads" }));
  assert.deepEqual(tabs.getAllByRole("tab").map(el => el.textContent), ["Newest", "Middle", "Oldest"]);
  fireEvent.click(tabs.getByRole("tab", { name: /^Middle:/ }));
  fireEvent.click(slot.getByRole("button", { name: "Hide “Middle” from the dashboard" }));
  await slot.findByText("Thread hidden from the dashboard. A new reply or activity will bring it back.");
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "a");
  assert.deepEqual([...slot.container.querySelectorAll('.db-thread-tabs .db-thread-tab-item')].map(el => el.textContent), ["Newest", "Middle", "Oldest"]);
  fireEvent.click(slot.getByRole("button", { name: "Restore “Middle”" }));
  await slot.findByText("Thread returned to the dashboard.");
  assert.deepEqual(tabs.getAllByRole("tab").map(el => el.textContent), ["Newest", "Middle", "Oldest"]);
});

test("bottom tabs overflow responds to width and returns focus on Escape without a separate search", async () => {
  const originalObserver = globalThis.ResizeObserver;
  const callbacks = new Map();
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe(element) { callbacks.set(element, this.callback); }
    disconnect() {}
  };
  try {
    const slot = mount({ connected: true, language: "en", threads: Array.from({ length: 8 }, (_, i) => thread(`t${i}`, "p1", `Thread ${i}`)) });
    await slot.findByTestId("bb-thread-chat");
    const dock = slot.container.querySelector(".db-thread-dock");
    Object.defineProperty(dock, "clientWidth", { value: 480, configurable: true });
    await act(async () => callbacks.get(dock)());
    const more = slot.getByRole("button", { name: "More 7" });
    fireEvent.click(more);
    const popup = slot.getByRole("region", { name: "Other threads" });
    assert.equal(within(popup).queryByRole("searchbox"), null);
    assert.equal(popup.querySelectorAll(".db-thread-overflow-item").length, 7);
    fireEvent.click(within(popup).getByRole("button", { name: /^Thread 7/ }));
    assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "t7");
    assert.ok(slot.getByRole("tab", { name: /^Thread 7:/, selected: true }));
    fireEvent.click(more);
    const overflowPanel = slot.getByRole("region", { name: "Other threads" });
    const selectedChat = slot.getByTestId("bb-thread-chat");
    fireEvent.click(within(overflowPanel).getAllByRole("button", { name: /^Hide/ })[0]);
    await slot.findByText("Thread hidden from the dashboard. A new reply or activity will bring it back.");
    assert.equal(slot.getByTestId("bb-thread-chat"), selectedChat);
    assert.equal(overflowPanel.querySelectorAll(".db-thread-overflow-item").length, 7);
    assert.ok(overflowPanel.querySelector('.db-thread-undo'));
    fireEvent.keyDown(slot.getByRole("region", { name: "Other threads" }), { key: "Escape" });
    assert.equal(slot.queryByRole("region", { name: "Other threads" }), null);
    assert.equal(document.activeElement, more);
    Object.defineProperty(dock, "clientWidth", { value: 1800, configurable: true });
    await act(async () => callbacks.get(dock)());
    assert.equal(slot.queryByRole("button", { name: /^More/ }), null);
  } finally {
    if (originalObserver === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = originalObserver;
  }
});

test("closing an inactive bottom tab persists hiding without switching or remounting the selected chat", async () => {
  const slot = mount({ connected: true, language: "en", threads: [thread("t1", "p1", "Selected", { isUnread: true }), thread("t2", "p1", "Other")] });
  const chat = await slot.findByTestId("bb-thread-chat");
  const dock = slot.container.querySelector(".db-thread-dock");
  fireEvent.click(within(dock).getByRole("button", { name: /Other/ }));
  await slot.findByText("Thread hidden from the dashboard. A new reply or activity will bring it back.");
  assert.equal(slot.queryByRole("tab", { name: /^Other:/ }), null);
  assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  assert.equal(chat.dataset.threadId, "t1");
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(slot.queryByRole("tab", { name: /^Other:/ }), null);
  assert.ok(slot.inspection.rpcCalls.some(call => call.method === "thread_hide" && call.input.threadId === "t2"));
  assert.equal(slot.inspection.sdkCalls.filter(call => /archive|delete|stop|send/.test(call.method)).length, 0);
});

test("closing the selected bottom tab opens its neighbor and closing the last tab shows the empty state", async () => {
  const slot = mount({ connected: true, language: "en", threads: [thread("t1", "p1", "First", { isUnread: true }), thread("t2", "p1", "Second")] });
  await slot.findByTestId("bb-thread-chat");
  fireEvent.click(slot.getByRole("button", { name: /Hide.*First/ }));
  await slot.findByText("Thread hidden from the dashboard. A new reply or activity will bring it back.");
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "t2");
  assert.equal(slot.queryByRole("tab", { name: /^First:/ }), null);
  fireEvent.click(slot.getByRole("button", { name: /Hide.*Second/ }));
  await act(async () => {});
  assert.equal(slot.queryByTestId("bb-thread-chat"), null);
  assert.equal(slot.queryByRole("tab", { name: /^Second:/ }), null);
});

test("failed hiding keeps the tab and selected chat, and working threads or drafts have no hide control", async () => {
  const slot = mount({ connected: true, language: "en", draftThreadIds: ["t3"], threads: [thread("t1", "p1", "Idle", { isUnread: true }), thread("t2", "p1", "Running", { status: "active" }), thread("t3", "p1", "Draft")], rpcOverrides: { thread_hide: () => { throw new Error("failed"); } } });
  const chat = await slot.findByTestId("bb-thread-chat");
  assert.equal(slot.queryByRole("button", { name: /Hide.*Running/ }), null);
  assert.equal(slot.queryByRole("button", { name: /Hide.*Draft/ }), null);
  fireEvent.click(slot.getByRole("button", { name: /Hide.*Idle/ }));
  await slot.findByRole("alert");
  assert.ok(slot.getByRole("tab", { name: /^Idle:/ }));
  assert.equal(slot.getByTestId("bb-thread-chat"), chat);
});

test("switching away and back restores reading through native initial scrolling and releases on user input", async () => {
  const { preserveChatReading } = await import("./chat-reading.ts");
  const root = document.createElement("div"), scroller = document.createElement("div");
  root.append(scroller);
  document.body.append(root);
  scroller.style.overflowY = "auto";
  Object.defineProperties(scroller, { clientHeight: { value: 400 }, scrollHeight: { value: 4000 } });
  const view = dom.window;
  try {
    const dispose = preserveChatReading(root, "reading-test");
    scroller.scrollTop = 900;
    scroller.dispatchEvent(new view.Event("scroll"));
    dispose();
    scroller.scrollTop = 3600;
    const disposeNext = preserveChatReading(root, "reading-test");
    assert.equal(scroller.scrollTop, 900);
    scroller.scrollTop = 3600;
    scroller.dispatchEvent(new view.Event("scroll"));
    assert.equal(scroller.scrollTop, 900);
    scroller.dispatchEvent(new view.Event("wheel", { bubbles: true }));
    scroller.scrollTop = 800;
    scroller.dispatchEvent(new view.Event("scroll"));
    assert.equal(scroller.scrollTop, 800);
    disposeNext();
    scroller.scrollTop = 3600;
    const disposeLast = preserveChatReading(root, "reading-test");
    assert.equal(scroller.scrollTop, 800);
    disposeLast();
  } finally {
    root.remove();
  }
});

test("chat starts at the bottom after async loading, preserves reading position and cleans up", async () => {
  const { followChatBottom } = await import("./chat-scroll.ts");
  const originalObserver = globalThis.ResizeObserver;
  let resized;
  let disconnected = false;
  globalThis.ResizeObserver = class {
    constructor(callback) { resized = callback; }
    observe() {}
    disconnect() { disconnected = true; }
  };
  try {
    const viewport = document.createElement("div");
    const content = document.createElement("div");
    let height = 100;
    Object.defineProperties(viewport, { scrollHeight: { get: () => height }, clientHeight: { value: 300 } });
    const stop = followChatBottom(viewport, content);
    assert.equal(viewport.scrollTop, 0);
    height = 1500;
    resized();
    assert.equal(viewport.scrollTop, 1200);
    height = 1600;
    viewport.dispatchEvent(new dom.window.Event("scroll"));
    resized();
    assert.equal(viewport.scrollTop, 1300);
    viewport.scrollTop = 200;
    viewport.dispatchEvent(new dom.window.Event("scroll"));
    height = 1800;
    resized();
    assert.equal(viewport.scrollTop, 200);
    viewport.scrollTop = 1500;
    viewport.dispatchEvent(new dom.window.Event("scroll"));
    height = 2100;
    resized();
    assert.equal(viewport.scrollTop, 1800);
    stop();
    assert.equal(disconnected, true);
  } finally {
    if (originalObserver === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = originalObserver;
  }
});
