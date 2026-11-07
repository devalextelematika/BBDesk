import '../../scripts/test-loader.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost, makeThreadResponse, plugin, listRow } from '../helpers/backend.mjs';


test("catalog mutations preserve legacy history and synchronize only a newly connected project", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 });
  const reads = [];
  let host = createFakePluginHost({ sdk: {
    projects: { list: async () => ["p1", "p2"].map(id => ({ id })) },
    threads: { list: async input => { reads.push(input.projectId); return []; } },
  } });
  const initial = { projects: [{ id: "p1", enabled: true, connectedAt: 12 }, ...Array.from({ length: 101 }, (_, i) => ({ id: `old-${i}`, enabled: false, connectedAt: i }))], launcher: [{ id: "notes", label: "Custom notes" }], sharedPool: false };
  try {
    await host.bb.storage.kv.set("config-v1", initial); await plugin(host.bb);
    let saved = await host.harness.behavior.callRpc("catalog_change", { type: "add", kind: "project", id: "p2" });
    assert.deepEqual(reads, []); // Confirmed configuration no longer waits for SDK history.
    context.mock.timers.tick(0);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(reads, ["p2"]);
    const connectedAt = saved.projects.find(p => p.id === "p2").connectedAt;
    reads.length = 0;
    saved = await host.harness.behavior.callRpc("catalog_change", { type: "move", kind: "project", id: "p2", targetId: "p1" });
    assert.deepEqual(saved.projects.filter(p => p.enabled).map(p => p.id), ["p2", "p1"]);
    assert.equal(saved.projects.find(p => p.id === "p1").connectedAt, 12);
    assert.deepEqual(reads, []);
    await host.harness.behavior.callRpc("catalog_change", { type: "remove", kind: "project", id: "p2" });
    saved = await host.harness.behavior.callRpc("catalog_change", { type: "restore", kind: "project", id: "p2", nextId: "p1" });
    assert.equal(saved.projects.find(p => p.id === "p2").connectedAt, connectedAt);
    assert.equal(saved.projects.length, 103);
    assert.deepEqual(saved.launcher, initial.launcher); assert.equal(saved.sharedPool, false);
    host = await host.harness.reload(plugin);
    assert.deepEqual((await host.harness.behavior.callRpc("snapshot", null)).config, saved);
  } finally { await host.harness.lifecycle.dispose(); }
});

test("concurrent catalog operations preserve both lists and idempotent additions preserve order", async () => {
  const host = createFakePluginHost({ sdk: { projects: { list: async () => [{ id: "same" }] }, threads: { list: async () => [] } } });
  try {
    await plugin(host.bb);
    await Promise.all([
      host.harness.behavior.callRpc("catalog_change", { type: "add", kind: "project", id: "same" }),
      host.harness.behavior.callRpc("catalog_change", { type: "add", kind: "app", id: "same", label: "Original" }),
      host.harness.behavior.callRpc("catalog_change", { type: "add", kind: "app", id: "other", label: "Other" }),
    ]);
    const saved = await host.harness.behavior.callRpc("catalog_change", { type: "add", kind: "app", id: "same", label: "Changed" });
    assert.deepEqual(saved.launcher, [{ id: "same", label: "Original" }, { id: "other", label: "Other" }]);
    assert.equal(saved.projects[0].id, "same");
    await assert.rejects(host.harness.behavior.callRpc("catalog_change", { type: "move", kind: "app", id: "same", targetId: "gone" }), /DASHBOARD_CATALOG_STALE/);
    const removed = await host.harness.behavior.callRpc("catalog_change", { type: "remove", kind: "app", id: "same" });
    assert.equal(removed.projects[0].enabled, true);
  } finally { await host.harness.lifecycle.dispose(); }
});

