import '../../scripts/test-loader.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project, secondProject, thread } from '../helpers/factories.mjs';
const { createWorkspaceState, workspaceTransition, selectionFields, sharedPoolComposer } = await import('../../workspace-transitions.ts');
const { createWorkspaceModel } = await import('../../workspace-selectors.ts');
const emptyPool = () => ({ entries: [], active: '', sizes: {}, open: false });
const initial = (layouts = {}, pool = emptyPool()) => createWorkspaceState({ projectId: 'p1', conversations: {} }, layouts, pool);
const threads = [thread('a', 'p1', 'Alpha', { createdAt: 3 }), thread('b', 'p1', 'Beta', { createdAt: 2 }), thread('c', 'p1', 'Gamma', { createdAt: 1 }), thread('other', 'p2', 'Other')];
const model = (rows = threads, ids = ['p1', 'p2']) => createWorkspaceModel({ threads: rows, projects: [project, secondProject], config: { projects: ids.map(id => ({ id, enabled: true, connectedAt: 100 })), launcher: [], sharedPool: true }, tracked: [], drafts: new Set(), opened: null });
const workspace = model();
function step(state, event) {
  const before = structuredClone(state);
  const result = workspaceTransition(state, event);
  assert.deepEqual(state, before, 'Transition mutated its input');
  const fields = selectionFields(result.selection);
  assert.ok(!(fields.opened && fields.historyOpened));
  if (result.selection.kind === 'project-composer') assert.deepEqual(fields, { opened: null, historyOpened: null, creating: result.selection.projectId });
  return result;
}
const open = (s, id = 'a', projectId = 'p1', history = false) => step(s, { type: 'conversation.open', id, projectId, history, enter: !history });

test('navigation and collapse cancel creation intents while pool composition keeps its project underlay', () => {
  let s = open(initial()); const chat = s.selection;
  s = step(s, { type: 'create.start', projectId: sharedPoolComposer, intent: {} });
  assert.equal(s.selection.underneath, chat); assert.equal(selectionFields(s.selection).opened, 'a');
  s = step(s, { type: 'create.close' }); assert.equal(s.selection, chat);
  const intent = {}; s = step(s, { type: 'create.start', projectId: 'p1', intent });
  assert.equal(s.creation.intent, intent);
  s = step(s, { type: 'project.select', projectId: 'p2', workspace });
  assert.equal(s.creation, null); assert.equal(selectionFields(s.selection).opened, 'other');
  assert.equal(step(s, { type: 'spawn.project', entry: { id: 'late', projectId: 'p1' }, intent }), s);
  s = step(s, { type: 'conversation.toggle', id: 'other' }); assert.equal(s.selection.kind, 'none');
  assert.equal(step(s, { type: 'project.enter', projectId: 'p2', workspace, expectedProjectId: 'p2' }), s);
});

test('stale project entry, selection recovery and memory effects cannot undo newer navigation', () => {
  const old = open(initial()); const next = open(old, 'other', 'p2');
  assert.equal(step(next, { type: 'project.enter', projectId: 'p1', workspace, expectedProjectId: 'p1' }), next);
  assert.equal(step(next, { type: 'selection.recover', id: 'b', expectedSelection: old.selection }), next);
  assert.equal(step(next, { type: 'memory.remember', projectId: 'p1', choice: { id: 'a', history: false }, expectedSelection: old.selection }), next);
});

test('pane additions focus duplicates, retain adjacent widths and distinguish close from hide replacement', () => {
  let s = open(initial());
  s = step(s, { type: 'pane.add', projectId: 'p1', id: 'b', history: false, after: true });
  s = step(s, { type: 'pane.add', projectId: 'p1', id: 'c', history: false, after: true });
  s = step(s, { type: 'pane.resize', projectId: 'p1', sizes: { a: 2, b: 3, c: 4 } });
  s = step(s, { type: 'pane.add', projectId: 'p1', id: 'b', history: false, after: false });
  assert.deepEqual(s.layouts.p1, { ids: ['a', 'b', 'c'], active: 'b', sizes: { a: 2, b: 3, c: 4 } });
  const closed = step(s, { type: 'pane.remove', projectId: 'p1', id: 'b', workspace });
  assert.equal(closed.layouts.p1.active, 'c'); assert.equal(selectionFields(closed.selection).opened, 'c');
  const hidden = step(s, { type: 'thread.hidden', entry: { id: 'b', projectId: 'p1' }, workspace });
  assert.equal(hidden.layouts.p1.active, 'a'); assert.equal(selectionFields(hidden.selection).opened, 'a');
  assert.deepEqual(hidden.layouts.p1.sizes, s.layouts.p1.sizes);
});

test('hide completion changes only the still-selected conversation and forgets its saved entry', () => {
  let s = open(initial());
  s = step(s, { type: 'memory.remember', projectId: 'p1', choice: { id: 'a', history: false }, expectedSelection: s.selection });
  const selected = step(s, { type: 'thread.hidden', entry: { id: 'a', projectId: 'p1' }, workspace });
  assert.equal(selectionFields(selected.selection).opened, 'b'); assert.equal(selected.memory.conversations.p1, undefined);
  const navigated = open(s, 'other', 'p2');
  const background = step(navigated, { type: 'thread.hidden', entry: { id: 'a', projectId: 'p1' }, workspace });
  assert.equal(background.selection, navigated.selection);
  const pool = step(s, { type: 'pool.show' });
  assert.equal(step(pool, { type: 'thread.hidden', entry: { id: 'a', projectId: 'p1' }, workspace }).selection, pool.selection);
});

