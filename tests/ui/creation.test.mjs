import '../../scripts/test-loader.mjs';
import { test, fireEvent, within, act } from '../helpers/dom.mjs';
import { project, secondProject, thread, mount } from '../helpers/dashboard.mjs';
import assert from 'node:assert/strict';
import { splitTransfer, splitIds, splitPanes, dropTransfer } from '../helpers/interactions.mjs';
import { poolLimitFixture, storedPool, captureComposerRejections } from '../helpers/pool.mjs';
import { deferred } from '../helpers/deferred.mjs';
import { sharedPoolLimit } from '../../split-layout.ts';

test("pool creation protection survives navigation, multiple creations and explicit unpinning", async () => {
  const threads = [thread("alpha", "p1", "Alpha")];
  let count = 0;
  const slot = mount({ connected: true, language: "en", threads, sdk: { threads: { spawn: async () => ({ id: `created${++count}` }) } } });
  await slot.findByTestId("bb-thread-chat");
  for (let i = 1; i <= 2; i++) {
    fireEvent.click(slot.getByRole("button", { name: "New thread in the shared pool" }));
    await act(async () => { fireEvent.click(slot.getByTestId("bb-new-thread-composer-submit")); });
    fireEvent.click(slot.getByRole("tab", { name: new RegExp(`^${project.name},`) }));
  }
  const entries = () => JSON.parse(window.localStorage.getItem("bb-dashboard:shared-pool:v1")).entries.map(entry => entry.threadId);
  assert.deepEqual(entries(), ["created1", "created2"]);
  fireEvent.click(slot.getByRole("button", { name: /^Shared pool/ }));
  assert.deepEqual(splitIds(slot), ["created1", "created2"]);
  assert.equal(slot.getAllByTestId("bb-thread-chat").length, 2);
  fireEvent.click(within(splitPanes(slot)[0]).getByRole("button", { name: /^Remove/ }));
  threads.push(thread("created1", "p1", "First created"), thread("created2", "p1", "Second created"));
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.deepEqual(entries(), ["created2"]);
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "created2");
});

test("late pool spawn keeps its pin without reopening the pool or replacing newer navigation", async () => {
  const { promise: response, resolve: complete } = deferred();
  const slot = mount({ connected: true, language: "en", projects: [project, secondProject], threads: [thread("alpha", "p1", "Alpha"), thread("other", "p2", "Other")],
    sdk: { threads: { spawn: () => response } } });
  await slot.findByTestId("bb-thread-chat");
  fireEvent.click(slot.getByRole("button", { name: "New thread in the shared pool" }));
  fireEvent.click(slot.getByTestId("bb-new-thread-composer-submit"));
  fireEvent.click(slot.getByRole("tab", { name: new RegExp(`^${secondProject.name},`) }));
  await act(async () => { complete({ id: "created" }); });
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "other");
  const pool = JSON.parse(window.localStorage.getItem("bb-dashboard:shared-pool:v1"));
  assert.equal(pool.open, false);
  assert.deepEqual(pool.entries, [{ projectId: "p1", threadId: "created" }]);
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

test("opening the new-thread composer takes precedence over single-thread auto-open", async () => {
  const slot = mount({ connected: true, projects: [project, secondProject], threads: [thread("t2", "p2", "Второй тред")] });
  fireEvent.click(await slot.findByRole("button", { name: "Новый тред в проекте «Второй проект»" }));
  assert.ok(slot.getByText("Новый тред · Второй проект"));
  assert.equal(slot.queryByTestId("bb-thread-chat"), null);
});

test("first prompt opens the returned thread before the sidebar catches up and retains it through startup", async () => {
  const threads = [thread("t1", "p1", "Старый тред"), thread("t2", "p1", "Другой тред")];
  const slot = mount({ connected: true, threads, sdk: { threads: { spawn: async () => ({ id: "created" }) } } });
  await slot.findByTestId("bb-thread-chat");
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
  const { promise: response, resolve: resolveSpawn } = deferred();
  const threads = [thread("t1", "p1", "Старый тред")];
  const slot = mount({ connected: true, threads, sdk: { threads: { spawn: () => response } } });
  fireEvent.click((await slot.findAllByRole("button", { name: "Новый тред в проекте «Тестовый проект»" }))[0]);
  fireEvent.click(slot.getByTestId("bb-new-thread-composer-submit"));
  threads.push(thread("created", "p1", "Созданный тред", { status: "active" }));
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.ok(slot.getByTestId("bb-new-thread-composer"));
  await act(async () => { resolveSpawn({ id: "created" }); });
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "created");
  assert.equal(slot.queryByTestId("bb-new-thread-composer"), null);
});

