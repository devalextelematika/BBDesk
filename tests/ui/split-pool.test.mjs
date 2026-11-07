import '../../scripts/test-loader.mjs';
import { test, fireEvent, within, act } from '../helpers/dom.mjs';
import { project, item, secondProject, thread, mount } from '../helpers/dashboard.mjs';
import assert from 'node:assert/strict';
import { splitTransfer, dropSplit, splitIds, splitPanes, dropTransfer } from '../helpers/interactions.mjs';
import { poolLimitFixture, storedPool } from '../helpers/pool.mjs';
import { sharedPoolLimit, addPoolEntry } from '../../split-layout.ts';

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
  const { readSplitLayouts, saveSplitLayouts } = await import("../../split-layout.ts");
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

test("shared pool pins threads from several projects without changing a project split", async () => {
  const threads = [
    thread("alpha", "p1", "Alpha", { providerId: "claude" }),
    thread("other", "p2", "Other", { providerId: "codex" }),
    thread("old", "p1", "Historical"),
    thread("sub", "p1", "Sub", { parentThreadId: "alpha" }),
  ];
  const slot = mount({
    connected: true, language: "en", projects: [project, secondProject], threads, hiddenIds: ["old"],
    providers: { status: "ready", providers: [
      { id: "claude", displayName: "Claude", logoUrl: "/logos/claude.svg", icon: { glyph: "Sparkle" }, strings: { iconTint: { light: "#111111", dark: "#eeeeee" } } },
      { id: "codex", displayName: "Codex", logoUrl: null },
    ] },
  });
  await slot.findByTestId("bb-thread-chat");
  const poolButton = () => slot.getByRole("button", { name: /^Shared pool/ });
  fireEvent.click(slot.getByRole("button", { name: "Pin “Alpha” to the shared pool" }));
  assert.equal(poolButton().getAttribute("aria-pressed"), "false");
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "alpha");
  fireEvent.click(slot.getByRole("tab", { name: /^Второй проект/ }));
  const transfer = splitTransfer("p2", "other");
  fireEvent.dragStart(slot.getByRole("tab", { name: /^Other:/ }), { dataTransfer: transfer });
  dropTransfer(poolButton(), transfer);
  dropTransfer(poolButton(), splitTransfer("p1", "sub"));
  const pool = poolButton();
  const icons = [...pool.querySelectorAll(".db-project-provider")];
  assert.deepEqual(icons.map(icon => icon.getAttribute("data-provider-id")), ["claude", "codex"]);
  assert.equal(icons[0].parentElement.getAttribute("title"), "Claude: Alpha");
  assert.equal(icons[1].parentElement.getAttribute("title"), "Codex: Other");
  assert.equal(pool.querySelector(".db-project-tab-name").textContent, "Shared pool");
  assert.equal(pool.querySelectorAll(".db-project-tab-states .db-dot").length, 2);
  assert.ok(icons[0].compareDocumentPosition(pool.querySelector(".db-project-tab-name")) & Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(pool.querySelector(".db-project-tab-name").compareDocumentPosition(pool.querySelector(".db-project-tab-states")) & Node.DOCUMENT_POSITION_FOLLOWING);
  assert.match(pool.getAttribute("aria-label"), /Shared pool, working: 0, need attention: 0, queued: 0, results: 2\. Alpha: Read \(Claude\); Other: Read \(Codex\)/);
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "other");
  fireEvent.click(poolButton());
  assert.equal(poolButton().getAttribute("aria-pressed"), "true");
  assert.equal(slot.getByRole("tab", { name: /^Тестовый проект,/ }).getAttribute("aria-selected"), "false");
  assert.deepEqual(splitIds(slot), ["alpha", "other"]);
  const poolDock = slot.container.querySelector(".db-pool-workspace .db-thread-dock");
  const remove = within(poolDock).getByRole("button", { name: "Remove “Alpha” from the shared pool" });
  assert.equal(remove.querySelector("path").getAttribute("d"), "m6 6 12 12M18 6 6 18");
  assert.equal(within(poolDock).getByRole("tab", { name: /^Тестовый проект · Alpha:/ }).querySelector("span:not(.db-dot)").textContent, "Тестовый проект · Alpha");
  assert.deepEqual([...slot.container.querySelectorAll(".db-thread-project")].map(node => node.textContent), ["Тестовый проект", "Второй проект"]);
  const otherPane = splitPanes(slot).find(pane => pane.dataset.threadId === "other");
  fireEvent.click(within(otherPane).getByRole("button", { name: "Remove “Other” from the shared pool" }));
  assert.deepEqual(splitIds(slot), ["alpha"]);
  assert.equal(slot.inspection.rpcCalls.filter(call => call.method === "thread_hide").length, 0);
  fireEvent.click(slot.getByRole("tab", { name: /^Тестовый проект,/ }));
  assert.equal(poolButton().getAttribute("aria-pressed"), "false");
  assert.deepEqual(splitIds(slot), ["alpha"]);
  assert.equal(JSON.parse(window.localStorage.getItem("bb-dashboard:split-layout:v1")).p1, undefined);
  fireEvent.click(slot.getByRole("button", { name: "Show last 10 threads" }));
  fireEvent.click(within(slot.getByRole("region", { name: "Previous threads" })).getByRole("button", { name: "Pin “Historical” to the shared pool" }));
  fireEvent.click(poolButton());
  assert.deepEqual(splitIds(slot), ["alpha", "old"]);
  assert.equal(slot.getAllByTestId("bb-thread-chat").map(node => node.dataset.threadId).sort().join(), "alpha,old");
});

