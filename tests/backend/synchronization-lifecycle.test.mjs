import '../../scripts/test-loader.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePluginHost, plugin, listRow } from '../helpers/backend.mjs';
import { activityTest, activityFixture, deferredSyncRead } from '../helpers/activity.mjs';

test("background synchronization ignores the prior queued RPC result", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 });
  let reads = 0;
  const host = createFakePluginHost({ sdk: {
    subscribe: () => () => {},
    threads: { list: async () => { reads++; return []; } },
  } });
  try {
    await host.bb.storage.kv.set("config-v1", { projects: [{ id: "p1", enabled: true, connectedAt: 1 }], launcher: [], sharedPool: true });
    await plugin(host.bb);
    await host.harness.behavior.callRpc("snapshot", null);
    const service = host.harness.behavior.runService("activity");
    context.mock.timers.tick(0);
    await new Promise(resolve => setImmediate(resolve));
    service.controller.abort();
    await service.done;
    // The cached snapshot and service startup coalesce into one full pass.
    assert.equal(reads, 1);
    assert.equal((await host.harness.behavior.callRpc("snapshot", null)).syncError, null);
  } finally { await host.harness.lifecycle.dispose(); }
});

activityTest("activity sync returns cached snapshots and commits settings while SDK history is held", async context => {
  const held = deferredSyncRead();
  let released = false;
  const f = await activityFixture(context, { list: () => held.promise, release: () => held.resolve([]) });
  await f.tick();
  assert.equal(f.calls.length, 1);
  const initial = await f.rpc("snapshot");
  assert.equal(initial.syncedAt, null);
  assert.deepEqual(initial.tracked, []);
  const saved = await f.rpc("catalog_change", { type: "pool", enabled: false });
  assert.equal(saved.sharedPool, false);
  assert.equal((await f.host.bb.storage.kv.get("config-v1")).sharedPool, false);
  assert.equal(released, false);
  for (let i = 0; i < 5; i++) await f.rpc("snapshot");
  assert.equal(f.calls.length, 1);
  released = true; held.resolve([listRow()]);
  await f.tick();
  const fresh = await f.rpc("snapshot");
  assert.equal(fresh.tracked[0].id, "t1");
  assert.ok(fresh.syncedAt !== null);
  initial.config.sharedPool = true;
  assert.equal((await f.rpc("snapshot")).config.sharedPool, false);
});

activityTest("activity sync discards a pre-hide running row and rereads without reviving the hidden chat", async context => {
  const held = deferredSyncRead();
  let hold = false;
  const f = await activityFixture(context, { list: input => input.projectId && hold ? held.promise : [listRow()], release: () => held.resolve([]) });
  await f.tick();
  hold = true; f.reconnect(); await f.tick(750);
  const hidden = await f.rpc("thread_hide", { threadId: "t1" });
  assert.equal(hidden.hidden, true);
  hold = false; held.resolve([listRow({ status: "active" })]); await f.tick();
  assert.equal((await f.host.bb.storage.kv.get("thread:t1")).visible, false);
  await f.tick(750);
  assert.equal((await f.rpc("snapshot")).tracked[0].visible, false);
});

activityTest("activity sync discards rows read before restore and keeps the restored attention timestamp", async context => {
  const held = deferredSyncRead();
  let hold = false;
  let row = listRow();
  const f = await activityFixture(context, { list: input => input.projectId && hold ? held.promise : [row], release: () => held.resolve([]) });
  await f.tick();
  const { undoToken } = await f.rpc("thread_hide", { threadId: "t1" });
  hold = true; f.reconnect(); await f.tick(750);
  row = listRow({ latestAttentionAt: 250 });
  assert.deepEqual(await f.rpc("thread_restore", { threadId: "t1", undoToken }), { restored: true });
  hold = false; held.resolve([listRow({ latestAttentionAt: 200 })]); await f.tick();
  assert.equal((await f.host.bb.storage.kv.get("thread:t1")).latestAttentionAt, 250);
  await f.tick(750);
  assert.equal((await f.host.bb.storage.kv.get("thread:t1")).visible, true);
});

