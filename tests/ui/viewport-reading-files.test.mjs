import '../../scripts/test-loader.mjs';
import { test, app, fireEvent, within, act, dom, JSDOM, withUiCleanup } from '../helpers/dom.mjs';
import { item, thread, mount } from '../helpers/dashboard.mjs';
import assert from 'node:assert/strict';
import { parse, generate, walk } from 'css-tree';
import { mobileViewportFixture } from '../helpers/interactions.mjs';
import { mountFileSurface } from '../helpers/file-surface.mjs';
import { readFileSync } from 'node:fs';
import { parseChatFileLink, resolveChatFilePath } from '../../chat-file-links.ts';

test("connection warning waits three seconds, resets after recovery and preserves the chat", async context => {
  assert.equal(app.navPanels[0].headerContent, undefined);
  const slot = mount({ connected: true, language: "en", threads: [thread("a", "p1", "Alpha")] });
  const chat = await slot.findByTestId("bb-thread-chat");
  const warning = () => slot.container.querySelector(".db-warning");
  assert.equal(warning(), null);
  context.mock.timers.enable({ apis: ["setTimeout"] });
  await act(async () => slot.behavior.setRealtimeConnectionState("reconnecting"));
  act(() => context.mock.timers.tick(2999));
  assert.equal(warning(), null);
  await act(async () => slot.behavior.setRealtimeConnectionState("connected"));
  act(() => context.mock.timers.tick(5000));
  assert.equal(warning(), null);
  await act(async () => slot.behavior.setRealtimeConnectionState("reconnecting"));
  act(() => context.mock.timers.tick(2999));
  assert.equal(warning(), null);
  act(() => context.mock.timers.tick(1));
  assert.match(warning().textContent, /Reconnecting/);
  assert.equal(warning().getAttribute("role"), "status");
  assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  await act(async () => slot.behavior.setRealtimeConnectionState("connected"));
  assert.equal(warning(), null);
  await act(async () => slot.behavior.setRealtimeConnectionState("reconnecting"));
  act(() => context.mock.timers.tick(2999));
  assert.equal(warning(), null);
  slot.lifecycle.unmount();
  act(() => context.mock.timers.tick(1));
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

test('failed UI work releases navigation, DOM, storage and browser overrides before another mount', async context => {
  const observer = globalThis.ResizeObserver;
  const drag = window.DragEvent;
  await assert.rejects(withUiCleanup(context, async () => {
    const slot = mount({ language: 'en', launcher: [{ id: item.id, label: item.label }] });
    assert.equal((await slot.findByRole('button', { name: item.label, exact: true })).disabled, false);
    window.localStorage.setItem('bb-dashboard:permission-mode:dashboard', 'full');
    window.sessionStorage.setItem('failed-test', 'temporary');
    globalThis.ResizeObserver = class {};
    window.DragEvent = window.MouseEvent;
    throw new Error('interrupted UI work');
  }), /interrupted UI work/);
  assert.equal(document.body.childElementCount, 0);
  assert.equal(window.localStorage.length, 0);
  assert.equal(window.sessionStorage.length, 0);
  assert.equal(globalThis.ResizeObserver, observer);
  assert.equal(window.DragEvent, drag);
  // Same cached app and navigation module, without installing a new bridge.
  const next = mount({ language: 'en', withNavigation: false, launcher: [{ id: item.id, label: item.label }] });
  assert.equal((await next.findByRole('button', { name: new RegExp('^' + item.label) })).disabled, true);
});

test("viewport CSS fills the host and applies mobile keyboard geometry to the child", () => {
  const css = parse(readFileSync(new URL("../../styles.css", import.meta.url), "utf8"));
  const rules = [];
  walk(css, node => {
    if (node.type === "Rule" && [".db-viewport", ".db-viewport>.db-root"].includes(generate(node.prelude))) rules.push(generate(node));
  });
  const fixture = new JSDOM(`<style>${rules.join("\n")}</style><div class="db-viewport"><div class="db-root"></div></div>`);
  try {
    const frame = fixture.window.document.querySelector(".db-viewport");
    const root = frame.firstElementChild;
    const frameStyle = fixture.window.getComputedStyle(frame);
    const rootStyle = fixture.window.getComputedStyle(root);
    assert.equal(frameStyle.position, "relative");
    assert.equal(frameStyle.height, "100%");
    assert.equal(frameStyle.overflow, "hidden");
    assert.equal(rootStyle.position, "absolute");
    assert.match(rootStyle.height, /var\(--db-visible-height,\s*100%\)/);
    assert.match(rootStyle.top, /var\(--db-visible-top,\s*0px\)/);
  } finally { fixture.window.close(); }
});

test("mobile typing fits the visual viewport without remounting the chat or losing draft selection", async t => {
  const mobile = mobileViewportFixture(t);
  const slot = mount({ connected: true, threads: [thread("a", "p1", "Alpha")], language: "en" });
  const native = await slot.findByTestId("bb-thread-chat");
  const frame = slot.container.querySelector(".db-viewport");
  frame.getBoundingClientRect = () => ({ top: 120, bottom: 956, height: 836, width: 440 });
  const editor = document.createElement("textarea");
  editor.value = "A draft that must survive opening and closing the keyboard";
  native.append(editor);
  editor.focus(); editor.setSelectionRange(7, 12);
  mobile.resize({ height: 550 }); await mobile.flush();
  assert.equal(frame.dataset.mobileComposing, "true");
  assert.equal(frame.style.getPropertyValue("--db-visible-height"), "430px");
  mobile.viewport.offsetTop = 160;
  mobile.viewport.dispatchEvent(new window.Event("scroll")); await mobile.flush();
  assert.equal(frame.style.getPropertyValue("--db-visible-top"), "40px");
  assert.equal(frame.style.getPropertyValue("--db-visible-height"), "550px");
  // A host already resized for the keyboard must not have it subtracted twice.
  frame.getBoundingClientRect = () => ({ top: 160, bottom: 710, height: 550, width: 440 });
  mobile.resize({ height: 550 }); await mobile.flush();
  assert.equal(frame.style.getPropertyValue("--db-visible-height"), "550px");
  const send = document.createElement("button"); native.append(send); send.focus(); await mobile.flush();
  assert.equal(frame.dataset.mobileComposing, "true");
  mobile.resize({ height: 956, offsetTop: 0 }); await mobile.flush();
  assert.equal(frame.dataset.mobileComposing, undefined);
  assert.equal(frame.style.getPropertyValue("--db-visible-height"), "");
  assert.equal(slot.getByTestId("bb-thread-chat"), native);
  assert.equal(editor.value, "A draft that must survive opening and closing the keyboard");
  assert.equal(editor.selectionStart, 7); assert.equal(editor.selectionEnd, 12);
  mobile.resize({ height: 550 });
  slot.lifecycle.unmount();
  assert.equal(mobile.pending.size, 0);
  mobile.resize({ height: 500 });
  assert.equal(mobile.pending.size, 0);
});

test("search, browser chrome, pinch zoom and desktop resizing do not activate mobile typing", async t => {
  const mobile = mobileViewportFixture(t);
  const slot = mount({ connected: true, threads: [thread("a", "p1", "Alpha")], language: "en" });
  const native = await slot.findByTestId("bb-thread-chat");
  const frame = slot.container.querySelector(".db-viewport");
  frame.getBoundingClientRect = () => ({ top: 120, bottom: 956, height: 836, width: 440 });
  const search = document.createElement("input"); frame.querySelector(".db-header").append(search);
  search.focus(); mobile.resize({ height: 550 }); await mobile.flush();
  assert.equal(frame.dataset.mobileComposing, undefined);
  const editor = document.createElement("div"); editor.setAttribute("contenteditable", "true"); editor.tabIndex = 0; native.append(editor); editor.focus();
  mobile.resize({ height: 880 }); await mobile.flush();
  assert.equal(frame.dataset.mobileComposing, undefined);
  mobile.resize({ height: 550, scale: 1.5 }); await mobile.flush();
  assert.equal(frame.dataset.mobileComposing, undefined);
  mobile.setCoarse(false); mobile.resize({ scale: 1 }); await mobile.flush();
  assert.equal(frame.dataset.mobileComposing, undefined);
  mobile.setCoarse(true); mobile.resize({ height: 550 }); await mobile.flush();
  assert.equal(frame.dataset.mobileComposing, "true");
  search.focus(); await mobile.flush();
  assert.equal(frame.dataset.mobileComposing, undefined);
  // Rotation resets the baseline even when the editor is still focused.
  editor.focus(); window.innerWidth = 956; window.innerHeight = 440;
  mobile.resize({ width: 956, height: 440 }); await mobile.flush();
  assert.equal(frame.dataset.mobileComposing, undefined);
});

test("chat file hrefs preserve Windows paths, encoded names and line locations", () => {
  assert.deepEqual(parseChatFileLink("/E:/Development/BBDesk/CHANGELOG.md"), { path: "E:/Development/BBDesk/CHANGELOG.md", location: null });
  assert.deepEqual(parseChatFileLink("file:///E:/My%20Project/report.md#L8-L12"), { path: "E:/My Project/report.md", location: { kind: "range", startLine: 8, endLine: 12 } });
  assert.deepEqual(parseChatFileLink("E:\\Project\\app.tsx:12:3"), { path: "E:/Project/app.tsx", location: { kind: "line", line: 12, column: 3 } });
  assert.equal(resolveChatFilePath("../verification/report.md", "E:\\Development\\BBDesk\\plugin"), "E:/Development/BBDesk/verification/report.md");
  assert.equal(resolveChatFilePath("/tmp/report.md", "E:/Project"), "/tmp/report.md");
  assert.equal(resolveChatFilePath("../../../report.md", "E:/Project"), null);
  for (const href of ["https://example.com/report.md", "http://localhost:1234/", "plugin://dashboard/home", "/api/attachments/test.zip", "/plugins/dashboard/home", "#L2", "//example.com/a.md", "file://server/a.md", "/bad%00.md", "/bad%ZZ.md", "app.ts:0", "app.ts#L8-L2"]) assert.equal(parseChatFileLink(href), null, href);
});

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

test("launcher collapse preserves the mounted chat, restores focus and persists across remounts", async () => {
  const slot = mount({ connected: true, threads: [thread("t1", "p1", "Тред", { isUnread: true })] });
  const chat = await slot.findByTestId("bb-thread-chat");
  const toggle = slot.getByRole("button", { name: "Скрыть приложения" });
  const settings = slot.getByRole("button", { name: "Настроить проекты и приложения" });
  const separator = slot.getByRole("separator");
  separator.focus();
  fireEvent.keyDown(separator, { key: "Escape" });
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
    fireEvent.click(slot.getByRole("button", { name: "Настроить проекты и приложения" }));
    assert.equal(slot.getByRole("button", { name: "Скрыть приложения" }).getAttribute("aria-expanded"), "true");
    assert.ok(slot.getByRole("dialog", { name: "Каталог" }));
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

test("switching away and back restores reading through native initial scrolling and releases on user input", async () => {
  const { preserveChatReading } = await import("../../chat-reading.ts");
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
  const { followChatBottom } = await import("../../chat-scroll.ts");
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
