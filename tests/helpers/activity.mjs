import { test } from 'node:test';
import { createFakePluginHost, plugin, listRow } from './backend.mjs';
export { deferred as deferredSyncRead } from './deferred.mjs';
// Timeout guards deadlocks; assertions use ordering and fake time.
export const activityTest = (name, run) => test(name, { timeout: 5_000 }, run);
export async function activityFixture(context, { rows: initialRows = [listRow()], list, config, release = () => {} } = {}) {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 });
  let rows = initialRows;
  const callbacks = new Map();
  const calls = [];
  const signals = [];
  let unsubscribed = 0;
  const host = createFakePluginHost({ sdk: {
    projects: { list: async () => ["p1", "p2", "p3"].map(id => ({ id })) },
    subscribe: ({ event, callback }) => { callbacks.set(event, callback); return () => { unsubscribed++; callbacks.delete(event); }; },
    threads: { list: async input => {
      const { signal, ...args } = input;
      calls.push(structuredClone(args)); signals.push(signal);
      if (list) return list(input, rows);
      return rows.filter(row => (!input.projectId || row.projectId === input.projectId) && (!input.threadIds || input.threadIds.includes(row.id)))
        .slice(input.offset ?? 0, (input.offset ?? 0) + input.limit);
    } },
  } });
  let service;
  let disposed = false;
  async function stop() { if (service) { service.controller.abort(); await service.done; } }
  async function dispose() {
    if (disposed) return;
    disposed = true;
    try { release(); await stop(); }
    finally { await host.harness.lifecycle.dispose(); }
  }
  context.after(dispose);
  await host.bb.storage.kv.set("config-v1", config ?? { projects: [{ id: "p1", enabled: true, connectedAt: 1 }], launcher: [], sharedPool: true });
  await plugin(host.bb);
  service = host.harness.behavior.runService("activity");
  return {
    host, calls, callbacks, signals,
    rpc: (method, input = null) => host.harness.behavior.callRpc(method, input),
    setRows(value) { rows = value; },
    emit(id = "t1") { callbacks.get("thread:changed")({ id, changes: ["events-appended"] }); },
    reconnect() { callbacks.get("realtime:connection")({ state: "connected" }); },
    async tick(ms = 0) {
      context.mock.timers.tick(ms); await new Promise(resolve => setImmediate(resolve));
      context.mock.timers.tick(0); await new Promise(resolve => setImmediate(resolve));
    },
    stop, dispose,
    start() { service = host.harness.behavior.runService("activity"); },
    get unsubscribed() { return unsubscribed; },
  };
}