activityTest("activity sync retains dirty events received during a full read and batches thread ids", async context => {
  const held = deferredSyncRead();
  const f = await activityFixture(context, { list: input => input.projectId ? held.promise : [listRow({ latestAttentionAt: 300 })], release: () => held.resolve([]) });
  await f.tick();
  for (let i = 0; i < 20; i++) f.emit();
  held.resolve([listRow()]); await f.tick();
  await f.tick(750);
  assert.deepEqual(f.calls.filter(call => call.threadIds).map(call => call.threadIds), [["t1"]]);
  assert.equal((await f.host.bb.storage.kv.get("thread:t1")).latestAttentionAt, 300);
});

activityTest("activity sync paginates every enabled project and only marks a completed full pass fresh", async context => {
  const rows = Array.from({ length: 201 }, (_, i) => listRow({ id: `a${i}` }));
  rows.push(listRow({ id: "b", projectId: "p2" }));
  const f = await activityFixture(context, { rows, config: { projects: ["p1", "p2"].map(id => ({ id, enabled: true, connectedAt: 1 })), launcher: [], sharedPool: true } });
  assert.equal((await f.rpc("snapshot")).syncedAt, null);
  await f.tick();
  assert.deepEqual(f.calls.map(call => [call.projectId, call.offset]), [["p1", 0], ["p1", 200], ["p2", 0]]);
  const snapshot = await f.rpc("snapshot");
  assert.equal(snapshot.tracked.length, 202);
  assert.equal(snapshot.syncedAt, 100_000);
});

activityTest("activity sync skips disabled projects and rejects a read from before disconnect and reconnect", async context => {
  const held = deferredSyncRead();
  let first = true;
  const f = await activityFixture(context, { list: () => { if (first) { first = false; return held.promise; } return []; }, release: () => held.resolve([]) });
  await f.tick();
  await f.rpc("catalog_change", { type: "remove", kind: "project", id: "p1" });
  await f.rpc("catalog_change", { type: "add", kind: "project", id: "p1" });
  held.resolve([listRow()]); await f.tick();
  assert.equal(await f.host.bb.storage.kv.get("thread:t1"), undefined);
  assert.equal((await f.rpc("snapshot")).syncedAt, null);
  await f.tick(750);
  assert.ok((await f.rpc("snapshot")).syncedAt !== null);
  assert.deepEqual((await f.rpc("snapshot")).tracked, []);
});

activityTest("activity sync does not invalidate a full read for unrelated app edits", async context => {
  const held = deferredSyncRead();
  const f = await activityFixture(context, { list: () => held.promise, release: () => held.resolve([]) });
  await f.tick();
  await f.rpc("catalog_change", { type: "add", kind: "app", id: "notes", label: "Notes" });
  await f.rpc("catalog_change", { type: "rename", id: "notes", label: "Renamed" });
  held.resolve([listRow()]); await f.tick(); await f.tick(750);
  assert.equal(f.calls.length, 1);
  assert.ok((await f.rpc("snapshot")).syncedAt !== null);
  assert.equal((await f.rpc("snapshot")).config.launcher[0].label, "Renamed");
});

activityTest("activity sync exposes failures without rejecting saved settings and retries at a bounded rate", async context => {
  let fail = true;
  const f = await activityFixture(context, { list: () => { if (fail) throw new Error("offline"); return [listRow()]; } });
  await f.tick();
  const first = await f.rpc("snapshot");
  assert.equal(first.syncError, "offline"); assert.equal(first.syncedAt, null);
  assert.equal((await f.rpc("catalog_change", { type: "pool", enabled: false })).sharedPool, false);
  for (let i = 0; i < 10; i++) await f.rpc("snapshot");
  await f.tick(4_999); assert.equal(f.calls.length, 1);
  assert.equal((await f.rpc("snapshot")).syncError, "offline");
  fail = false; await f.tick(1);
  assert.equal(f.calls.length, 2);
  assert.equal((await f.rpc("snapshot")).syncError, null);
  assert.ok((await f.rpc("snapshot")).syncedAt !== null);
});