test("catalog can reorder and remove unavailable entries without resetting settings", async () => {
  const host = createFakePluginHost({ sdk: { projects: { list: async () => [] }, threads: { list: async () => [] } } });
  try {
    await host.bb.storage.kv.set("config-v1", { projects: [{ id: "gone", enabled: true, connectedAt: 1 }, { id: "also-gone", enabled: true, connectedAt: 2 }], launcher: [], sharedPool: true });
    await plugin(host.bb);
    await host.harness.behavior.callRpc("catalog_change", { type: "move", kind: "project", id: "also-gone", targetId: "gone" });
    const saved = await host.harness.behavior.callRpc("catalog_change", { type: "remove", kind: "project", id: "gone" });
    assert.deepEqual(saved.projects.map(p => [p.id, p.enabled]), [["also-gone", true], ["gone", false]]);
    await assert.rejects(host.harness.behavior.callRpc("catalog_change", { type: "add", kind: "project", id: "gone" }), /DASHBOARD_PROJECT_UNAVAILABLE/);
  } finally { await host.harness.lifecycle.dispose(); }
});

test("catalog restore preserves concurrent additions, positions and renamed labels", async () => {
  const host = createFakePluginHost();
  try {
    await plugin(host.bb);
    for (const id of ["a", "b", "c"]) await host.harness.behavior.callRpc("catalog_change", { type: "add", kind: "app", id, label: id });
    await host.harness.behavior.callRpc("catalog_change", { type: "remove", kind: "app", id: "b" });
    await host.harness.behavior.callRpc("catalog_change", { type: "add", kind: "app", id: "d", label: "New" });
    await host.harness.behavior.callRpc("catalog_change", { type: "rename", id: "a", label: "Renamed" });
    const operation = { type: "restore", kind: "app", id: "b", label: "b", previousId: "a", nextId: "c" };
    const saved = await host.harness.behavior.callRpc("catalog_change", operation);
    assert.deepEqual(saved.launcher.map(e => e.id), ["a", "b", "c", "d"]);
    assert.equal(saved.launcher[0].label, "Renamed");
    assert.deepEqual((await host.harness.behavior.callRpc("catalog_change", operation)).launcher, saved.launcher);
  } finally { await host.harness.lifecycle.dispose(); }
});

test("catalog limits and failed persistence retain the last confirmed configuration", async () => {
  const host = createFakePluginHost();
  try {
    const config = { projects: [], launcher: Array.from({ length: 100 }, (_, i) => ({ id: String(i), label: String(i) })), sharedPool: true };
    await host.bb.storage.kv.set("config-v1", config); await plugin(host.bb);
    await assert.rejects(host.harness.behavior.callRpc("catalog_change", { type: "add", kind: "app", id: "101", label: "101" }), /DASHBOARD_CATALOG_LIMIT/);
    const set = host.bb.storage.kv.set.bind(host.bb.storage.kv);
    host.bb.storage.kv.set = async () => { throw new Error("disk unavailable"); };
    await assert.rejects(host.harness.behavior.callRpc("catalog_change", { type: "remove", kind: "app", id: "0" }), /disk unavailable/);
    host.bb.storage.kv.set = set;
    assert.deepEqual((await host.harness.behavior.callRpc("snapshot", null)).config, config);
  } finally { await host.harness.lifecycle.dispose(); }
});

test("legacy catalog descriptions are ignored and do not affect panel configuration", async () => {
  const host = createFakePluginHost({ sdk: { threads: { list: async () => [] } } });
  const config = { projects: [], launcher: [{ id: "notes", label: "Notes" }], sharedPool: false };
  try {
    await host.bb.storage.kv.set("config-v1", config);
    await host.bb.storage.kv.set("catalog-descriptions-v1", { '["app","notes"]': "Old optional note" });
    await plugin(host.bb);
    assert.deepEqual((await host.harness.behavior.callRpc("snapshot", null)).config, config);
    await assert.rejects(host.harness.behavior.callRpc("catalog_descriptions", null));
    await assert.rejects(host.harness.behavior.callRpc("catalog_describe", { kind: "app", id: "notes", text: "Note" }));
  } finally { await host.harness.lifecycle.dispose(); }
});

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

