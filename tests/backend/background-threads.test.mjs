import '../../scripts/test-loader.mjs';
import assert from 'node:assert/strict';
import { activityTest, activityFixture } from '../helpers/activity.mjs';
import { listRow, plugin } from '../helpers/backend.mjs';

activityTest('background policy persists across reload, exposes interactions and retries, and hides unread success', async context => {
  const f = await activityFixture(context, { rows: [] });
  const saved = await f.rpc('catalog_change', { type: 'background', enabled: true, substrings: ['worker'] });
  assert.equal(saved.backgroundThreads.since, 100000);
  let row = listRow({ createdAt: 100001, displayTitle: 'WORKER: test', status: 'active' });
  async function observe(changes) {
    row = { ...row, ...changes }; f.setRows([row]); f.emit(); await f.tick(750);
    return (await f.rpc('snapshot')).tracked.find(t => t.id === row.id);
  }
  let tracked = await observe({});
  assert.equal(tracked.backgroundMatched, true); assert.equal(tracked.visible, false);
  tracked = await observe({ hasPendingInteraction: true });
  assert.equal(tracked.visible, true);
  tracked = await observe({ hasPendingInteraction: false, status: 'active' });
  assert.equal(tracked.visible, true);
  tracked = await observe({ status: 'error' });
  assert.equal(tracked.visible, true);
  tracked = await observe({ displayTitle: 'Renamed', status: 'active' });
  assert.equal(tracked.visible, true);
  tracked = await observe({ status: 'idle', isUnread: true });
  assert.equal(tracked.visible, false); assert.equal(tracked.backgroundExposed, false);
  assert.equal((await f.host.bb.storage.kv.get('thread:t1')).visible, false);
  await f.stop();
  const reloaded = await f.host.harness.lifecycle.reload(plugin);
  try {
    const snapshot = await reloaded.harness.behavior.callRpc('snapshot', null);
    assert.deepEqual(snapshot.config.backgroundThreads, saved.backgroundThreads);
    assert.equal(snapshot.tracked[0].backgroundMatched, true);
    assert.equal(snapshot.tracked[0].visible, false);
  } finally { await reloaded.harness.lifecycle.dispose(); }
});