test("catalog toggles shared pool immediately without forgetting its threads", async () => {
  window.localStorage.setItem('bb-dashboard:shared-pool:v1',JSON.stringify({open:true,active:'alpha',sizes:{},entries:[{projectId:'p1',threadId:'alpha'}]}));
  const slot=mount({connected:true,language:'en',threads:[thread('alpha','p1','Alpha')]});
  await slot.findByRole('button',{name:/^Shared pool/});
  fireEvent.click(slot.getByRole('button',{name:'Configure projects and applications'}));
  await act(async()=>fireEvent.click(slot.getByRole('checkbox',{name:'Shared pool'})));
  assert.equal(slot.queryByRole('button',{name:/^Shared pool/}),null);
  assert.deepEqual(JSON.parse(window.localStorage.getItem('bb-dashboard:shared-pool:v1')).entries,[{projectId:'p1',threadId:'alpha'}]);
  assert.equal(JSON.parse(window.localStorage.getItem('bb-dashboard:shared-pool:v1')).open,false);
  await act(async()=>fireEvent.click(slot.getByRole('checkbox',{name:'Shared pool'})));
  assert.ok(slot.getByRole('button',{name:/^Shared pool/}));
  assert.deepEqual(slot.inspection.rpcCalls.filter(c=>c.method==='catalog_change'&&c.input.type==='pool').map(c=>c.input.enabled),[false,true]);
});

test("shared pool keeps a disabled project visible and drops archived threads", async () => {
  window.localStorage.setItem("bb-dashboard:shared-pool:v1", JSON.stringify({
    open: true, active: "a", sizes: { a: 3, b: 3 },
    entries: [{ projectId: "p1", threadId: "a" }, { projectId: "p1", threadId: "b" }, { projectId: "gone", threadId: "missing" }],
  }));
  const threads = [thread("a", "p1", "Alpha"), thread("b", "p1", "Beta")];
  let slot = mount({ connected: true, language: "en", threads });
  await slot.findAllByTestId("bb-thread-chat");
  assert.equal(slot.getAllByTestId("bb-thread-chat").length, 2);
  assert.deepEqual(splitIds(slot), ["a", "b", "missing"]);
  assert.ok(slot.getAllByText("Project unavailable").length);
  assert.ok(slot.getByText("Check access to this project or disable it in dashboard settings."));
  threads[1] = { ...threads[1], isArchived: true };
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.deepEqual(splitIds(slot), ["a", "missing"]);
  slot.lifecycle.unmount();
  slot = mount({ connected: true, language: "en", threads });
  await slot.findByTestId("bb-thread-chat");
  assert.deepEqual(splitIds(slot), ["a", "missing"]);
  assert.equal(JSON.parse(window.localStorage.getItem("bb-dashboard:shared-pool:v1")).open, true);
});

