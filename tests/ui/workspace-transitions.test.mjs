import { test, fireEvent, act, waitFor } from '../helpers/dom.mjs';
import { mount, showCatalog } from '../helpers/dashboard.mjs';
import { project, secondProject, thread } from '../helpers/factories.mjs';
import { deferred } from '../helpers/deferred.mjs';
import assert from 'node:assert/strict';

test('late successful hide cannot switch or remount the conversation selected in another project', async () => {
  const hidden = deferred();
  const slot = mount({ connected: true, language: 'en', projects: [project, secondProject], threads: [thread('a', 'p1', 'Alpha'), thread('b', 'p2', 'Beta')], rpcOverrides: { thread_hide: () => hidden.promise } });
  await slot.findByTestId('bb-thread-chat');
  fireEvent.click(slot.getByRole('button', { name: /Hide.*Alpha/ }));
  fireEvent.click(slot.getByRole('tab', { name: new RegExp('^' + secondProject.name + ',') }));
  const current = slot.getByTestId('bb-thread-chat'); assert.equal(current.dataset.threadId, 'b');
  await act(async () => hidden.resolve({ hidden: true, undoToken: 'unused' }));
  assert.equal(slot.getByTestId('bb-thread-chat'), current);
  assert.equal(slot.getByRole('tab', { name: new RegExp('^' + secondProject.name + ','), selected: true }).getAttribute('aria-selected'), 'true');
});

test('disabling the pool during spawn keeps its eventual pin without reopening after re-enable', async () => {
  const spawned = deferred();
  const slot = mount({ connected: true, language: 'en', threads: [thread('a', 'p1', 'Alpha')], sdk: { threads: { spawn: () => spawned.promise } } });
  await slot.findByTestId('bb-thread-chat');
  fireEvent.click(slot.getByRole('button', { name: 'New thread in the shared pool' }));
  fireEvent.click(slot.getByTestId('bb-new-thread-composer-submit'));
  await showCatalog(slot);
  await act(async () => fireEvent.click(slot.getByRole('checkbox', { name: 'Shared pool' })));
  await act(async () => spawned.resolve({ id: 'created' }));
  let saved = JSON.parse(window.localStorage.getItem('bb-dashboard:shared-pool:v1'));
  assert.equal(saved.open, false); assert.deepEqual(saved.entries, [{ projectId: 'p1', threadId: 'created' }]);
  await act(async () => fireEvent.click(slot.getByRole('checkbox', { name: 'Shared pool' })));
  fireEvent.click(slot.getByRole('button', { name: 'Done' }));
  assert.equal(slot.getByTestId('bb-thread-chat').dataset.threadId, 'a');
  assert.equal(slot.getByRole('button', { name: /^Shared pool/ }).getAttribute('aria-pressed'), 'false');
});

test('two pool completions from one composer keep the last completed column active', async () => {
  const responses = [deferred(), deferred()]; let calls = 0;
  const slot = mount({ connected: true, language: 'en', threads: [thread('a', 'p1', 'Alpha')], sdk: { threads: { spawn: () => responses[calls++].promise } } });
  await slot.findByTestId('bb-thread-chat');
  fireEvent.click(slot.getByRole('button', { name: 'New thread in the shared pool' }));
  const submit = slot.getByTestId('bb-new-thread-composer-submit');
  fireEvent.click(submit); fireEvent.click(submit); assert.equal(calls, 2);
  await act(async () => { responses[0].resolve({ id: 'first' }); responses[1].resolve({ id: 'second' }); });
  const saved = JSON.parse(window.localStorage.getItem('bb-dashboard:shared-pool:v1'));
  assert.deepEqual(saved.entries.map(e => e.threadId), ['first', 'second']); assert.equal(saved.active, 'second');
  assert.equal(slot.container.querySelector('.db-split-pane[data-thread-id="second"]').dataset.active, 'true');
});

test('disconnecting the composing project selects a fallback and ignores its delayed result', async () => {
  const spawned = deferred();
  const slot = mount({ connected: true, language: 'en', projects: [project, secondProject], threads: [thread('a', 'p1', 'Alpha'), thread('b', 'p2', 'Beta')], sdk: { threads: { spawn: () => spawned.promise } } });
  await slot.findByTestId('bb-thread-chat');
  fireEvent.click(slot.getAllByRole('button', { name: `New thread in project “${project.name}”` })[0]);
  fireEvent.click(slot.getByTestId('bb-new-thread-composer-submit'));
  await showCatalog(slot);
  await act(async () => fireEvent.click(slot.getByRole('checkbox', { name: project.name })));
  fireEvent.click(slot.getByRole('button', { name: 'Done' }));
  const current = await slot.findByTestId('bb-thread-chat'); assert.equal(current.dataset.threadId, 'b');
  await act(async () => spawned.resolve({ id: 'late' }));
  assert.equal(slot.getByTestId('bb-thread-chat'), current);
  assert.equal(slot.queryByTestId('bb-new-thread-composer'), null);
});

test('legacy workspace storage loads once and stable realtime updates do not create persistence loops', async context => {
  const keys = new Set(['bb-dashboard:workspace-session:v1', 'bb-dashboard:split-layout:v1', 'bb-dashboard:shared-pool:v1']);
  const reads = [], writes = [];
  const get = window.Storage.prototype.getItem, set = window.Storage.prototype.setItem;
  context.mock.method(window.Storage.prototype, 'getItem', function(key) { if (keys.has(key)) reads.push(key); return get.call(this, key); });
  context.mock.method(window.Storage.prototype, 'setItem', function(key, value) { if (keys.has(key)) writes.push(key); return set.call(this, key, value); });
  const slot = mount({ connected: true, language: 'en', threads: [thread('a', 'p1', 'Alpha')] });
  await slot.findByTestId('bb-thread-chat');
  await act(async () => {});
  assert.deepEqual([...keys].map(key => reads.filter(k => k === key).length), [1, 1, 1]);
  const count = writes.length;
  await slot.behavior.emitRealtime('dashboard-changed', {});
  await waitFor(() => assert.equal(slot.getByTestId('bb-thread-chat').dataset.threadId, 'a'));
  assert.equal(writes.length, count);
});