activityTest("activity sync keeps partial progress and recovers after a tracking write failure", async context => {
  const f = await activityFixture(context, { rows: [listRow({ id: "a" }), listRow({ id: "b" })] });
  const original = f.host.bb.storage.kv.set.bind(f.host.bb.storage.kv);
  let fail = true;
  f.host.bb.storage.kv.set = async (key, value) => { if (key === "thread:b" && fail) throw new Error("disk unavailable"); return original(key, value); };
  await f.tick();
  assert.equal((await f.rpc("snapshot")).syncError, "disk unavailable");
  assert.equal((await f.rpc("snapshot")).syncedAt, null);
  assert.equal((await f.host.bb.storage.kv.get("thread:a")).visible, true);
  assert.equal((await f.rpc("catalog_change", { type: "pool", enabled: false })).sharedPool, false);
  fail = false; await f.tick(5_000);
  assert.equal((await f.rpc("snapshot")).syncError, null);
  assert.equal((await f.rpc("snapshot")).tracked.length, 2);
});

activityTest("activity sync coalesces reconnect requests into one follow-up pass", async context => {
  const held = deferredSyncRead();
  let first = true;
  const f = await activityFixture(context, { list: () => { if (first) { first = false; return held.promise; } return []; }, release: () => held.resolve([]) });
  await f.tick();
  for (let i = 0; i < 10; i++) f.reconnect();
  held.resolve([]); await f.tick(); await f.tick(750);
  assert.equal(f.calls.length, 2);
  await f.tick(750); assert.equal(f.calls.length, 2);
});

activityTest("activity sync stops without waiting for SDK and ignores late responses after abort and restart", async context => {
  const held = deferredSyncRead();
  let first = true;
  const f = await activityFixture(context, { list: () => { if (first) { first = false; return held.promise; } return [listRow({ latestAttentionAt: 300 })]; }, release: () => held.resolve([]) });
  await f.tick();
  await f.stop();
  assert.equal(f.signals[0].aborted, true);
  assert.equal(f.unsubscribed, 2);
  assert.equal(f.callbacks.size, 0);
  f.start(); await f.tick();
  assert.equal(f.signals[1].aborted, false);
  assert.equal((await f.host.bb.storage.kv.get("thread:t1")).latestAttentionAt, 300);
  const signals = f.host.harness.realtimeSignals.length;
  held.resolve([listRow({ latestAttentionAt: 200 })]); await f.tick();
  assert.equal((await f.host.bb.storage.kv.get("thread:t1")).latestAttentionAt, 300);
  assert.equal(f.host.harness.realtimeSignals.length, signals);
});

activityTest("activity sync aborts an SDK read that honors AbortSignal without reporting a sync failure", async context => {
  const f = await activityFixture(context, { list: ({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("SDK read aborted")), { once: true });
  }) });
  await f.tick();
  await f.stop(); await f.tick();
  assert.equal(f.signals[0].aborted, true);
  assert.equal((await f.rpc("snapshot")).syncError, null);
  assert.equal((await f.rpc("snapshot")).syncedAt, null);
  await f.tick(60_000);
  assert.equal(f.calls.length, 1);
});

activityTest("activity sync targeted project reads acknowledge saved configuration before history and do not advance full freshness", async context => {
  const held = deferredSyncRead();
  const f = await activityFixture(context, { list: input => input.projectId === "p2" ? held.promise : [], release: () => held.resolve([]) });
  await f.tick();
  const fullTime = (await f.rpc("snapshot")).syncedAt;
  const saved = await f.rpc("catalog_change", { type: "add", kind: "project", id: "p2" });
  assert.ok(saved.projects.some(project => project.id === "p2" && project.enabled));
  assert.equal(f.calls.length, 1);
  await f.tick(750);
  assert.equal(f.calls.at(-1).projectId, "p2");
  assert.equal((await f.rpc("snapshot")).syncedAt, fullTime);
  held.resolve([listRow({ projectId: "p2", status: "active" })]); await f.tick();
  assert.equal((await f.rpc("snapshot")).tracked[0].projectId, "p2");
  assert.equal((await f.rpc("snapshot")).syncedAt, fullTime);
});

