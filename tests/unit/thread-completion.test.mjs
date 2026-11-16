import '../../scripts/test-loader.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyCompletions, observeCompletions } from '../../thread-completion.ts';
import { threadState } from '../../workspace-selectors.ts';
import { thread } from '../helpers/factories.mjs';

test('completion survives automatic reading, clears on leaving and does not return on revisiting', () => {
  let row = thread('a', 'p1', 'Alpha', { status: 'active' });
  let state = observeCompletions(emptyCompletions(), [row], 'a', 1000);
  row = { ...row, status: 'idle', isUnread: false };
  state = observeCompletions(state, [row], 'a', 2000);
  assert.deepEqual(threadState({ ...row, completion: state.rows.get('a') }), { message: 'completedAt', tone: 'completed' });
  assert.equal(state.rows.get('a').at, 2000);
  assert.equal(observeCompletions(state, [row], 'a', 3000), state);
  state = observeCompletions(state, [row], 'b', 4000);
  assert.equal(state.rows.get('a').pending, false);
  state = observeCompletions(state, [row], 'a', 5000);
  assert.equal(state.rows.get('a').pending, false);
  assert.equal(state.rows.get('a').at, 2000);
});

test('background completion waits for selection and departure even if native unread clears', () => {
  let row = thread('b', 'p1', 'Beta', { isUnread: true, latestAttentionAt: 2000 });
  let state = observeCompletions(emptyCompletions(), [row], 'a', 2100);
  assert.equal(state.rows.get('b').pending, true);
  assert.equal(state.rows.get('b').viewed, false);
  row = { ...row, isUnread: false };
  state = observeCompletions(state, [row], 'a', 2200);
  assert.equal(state.rows.get('b').pending, true);
  state = observeCompletions(state, [row], 'b', 2300);
  assert.equal(state.rows.get('b').viewed, true);
  state = observeCompletions(state, [row], 'a', 2400);
  assert.equal(state.rows.get('b').pending, false);
  row = { ...row, isUnread: true };
  state = observeCompletions(state, [row], 'b', 2500);
  assert.equal(state.rows.get('b').pending, false, 'stale host unread must not restore an acknowledged completion');
  row = { ...row, latestAttentionAt: 3000 };
  state = observeCompletions(state, [row], 'b', 3100);
  assert.equal(state.rows.get('b').pending, true);
});

test('restarts, queues, background work, errors, interactions and stopping keep their own states', () => {
  const base = thread('a', 'p1', 'Alpha', { isUnread: true });
  const initial = observeCompletions(emptyCompletions(), [base], 'a', 1000);
  for (const changes of [
    { status: 'active' }, { status: 'error' }, { queuedWork: 'waiting' }, { queuedWork: 'failed' },
    { hasPendingInteraction: true }, { status: 'stopping' },
    { activity: { ...base.activity, backgroundAgents: 1 } },
  ]) {
    const row = { ...base, ...changes };
    const state = observeCompletions(initial, [row], 'a', 2000);
    assert.equal(state.rows.get('a').pending, false);
    assert.notEqual(threadState({ ...row, completion: state.rows.get('a') }).tone, 'completed');
  }
  let state = observeCompletions(initial, [{ ...base, status: 'stopping', isUnread: false }], 'a', 2000);
  state = observeCompletions(state, [{ ...base, isUnread: false }], 'a', 3000);
  assert.equal(state.rows.get('a').pending, false, 'stopping is not successful completion');
  const running = { ...base, status: 'active', isUnread: false };
  state = observeCompletions(state, [running], 'a', 4000);
  state = observeCompletions(state, [{ ...running, status: 'idle' }], 'a', 5000);
  assert.equal(state.rows.get('a').pending, true);
  assert.equal(state.rows.get('a').at, 5000);
});
