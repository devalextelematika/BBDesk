import '../../scripts/test-loader.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project, secondProject, thread } from '../helpers/factories.mjs';
const { createWorkspaceState, workspaceTransition, selectionFields, sharedPoolComposer } = await import('../../workspace-transitions.ts');
const { createWorkspaceModel, selectActiveProject, selectSubagentManager, projectEntryThread } = await import('../../workspace-selectors.ts');
const { isFinishedSubagent, sidebarActivity } = await import('../../state.ts');

const projects = [project, secondProject];
const configFor = (ids, sharedPool = true) => ({ projects: ids.map(id => ({ id, enabled: true, connectedAt: 100 })), launcher: [], sharedPool });
// The model depends on the selection (an opened chat counts as working), so every render rebuilds it.
const modelFor = (state, rows, config) => createWorkspaceModel({ threads: rows, projects, config, tracked: [], drafts: new Set(), opened: selectionFields(state.selection).opened });
const syncEvent = (state, workspace, env) => ({ type: 'workspace.sync', workspace, liveReady: env.liveReady, dataReady: env.dataReady, poolEnabled: env.poolEnabled, selection: state.selection, projectId: state.projectId });

/** Simulates render → effect → render until a pass changes nothing. */
function settle(state, rows, env, pass = (s, workspace) => workspaceTransition(s, syncEvent(s, workspace, env))) {
  let s = state;
  for (let passes = 0; passes < 8; passes++) {
    const next = pass(s, modelFor(s, rows, env.config));
    if (next === s) return { state: s, passes };
    s = next;
  }
  assert.fail('workspace synchronization did not settle');
}

/** The previous page effects, in declaration order, each with its own render-time guards. */
function legacyPass(env) {
  return (render, workspace) => {
    const T = workspaceTransition;
    let s = render;
    const { opened, historyOpened, creating } = selectionFields(render.selection);
    const active = selectActiveProject(workspace, render.projectId);
    const current = workspace.current;
    const pending = render.pendingCreated;
    const entry = () => active ? projectEntryThread(workspace, active.id)?.id ?? null : null;
    if (pending && (current?.id === pending.id || workspace.conversationsByProject.get(pending.projectId)?.has(pending.id))) s = T(s, { type: 'pending.seen', entry: pending });
    if (env.liveReady && opened && (!current || isFinishedSubagent(sidebarActivity(current))) && !(pending?.id === opened && !current)) {
      const manager = current && selectSubagentManager(workspace, current);
      s = manager ? T(s, { type: 'selection.recover', projectId: manager.projectId, id: manager.id, history: !workspace.workingIds.has(manager.id), expectedSelection: render.selection })
        : T(s, { type: 'selection.recover', id: entry(), expectedSelection: render.selection });
    }
    if (env.liveReady && historyOpened && !(active && workspace.conversationsByProject.get(active.id)?.has(historyOpened)))
      s = T(s, { type: 'selection.recover', id: entry(), expectedSelection: render.selection });
    if (env.dataReady && env.liveReady) { s = T(s, { type: 'layouts.reconcile', workspace }); s = T(s, { type: 'pool.reconcile', workspace }); }
    if (!env.poolEnabled) s = T(s, { type: 'pool.disable' });
    if (env.dataReady && env.liveReady && active) {
      s = T(s, { type: 'project.enter', projectId: active.id, workspace, expectedProjectId: render.projectId });
      const id = historyOpened ?? opened;
      const choice = !creating && id && workspace.conversationsByProject.get(active.id)?.has(id) ? { id, history: !!historyOpened } : undefined;
      s = T(s, { type: 'memory.remember', projectId: active.id, choice, expectedSelection: render.selection });
    }
    return s;
  };
}

const rows = [
  thread('work', 'p1', 'Working', { status: 'active', createdAt: 5 }),
  thread('done', 'p1', 'Done', { latestAttentionAt: 150, createdAt: 4 }),
  thread('old', 'p1', 'Old', { latestAttentionAt: 50, createdAt: 3 }),
  thread('child', 'p1', 'Finished child', { parentThreadId: 'work', createdAt: 2 }),
  thread('busy-child', 'p1', 'Busy child', { parentThreadId: 'work', status: 'active', createdAt: 1 }),
  thread('hidden', 'p1', 'Hidden', { isHidden: true }),
  thread('archived', 'p1', 'Archived', { isArchived: true }),
  thread('other', 'p2', 'Other', { status: 'active' }),
];
const ids = ['work', 'done', 'old', 'child', 'busy-child', 'hidden', 'archived', 'other', 'missing'];
const selections = [
  { kind: 'none' },
  ...ids.flatMap(id => [{ kind: 'working', id }, { kind: 'history', id }]),
  { kind: 'project-composer', projectId: 'p1' }, { kind: 'project-composer', projectId: 'p2' },
  { kind: 'pool-composer', underneath: { kind: 'none' } }, { kind: 'pool-composer', underneath: { kind: 'working', id: 'child' } },
];
const pools = [
  { entries: [], active: '', sizes: {}, open: false },
  { entries: [{ projectId: 'p1', threadId: 'done' }, { projectId: 'p1', threadId: 'hidden' }, { projectId: 'p2', threadId: 'other' }], active: 'hidden', sizes: { done: 1, hidden: 2, other: 1 }, open: true },
];
const layouts = [{}, { p1: { ids: ['work', 'archived', 'done'], active: 'archived', sizes: {} } }];