test("shared pool new thread stays in the pool and pins the created thread", async () => {
  const slot = mount({
    connected: true, language: "en", projects: [project, secondProject],
    threads: [thread("alpha", "p1", "Alpha")],
    sdk: { threads: { spawn: async () => ({ id: "created" }) } },
  });
  await slot.findByTestId("bb-thread-chat");
  fireEvent.click(slot.getByRole("button", { name: "New thread in the shared pool" }));
  assert.equal(slot.getAllByRole("button", { name: "New thread in the shared pool" }).length, 2);
  assert.equal(slot.getByRole("button", { name: /^Shared pool/ }).getAttribute("aria-pressed"), "true");
  assert.equal(slot.getByTestId("bb-new-thread-composer").dataset.defaultProjectId, "p1");
  assert.equal(slot.queryByTestId("bb-thread-chat"), null);
  await act(async () => { fireEvent.click(slot.getByTestId("bb-new-thread-composer-submit")); });
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "created");
  assert.equal(slot.queryByTestId("bb-new-thread-composer"), null);
  assert.equal(slot.getByRole("button", { name: /^Shared pool/ }).getAttribute("aria-pressed"), "true");
  assert.deepEqual(JSON.parse(window.localStorage.getItem("bb-dashboard:shared-pool:v1")).entries, [{ projectId: "p1", threadId: "created" }]);
  assert.deepEqual(JSON.parse(window.localStorage.getItem("bb-dashboard:split-layout:v1") ?? "{}"), {});
});

test("full pool refuses submission before spawn, keeps the draft and selection, and retries after a removal", async context => {
  const failures = captureComposerRejections(context);
  const threads = poolLimitFixture();
  let spawns = 0;
  const slot = mount({ connected: true, language: "en", threads, sdk: { threads: { spawn: async () => { spawns++; return { id: "created" }; } } } });
  await slot.findByTestId("bb-thread-chat");
  fireEvent.click(slot.getByRole("button", { name: "New thread in the shared pool" }));
  const editor = slot.getByTestId("bb-new-thread-composer-input");
  fireEvent.change(editor, { target: { value: "Keep this draft" } });
  editor.focus(); editor.setSelectionRange(2, 6);
  await act(async () => fireEvent.click(slot.getByTestId("bb-new-thread-composer-submit")));
  assert.equal(spawns, 0);
  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /shared pool is full/);
  assert.equal(slot.getByTestId("bb-new-thread-composer-input"), editor);
  assert.equal(editor.value, "Keep this draft");
  assert.equal(editor.selectionStart, 2); assert.equal(editor.selectionEnd, 6);
  assert.equal(slot.queryByText("New thread created."), null);
  await slot.setLanguage("ru");
  assert.match(slot.container.querySelector("[data-pool-full]").textContent, /Общий пул заполнен/);
  assert.equal(slot.getByTestId("bb-new-thread-composer-input"), editor);
  await slot.setLanguage("en");
  fireEvent.click(within(slot.container.querySelector(".db-pool-workspace .db-thread-dock")).getByRole("button", { name: /^Remove.*Pinned 0/ }));
  assert.equal(slot.queryByText(/shared pool is full/), null);
  assert.equal(slot.getByTestId("bb-new-thread-composer-input"), editor);
  await act(async () => fireEvent.click(slot.getByTestId("bb-new-thread-composer-submit")));
  assert.equal(spawns, 1);
  assert.equal(storedPool().entries.length, sharedPoolLimit);
  assert.ok(storedPool().entries.some(entry => entry.threadId === "created"));
  assert.equal(slot.queryByTestId("bb-new-thread-composer"), null);
});