test("legacy full-list replacements commit once and preserve ordering, raw labels and project history", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 });
  const host = createFakePluginHost({ sdk: { projects: { list: async () => ["p1", "p2", "p3"].map(id => ({ id })) }, threads: { list: async () => [] } } });
  try {
    await host.bb.storage.kv.set("config-v1", { projects: [{ id: "p1", enabled: true, connectedAt: 10 }, { id: "p2", enabled: false, connectedAt: 20 }], launcher: [{ id: "keep", label: "Keep" }], sharedPool: false });
    await plugin(host.bb);
    const commits = [];
    const set = host.bb.storage.kv.set.bind(host.bb.storage.kv);
    host.bb.storage.kv.set = async (key, value) => { await set(key, value); if (key === "config-v1") commits.push(structuredClone(value)); };
    const rpc = (method, input) => host.harness.behavior.callRpc(method, input);
    let saved = await rpc("projects_set", { ids: ["p2", "p3", "p2"] });
    assert.deepEqual(saved.projects, [{ id: "p2", enabled: true, connectedAt: 20 }, { id: "p3", enabled: true, connectedAt: 100_000 }, { id: "p1", enabled: false, connectedAt: 10 }]);
    assert.equal(saved.sharedPool, false); assert.deepEqual(saved.launcher, [{ id: "keep", label: "Keep" }]);
    assert.equal(commits.length, 1);
    saved = await rpc("launcher_set", { items: [{ id: "a", label: "First" }, { id: "b", label: "B" }, { id: "a", label: "  Last  " }] });
    assert.deepEqual(saved.launcher, [{ id: "a", label: "  Last  " }, { id: "b", label: "B" }]);
    assert.equal(commits.length, 2);
    saved = await rpc("catalog_change", { type: "rename", id: "a", label: "  Trimmed  " });
    assert.equal(saved.launcher[0].label, "Trimmed");
    saved = await rpc("launcher_set", { items: [] });
    assert.deepEqual(saved.launcher, []);
    saved = await rpc("projects_set", { ids: [], sharedPool: true });
    assert.deepEqual(saved.projects.map(project => [project.id, project.enabled, project.connectedAt]), [["p2", false, 20], ["p3", false, 100_000], ["p1", false, 10]]);
    assert.equal(saved.sharedPool, true);
    assert.equal(commits.length, 5);
    assert.deepEqual(await host.bb.storage.kv.get("config-v1"), saved);
  } finally { await host.harness.lifecycle.dispose(); }
});

test("concurrent legacy replacements and catalog additions preserve both lists through reload", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 });
  let host = createFakePluginHost({ sdk: { projects: { list: async () => ["p1", "p2"].map(id => ({ id })) }, threads: { list: async () => [] } } });
  try {
    await host.bb.storage.kv.set("config-v1", { projects: [{ id: "p1", enabled: true, connectedAt: 10 }, { id: "p2", enabled: false, connectedAt: 20 }], launcher: [], sharedPool: false });
    await plugin(host.bb);
    await Promise.all([
      host.harness.behavior.callRpc("projects_set", { ids: ["p2"] }),
      host.harness.behavior.callRpc("launcher_set", { items: [{ id: "a", label: "Custom A" }] }),
      host.harness.behavior.callRpc("catalog_change", { type: "add", kind: "app", id: "b", label: "Custom B" }),
    ]);
    const saved = await host.bb.storage.kv.get("config-v1");
    assert.deepEqual(saved.launcher, [{ id: "a", label: "Custom A" }, { id: "b", label: "Custom B" }]);
    assert.deepEqual(saved.projects, [{ id: "p2", enabled: true, connectedAt: 20 }, { id: "p1", enabled: false, connectedAt: 10 }]);
    assert.equal(saved.sharedPool, false);
    host = await host.harness.reload(plugin);
    assert.deepEqual((await host.harness.behavior.callRpc("snapshot", null)).config, saved);
  } finally { await host.harness.lifecycle.dispose(); }
});

