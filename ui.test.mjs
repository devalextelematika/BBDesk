import "./scripts/test-loader.mjs";
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
afterEach(() => { cleanup(); window.localStorage.removeItem("bb-dashboard:launcher-layout:v1"); });
const project = { id: "p1", name: "Тестовый проект", isPersonal: false, href: "/projects/p1", settingsHref: "/projects/p1/settings" };
const item = { id: "notes/home", pluginId: "notes", label: "Заметки", icon: { kind: "plugin", pluginId: "notes", icon: null }, action: { kind: "plugin-panel", path: "home", pluginId: "notes" }, isDisabled: false, isLoading: false, isVisible: true, shortcut: null, badge: null };
function mount({ connected = false, launcher = [], threads = [], projects = [project], sdk = {}, navigationItems = [item], withNavigation = true } = {}) {
  let snapshot = { config: { projects: connected ? projects.map(p => ({ id: p.id, enabled: true, connectedAt: 100 })) : [], launcher }, tracked: threads.map(t => ({ id: t.id, projectId: t.projectId, visible: true, latestAttentionAt: 150, hiddenAttentionAt: 0 })), syncError: null, syncedAt: 150 };
  const navigation = withNavigation ? renderSlot(app.experimentalSidebarNavigations[0], {
    isCompactViewport: false, placement: "rail", experimental_Original: () => null,
  }, { pluginId: "dashboard", sidebarNavigation: { items: navigationItems } }) : null;
  const slot = renderSlot(app.navPanels[0], { subPath: "" }, {
    pluginId: "dashboard",
    sidebarThreads: { status: "ready", projects, threads },
    // Pages have no sidebar navigation context in BB. Only the bridge above does.
    sdk: { subscribe: () => () => {}, ...sdk },
    rpc: {
      snapshot: () => structuredClone(snapshot),
      projects_set: ({ ids }) => { snapshot.config.projects = ids.map(id => ({ id, enabled: true, connectedAt: 100 })); return snapshot.config; },
      launcher_set: ({ items }) => { snapshot.config.launcher = items; return snapshot.config; },
      thread_hide: () => ({ hidden: true }),
    },
  });
  const unmount = slot.lifecycle.unmount;
  slot.lifecycle.unmount = () => { unmount(); navigation?.lifecycle.unmount(); };
  return Object.assign(slot, { navigation });
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
  assert.ok(within(header).getByRole("button", { name: "Выбрать проекты" }));
  assert.ok(header.contains(slot.getByRole("button", { name: "Поиск тредов" })));
  const control = slot.getByRole("button", { name: "Настроить приложения" });
  assert.equal(control.querySelector("svg").getAttribute("viewBox"), "0 0 24 24");
  assert.ok(!/(?:Рџ|Рњ|СЃ|С‚|�)/u.test(slot.container.textContent));
});

