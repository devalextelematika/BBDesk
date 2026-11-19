import { test, act, fireEvent, within, createElement, app, waitFor } from '../helpers/dom.mjs';
import { mount, thread, showCatalog } from '../helpers/dashboard.mjs';
import assert from 'node:assert/strict';
const { changeCatalog } = await import('../../catalog-config.ts');
const baseConfig = () => ({ projects: [{ id: 'p1', enabled: true, connectedAt: 1 }], launcher: [], sharedPool: true });

test('multiline background settings save on blur, retain the list when disabled, and retry failed writes', async () => {
  let config = baseConfig(), fail = false;
  const operations = [];
  const slot = mount({ language: 'en', rpcOverrides: {
    snapshot: () => ({ config, tracked: [], syncError: null, syncedAt: 150 }),
    catalog_change: operation => { operations.push(operation); if (fail) throw new Error('offline'); config = changeCatalog(config, operation, 1000); return structuredClone(config); },
  } });
  let dialog = await showCatalog(slot);
  fireEvent.click(within(dialog).getByRole('tab', { name: 'More settings' }));
  let input = within(dialog).getByRole('textbox', { name: 'Title substrings, one per line' });
  fireEvent.change(input, { target: { value: ' worker \n\nпроверка\nWORKER' } });
  await act(async () => fireEvent.blur(input));
  assert.deepEqual(config.backgroundThreads.substrings, ['WORKER', 'проверка']);
  const checkbox = within(dialog).getByRole('checkbox', { name: 'Show background threads only when attention is needed' });
  await act(async () => fireEvent.click(checkbox));
  assert.equal(config.backgroundThreads.enabled, true);
  await act(async () => fireEvent.click(checkbox));
  assert.equal(config.backgroundThreads.enabled, false);
  assert.deepEqual(config.backgroundThreads.substrings, ['WORKER', 'проверка']);
  fail = true;
  fireEvent.change(input, { target: { value: 'job' } });
  await act(async () => fireEvent.blur(input));
  assert.ok(within(dialog).getByRole('alert')); assert.equal(input.value, 'job');
  fail = false;
  await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Retry' })));
  assert.deepEqual(config.backgroundThreads.substrings, ['job']);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
  dialog = await showCatalog(slot);
  fireEvent.click(within(dialog).getByRole('tab', { name: 'More settings' }));
  input = within(dialog).getByRole('textbox', { name: 'Title substrings, one per line' });
  assert.equal(input.value, 'job');
  fireEvent.change(input, { target: { value: 'nightly' } });
  await act(async () => fireEvent.keyDown(input, { key: 'Escape' }));
  assert.deepEqual(config.backgroundThreads.substrings, ['nightly']);
  assert.equal(slot.queryByRole('dialog'), null);
});

test('background work stays in indicators, appears for user input and errors, then leaves even an open chat on success', async () => {
  const config = { ...baseConfig(), backgroundThreads: { enabled: true, substrings: ['worker'], since: 1000 } };
  const rows = [thread('bg', 'p1', 'Nightly worker', { createdAt: 1100, status: 'active' })];
  const tracked = [];
  const slot = mount({ language: 'en', threads: rows, rpcOverrides: { snapshot: () => ({ config, tracked, syncError: null, syncedAt: 150 }) } });
  await waitFor(() => assert.equal(slot.container.querySelectorAll('.db-thread-indicator').length, 1));
  assert.equal(slot.container.querySelectorAll('.db-thread-tab').length, 0);
  assert.equal(slot.queryByTestId('bb-thread-chat'), null);
  async function update(changes) {
    Object.assign(rows[0], changes);
    await act(async () => slot.lifecycle.rerender(createElement(app.navPanels[0].component, { subPath: '' })));
  }
  await update({ hasPendingInteraction: true });
  assert.equal(slot.container.querySelectorAll('.db-thread-tab').length, 1);
  fireEvent.click(slot.container.querySelector('.db-thread-tab'));
  await slot.findByTestId('bb-thread-chat');
  tracked.push({ id: 'bg', projectId: 'p1', visible: true, latestAttentionAt: 150, hiddenAttentionAt: 0, backgroundMatched: true, backgroundExposed: true });
  await update({ hasPendingInteraction: false, status: 'error' });
  assert.ok(slot.container.querySelector('.db-thread-tab .error'));
  await update({ status: 'idle', isUnread: true });
  await waitFor(() => assert.equal(slot.queryByTestId('bb-thread-chat'), null));
  assert.equal(slot.container.querySelectorAll('.db-thread-tab, .db-thread-indicator').length, 0);
});
