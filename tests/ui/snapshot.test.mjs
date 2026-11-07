import { test, loadPluginApp, renderSlot, createElement, act, waitFor } from '../helpers/dom.mjs';
import { deferred } from '../helpers/deferred.mjs';
import assert from 'node:assert/strict';
const { definePluginApp } = await import('@get-bb/plugin-sdk/app');
const { useDashboardSnapshot } = await import('../../hooks/use-dashboard-snapshot.ts');
const config = { projects: [{ id: 'p1', enabled: true, connectedAt: 100 }], launcher: [], sharedPool: true };
const snapshot = (changes = {}) => ({ config: structuredClone(config), tracked: [], syncError: null, syncedAt: 150, ...changes });
async function probe(rpc) {
  let value, renders = 0;
  const app = await loadPluginApp(() => Promise.resolve({ default: definePluginApp(builder => {
    builder.slots.navPanel({ id: 'snapshot', path: 'snapshot', title: 'Snapshot', icon: 'File', component: () => {
      value = useDashboardSnapshot(); renders++;
      return createElement('output', null, JSON.stringify({ data: value.data, error: value.error }));
    } });
  }) }));
  let slot;
  await act(async () => { slot = renderSlot(app.navPanels[0], { subPath: '' }, { pluginId: 'dashboard', realtimeConnectionState: 'disconnected', rpc }); });
  return { slot, get value() { return value; }, get renders() { return renders; } };
}

test('snapshot coalesces refresh, realtime bursts and reconnect into a single follow-up read', async () => {
  const first = deferred(), second = deferred();
  let calls = 0, active = 0, maximum = 0;
  const p = await probe({ snapshot: async () => {
    const current = ++calls; active++; maximum = Math.max(maximum, active);
    try { return await (current === 1 ? first.promise : second.promise); } finally { active--; }
  } });
  assert.equal(calls, 1);
  for (let i = 0; i < 4; i++) await p.slot.behavior.emitRealtime('dashboard-changed', {});
  await p.slot.behavior.setRealtimeConnectionState('connected');
  await act(async () => { await p.value.refresh(); });
  assert.equal(calls, 1);
  await act(async () => first.resolve(snapshot()));
  await waitFor(() => assert.equal(calls, 2));
  assert.equal(maximum, 1);
  await act(async () => second.resolve(snapshot({ syncedAt: 200 })));
  assert.equal(p.value.data.syncedAt, 200);
  assert.equal(calls, 2);
});

test('a pre-mutation snapshot cannot replace confirmed configuration and requests a fresh read', async () => {
  const stale = deferred(), fresh = deferred();
  const confirmed = { ...config, sharedPool: false, launcher: [{ id: 'notes', label: 'Confirmed' }] };
  let calls = 0;
  const p = await probe({ snapshot: () => ++calls === 1 ? snapshot() : calls === 2 ? stale.promise : fresh.promise,
    catalog_change: () => structuredClone(confirmed) });
  await waitFor(() => assert.equal(p.value.data.syncedAt, 150));
  await p.slot.behavior.emitRealtime('dashboard-changed', {});
  assert.equal(calls, 2);
  await act(async () => {
    const next = await p.value.rpc.call('catalog_change', { type: 'pool', enabled: false });
    p.value.applyConfig(next); void p.value.refresh();
  });
  assert.deepEqual(p.value.data.config, confirmed);
  await act(async () => stale.resolve(snapshot({ syncedAt: 160, syncError: 'stale' })));
  assert.equal(calls, 3);
  assert.deepEqual(p.value.data.config, confirmed);
  assert.equal(p.value.data.syncedAt, 150); assert.equal(p.value.data.syncError, null);
  const tracked = [{ id: 'new', projectId: 'p1', visible: true, latestAttentionAt: 200, hiddenAttentionAt: 0 }];
  await act(async () => fresh.resolve(snapshot({ config: confirmed, tracked, syncedAt: 200 })));
  assert.deepEqual(p.value.data.tracked, tracked); assert.equal(p.value.data.syncedAt, 200);
});

test('snapshot failures expose a retryable error and reconnect refreshes confirmed data', async () => {
  let calls = 0;
  const p = await probe({ snapshot: () => {
    calls++; if (calls === 1) throw new Error('offline');
    return snapshot({ syncedAt: calls * 100 });
  } });
  await waitFor(() => assert.equal(p.value.error, 'actionFailed'));
  assert.equal(p.value.data, null);
  await act(async () => p.value.refresh());
  assert.equal(p.value.error, null); assert.equal(p.value.data.syncedAt, 200);
  await p.slot.behavior.setRealtimeConnectionState('connected');
  assert.equal(calls, 3); assert.equal(p.value.data.syncedAt, 300);
  await p.slot.behavior.emitRealtime('dashboard-changed', {});
  assert.equal(calls, 4); assert.equal(p.value.data.syncedAt, 400);
});

test('unmounted snapshot reads ignore late success and failure without follow-up work or cache reuse', async () => {
  for (const failure of [false, true]) {
    const held = deferred(); let calls = 0;
    const p = await probe({ snapshot: () => { calls++; return held.promise; } });
    await p.slot.behavior.emitRealtime('dashboard-changed', {});
    p.slot.lifecycle.unmount(); const renders = p.renders;
    await act(async () => failure ? held.reject(new Error('late failure')) : held.resolve(snapshot()));
    assert.equal(calls, 1); assert.equal(p.renders, renders); assert.equal(p.value.data, null);
    const next = await probe({ snapshot: () => snapshot({ syncedAt: 999 }) });
    await waitFor(() => assert.equal(next.value.data.syncedAt, 999));
    assert.equal(next.value.error, null);
    next.slot.lifecycle.unmount();
  }
});
