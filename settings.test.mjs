import "./scripts/test-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
const { default: plugin } = await import("./server.ts");
const listRow = (changes = {}) => ({ ...makeThreadResponse({ id: "t1", projectId: "p1", status: "idle" }),
  latestAttentionAt: 200, queuedWork: "none", hasPendingInteraction: false, runtime: { displayStatus: "idle" },
  activity: { activeBackgroundAgentCount: 0, activeBackgroundCommandCount: 0, activeWorkflowCount: 0 }, ...changes });

test("hide undo restores visibility, rejects stale tokens and never changes native thread execution", async () => {
  let row = listRow();
  const host = createFakePluginHost({ sdk: { threads: { list: async () => [row] } } });
  try {
    await host.bb.storage.kv.set("config-v1", { projects: [{ id: "p1", enabled: true, connectedAt: 100 }], launcher: [] });
    await host.bb.storage.kv.set("thread:t1", { id: "t1", projectId: "p1", visible: true, latestAttentionAt: 200, hiddenAttentionAt: 0 });
    await plugin(host.bb);
    const first = await host.harness.behavior.callRpc("thread_hide", { threadId: "t1" });
    const second = await host.harness.behavior.callRpc("thread_hide", { threadId: "t1" });
    assert.equal((await host.bb.storage.kv.get("thread:t1")).visible, false);
    assert.notEqual(first.undoToken, second.undoToken);
    assert.deepEqual(await host.harness.behavior.callRpc("thread_restore", { threadId: "t1", undoToken: first.undoToken }), { restored: false });
    row = listRow({ status: "active", latestAttentionAt: 201 });
    assert.deepEqual(await host.harness.behavior.callRpc("thread_restore", { threadId: "t1", undoToken: second.undoToken }), { restored: true });
    assert.equal((await host.bb.storage.kv.get("thread:t1")).visible, true);
    assert.equal((await host.bb.storage.kv.get("thread:t1")).latestAttentionAt, 201);
    assert.deepEqual(await host.harness.behavior.callRpc("thread_restore", { threadId: "t1", undoToken: second.undoToken }), { restored: false });
    assert.ok(host.harness.inspection.sdk.calls.every(call => call.path === "threads.list"));
  } finally { await host.harness.lifecycle.dispose(); }
});

test("undo refuses archived or inaccessible conversations and failed writes remain retryable", async () => {
  let row = listRow();
  const host = createFakePluginHost({ sdk: { threads: { list: async () => row ? [row] : [] } } });
  try {
    await host.bb.storage.kv.set("config-v1", { projects: [{ id: "p1", enabled: true, connectedAt: 100 }], launcher: [] });
    await host.bb.storage.kv.set("thread:t1", { id: "t1", projectId: "p1", visible: true, latestAttentionAt: 200, hiddenAttentionAt: 0 });
    await plugin(host.bb);
    const { undoToken } = await host.harness.behavior.callRpc("thread_hide", { threadId: "t1" });
    const input = { threadId: "t1", undoToken };
    row = { ...row, archivedAt: 250 };
    assert.deepEqual(await host.harness.behavior.callRpc("thread_restore", input), { restored: false });
    row = { ...row, archivedAt: null, visibility: "hidden" };
    assert.deepEqual(await host.harness.behavior.callRpc("thread_restore", input), { restored: false });
    row = { ...row, visibility: "visible" };
    const set = host.bb.storage.kv.set.bind(host.bb.storage.kv);
    host.bb.storage.kv.set = async () => { throw new Error("disk unavailable"); };
    await assert.rejects(host.harness.behavior.callRpc("thread_restore", input), /disk unavailable/);
    assert.equal((await host.bb.storage.kv.get("thread:t1")).visible, false);
    host.bb.storage.kv.set = set;
    assert.deepEqual(await host.harness.behavior.callRpc("thread_restore", input), { restored: true });
  } finally { await host.harness.lifecycle.dispose(); }
});

test("native language setting defaults to English and survives reload without changing dashboard data", async () => {
  let host = createFakePluginHost();
  let readSettings;
  async function load(bb) {
    const define = bb.settings.define.bind(bb.settings);
    bb.settings.define = descriptors => {
      const settings = define(descriptors);
      readSettings = () => settings.get();
      return settings;
    };
    await plugin(bb);
  }
  try {
    const saved = { projects: [{ id: "p1", enabled: true, connectedAt: 123 }], launcher: [{ id: "notes/home", label: "Мои заметки" }] };
    await host.bb.storage.kv.set("config-v1", saved);
    await load(host.bb);
    assert.equal((await readSettings()).language, "en");
    assert.equal(host.harness.registrations.settingsDescriptors.language.label, "Interface language");
    await host.harness.setSettings({ language: "ru" });
    await assert.rejects(host.harness.setSettings({ language: "de" }));
    host = await host.harness.reload(load);
    assert.equal((await readSettings()).language, "ru");
    assert.deepEqual(await host.bb.storage.kv.get("config-v1"), saved);
    await host.harness.setSettings({ language: null });
    assert.equal((await readSettings()).language, "en");
  } finally { await host.harness.dispose(); }
});