test('pool completions share the latest capacity and keep every result that cannot be pinned', () => {
  const entries = Array.from({ length: 49 }, (_, i) => ({ projectId: 'p1', threadId: 'p' + i }));
  let s = initial({}, { entries, active: 'p0', sizes: {}, open: false }); const intent = {};
  s = step(s, { type: 'create.start', projectId: sharedPoolComposer, intent });
  const one = {}, two = {}; s = step(s, { type: 'pool.request', operation: one }); s = step(s, { type: 'pool.request', operation: two });
  s = step(s, { type: 'spawn.pool', entry: { projectId: 'p1', id: 'first' }, intent, operation: one, title: 'First' });
  s = step(s, { type: 'spawn.pool', entry: { projectId: 'p1', id: 'second' }, intent, operation: two, title: 'Second' });
  assert.equal(s.pool.entries.length, 50); assert.equal(s.pendingPool.get('first'), 'p1');
  assert.deepEqual(s.unplaced, [{ projectId: 'p1', threadId: 'second', title: 'Second', reason: 'limit' }]);
  assert.equal(s.poolRequests.size, 0);
});

test('successful completion retains the intent for another result from the same creation batch', () => {
  const intent = {}; let projectState = step(initial(), { type: 'create.start', projectId: 'p1', intent });
  for (const id of ['first', 'second']) projectState = step(projectState, { type: 'spawn.project', entry: { projectId: 'p1', id }, intent });
  assert.equal(selectionFields(projectState.selection).opened, 'second'); assert.equal(projectState.creation.intent, intent);
  let poolState = step(initial(), { type: 'create.start', projectId: sharedPoolComposer, intent });
  for (const id of ['first', 'second']) {
    const operation = {}; poolState = step(poolState, { type: 'pool.request', operation });
    poolState = step(poolState, { type: 'spawn.pool', entry: { projectId: 'p1', id }, intent, operation, title: id });
  }
  assert.deepEqual(poolState.pool.entries.map(e => e.threadId), ['first', 'second']);
  assert.equal(poolState.pool.active, 'second'); assert.equal(poolState.pendingCreated.id, 'second');
});

test('explicit unpin and navigation during spawn preserve user intent and independent requests', () => {
  const intent = {}, operation = {}; let s = open(initial());
  s = step(s, { type: 'create.start', projectId: sharedPoolComposer, intent }); s = step(s, { type: 'pool.request', operation });
  s = step(s, { type: 'pool.remove', id: 'created' });
  s = step(s, { type: 'project.select', projectId: 'p2', workspace });
  s = step(s, { type: 'spawn.pool', entry: { projectId: 'p1', id: 'created' }, intent, operation, title: 'Created' });
  assert.equal(s.pool.entries.length, 0); assert.equal(selectionFields(s.selection).opened, 'other');
  assert.equal(s.unplaced[0].reason, 'removed'); assert.equal(s.pool.open, false);
});

test('pool disable closes its composer but retains late results as pins without reopening', () => {
  const intent = {}, operation = {}; let s = open(initial());
  s = step(s, { type: 'create.start', projectId: sharedPoolComposer, intent }); s = step(s, { type: 'pool.request', operation });
  s = step(s, { type: 'pool.disable' });
  s = step(s, { type: 'spawn.pool', entry: { projectId: 'p1', id: 'created' }, intent, operation, title: 'Created' });
  assert.equal(s.pool.open, false); assert.equal(s.pool.entries[0].threadId, 'created'); assert.equal(selectionFields(s.selection).opened, 'a');
});

test('reconciliation retains pending chats and disconnected pool entries and drops unavailable columns', () => {
  const pool = { entries: [{ projectId: 'p1', threadId: 'pending' }, { projectId: 'gone', threadId: 'missing' }, { projectId: 'p1', threadId: 'archived' }], active: 'pending', open: true, sizes: { pending: 2, missing: 4, archived: 1 } };
  let s = initial({ p1: { ids: ['pending', 'a', 'archived'], active: 'pending', sizes: {} } }, pool);
  s = { ...s, pendingCreated: { id: 'pending', projectId: 'p1' }, pendingPool: new Map([['pending', 'p1']]) };
  s = step(s, { type: 'layouts.reconcile', workspace }); s = step(s, { type: 'pool.reconcile', workspace });
  assert.deepEqual(s.layouts.p1.ids, ['pending', 'a']);
  assert.deepEqual(s.pool.entries.map(e => e.threadId), ['pending', 'missing']);
  const ready = model([...threads, thread('pending', 'p1', 'Pending')]);
  const priorPending = s.pendingCreated;
  assert.equal(step(s, { type: 'pending.seen', entry: { id: 'older-result', projectId: 'p1' } }), s);
  s = step(s, { type: 'pending.seen', entry: priorPending }); s = step(s, { type: 'pool.reconcile', workspace: ready });
  assert.equal(s.pendingPool.size, 0); assert.equal(s.pendingCreated, null);
});

test('disconnecting a project with an active composer restores a valid fallback and rejects its late spawn', () => {
  const intent = {}; let s = step(initial(), { type: 'create.start', projectId: 'p1', intent });
  s = step(s, { type: 'project.enter', projectId: 'p2', expectedProjectId: 'p1', workspace: model(threads, ['p2']) });
  assert.equal(selectionFields(s.selection).opened, 'other'); assert.equal(s.selection.kind, 'working');
  assert.equal(step(s, { type: 'spawn.project', entry: { id: 'late', projectId: 'p1' }, intent }), s);
});