test("all configuration adapters retain confirmed state and publish nothing after failed persistence", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 });
  let reads = 0;
  const host = createFakePluginHost({ sdk: { projects: { list: async () => [{ id: "p2" }] }, threads: { list: async () => { reads++; return []; } } } });
  const initial = { projects: [{ id: "p1", enabled: true, connectedAt: 10 }], launcher: [{ id: "keep", label: "Keep" }], sharedPool: true };
  try {
    await host.bb.storage.kv.set("config-v1", initial); await plugin(host.bb);
    const signals = host.harness.realtimeSignals.length;
    const set = host.bb.storage.kv.set.bind(host.bb.storage.kv);
    host.bb.storage.kv.set = async () => { throw new Error("disk unavailable"); };
    for (const [method, input] of [
      ["projects_set", { ids: ["p2"] }],
      ["launcher_set", { items: [{ id: "new", label: "New" }] }],
      ["catalog_change", { type: "pool", enabled: false }],
    ]) {
      await assert.rejects(host.harness.behavior.callRpc(method, input), /disk unavailable/);
      assert.deepEqual(await host.bb.storage.kv.get("config-v1"), initial);
    }
    context.mock.timers.tick(0); await new Promise(resolve => setImmediate(resolve));
    assert.equal(reads, 0); assert.equal(host.harness.realtimeSignals.length, signals);
    host.bb.storage.kv.set = set;
    const saved = await host.harness.behavior.callRpc("launcher_set", { items: [{ id: "ok", label: "Recovered" }] });
    assert.deepEqual(saved.launcher, [{ id: "ok", label: "Recovered" }]);
    assert.deepEqual(saved.projects, initial.projects);
  } finally { await host.harness.lifecycle.dispose(); }
});

test("catalog compatibility keeps validation priority and skips project checks for idempotent additions", async () => {
  let checks = 0;
  const projects = Array.from({ length: 100 }, (_, i) => ({ id: `p${i}`, enabled: true, connectedAt: i }));
  const host = createFakePluginHost({ sdk: { projects: { list: async () => { checks++; return [...projects, { id: "extra" }]; } }, threads: { list: async () => [] } } });
  try {
    await host.bb.storage.kv.set("config-v1", { projects, launcher: [{ id: "a", label: "Custom" }], sharedPool: true }); await plugin(host.bb);
    const rpc = input => host.harness.behavior.callRpc("catalog_change", input);
    await assert.rejects(rpc({ type: "add", kind: "project", id: "missing" }), /DASHBOARD_PROJECT_UNAVAILABLE/);
    await assert.rejects(rpc({ type: "restore", kind: "project", id: "missing" }), /DASHBOARD_PROJECT_UNAVAILABLE/);
    await assert.rejects(rpc({ type: "add", kind: "project", id: "extra" }), /DASHBOARD_CATALOG_LIMIT/);
    assert.equal(checks, 3);
    await rpc({ type: "add", kind: "project", id: "p0" });
    await rpc({ type: "restore", kind: "project", id: "p0", nextId: "p99" });
    let saved = await rpc({ type: "add", kind: "app", id: "a", label: "Ignored" });
    saved = await rpc({ type: "restore", kind: "app", id: "a", label: "Ignored", nextId: "unknown" });
    assert.equal(checks, 3);
    assert.deepEqual(saved.projects, projects); assert.equal(saved.launcher[0].label, "Custom");
    await assert.rejects(rpc({ type: "rename", id: "missing", label: "Name" }), /DASHBOARD_CATALOG_STALE/);
    await assert.rejects(rpc({ type: "move", kind: "project", id: "p0", targetId: "missing" }), /DASHBOARD_CATALOG_STALE/);
  } finally { await host.harness.lifecycle.dispose(); }
});

