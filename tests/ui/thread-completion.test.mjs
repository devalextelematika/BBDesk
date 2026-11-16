import { test, act, fireEvent, createElement, app, waitFor } from '../helpers/dom.mjs';
import { mount, thread } from '../helpers/dashboard.mjs';
import assert from 'node:assert/strict';

const tab = (slot, name) => slot.getAllByRole('tab', { name: new RegExp(name + ':') }).find(node => node.classList.contains('db-thread-tab'));
async function update(slot, rows, index, changes) {
  Object.assign(rows[index], changes);
  await act(async () => slot.lifecycle.rerender(createElement(app.navPanels[0].component, { subPath: '' })));
}

test('open chat retains its completion check until another thread is selected', async () => {
  const rows = [thread('a', 'p1', 'Alpha', { status: 'active' }), thread('b', 'p1', 'Beta')];
  const slot = mount({ connected: true, language: 'en', threads: rows });
  const chat = await slot.findByTestId('bb-thread-chat');
  await update(slot, rows, 0, { status: 'idle', isUnread: false });
  assert.ok(tab(slot, 'Alpha').querySelector('.db-dot.completed svg'));
  assert.match(slot.container.querySelector('.db-thread-open').textContent, /Completed at \d{2}:\d{2}/);
  assert.equal(slot.getByTestId('bb-thread-chat'), chat);
  fireEvent.click(tab(slot, 'Beta'));
  assert.equal(tab(slot, 'Alpha').querySelector('.completed'), null);
  assert.match(tab(slot, 'Alpha').title, /Completed at/);
  fireEvent.click(tab(slot, 'Alpha'));
  assert.equal(tab(slot, 'Alpha').querySelector('.completed'), null);
  await update(slot, rows, 0, { status: 'active' });
  assert.ok(tab(slot, 'Alpha').querySelector('.db-working'));
  await update(slot, rows, 0, { status: 'idle' });
  assert.ok(tab(slot, 'Alpha').querySelector('.db-dot.completed'));
});

test('background result stays green through automatic reading until selected and left', async () => {
  const rows = [thread('a', 'p1', 'Alpha', { status: 'active' }), thread('b', 'p1', 'Beta', { status: 'active' })];
  const slot = mount({ connected: true, language: 'en', threads: rows });
  await slot.findByTestId('bb-thread-chat');
  fireEvent.click(tab(slot, 'Alpha'));
  await update(slot, rows, 1, { status: 'idle', isUnread: true, latestAttentionAt: Date.now() });
  assert.ok(tab(slot, 'Beta').querySelector('.db-dot.result'));
  await update(slot, rows, 1, { isUnread: false });
  assert.ok(tab(slot, 'Beta').querySelector('.db-dot.result'));
  fireEvent.click(tab(slot, 'Beta'));
  assert.ok(tab(slot, 'Beta').querySelector('.db-dot.completed'));
  fireEvent.click(tab(slot, 'Alpha'));
  assert.equal(tab(slot, 'Beta').querySelector('.completed, .result'), null);
});

test('pool pane focus acknowledges only the completion of the pane being left', async () => {
  window.localStorage.setItem('bb-dashboard:shared-pool:v1', JSON.stringify({ entries: [{ projectId: 'p1', threadId: 'a' }, { projectId: 'p1', threadId: 'b' }], active: 'a', sizes: {}, open: true }));
  const rows = [thread('a', 'p1', 'Alpha', { status: 'active' }), thread('b', 'p1', 'Beta', { status: 'active' })];
  const slot = mount({ connected: true, language: 'en', threads: rows });
  await waitFor(() => assert.equal(slot.getAllByTestId('bb-thread-chat').length, 2));
  const chats = slot.getAllByTestId('bb-thread-chat');
  await update(slot, rows, 0, { status: 'idle' });
  await update(slot, rows, 1, { status: 'idle' });
  assert.ok(tab(slot, 'Alpha').querySelector('.completed'));
  assert.ok(tab(slot, 'Beta').querySelector('.result'));
  fireEvent.pointerDown(slot.container.querySelector('.db-split-pane[data-thread-id="b"]'));
  assert.equal(tab(slot, 'Alpha').querySelector('.completed'), null);
  assert.ok(tab(slot, 'Beta').querySelector('.completed'));
  fireEvent.focus(slot.container.querySelector('.db-split-pane[data-thread-id="a"]'));
  assert.equal(tab(slot, 'Beta').querySelector('.completed'), null);
  assert.deepEqual(slot.getAllByTestId('bb-thread-chat'), chats);
});

test('project split keeps background completion until that pane is selected and left', async () => {
  window.localStorage.setItem('bb-dashboard:split-layout:v1', JSON.stringify({ p1: { ids: ['a', 'b'], active: 'a', sizes: {} } }));
  const rows = [thread('a', 'p1', 'Alpha', { status: 'active' }), thread('b', 'p1', 'Beta', { status: 'active' })];
  const slot = mount({ connected: true, language: 'en', threads: rows });
  await waitFor(() => assert.equal(slot.getAllByTestId('bb-thread-chat').length, 2));
  await update(slot, rows, 1, { status: 'idle' });
  assert.ok(tab(slot, 'Beta').querySelector('.result'));
  fireEvent.pointerDown(slot.container.querySelector('.db-split-pane[data-thread-id="b"]'));
  assert.ok(tab(slot, 'Beta').querySelector('.completed'));
  fireEvent.pointerDown(slot.container.querySelector('.db-split-pane[data-thread-id="a"]'));
  assert.equal(tab(slot, 'Beta').querySelector('.completed, .result'), null);
});