test("pool filling during spawn keeps the created result available before the sidebar arrives", async () => {
  const threads = poolLimitFixture(sharedPoolLimit - 1);
  let complete;
  const slot = mount({ connected: true, language: "en", threads, sdk: { threads: { spawn: () => new Promise(resolve => { complete = resolve; }) } } });
  await slot.findByTestId("bb-thread-chat");
  fireEvent.click(slot.getByRole("button", { name: "New thread in the shared pool" }));
  fireEvent.click(slot.getByTestId("bb-new-thread-composer-submit"));
  dropTransfer(slot.getByRole("button", { name: /^Shared pool/ }), splitTransfer("p1", threads[sharedPoolLimit - 1].id));
  const pins = storedPool().entries;
  await act(async () => complete({ id: "created" }));
  assert.deepEqual(storedPool().entries, pins);
  assert.equal(slot.queryByTestId("bb-new-thread-composer"), null);
  const result = slot.container.querySelector('[data-created-thread-id="created"]');
  assert.match(result.textContent, /thread was created, but the shared pool is full/);
  assert.equal(slot.inspection.sdkCalls.filter(call => call.method === "threads.spawn").length, 1);
  fireEvent.click(within(result).getByRole("button", { name: "Open created thread" }));
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "created");
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "created");
  threads.push(thread("created", "p1", "Created result"));
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "created");
  assert.deepEqual(storedPool().entries, pins);
});

test("concurrent pool spawn completions respect capacity and retain every unpinned result without late navigation", async () => {
  const threads = [...poolLimitFixture(sharedPoolLimit - 1), thread("other", "p2", "Other")];
  const completions = [];
  const slot = mount({ connected: true, language: "en", projects: [project, secondProject], threads,
    sdk: { threads: { spawn: () => new Promise(resolve => completions.push(resolve)) } } });
  await slot.findByTestId("bb-thread-chat");
  for (let i = 0; i < 2; i++) {
    fireEvent.click(slot.getAllByRole("button", { name: "New thread in the shared pool" })[0]);
    fireEvent.click(slot.getByTestId("bb-new-thread-composer-submit"));
  }
  // Fill the last place while both creates are in flight, then choose another project.
  dropTransfer(slot.getByRole("button", { name: /^Shared pool/ }), splitTransfer("p1", threads[sharedPoolLimit - 1].id));
  fireEvent.click(slot.getByRole("tab", { name: new RegExp(`^${secondProject.name},`) }));
  const chat = slot.getByTestId("bb-thread-chat");
  await act(async () => { completions[1]({ id: "second-created" }); completions[0]({ id: "first-created" }); });
  assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  assert.equal(chat.dataset.threadId, "other");
  assert.equal(storedPool().open, false);
  assert.equal(storedPool().entries.length, sharedPoolLimit);
  assert.equal(slot.container.querySelectorAll("[data-created-thread-id]").length, 2);
  assert.equal(slot.queryByTestId("bb-new-thread-composer"), null);
  assert.equal(slot.inspection.sdkCalls.filter(call => call.method === "threads.spawn").length, 2);
  // Opening one result does not discard the other result.
  fireEvent.click(within(slot.container.querySelector('[data-created-thread-id="first-created"]')).getByRole("button", { name: "Open created thread" }));
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "first-created");
  assert.ok(slot.container.querySelector('[data-created-thread-id="second-created"]'));
});