function* scenarios() {
  for (const selection of selections) for (const projectId of ['p1', 'p2', null, 'gone']) for (const pool of pools) for (const layout of layouts)
    for (const pending of [null, { id: 'missing', projectId: 'p1' }, { id: 'done', projectId: 'p1' }])
      for (const env of [
        { liveReady: true, dataReady: true, poolEnabled: true, config: configFor(['p1', 'p2']) },
        { liveReady: true, dataReady: true, poolEnabled: false, config: configFor(['p1', 'p2'], false) },
        { liveReady: true, dataReady: true, poolEnabled: true, config: configFor(['p1']) },
        { liveReady: false, dataReady: true, poolEnabled: true, config: configFor(['p1', 'p2']) },
        { liveReady: true, dataReady: false, poolEnabled: true, config: undefined },
      ]) {
        const state = { ...createWorkspaceState({ projectId, conversations: { p1: { id: 'old', history: true } } }, structuredClone(layout), structuredClone(pool)),
          selection, pendingCreated: pending, creation: selection.kind.endsWith('composer') ? { id: 1, projectId: selection.kind === 'pool-composer' ? sharedPoolComposer : selection.projectId } : null };
        yield { state, env, label: JSON.stringify({ selection, projectId, pool: pool.open, layout: Object.keys(layout).length, pending: pending?.id, env: { ...env, config: env.config?.projects.map(p => p.id) } }) };
      }
}

test('synchronization settles within three passes and then returns the same state object for every scenario', () => {
  let count = 0;
  for (const { state, env, label } of scenarios()) {
    const { state: settled, passes } = settle(state, rows, env);
    assert.ok(passes <= 3, `${label} took ${passes} passes`);
    const again = workspaceTransition(settled, syncEvent(settled, modelFor(settled, rows, env.config), env));
    assert.equal(again, settled, `${label} is not a fixpoint`);
    count++;
  }
  assert.ok(count > 1000);
});

test('synchronization reaches the same state as the previous separate page effects', () => {
  for (const { state, env, label } of scenarios()) {
    const current = settle(state, rows, env).state;
    const legacy = settle(state, rows, env, legacyPass(env)).state;
    assert.deepEqual(current, legacy, label);
  }
});

test('a finished subagent returns to its manager and a vanished history chat to the project entry', () => {
  const env = { liveReady: true, dataReady: true, poolEnabled: true, config: configFor(['p1', 'p2']) };
  const base = createWorkspaceState({ projectId: 'p1', conversations: {} }, {}, pools[0]);
  assert.deepEqual(settle({ ...base, selection: { kind: 'working', id: 'child' } }, rows, env).state.selection, { kind: 'working', id: 'work' });
  assert.deepEqual(settle({ ...base, selection: { kind: 'history', id: 'hidden' } }, rows, env).state.selection, { kind: 'working', id: 'work' });
  // A created thread missing from the live view stays selected until it arrives.
  const created = { ...base, enteredProjectId: 'p1', selection: { kind: 'working', id: 'new' }, pendingCreated: { id: 'new', projectId: 'p1' } };
  const waiting = settle(created, rows, env).state;
  assert.deepEqual(waiting.selection, { kind: 'working', id: 'new' }); assert.ok(waiting.pendingCreated);
  const arrived = settle(waiting, [...rows, thread('new', 'p1', 'New', { status: 'active' })], env).state;
  assert.deepEqual(arrived.selection, { kind: 'working', id: 'new' }); assert.equal(arrived.pendingCreated, null);
});

test('a pass rendered for an older selection leaves selection-dependent steps to the next render', () => {
  const env = { liveReady: true, dataReady: true, poolEnabled: true, config: configFor(['p1', 'p2']) };
  const rendered = { ...createWorkspaceState({ projectId: 'p1', conversations: {} }, {}, pools[0]), selection: { kind: 'working', id: 'child' } };
  const workspace = modelFor(rendered, rows, env.config);
  // A user action replaced the selection after the render that built this model.
  const moved = { ...rendered, selection: { kind: 'history', id: 'old' } };
  const result = workspaceTransition(moved, syncEvent(rendered, workspace, env));
  assert.equal(result.selection, moved.selection);
  assert.equal(result.enteredProjectId, moved.enteredProjectId);
  assert.equal(result.memory, moved.memory);
});
