import '../../scripts/test-loader.mjs';
import { test, fireEvent, within, act } from '../helpers/dom.mjs';
import { thread, mount } from '../helpers/dashboard.mjs';
import assert from 'node:assert/strict';
import { splitIds } from '../helpers/interactions.mjs';

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

test("failed delayed split hide preserves columns and the selected conversation", async () => {
  window.localStorage.setItem("bb-dashboard:split-layout:v1", JSON.stringify({ p1: { ids: ["a", "b"], active: "a", sizes: {} } }));
  let fail;
  const slot = mount({ connected: true, language: "en", threads: [thread("a", "p1", "Alpha"), thread("b", "p1", "Beta")],
    rpcOverrides: { thread_hide: () => new Promise((resolve, reject) => { fail = reject; }) } });
  await slot.findAllByTestId("bb-thread-chat");
  fireEvent.click(slot.getByRole("button", { name: "Hide “Alpha” from the dashboard" }));
  await act(async () => { fail(new Error("offline")); });
  assert.deepEqual(splitIds(slot), ["a", "b"]);
  assert.equal(slot.getByRole("tab", { name: /^Alpha:/ }).getAttribute("aria-selected"), "true");
});

test("hidden background tabs disappear without an undo placeholder or chat switch", async () => {
  const slot = mount({ connected: true, language: "en", threads: [thread("a", "p1", "Selected", { isUnread: true }), thread("b", "p1", "Background")] });
  const chat = await slot.findByTestId("bb-thread-chat");
  await act(async () => fireEvent.click(slot.getByRole("button", { name: /^Hide .*Background.* from the dashboard$/ })));
  assert.equal(slot.queryByRole("tab", { name: /^Background:/ }), null);
  assert.equal(slot.container.querySelector('[data-undo], .db-thread-undo'), null);
  assert.deepEqual([...slot.container.querySelectorAll('.db-thread-tabs .db-thread-tab-item')].map(el => el.textContent), ["Selected"]);
  assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  assert.equal(document.activeElement, slot.getByRole("tab", { name: /^Selected:/, selected: true }));
  assert.equal(slot.inspection.rpcCalls.some(call => call.method === "thread_restore"), false);
});

test("several threads can be hidden consecutively without retained slots", async () => {
  const slot = mount({ connected: true, language: "en", threads: [thread("a", "p1", "First", { isUnread: true }), thread("b", "p1", "Second"), thread("c", "p1", "Third")] });
  const chat = await slot.findByTestId("bb-thread-chat");
  for (const title of ["Second", "Third"]) {
    await act(async () => fireEvent.click(slot.getByRole("button", { name: new RegExp("^Hide .*" + title + ".* from the dashboard$") })));
    assert.equal(slot.queryByRole("tab", { name: new RegExp("^" + title + ":") }), null);
    assert.equal(slot.container.querySelector('[data-undo], .db-thread-undo'), null);
    assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  }
  assert.deepEqual([...slot.container.querySelectorAll('.db-thread-tabs .db-thread-tab-item')].map(el => el.textContent), ["First"]);
});

test("hiding removes the slot before advancing any timer", async context => {
  const slot = mount({ connected: true, language: "en", threads: [thread("a", "p1", "First", { isUnread: true }), thread("b", "p1", "Second"), thread("c", "p1", "Third")] });
  const chat = await slot.findByTestId("bb-thread-chat");
  context.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  await act(async () => fireEvent.click(slot.getByRole("button", { name: /^Hide .*Second.* from the dashboard$/ })));
  const names = () => [...slot.container.querySelectorAll('.db-thread-tabs .db-thread-tab-item')].map(el => el.textContent);
  assert.deepEqual(names(), ["First", "Third"]);
  assert.equal(slot.container.querySelector('[data-undo], .db-thread-undo'), null);
  act(() => context.mock.timers.tick(20000));
  assert.deepEqual(names(), ["First", "Third"]);
  assert.equal(slot.getByTestId("bb-thread-chat"), chat);
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

test("bottom tabs retain chronological neighbors and close hidden slots immediately", async () => {
  const threads = [thread("a", "p1", "Oldest", { createdAt: 100 }), thread("b", "p1", "Middle", { createdAt: 200 }), thread("c", "p1", "Newest", { createdAt: 300 })];
  const slot = mount({ connected: true, language: "en", threads });
  await slot.findByTestId("bb-thread-chat");
  const tabs = within(slot.getByRole("tablist", { name: "Project threads" }));
  assert.deepEqual(tabs.getAllByRole("tab").map(el => el.textContent), ["Newest", "Middle", "Oldest"]);
  fireEvent.click(tabs.getByRole("tab", { name: /^Middle:/ }));
  fireEvent.click(slot.getByRole("button", { name: "Hide “Middle” from the dashboard" }));
  await slot.findByText("Thread hidden from the dashboard. A new reply or activity will bring it back.");
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "a");
  assert.deepEqual([...slot.container.querySelectorAll('.db-thread-tabs .db-thread-tab-item')].map(el => el.textContent), ["Newest", "Oldest"]);
  assert.equal(slot.container.querySelector('[data-undo], .db-thread-undo'), null);
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
    assert.equal(overflowPanel.querySelectorAll(".db-thread-overflow-item").length, 6);
    assert.equal(overflowPanel.querySelector('.db-thread-undo'), null);
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
  fireEvent.click(within(dock).getByRole("button", { name: "Hide “Other” from the dashboard" }));
  await slot.findByText("Thread hidden from the dashboard. A new reply or activity will bring it back.");
  assert.equal(slot.queryByRole("tab", { name: /^Other:/ }), null);
  assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  assert.equal(chat.dataset.threadId, "t1");
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(slot.queryByRole("tab", { name: /^Other:/ }), null);
  assert.ok(slot.inspection.rpcCalls.some(call => call.method === "thread_hide" && call.input.threadId === "t2"));
  assert.equal(slot.inspection.sdkCalls.filter(call => /archive|delete|stop|send/.test(call.method)).length, 0);
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

test("thread toolbar has no search or filter and all conversation tabs stay available", async () => {
 const slot=mount({language:"en",connected:true,threads:[thread("active","p1","Working",{status:"active"}),thread("read","p1","Read result"),thread("new","p1","New result",{isUnread:true})]});
 const chat=await slot.findByTestId("bb-thread-chat");
 const header=slot.getByRole("banner");
 assert.equal(within(header).queryByRole("combobox"),null);
 assert.equal(within(header).queryByRole("searchbox"),null);
 assert.equal(within(header).queryByRole("button",{name:/search/i}),null);
 assert.equal(slot.container.querySelector(".db-header-tools, .db-search-results"),null);
 const dock=slot.container.querySelector(".db-thread-dock");
 assert.ok(within(dock).getByRole("tab",{name:/^Read result/}));
 assert.ok(within(dock).getByRole("tab",{name:/^New result/}));
 fireEvent.click(within(dock).getByRole("tab",{name:/^Read result/}));
 assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId,"read");
 assert.ok(chat);
});