test("concurrent pool spawns use the last free place once even within the same React batch", async () => {
  const threads = poolLimitFixture(sharedPoolLimit - 1);
  const completions = [];
  const slot = mount({ connected: true, language: "en", threads,
    sdk: { threads: { spawn: () => new Promise(resolve => completions.push(resolve)) } } });
  await slot.findByTestId("bb-thread-chat");
  for (const prompt of ["First task", "Second task"]) {
    fireEvent.click(slot.getAllByRole("button", { name: "New thread in the shared pool" })[0]);
    fireEvent.change(slot.getByTestId("bb-new-thread-composer-input"), { target: { value: prompt } });
    fireEvent.click(slot.getByTestId("bb-new-thread-composer-submit"));
  }
  await act(async () => { completions[0]({ id: "created-first" }); completions[1]({ id: "created-second" }); });
  assert.equal(storedPool().entries.length, sharedPoolLimit);
  assert.ok(storedPool().entries.some(entry => entry.threadId === "created-first"));
  assert.equal(storedPool().entries.some(entry => entry.threadId === "created-second"), false);
  const result = slot.container.querySelector('[data-created-thread-id="created-second"]');
  assert.match(result.textContent, /Second task/);
  assert.equal(slot.container.querySelectorAll('[data-created-thread-id]').length, 1);
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.ok(storedPool().entries.some(entry => entry.threadId === "created-first"));
  assert.ok(slot.container.querySelector('[data-created-thread-id="created-second"]'));
});

test("pool spawn completing after explicit unpin does not pin the thread again", async () => {
  const threads = [thread("alpha", "p1", "Alpha")];
  let complete;
  const slot = mount({ connected: true, language: "en", threads, sdk: { threads: { spawn: () => new Promise(resolve => { complete = resolve; }) } } });
  await slot.findByTestId("bb-thread-chat");
  fireEvent.click(slot.getByRole("button", { name: "New thread in the shared pool" }));
  fireEvent.click(slot.getByTestId("bb-new-thread-composer-submit"));
  threads.push(thread("created", "p1", "Created"));
  await slot.behavior.emitRealtime("dashboard-changed", {});
  fireEvent.click(slot.getByRole("tab", { name: new RegExp(`^${project.name},`) }));
  fireEvent.click(slot.getByRole("button", { name: /^Pin.*Created/ }));
  fireEvent.click(slot.getByRole("button", { name: /^Remove.*Created/ }));
  await act(async () => complete({ id: "created" }));
  assert.deepEqual(storedPool().entries, []);
  assert.match(slot.container.querySelector('[data-created-thread-id="created"]').textContent, /not pinned/);
});

test("failed pool spawn keeps its draft and a late unmounted spawn does not change stored pins", async context => {
  const failures = captureComposerRejections(context);
  let reject;
  let complete;
  let calls = 0;
  const slot = mount({ connected: true, language: "en", threads: [thread("alpha", "p1", "Alpha")],
    sdk: { threads: { spawn: () => new Promise((resolve, fail) => { calls++; complete = resolve; reject = fail; }) } } });
  await slot.findByTestId("bb-thread-chat");
  fireEvent.click(slot.getByRole("button", { name: "New thread in the shared pool" }));
  const editor = slot.getByTestId("bb-new-thread-composer-input");
  fireEvent.change(editor, { target: { value: "Retry this draft" } });
  editor.setSelectionRange(1, 5);
  fireEvent.click(slot.getByTestId("bb-new-thread-composer-submit"));
  await act(async () => reject(new Error("offline")));
  assert.equal(failures.length, 1);
  assert.equal(slot.getByTestId("bb-new-thread-composer-input"), editor);
  assert.equal(editor.value, "Retry this draft");
  assert.equal(editor.selectionStart, 1); assert.equal(editor.selectionEnd, 5);
  assert.deepEqual(storedPool().entries, []);
  assert.equal(slot.container.querySelector("[data-created-thread-id]"), null);
  fireEvent.click(slot.getByTestId("bb-new-thread-composer-submit"));
  const before = window.localStorage.getItem("bb-dashboard:shared-pool:v1");
  slot.lifecycle.unmount();
  await act(async () => complete({ id: "created-after-unmount" }));
  assert.equal(calls, 2);
  assert.equal(window.localStorage.getItem("bb-dashboard:shared-pool:v1"), before);
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
