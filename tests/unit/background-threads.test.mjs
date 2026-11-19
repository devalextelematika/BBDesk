import '../../scripts/test-loader.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thread, project } from '../helpers/factories.mjs';
const { reconcileThread, sidebarActivity, matchesBackground } = await import('../../state.ts');
const { createWorkspaceModel, selectProjectWorkspace, projectEntryThread } = await import('../../workspace-selectors.ts');
const { configSchema, catalogChangeSchema } = await import('../../contracts.ts');
const { changeCatalog } = await import('../../catalog-config.ts');
const rules = { enabled: true, substrings: ['worker', 'ПРОВЕРКА'], since: 1000 };
const config = { projects: [{ id: 'p1', enabled: true, connectedAt: 1 }], launcher: [], sharedPool: true, backgroundThreads: rules };
const row = changes => thread('bg', 'p1', 'Nightly WORKER', { createdAt: 1100, status: 'active', ...changes });
const model = (threads, tracked = [], opened = null) => createWorkspaceModel({ threads, projects: [project], config, tracked, drafts: new Set(['bg']), opened });
const view = m => selectProjectWorkspace(m, 'p1', undefined, { opened: m.current?.id ?? null, historyOpened: null, pendingCreated: null });

test('background matching is literal, case insensitive, any-line and limited to new threads', () => {
  assert.equal(matchesBackground(row(), rules), true);
  assert.equal(matchesBackground(row({ displayTitle: 'проверка сайта' }), rules), true);
  assert.equal(matchesBackground(row({ createdAt: 999 }), rules), false);
  assert.equal(matchesBackground(row({ createdAt: undefined }), rules), false);
  assert.equal(matchesBackground(row(), { ...rules, enabled: false }), false);
  assert.equal(matchesBackground(row(), { ...rules, substrings: ['.*', '  '] }), false);
});

test('working background thread has an indicator and count without a project tab or auto-selection', () => {
  const m = model([row()]);
  assert.equal(m.indicators.length, 1); assert.equal(m.runningCount, 1);
  assert.equal(view(m).rows.length, 0); assert.equal(projectEntryThread(m, 'p1'), undefined);
  assert.equal(view(model([row()], [], 'bg')).displayed.id, 'bg');
});

test('errors and interactions show background threads; retries stay visible until success, even after rename', () => {
  let tracked;
  for (const changes of [{}, { hasPendingInteraction: true }, { status: 'active' }, { status: 'error' }, { status: 'active', displayTitle: 'Renamed' }, { status: 'idle', displayTitle: 'Renamed', isUnread: true }]) {
    const t = row(changes);
    tracked = reconcileThread(tracked, sidebarActivity(t), 1, rules);
    const m = model([t], [tracked], 'bg');
    const finished = t.status === 'idle';
    assert.equal(view(m).rows.length, changes.hasPendingInteraction || t.status === 'error' || tracked.backgroundExposed ? 1 : 0);
    assert.equal(m.indicators.length, finished ? 0 : 1);
    if (finished) {
      assert.equal(m.current, undefined); assert.equal(view(m).history.length, 0);
      assert.equal(m.conversationsByProject.get('p1').size, 0);
      assert.equal(tracked.visible, false);
    }
  }
  const failedQueue = model([row({ status: 'idle', queuedWork: 'failed' })]);
  assert.equal(view(failedQueue).rows.length, 1);
});

test('old configs remain valid and rule edits preserve other settings and activation boundary', () => {
  const old = { projects: config.projects, launcher: [], sharedPool: false };
  assert.deepEqual(configSchema.parse(old), old);
  let saved = changeCatalog(old, { type: 'background', enabled: false, substrings: ['worker'] }, 500);
  saved = changeCatalog(saved, { type: 'background', enabled: true, substrings: ['worker', 'WORKER'] }, 1000);
  assert.equal(saved.backgroundThreads.since, 1000); assert.deepEqual(saved.backgroundThreads.substrings, ['WORKER']);
  saved = changeCatalog(saved, { type: 'background', enabled: true, substrings: ['job'] }, 2000);
  assert.equal(saved.backgroundThreads.since, 1000); assert.equal(saved.sharedPool, false);
  assert.equal(catalogChangeSchema.safeParse({ type: 'background', enabled: true, substrings: ['x'.repeat(201)] }).success, false);
  assert.equal(catalogChangeSchema.safeParse({ type: 'background', enabled: true, substrings: Array(101).fill('x') }).success, false);
});
