import "./scripts/test-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
const { default: plugin } = await import("./server.ts");
const listRow = (changes = {}) => ({ ...makeThreadResponse({ id: "t1", projectId: "p1", status: "idle" }),
  latestAttentionAt: 200, queuedWork: "none", hasPendingInteraction: false, runtime: { displayStatus: "idle" },
  activity: { activeBackgroundAgentCount: 0, activeBackgroundCommandCount: 0, activeWorkflowCount: 0 }, ...changes });

test("more than 100 lifetime projects survive save, snapshot and reload with connection history", async () => {
  const ids = Array.from({ length: 101 }, (_, i) => `p${i}`);
  let host = createFakePluginHost({ sdk: { projects: { list: async () => ids.map(id => ({ id })) }, threads: { list: async () => [] } } });
  try {
    await plugin(host.bb);
    const initial = await host.harness.behavior.callRpc("projects_set", { ids: ids.slice(0, 100) });
    const saved = await host.harness.behavior.callRpc("projects_set", { ids: [ids[100]] });
    assert.equal(saved.projects.length, 101);
    assert.equal(saved.projects.filter(project => project.enabled).length, 1);
    assert.deepEqual((await host.harness.behavior.callRpc("snapshot", null)).config, saved);
    host = await host.harness.reload(plugin);
    assert.deepEqual((await host.harness.behavior.callRpc("snapshot", null)).config, saved);
    const reconnected = await host.harness.behavior.callRpc("projects_set", { ids: [ids[0]] });
    assert.equal(reconnected.projects[0].connectedAt, initial.projects[0].connectedAt);
    assert.equal(reconnected.projects.length, 101);
  } finally { await host.harness.lifecycle.dispose(); }
});

test("previously persisted oversized project history is recovered without resetting launcher or pool settings", async () => {
  const host = createFakePluginHost({ sdk: { threads: { list: async () => [] } } });
  const config = { projects: Array.from({ length: 101 }, (_, i) => ({ id: `p${i}`, enabled: i === 100, connectedAt: i + 1 })), launcher: [{ id: "notes/home", label: "Notes" }], sharedPool: false };
  try {
    await host.bb.storage.kv.set("config-v1", config);
    await plugin(host.bb);
    assert.deepEqual((await host.harness.behavior.callRpc("snapshot", null)).config, config);
  } finally { await host.harness.lifecycle.dispose(); }
});

test("invalid project selection and failed persistence leave the active configuration unchanged", async () => {
  const ids = Array.from({ length: 101 }, (_, i) => `p${i}`);
  const host = createFakePluginHost({ sdk: { projects: { list: async () => ids.map(id => ({ id })) }, threads: { list: async () => [] } } });
  try {
    await plugin(host.bb);
    const saved = await host.harness.behavior.callRpc("projects_set", { ids: [ids[0]] });
    await assert.rejects(host.harness.behavior.callRpc("projects_set", { ids }));
    await assert.rejects(host.harness.behavior.callRpc("projects_set", { ids: ["missing"] }));
    const set = host.bb.storage.kv.set.bind(host.bb.storage.kv);
    host.bb.storage.kv.set = async () => { throw new Error("disk unavailable"); };
    await assert.rejects(host.harness.behavior.callRpc("projects_set", { ids: [ids[1]] }), /disk unavailable/);
    host.bb.storage.kv.set = set;
    assert.deepEqual(await host.bb.storage.kv.get("config-v1"), saved);
    assert.deepEqual((await host.harness.behavior.callRpc("snapshot", null)).config, saved);
  } finally { await host.harness.lifecycle.dispose(); }
});

test("project order persists through reload while connection history and disabled projects survive", async () => {
  let host = createFakePluginHost({ sdk: { projects: { list: async () => ["p1", "p2", "p3"].map(id => ({ id })) }, threads: { list: async () => [] } } });
  try {
    await host.bb.storage.kv.set("config-v1", { projects: [
      { id: "p1", enabled: true, connectedAt: 100 },
      { id: "p2", enabled: true, connectedAt: 200 },
    ], launcher: [] });
    await plugin(host.bb);
    const saved = await host.harness.behavior.callRpc("projects_set", { ids: ["p2", "p3", "p2"] });
    assert.deepEqual(saved.projects.map(p => p.id), ["p2", "p3", "p1"]);
    assert.equal(saved.projects[0].connectedAt, 200);
    assert.ok(saved.projects[1].connectedAt > 200);
    assert.deepEqual(saved.projects[2], { id: "p1", enabled: false, connectedAt: 100 });
    host = await host.harness.reload(plugin);
    assert.deepEqual((await host.harness.behavior.callRpc("snapshot", null)).config, saved);
    const restored = await host.harness.behavior.callRpc("projects_set", { ids: ["p1", "p2", "p3"] });
    assert.deepEqual(restored.projects.map(p => p.id), ["p1", "p2", "p3"]);
    assert.equal(restored.projects[0].connectedAt, 100);
  } finally { await host.harness.lifecycle.dispose(); }
});

test("shared pool visibility persists with project selection and stays on for older settings", async () => {
  let host = createFakePluginHost({ sdk: { projects: { list: async () => [{ id: "p1" }] }, threads: { list: async () => [] } } });
  try {
    await host.bb.storage.kv.set("config-v1", { projects: [{ id: "p1", enabled: true, connectedAt: 100 }], launcher: [] });
    await plugin(host.bb);
    assert.equal((await host.harness.behavior.callRpc("snapshot", null)).config.sharedPool, true);
    const hidden = await host.harness.behavior.callRpc("projects_set", { ids: ["p1"], sharedPool: false });
    assert.equal(hidden.sharedPool, false);
    host = await host.harness.reload(plugin);
    assert.equal((await host.harness.behavior.callRpc("snapshot", null)).config.sharedPool, false);
    const kept = await host.harness.behavior.callRpc("projects_set", { ids: ["p1"] });
    assert.equal(kept.sharedPool, false);
  } finally { await host.harness.lifecycle.dispose(); }
});

test("common threads connect through the personal project and unknown projects stay rejected", async () => {
  const host = createFakePluginHost({ sdk: {
    projects: { list: async args => (args?.includePersonal ? ["p1", "home"] : ["p1"]).map(id => ({ id })) },
    threads: { list: async () => [] },
  } });
  try {
    await plugin(host.bb);
    const saved = await host.harness.behavior.callRpc("projects_set", { ids: ["home", "p1"] });
    assert.deepEqual(saved.projects.map(project => project.id), ["home", "p1"]);
    assert.ok(saved.projects.every(project => project.enabled));
    assert.ok(host.harness.inspection.sdk.calls.some(call => call.path === "projects.list" && call.args[0]?.includePersonal === true));
    await assert.rejects(host.harness.behavior.callRpc("projects_set", { ids: ["missing"] }), /DASHBOARD_PROJECT_UNAVAILABLE/);
  } finally { await host.harness.lifecycle.dispose(); }
});

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
