import '../../scripts/test-loader.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project, thread } from '../helpers/factories.mjs';
const { projectWorkspaceView, sharedPoolWorkspaceView } = await import('../../workspace-view-models.ts');
const { createWorkspaceModel, selectProjectWorkspace, selectPoolWorkspace } = await import('../../workspace-selectors.ts');
const tr = key => key;
const workspace = (threads, projects = [project]) => createWorkspaceModel({ threads, projects, config: { projects: [{ id: 'p1', enabled: true, connectedAt: 100 }], launcher: [], sharedPool: true }, tracked: [], drafts: new Set(), opened: null });
const view = (m, changes = {}) => projectWorkspaceView({ projectId: 'p1', project, selected: selectProjectWorkspace(m, 'p1', undefined, { opened: 'a', historyOpened: null, pendingCreated: null }), threadsById: m.byId, opened: 'a', historyOpened: null, creating: null, historyExpanded: false, compact: false, dragging: false, drafts: new Set(), workingIds: m.workingIds, poolIds: [], saving: false, ...changes }, tr);

test('project presentation preserves separate header and tab metadata fallbacks and draft status', () => {
  const m = workspace([thread('a', 'p1', 'Authored title', { hasPendingInteraction: true, environment: null, host: null })]);
  const result = view(m, { drafts: new Set(['a']) }); const pane = result.split.panes.get('a');
  assert.equal(pane.heading, 'Authored title ·  · actionNeeded');
  assert.equal(pane.draft, true); assert.equal(result.tabs[0].detail, 'environment');
  assert.equal(result.tabs[0].canHide, false); assert.equal(result.tabs[0].status, 'actionNeeded');
  assert.equal(result.showConversations, true); assert.equal(result.empty, false);
  const duplicates = workspace([thread('a', 'p1', 'First SDK match', { isHidden: true, status: 'error' }), thread('a', 'p1', 'Visible row')]);
  const distinct = view(duplicates);
  assert.equal(distinct.tabs[0].title, 'Visible row'); assert.equal(distinct.tabs[0].status, 'read');
  assert.equal(distinct.split.panes.get('a').title, 'First SDK match'); assert.equal(distinct.split.panes.get('a').state.tone, 'error');
});

test('pending creation and unavailable project presentation render one distinct state', () => {
  const m = workspace([]);
  const selected = selectProjectWorkspace(m, 'p1', undefined, { opened: 'new', historyOpened: null, pendingCreated: { projectId: 'p1', id: 'new' } });
  const pending = view(m, { opened: 'new', selected });
  assert.equal(pending.openingId, 'new'); assert.equal(pending.showConversations, false); assert.equal(pending.empty, false);
  const unavailable = view(m, { project: undefined });
  assert.equal(unavailable.project.name, 'projectUnavailable'); assert.equal(unavailable.project.available, false); assert.equal(unavailable.emptyMessage, 'projectAccessHelp');
});

test('pool presentation keeps pending, disconnected and draft rows with their original captions', () => {
  const m = workspace([thread('a', 'p1', 'Alpha'), thread('b', 'gone', 'Other')]);
  const source = selectPoolWorkspace(m, { entries: [{ projectId: 'p1', threadId: 'a' }, { projectId: 'p1', threadId: 'pending' }, { projectId: 'gone', threadId: 'b' }], active: 'a', sizes: {}, open: true }, new Map([['pending', 'p1']]), 'p1', tr);
  const result = sharedPoolWorkspaceView(source, { active: 'a', sizes: { a: 3 }, creating: false, saving: false, drafts: new Set(['a']) });
  assert.equal(result.rows.get('a').heading, 'Тестовый проект · Alpha · read');
  assert.equal(result.rows.get('a').draft, true); assert.equal(result.rows.get('pending').available, true);
  assert.equal(result.rows.get('b').available, false); assert.equal(result.rows.get('b').caption, 'projectUnavailable');
  assert.equal(result.activeId, 'a'); assert.deepEqual(result.ids, ['a', 'pending', 'b']);
});
