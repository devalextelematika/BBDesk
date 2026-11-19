import { test, fireEvent, within, act, waitFor } from '../helpers/dom.mjs';
import { mount } from '../helpers/dashboard.mjs';
import { project, thread } from '../helpers/factories.mjs';
import { splitTransfer, dragFire } from '../helpers/interactions.mjs';
import assert from 'node:assert/strict';

function geometry(t, initial = 280) {
  let width = initial;
  t.mock.getter(window.HTMLElement.prototype, 'clientWidth', function () { return this.classList.contains('db-project-tabs') ? width : 0; });
  t.mock.method(window.HTMLElement.prototype, 'getBoundingClientRect', function () {
    const w = this.classList.contains('db-project-tab-wrap') ? 100 : 32;
    return { left: 0, top: 0, right: w, bottom: 32, width: w, height: 32 };
  });
  return value => { width = value; fireEvent(window, new window.Event('resize')); };
}
const projects = ['First', 'Second', 'Third', 'Fourth'].map((name, i) => ({ ...project, id: 'p' + (i + 1), name }));
const visible = slot => within(slot.container.querySelector('.db-project-tab-strip')).getAllByRole('tab').map(node => node.id);

test('project overflow preserves a left prefix, selects hidden projects and restores the whole strip on resize', async t => {
  const resize = geometry(t);
  const slot = mount({ connected: true, projects, language: 'en' });
  await slot.findByRole('button', { name: 'More projects (3)' });
  assert.deepEqual(visible(slot), ['db-project-tab-p1', 'db-project-tab-p2']);
  const more = slot.getByRole('button', { name: 'More projects (3)' });
  fireEvent.click(more);
  const menu = slot.getByRole('menu');
  assert.deepEqual(within(menu).getAllByRole('menuitemradio').map(node => node.textContent), ['Third', 'Fourth', 'Shared pool']);
  assert.equal(document.activeElement, within(menu).getAllByRole('menuitemradio')[0]);
  fireEvent.click(within(menu).getByRole('menuitemradio', { name: /Fourth/ }));
  assert.equal(slot.queryByRole('menu'), null);
  assert.equal(document.activeElement, more);
  assert.equal(more.dataset.selected, 'true');
  assert.deepEqual(visible(slot), ['db-project-tab-p1', 'db-project-tab-p2']);
  resize(600);
  assert.equal(slot.queryByRole('button', { name: /More projects/ }), null);
  assert.deepEqual(visible(slot), projects.map(p => 'db-project-tab-' + p.id));
  resize(60);
  assert.equal(within(slot.container.querySelector('.db-project-tab-strip')).queryByRole('tab'), null);
  assert.ok(slot.getByRole('button', { name: 'More projects (5)' }));
});

test('overflow supports Escape, outside dismissal, keyboard navigation and creating a thread', async t => {
  geometry(t);
  const slot = mount({ connected: true, projects, language: 'en' });
  const more = await slot.findByRole('button', { name: 'More projects (3)' });
  fireEvent.keyDown(more, { key: 'ArrowDown' });
  const menu = slot.getByRole('menu');
  fireEvent.keyDown(document.activeElement, { key: 'End' });
  assert.equal(document.activeElement, within(menu).getAllByRole('menuitem').at(-1));
  fireEvent.keyDown(document.activeElement, { key: 'Escape' });
  assert.equal(slot.queryByRole('menu'), null);
  assert.equal(document.activeElement, more);
  fireEvent.click(more);
  fireEvent.pointerDown(document.body);
  assert.equal(slot.queryByRole('menu'), null);
  fireEvent.click(more);
  fireEvent.click(within(slot.getByRole('menu')).getByRole('menuitem', { name: /New thread in project.*Third/ }));
  assert.equal(slot.queryByRole('menu'), null);
  await slot.findByTestId('bb-new-thread-composer');
});

