import { test, fireEvent, within, act } from '../helpers/dom.mjs';
import { mount, showCatalog } from '../helpers/dashboard.mjs';
import { project, secondProject, thread } from '../helpers/factories.mjs';
import { dragFire, splitTransfer } from '../helpers/interactions.mjs';
import assert from 'node:assert/strict';

async function catalogAndLanguage(slot) {
  const dialog = await showCatalog(slot);
  const search = within(dialog).getByRole('searchbox');
  fireEvent.change(search, { target: { value: 'Keep this search' } });
  fireEvent.click(within(dialog).getByRole('tab', { name: 'Applications' }));
  await slot.setLanguage('ru');
  assert.equal(search.value, 'Keep this search');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Готово' }));
}
function reorderProjects(slot) {
  const source = slot.container.querySelector('#db-project-tab-p1');
  const target = slot.container.querySelector('#db-project-tab-p2').closest('.db-project-tab-wrap');
  const transfer = { setData() {}, effectAllowed: '', dropEffect: '' };
  dragFire(source, 'dragstart', {}, transfer);
  dragFire(target, 'dragover', { clientX: 10000 }, transfer);
  dragFire(target, 'drop', { clientX: 10000 }, transfer);
  dragFire(source, 'dragend', {}, transfer);
}
function retainedChats(slot) {
  const original = new Map(slot.getAllByTestId('bb-thread-chat').map(chat => {
    const editor = document.createElement('textarea'); editor.value = 'Draft ' + chat.dataset.threadId;
    chat.append(editor); editor.setSelectionRange(2, 5); chat.scrollTop = 73;
    return [chat.dataset.threadId, { chat, editor }];
  }));
  return () => {
    const current = slot.getAllByTestId('bb-thread-chat');
    assert.equal(current.length, original.size);
    for (const chat of current) {
      const expected = original.get(chat.dataset.threadId);
      assert.equal(chat, expected.chat); assert.ok(chat.contains(expected.editor));
      assert.equal(expected.editor.value, 'Draft ' + chat.dataset.threadId);
      assert.equal(expected.editor.selectionStart, 2); assert.equal(expected.editor.selectionEnd, 5); assert.equal(chat.scrollTop, 73);
    }
  };
}
function resize(slot) {
  fireEvent.keyDown(slot.container.querySelector('.db-launcher-resize'), { key: 'ArrowRight' });
  const divider = slot.container.querySelector('.db-split-divider');
  if (divider) fireEvent.keyDown(divider, { key: 'ArrowRight' });
}

test('project view retains every native chat, draft and reading node across catalog, resize, reorder and language', async () => {
  window.localStorage.setItem('bb-dashboard:split-layout:v1', JSON.stringify({ p1: { ids: ['a', 'b'], active: 'a', sizes: { a: 2, b: 3 } } }));
  const slot = mount({ language: 'en', connected: true, projects: [project, secondProject], threads: [thread('a', 'p1', 'Alpha'), thread('b', 'p1', 'Beta'), thread('other', 'p2', 'Other')] });
  await slot.findAllByTestId('bb-thread-chat'); const retained = retainedChats(slot);
  await catalogAndLanguage(slot); retained();
  resize(slot); retained();
  await act(async () => reorderProjects(slot)); retained();
  assert.ok(slot.inspection.rpcCalls.some(call => call.method === 'catalog_change' && call.input.type === 'move'));
  assert.equal(slot.container.querySelectorAll('.db-split-pane').length, 2);
});

test('pool view retains every native chat and draft while its columns reorder and resize', async () => {
  window.localStorage.setItem('bb-dashboard:shared-pool:v1', JSON.stringify({ entries: [{ projectId: 'p1', threadId: 'a' }, { projectId: 'p2', threadId: 'b' }], active: 'a', open: true, sizes: { a: 2, b: 3 } }));
  const slot = mount({ language: 'en', connected: true, projects: [project, secondProject], threads: [thread('a', 'p1', 'Alpha'), thread('b', 'p2', 'Beta')] });
  await slot.findAllByTestId('bb-thread-chat'); const retained = retainedChats(slot);
  await catalogAndLanguage(slot); retained();
  resize(slot); retained();
  const dock = slot.container.querySelector('.db-pool-workspace .db-thread-dock');
  const tabs = within(dock).getAllByRole('tab'); const target = tabs[1].closest('.db-thread-tab-item');
  target.getBoundingClientRect = () => ({ left: 0, width: 100, right: 100, top: 0, bottom: 32, height: 32 });
  const transfer = splitTransfer('p1', 'a');
  dragFire(tabs[0], 'dragstart', {}, transfer);
  dragFire(target, 'dragover', { clientX: 90 }, transfer);
  dragFire(target, 'drop', { clientX: 90 }, transfer);
  dragFire(tabs[0], 'dragend', {}, transfer);
  retained();
  assert.deepEqual([...slot.container.querySelectorAll('.db-split-pane')].map(node => node.dataset.threadId), ['b', 'a']);
});

for (const pool of [false, true]) test(`${pool ? 'pool' : 'project'} composer retains its draft, selection and project through view updates`, async () => {
  const slot = mount({ language: 'en', connected: true, projects: [project, secondProject], threads: [thread('a', 'p1', 'Alpha')] });
  await slot.findByTestId('bb-thread-chat');
  const button = pool ? slot.getByRole('button', { name: 'New thread in the shared pool' }) : slot.getAllByRole('button', { name: `New thread in project “${project.name}”` })[0];
  fireEvent.click(button);
  const composer = slot.getByTestId('bb-new-thread-composer'), editor = slot.getByTestId('bb-new-thread-composer-input');
  fireEvent.change(editor, { target: { value: 'Unsent native draft' } }); editor.setSelectionRange(3, 8);
  await catalogAndLanguage(slot); resize(slot); await act(async () => reorderProjects(slot));
  assert.equal(slot.getByTestId('bb-new-thread-composer'), composer);
  assert.equal(slot.getByTestId('bb-new-thread-composer-input'), editor);
  assert.equal(editor.value, 'Unsent native draft'); assert.equal(editor.selectionStart, 3); assert.equal(editor.selectionEnd, 8);
  assert.equal(composer.dataset.defaultProjectId, 'p1');
  assert.equal(slot.queryByTestId('bb-thread-chat'), null);
});
