import { test, act } from '../helpers/dom.mjs';
import assert from 'node:assert/strict';
const { renderHook } = await import('@testing-library/react');
const { useWorkspaceSync } = await import('../../hooks/use-workspace-sync.ts');

test('a synchronization that never settles pauses after twenty changes, reports once and retries later', async context => {
  let state = { n: 0 }, dispatched = 0;
  // A pathological rule: every pass produces a new state object.
  const controller = { getState: () => state, dispatch: () => { dispatched++; state = { n: state.n + 1 }; return state; } };
  const errors = []; context.mock.method(console, 'error', message => errors.push(message));
  let now = 1_000; context.mock.method(Date, 'now', () => now);
  const hook = renderHook(() => useWorkspaceSync(controller, {}));
  for (let i = 0; i < 30; i++) await act(async () => hook.rerender());
  assert.equal(dispatched, 20);
  assert.equal(errors.length, 1);
  now += 5_000;
  for (let i = 0; i < 30; i++) await act(async () => hook.rerender());
  assert.equal(dispatched, 40);
  assert.equal(errors.length, 1);
  hook.unmount();
});

test('passes that settle keep running on every render without pausing', async context => {
  const state = {}; let dispatched = 0;
  const controller = { getState: () => state, dispatch: () => { dispatched++; return state; } };
  const errors = []; context.mock.method(console, 'error', message => errors.push(message));
  const hook = renderHook(() => useWorkspaceSync(controller, {}));
  for (let i = 0; i < 50; i++) await act(async () => hook.rerender());
  assert.equal(dispatched, 51);
  assert.equal(errors.length, 0);
  hook.unmount();
});