test('project drag opens More and reorders within and across the menu without remounting chat', async t => {
  geometry(t);
  const slot = mount({ connected: true, projects, language: 'en', threads: [thread('a', 'p1', 'Keep chat')] });
  const chat = await slot.findByTestId('bb-thread-chat');
  const transfer = { setData() {}, effectAllowed: '', dropEffect: '' };
  const more = slot.getByRole('button', { name: 'More projects (3)' });
  const first = slot.container.querySelector('#db-project-tab-p1');
  dragFire(first, 'dragstart', {}, transfer);
  dragFire(more, 'dragover', {}, transfer);
  let third = within(slot.getByRole('menu')).getByRole('menuitemradio', { name: /Third/ });
  dragFire(third.closest('.db-project-tab-wrap'), 'drop', { clientY: 30 }, transfer);
  await waitFor(() => assert.deepEqual(visible(slot), ['db-project-tab-p2', 'db-project-tab-p3']));
  let menu = slot.getByRole('menu');
  let fourth = within(menu).getByRole('menuitemradio', { name: /Fourth/ });
  const source = within(menu).getByRole('menuitemradio', { name: /First/ });
  dragFire(source, 'dragstart', {}, transfer);
  dragFire(fourth.closest('.db-project-tab-wrap'), 'drop', { clientY: 30 }, transfer);
  await waitFor(() => assert.deepEqual(within(slot.getByRole('menu')).getAllByRole('menuitemradio').map(node => node.textContent), ['Fourth', 'First', 'Shared pool']));
  fourth = within(slot.getByRole('menu')).getByRole('menuitemradio', { name: /Fourth/ });
  dragFire(fourth, 'dragstart', {}, transfer);
  dragFire(slot.container.querySelector('#db-project-tab-p2').closest('.db-project-tab-wrap'), 'drop', { clientX: -1 }, transfer);
  await waitFor(() => assert.deepEqual(visible(slot), ['db-project-tab-p4', 'db-project-tab-p2']));
  assert.equal(slot.getByTestId('bb-thread-chat'), chat);
  assert.ok(slot.inspection.rpcCalls.some(call => call.method === 'catalog_change' && call.input.id === 'p4' && call.input.targetId === 'p2' && !call.input.after));
});


test('common threads and shared pool share one measured strip and one overflow menu with projects', async t => {
  const resize = geometry(t, 700);
  const personal = { ...project, id: 'home', name: 'Personal', isPersonal: true };
  const slot = mount({ connected: true, language: 'en', projects: [projects[0], projects[1], personal] });
  await slot.findByRole('tab', { name: /^Common threads,/ });
  const strip = slot.container.querySelector('.db-project-tab-strip');
  assert.equal(slot.container.querySelectorAll('.db-project-tabs').length, 1);
  assert.equal(slot.queryByRole('button', { name: /More projects/ }), null);
  assert.ok(within(strip).getByRole('tab', { name: /^Common threads,/ }));
  assert.ok(within(strip).getByRole('button', { name: 'Shared pool' }));
  resize(160);
  const more = slot.getByRole('button', { name: 'More projects (3)' });
  assert.equal(slot.getAllByRole('button', { name: /More projects/ }).length, 1);
  fireEvent.click(more);
  let menu = slot.getByRole('menu');
  assert.deepEqual(within(menu).getAllByRole('menuitemradio').map(node => node.textContent), ['Second', 'Common threads', 'Shared pool']);
  fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Shared pool' }));
  assert.equal(slot.queryByRole('menu'), null);
  assert.equal(more.dataset.selected, 'true');
  fireEvent.click(more);
  menu = slot.getByRole('menu');
  assert.equal(within(menu).getByRole('menuitemradio', { name: 'Shared pool' }).getAttribute('aria-checked'), 'true');
  fireEvent.click(within(menu).getByRole('menuitemradio', { name: /^Common threads,/ }));
  assert.equal(slot.queryByRole('menu'), null);
  fireEvent.click(more);
  assert.equal(within(slot.getByRole('menu')).getByRole('menuitemradio', { name: /^Common threads,/ }).getAttribute('aria-checked'), 'true');
  resize(700);
  assert.equal(slot.queryByRole('menu'), null);
  assert.equal(slot.queryByRole('button', { name: /More projects/ }), null);
  assert.ok(within(strip).getByRole('tab', { name: /^Common threads,/ }));
  assert.ok(within(strip).getByRole('button', { name: 'Shared pool' }));
});


test('hidden shared pool accepts a thread drop through More and retains its new-thread action', async t => {
  geometry(t, 160);
  const slot = mount({ connected: true, language: 'en', projects: projects.slice(0, 2), threads: [thread('a', 'p1', 'Pinned from menu')] });
  await slot.findByTestId('bb-thread-chat');
  const more = slot.getByRole('button', { name: 'More projects (2)' });
  const transfer = splitTransfer('p1', 'a');
  dragFire(document.querySelector('.db-thread-tab'), 'dragstart', {}, transfer);
  dragFire(more, 'dragover', {}, transfer);
  const pool = within(slot.getByRole('menu')).getByRole('menuitemradio', { name: 'Shared pool' });
  dragFire(pool, 'drop', {}, transfer);
  fireEvent.click(pool);
  assert.equal(slot.container.querySelector('.db-pool-workspace [data-testid="bb-thread-chat"]').dataset.threadId, 'a');
  fireEvent.click(more);
  fireEvent.click(within(slot.getByRole('menu')).getByRole('menuitem', { name: 'New thread in the shared pool' }));
  await slot.findByTestId('bb-new-thread-composer');
  assert.equal(slot.queryByRole('menu'), null);
});