test("shared pool persistence keeps valid pairs and ignores malformed storage", async () => {
  const { readSharedPool, saveSharedPool, addPoolEntry, movePoolEntry, removePoolEntry } = await import("../../split-layout.ts");
  const key = "bb-dashboard:shared-pool:v1";
  window.localStorage.setItem(key, JSON.stringify({
    open: true, active: "missing", sizes: { a: 4, b: 0, c: "no" },
    entries: [{ projectId: "p1", threadId: "a" }, { projectId: "p2", threadId: "a" }, { projectId: "", threadId: "b" }, null, { projectId: "p2", threadId: "c" }],
  }));
  assert.deepEqual(readSharedPool(), {
    open: true, active: "a", sizes: { a: 4, c: 1 },
    entries: [{ projectId: "p1", threadId: "a" }, { projectId: "p2", threadId: "c" }],
  });
  const added = addPoolEntry({ entries: [], active: "", sizes: {}, open: false }, { projectId: "p1", threadId: "a" }).pool;
  assert.deepEqual(addPoolEntry(added, { projectId: "p9", threadId: "a" }).pool.entries, [{ projectId: "p9", threadId: "a" }]);
  assert.equal(removePoolEntry(added, "a").entries.length, 0);
  const ordered = { open: true, active: "a", sizes: { a: 4, b: 2, c: 1 }, entries: [{ projectId: "p1", threadId: "a" }, { projectId: "p1", threadId: "b" }, { projectId: "p2", threadId: "c" }] };
  assert.equal(movePoolEntry(ordered, "b", "b"), ordered);
  assert.equal(movePoolEntry(ordered, "a", "b", false), ordered);
  assert.equal(movePoolEntry(ordered, "missing", "a"), ordered);
  const moved = movePoolEntry(ordered, "c", "a", false);
  assert.deepEqual(moved.entries.map(entry => entry.threadId), ["c", "a", "b"]);
  assert.equal(moved.active, "a");
  assert.deepEqual(moved.sizes, ordered.sizes);
  window.localStorage.setItem(key, "broken");
  assert.deepEqual(readSharedPool(), { entries: [], active: "", sizes: {}, open: false });
  const storage = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
  try {
    assert.deepEqual(readSharedPool(), { entries: [], active: "", sizes: {}, open: false });
    assert.doesNotThrow(() => saveSharedPool(added));
  } finally { Object.defineProperty(window, "localStorage", storage); }
});

test("pool addition reports capacity and duplicate outcomes without changing existing widths or order", async () => {
  const { readSharedPool, removePoolEntry } = await import("../../split-layout.ts");
  const rows = poolLimitFixture(sharedPoolLimit - 1);
  const previous = readSharedPool();
  const result = addPoolEntry(previous, { projectId: "p1", threadId: rows[sharedPoolLimit - 1].id });
  assert.equal(result.status, "added");
  const full = { ...result.pool, sizes: { [rows[0].id]: 3 } };
  const refused = addPoolEntry(full, { projectId: "p1", threadId: "extra" });
  assert.equal(refused.status, "limit");
  assert.equal(refused.pool, full);
  const duplicate = addPoolEntry(full, full.entries[0]);
  assert.equal(duplicate.status, "present");
  assert.deepEqual(duplicate.pool.entries, full.entries);
  assert.deepEqual(duplicate.pool.sizes, full.sizes);
  assert.equal(duplicate.pool.active, full.entries[0].threadId);
  assert.equal(addPoolEntry(full, { projectId: "", threadId: "extra" }).status, "invalid");
  assert.equal(addPoolEntry(removePoolEntry(full, rows[0].id), { projectId: "p1", threadId: "extra" }).status, "added");
  poolLimitFixture(sharedPoolLimit + 1);
  assert.equal(readSharedPool().entries.length, sharedPoolLimit);
});