test("launcher collapse preserves the mounted chat, restores focus and persists across remounts", async () => {
  const slot = mount({ connected: true, threads: [thread("t1", "p1", "Тред")] });
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
  const callbacks = [];
  globalThis.ResizeObserver = class {
    constructor(callback) { callbacks.push(callback); }
    observe() {}
    disconnect() {}
  };
  window.localStorage.setItem("bb-dashboard:launcher-layout:v1", JSON.stringify({ open: true, width: 400 }));
  try {
    const slot = mount();
    const resize = await slot.findByRole("separator");
    const root = slot.container.querySelector(".db-root");
    let width = 300;
    Object.defineProperty(root, "clientWidth", { get: () => width });
    await act(async () => callbacks[0]());
    assert.equal(resize.getAttribute("aria-valuenow"), "256");
    assert.equal(JSON.parse(window.localStorage.getItem("bb-dashboard:launcher-layout:v1")).width, 400);
    fireEvent.click(slot.getByRole("button", { name: "Настроить приложения" }));
    assert.equal(slot.getByRole("button", { name: "Скрыть приложения" }).getAttribute("aria-expanded"), "true");
    assert.ok(slot.getByRole("region", { name: "Настройка приложений" }));
    width = 1200;
    await act(async () => callbacks[0]());
    assert.equal(resize.getAttribute("aria-valuenow"), "400");
    fireEvent.click(slot.container.querySelector(".db-launcher-backdrop"));
    assert.ok(slot.getByRole("button", { name: "Показать приложения" }));
  } finally {
    if (originalObserver === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = originalObserver;
  }
});
test("project settings render in Russian and save the selected project", async () => {
  const slot = mount();
  await slot.findByText("Выберите проекты для работы");
  fireEvent.click(within(slot.getByRole("banner")).getByRole("button", { name: "Выбрать проекты", exact: true }));
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
test("thread rows render the restored Russian status and environment", async () => {
  const slot = mount({ connected: true, threads: [{
    id: "t1", projectId: "p1", displayTitle: "Проверка русского треда", status: "idle", runtimeStatus: "idle",
    queuedWork: "none", hasPendingInteraction: false, isUnread: false, isHidden: false, isArchived: false,
    latestAttentionAt: 150, activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    environment: { name: "Основное окружение" }, host: null,
  }] });
  await slot.findByText("Проверка русского треда");
  assert.ok(slot.getByText("Просмотрено"));
  assert.ok(within(slot.container.querySelector(".db-thread-open")).getByText("Основное окружение"));
  assert.ok(slot.getByRole("button", { name: "Убрать «Проверка русского треда» с рабочего стола" }));
});
const secondProject = { ...project, id: "p2", name: "Второй проект" };
function thread(id, projectId, displayTitle, changes = {}) {
  return { id, projectId, displayTitle, status: "idle", runtimeStatus: "idle", queuedWork: "none", hasPendingInteraction: false,
    isUnread: false, isHidden: false, isArchived: false, latestAttentionAt: 150,
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    environment: { name: "Основное окружение" }, host: null, ...changes };
}

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
    thread("fork", "p1", "Самостоятельная ветка", { parentThreadId: "manager", originKind: "fork" }),
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
  assert.ok(slot.getByText("Задача первого проекта"));
  assert.equal(slot.queryByText("Задача второго проекта"), null);
  fireEvent.click(slot.getByRole("tab", { name: /^Второй проект,/ }));
  assert.ok(slot.getByText("Задача второго проекта"));
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
  fireEvent.change(slot.getByRole("combobox", { name: "Показывать треды" }), { target: { value: "attention" } });
  assert.equal(slot.queryByText("Прочитанный результат"), null);
  assert.ok(slot.getByText("Нужен ответ"));
  fireEvent.click(slot.getByRole("button", { name: "Поиск тредов" }));
  fireEvent.change(slot.getByRole("searchbox", { name: "Найти тред" }), { target: { value: "нет совпадений" } });
  assert.ok(slot.getByText("Треды не найдены."));
  fireEvent.click(slot.getByRole("button", { name: "Закрыть поиск" }));
  assert.ok(slot.getByText("Нужен ответ"));
});

test("single thread opens on project entry, respects manual collapse and reopens on return", async () => {
  const slot = mount({ connected: true, projects: [project, secondProject], threads: [
    thread("t1", "p1", "Первый тред"), thread("t2", "p2", "Второй тред"),
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

test("accepted prompts and work transitions keep the same chat mounted until manually closed", async () => {
  const subscriptions = new Set();
  const threads = [thread("t1", "p1", "Открытый тред"), thread("t2", "p1", "Другой тред")];
  const slot = mount({ connected: true, threads, sdk: {
    subscribe: subscription => { subscriptions.add(subscription); return () => subscriptions.delete(subscription); },
  } });
  await slot.findByText("Открытый тред");
  assert.equal(slot.queryByTestId("bb-thread-chat"), null);
  fireEvent.click(slot.getByRole("button", { name: /^Открытый тред/ }));
  const chat = slot.getByTestId("bb-thread-chat");
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
  fireEvent.click(slot.getByRole("button", { name: "Новый тред в проекте «Тестовый проект»" }));
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
  fireEvent.click(await slot.findByRole("button", { name: "Новый тред в проекте «Тестовый проект»" }));
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
  fireEvent.click(await slot.findByRole("button", { name: "Новый тред в проекте «Тестовый проект»" }));
  fireEvent.click(slot.getByTestId("bb-new-thread-composer-submit"));
  if (action === "switch project") fireEvent.click(slot.getByRole("tab", { name: /^Второй проект,/ }));
  else if (action === "open existing thread") fireEvent.click(slot.getByRole("button", { name: /^Старый тред/ }));
  else fireEvent.click(slot.getByRole("button", { name: "Закрыть создание треда" }));
  await act(async () => { resolveSpawn({ id: "created" }); });
  if (action === "open existing thread") assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "t1");
  else assert.equal(slot.queryByTestId("bb-thread-chat"), null);
  assert.equal(slot.queryByTestId("bb-new-thread-composer"), null);
  if (action === "switch project") assert.equal(slot.getByRole("tab", { name: /^Второй проект,/ }).getAttribute("aria-selected"), "true");
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