test("old wire inputs retain defaults, unknown-field stripping, restore positioning and list limits", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 });
  let checks = 0;
  let host = createFakePluginHost({ sdk: { projects: { list: async () => { checks++; return ["p1", "p2"].map(id => ({ id })); } }, threads: { list: async () => [] } } });
  try {
    await host.bb.storage.kv.set("config-v1", { projects: [{ id: "p1", enabled: true, connectedAt: 10 }, { id: "p2", enabled: true, connectedAt: 20 }], launcher: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }); await plugin(host.bb);
    const rpc = (method, input) => host.harness.behavior.callRpc(method, JSON.parse(JSON.stringify(input)));
    let saved = await rpc("catalog_change", { type: "move", kind: "app", id: "b", targetId: "a", legacyExtra: true });
    assert.deepEqual(saved.launcher.map(item => item.id), ["b", "a"]);
    await rpc("catalog_change", { type: "remove", kind: "app", id: "b", label: "Ignored old UI field" });
    saved = await rpc("catalog_change", { type: "restore", kind: "app", id: "b", previousId: "a", nextId: "gone", label: "  Restored  " });
    assert.deepEqual(saved.launcher, [{ id: "a", label: "A" }, { id: "b", label: "Restored" }]);
    saved = await rpc("projects_set", { ids: ["p2", "p2"], legacyExtra: "ignored" });
    assert.equal(saved.sharedPool, true); assert.equal(saved.projects[0].connectedAt, 20);
    saved = await rpc("launcher_set", { items: [{ id: "a", label: "  Raw  ", description: "ignored" }] });
    assert.deepEqual(saved.launcher, [{ id: "a", label: "  Raw  " }]);
    await assert.rejects(rpc("catalog_change", { type: "rename", id: "a", label: "   " }));
    const previousChecks = checks;
    await assert.rejects(rpc("projects_set", { ids: Array(101).fill("p2") }));
    assert.equal(checks, previousChecks);
    assert.deepEqual(await host.bb.storage.kv.get("config-v1"), saved);
    host = await host.harness.reload(plugin);
    assert.deepEqual((await host.harness.behavior.callRpc("snapshot", null)).config, saved);
  } finally { await host.harness.lifecycle.dispose(); }
});

test("thread restore keeps bounded token eviction and invalidates unconsumed tokens after reload", async () => {
  let host = createFakePluginHost({ sdk: { threads: { list: async input => input.threadIds?.map(id => listRow({ id })) ?? [] } } });
  try {
    await host.bb.storage.kv.set("config-v1", { projects: [{ id: "p1", enabled: true, connectedAt: 1 }], launcher: [], sharedPool: true });
    for (let i = 0; i < 101; i++) await host.bb.storage.kv.set(`thread:t${i}`, { id: `t${i}`, projectId: "p1", visible: true, latestAttentionAt: 200, hiddenAttentionAt: 0 });
    await plugin(host.bb);
    const tokens = [];
    for (let i = 0; i < 101; i++) tokens.push((await host.harness.behavior.callRpc("thread_hide", { threadId: `t${i}` })).undoToken);
    assert.deepEqual(await host.harness.behavior.callRpc("thread_restore", { threadId: "t0", undoToken: tokens[0] }), { restored: false });
    assert.deepEqual(await host.harness.behavior.callRpc("thread_restore", { threadId: "t1", undoToken: tokens[1] }), { restored: true });
    host = await host.harness.reload(plugin);
    assert.deepEqual(await host.harness.behavior.callRpc("thread_restore", { threadId: "t100", undoToken: tokens[100] }), { restored: false });
    assert.equal((await host.bb.storage.kv.get("thread:t100")).visible, false);
  } finally { await host.harness.lifecycle.dispose(); }
});

test("empty legacy project replacement still validates SDK availability before disabling projects", async () => {
  let offline = true;
  let checks = 0;
  const host = createFakePluginHost({ sdk: { projects: { list: async () => { checks++; if (offline) throw new Error("project lookup offline"); return []; } }, threads: { list: async () => [] } } });
  const initial = { projects: [{ id: "p1", enabled: true, connectedAt: 10 }], launcher: [], sharedPool: false };
  try {
    await host.bb.storage.kv.set("config-v1", initial); await plugin(host.bb);
    await assert.rejects(host.harness.behavior.callRpc("projects_set", { ids: [] }), /project lookup offline/);
    assert.deepEqual(await host.bb.storage.kv.get("config-v1"), initial);
    offline = false;
    const saved = await host.harness.behavior.callRpc("projects_set", { ids: [] });
    assert.equal(checks, 2);
    assert.deepEqual(saved.projects, [{ id: "p1", enabled: false, connectedAt: 10 }]);
    assert.equal(saved.sharedPool, false);
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