activityTest("activity sync never fetches a later project disabled while an earlier project is being read", async context => {
  const held = deferredSyncRead();
  let first = true;
  const f = await activityFixture(context, {
    config: { projects: ["p1", "p2"].map(id => ({ id, enabled: true, connectedAt: 1 })), launcher: [], sharedPool: true },
    list: () => { if (first) { first = false; return held.promise; } return []; }, release: () => held.resolve([]),
  });
  await f.tick();
  await f.rpc("catalog_change", { type: "remove", kind: "project", id: "p2" });
  held.resolve([]); await f.tick(); await f.tick(750);
  assert.deepEqual(f.calls.map(call => call.projectId), ["p1", "p1"]);
  assert.ok((await f.rpc("snapshot")).syncedAt !== null);
});

activityTest("activity sync sends every dirty id in bounded batches without truncation", async context => {
  const f = await activityFixture(context, { rows: [] });
  await f.tick();
  const ids = Array.from({ length: 401 }, (_, i) => `dirty-${i}`);
  ids.forEach(id => f.emit(id));
  await f.tick(750);
  const batches = f.calls.filter(call => call.threadIds).map(call => call.threadIds);
  assert.deepEqual(batches.map(ids => ids.length), [200, 200, 1]);
  assert.deepEqual(batches.flat(), ids);
});

activityTest("activity sync preserves a useful read when a concurrent configuration write fails", async context => {
  const held = deferredSyncRead();
  const f = await activityFixture(context, { list: () => held.promise, release: () => held.resolve([]) });
  await f.tick();
  const original = f.host.bb.storage.kv.set.bind(f.host.bb.storage.kv);
  f.host.bb.storage.kv.set = async (key, value) => { if (key === "config-v1") throw new Error("config disk unavailable"); return original(key, value); };
  await assert.rejects(f.rpc("catalog_change", { type: "remove", kind: "project", id: "p1" }), /config disk unavailable/);
  held.resolve([listRow()]); await f.tick();
  const snapshot = await f.rpc("snapshot");
  assert.equal(snapshot.config.projects[0].enabled, true);
  assert.equal(snapshot.tracked[0].visible, true);
  assert.ok(snapshot.syncedAt !== null);
  assert.equal(f.calls.length, 1);
});

activityTest("activity sync refreshes periodically even without snapshot reads or realtime events", async context => {
  const f = await activityFixture(context);
  await f.tick();
  assert.equal(f.calls.length, 1);
  f.setRows([listRow({ latestAttentionAt: 300 })]);
  await f.tick(60_000);
  assert.equal(f.calls.length, 2);
  const snapshot = await f.rpc("snapshot");
  assert.equal(snapshot.syncedAt, 160_000);
  assert.equal(snapshot.tracked[0].latestAttentionAt, 300);
});

activityTest("activity sync mirrors an already-started durable write when stopped during its completion", async context => {
  const held = deferredSyncRead();
  const f = await activityFixture(context, { rows: [listRow({ status: "active", latestAttentionAt: 0 })], release: () => held.resolve() });
  const original = f.host.bb.storage.kv.set.bind(f.host.bb.storage.kv);
  f.host.bb.storage.kv.set = async (key, value) => {
    await original(key, value);
    if (key === "thread:t1") await held.promise;
  };
  await f.tick();
  assert.equal((await f.host.bb.storage.kv.get("thread:t1")).visible, true);
  const signals = f.host.harness.realtimeSignals.length;
  await f.stop();
  held.resolve(); await f.tick();
  assert.equal((await f.rpc("snapshot")).tracked[0].visible, true);
  assert.equal((await f.rpc("snapshot")).syncedAt, null);
  assert.equal(f.host.harness.realtimeSignals.length, signals);
});

activityTest("activity sync cannot publish or start storage writes after plugin disposal", async context => {
  const held = deferredSyncRead();
  const f = await activityFixture(context, { list: () => held.promise, release: () => {} });
  let writes = 0;
  const original = f.host.bb.storage.kv.set.bind(f.host.bb.storage.kv);
  f.host.bb.storage.kv.set = async (...args) => { writes++; return original(...args); };
  await f.tick();
  const signals = f.host.harness.realtimeSignals.length;
  await f.dispose();
  held.resolve([listRow()]); await f.tick(60_000);
  assert.equal(writes, 0);
  assert.equal(f.host.harness.realtimeSignals.length, signals);
  assert.equal(f.unsubscribed, 2);
  assert.equal(f.calls.length, 1);
});