test("full pool pin and drop refusals preserve the selected chat and existing pins", async () => {
  const threads = poolLimitFixture();
  const slot = mount({ connected: true, language: "en", threads });
  const chat = await slot.findByTestId("bb-thread-chat");
  const before = storedPool().entries;
  const extra = threads[sharedPoolLimit];
  fireEvent.click(slot.getByRole("button", { name: new RegExp(`^Pin.*${extra.displayTitle}`) }));
  assert.ok(slot.container.querySelector("[data-pool-full]"));
  assert.deepEqual(storedPool().entries, before);
  assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  dropTransfer(slot.getByRole("button", { name: /^Shared pool/ }), splitTransfer("p1", extra.id));
  assert.deepEqual(storedPool().entries, before);
  assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  // An already pinned entry can still be selected by dropping it at capacity.
  dropTransfer(slot.getByRole("button", { name: /^Shared pool/ }), splitTransfer("p1", threads[1].id));
  assert.equal(storedPool().active, threads[1].id);
  assert.deepEqual(storedPool().entries, before);
  fireEvent.click(slot.getByRole("button", { name: /^Shared pool/ }));
  dropTransfer(slot.container.querySelector(".db-split-pane"), splitTransfer("p1", extra.id));
  assert.ok(slot.container.querySelector("[data-pool-full]"));
  assert.deepEqual(storedPool().entries, before);
});

test("shared pool bottom tabs reorder the split columns", async () => {
  window.localStorage.setItem("bb-dashboard:shared-pool:v1", JSON.stringify({
    open: true, active: "alpha", sizes: { alpha: 4, other: 2, gamma: 1 },
    entries: [
      { projectId: "p1", threadId: "alpha" },
      { projectId: "p2", threadId: "other" },
      { projectId: "p1", threadId: "gamma" },
    ],
  }));
  const slot = mount({
    connected: true, language: "en", projects: [project, secondProject],
    threads: [thread("alpha", "p1", "Alpha"), thread("other", "p2", "Other"), thread("gamma", "p1", "Gamma")],
  });
  await slot.findAllByTestId("bb-thread-chat");
  const dock = () => slot.container.querySelector(".db-pool-workspace .db-thread-dock");
  const tabs = () => within(dock()).getAllByRole("tab").map(tab => tab.textContent);
  const alphaChat = slot.getAllByTestId("bb-thread-chat").find(node => node.dataset.threadId === "alpha");
  assert.deepEqual(splitIds(slot), ["alpha", "other", "gamma"]);
  assert.deepEqual(tabs(), ["Тестовый проект · Alpha", "Второй проект · Other", "Тестовый проект · Gamma"]);
  function reorder(from, to, clientX) {
    const item = within(dock()).getByRole("tab", { name: to }).closest(".db-thread-tab-item");
    const source = within(dock()).getByRole("tab", { name: from });
    item.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 32, right: 100, bottom: 32, x: 0, y: 0, toJSON() { return {}; } });
    const transfer = splitTransfer("p1", "alpha");
    const previous = window.DragEvent;
    window.DragEvent = window.MouseEvent;
    try {
      fireEvent.dragStart(source, { dataTransfer: transfer });
      fireEvent.dragOver(item, { dataTransfer: transfer, clientX });
      assert.equal(item.dataset.drop, clientX >= 50 ? "after" : "before");
      fireEvent.drop(item, { dataTransfer: transfer, clientX });
      fireEvent.dragEnd(source);
    } finally { window.DragEvent = previous; }
  }
  reorder(/^Тестовый проект · Alpha:/, /^Второй проект · Other:/, 10);
  assert.deepEqual(splitIds(slot), ["alpha", "other", "gamma"]);
  reorder(/^Тестовый проект · Gamma:/, /^Тестовый проект · Alpha:/, 10);
  assert.deepEqual(splitIds(slot), ["gamma", "alpha", "other"]);
  assert.deepEqual(tabs(), ["Тестовый проект · Gamma", "Тестовый проект · Alpha", "Второй проект · Other"]);
  const stored = JSON.parse(window.localStorage.getItem("bb-dashboard:shared-pool:v1"));
  assert.deepEqual(stored.entries.map(entry => entry.threadId), ["gamma", "alpha", "other"]);
  assert.equal(stored.active, "alpha");
  assert.deepEqual(stored.sizes, { alpha: 4, other: 2, gamma: 1 });
  assert.equal(slot.getAllByTestId("bb-thread-chat").find(node => node.dataset.threadId === "alpha"), alphaChat);
  assert.equal(splitPanes(slot).find(pane => pane.dataset.threadId === "alpha").dataset.active, "true");
  reorder(/^Второй проект · Other:/, /^Тестовый проект · Gamma:/, 90);
  assert.deepEqual(splitIds(slot), ["gamma", "other", "alpha"]);
});
