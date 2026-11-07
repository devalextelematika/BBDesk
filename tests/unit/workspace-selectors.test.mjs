import '../../scripts/test-loader.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thread, project, secondProject } from '../helpers/factories.mjs';
const { createWorkspaceModel, projectEntryThread, threadState, needsAttention, selectProjectTabs, selectThreadTabs, selectProjectWorkspace, selectProjectConversation, selectPoolWorkspace, conversationItem } = await import('../../workspace-selectors.ts');
const { sidebarActivity, serverActivity, isWorking, hasWork, isFinishedSubagent } = await import('../../state.ts');
const tr = key => key;
const config = { projects: [{ id: 'p1', enabled: true, connectedAt: 100 }], launcher: [], sharedPool: true };
const model = (threads, changes = {}) => createWorkspaceModel({ threads, projects: [project, secondProject], config, tracked: [], drafts: new Set(), opened: null, ...changes });
const ids = rows => rows.map(row => row.id);
const row = (id, changes = {}) => thread(id, 'p1', id, changes);

test('workspace inclusion preserves tombstones, work, drafts, opened chats and lifecycle exclusions', () => {
  const threads = [row('old', { latestAttentionAt: 100 }), row('new'), row('hidden'), row('revived', { latestAttentionAt: 201 }),
    row('working', { status: 'active', latestAttentionAt: 1 }), row('draft', { latestAttentionAt: 1 }), row('opened', { latestAttentionAt: 1 }),
    row('archived', { isArchived: true, status: 'active' }), row('native-hidden', { isHidden: true, status: 'active' }),
    row('child-done', { parentThreadId: 'working' }), row('child-error', { parentThreadId: 'working', status: 'error' }),
    row('fork', { parentThreadId: 'working', originKind: 'fork' }), thread('foreign', 'p2', 'Foreign', { status: 'active' })];
  const tracked = ['hidden', 'revived', 'working'].map(id => ({ id, projectId: 'p1', visible: false, latestAttentionAt: 200, hiddenAttentionAt: 200 }));
  tracked.push({ id: 'child-done', projectId: 'p1', visible: true, latestAttentionAt: 150, hiddenAttentionAt: 0 });
  const m = model(threads, { tracked, drafts: new Set(['draft']), opened: 'opened' });
  assert.deepEqual(ids(m.allThreads), ['new', 'revived', 'working', 'draft', 'opened', 'child-error', 'fork']);
  assert.equal(m.trackedById.get('hidden').hiddenAttentionAt, 200);
  assert.equal(m.current.id, 'opened');
});

test('sidebar and server activity adapters feed the same domain rules without mixing SDK field names', () => {
  const base = row('work', { status: 'idle', runtimeStatus: 'waiting-for-host', parentThreadId: 'manager' });
  const sidebar = sidebarActivity({ ...base, activity: { backgroundAgents: 2, backgroundCommands: 3, workflows: 4 } });
  const server = serverActivity({ ...base, runtimeStatus: 'idle', runtime: { displayStatus: 'waiting-for-host' }, activity: { activeBackgroundAgentCount: 2, activeBackgroundCommandCount: 3, activeWorkflowCount: 4 } });
  for (const field of ['runtimeStatus', 'backgroundAgents', 'backgroundCommands', 'workflows']) assert.equal(sidebar[field], server[field]);
  for (const activity of [sidebar, server]) {
    assert.equal(isWorking(activity), true); assert.equal(hasWork(activity), true); assert.equal(isFinishedSubagent(activity), false);
  }
  const quiet = serverActivity({ ...base, runtime: { displayStatus: 'idle' }, activity: { activeBackgroundAgentCount: 0, activeBackgroundCommandCount: 0, activeWorkflowCount: 0 } });
  assert.equal(isFinishedSubagent(quiet), true);
});

test('status priority and unread attention keep interaction, failures, runtime, queue and subagent distinctions', () => {
  const cases = [
    [{ hasPendingInteraction: true, status: 'error' }, 'actionNeeded', 'attention'],
    [{ queuedWork: 'failed', runtimeStatus: 'provisioning' }, 'error', 'error'],
    [{ status: 'active', runtimeStatus: 'waiting-for-host' }, 'waitingHost', 'waiting'],
    [{ runtimeStatus: 'provisioning' }, 'provisioning', 'running'],
    [{ status: 'pending' }, 'pending', 'waiting'], [{ status: 'starting' }, 'starting', 'running'], [{ status: 'stopping' }, 'stopping', 'running'],
    [{ status: 'active', parentThreadId: 'manager' }, 'subagentWorking', 'running'], [{ status: 'active' }, 'working', 'running'],
    [{ queuedWork: 'waiting', isUnread: true }, 'queued', 'waiting'], [{ isUnread: true, status: 'other' }, 'newReply', 'result'],
    [{ status: 'other' }, 'unknownState', 'unknown'], [{}, 'read', 'read'],
  ];
  for (const [changes, message, tone] of cases) assert.deepEqual(threadState(row('t', changes)), { message, tone });
  assert.equal(needsAttention(row('t', { status: 'active', isUnread: true })), false);
  assert.equal(needsAttention(row('t', { isUnread: true })), true);
});

test('project entry priority and ties remain independent of tab chronology and translated labels', () => {
  const attention = row('attention', { hasPendingInteraction: true, latestAttentionAt: 101 });
  const reply = row('reply', { isUnread: true, latestAttentionAt: 102 });
  const work = row('work', { status: 'active', latestAttentionAt: 103 });
  const failure = row('failure', { status: 'error', latestAttentionAt: 999 });
  for (const [threads, expected] of [[[failure, work, reply, attention], 'attention'], [[failure, work, reply], 'reply'], [[failure, work], 'work'], [[failure, row('read')], 'failure'], [[row('b'), row('a')], 'a']]) {
    assert.equal(projectEntryThread(model(threads), 'p1').id, expected);
  }
  assert.equal(projectEntryThread(model([row('child', { hasPendingInteraction: true, parentThreadId: 'm' })]), 'p1'), undefined);
});

test('project rows, historical columns and history preserve separate inclusion, ordering and pending creation', () => {
  const history = Array.from({ length: 12 }, (_, i) => row(`h${i}`, { latestAttentionAt: 50, createdAt: i }));
  const m = model([...history, row('active', { createdAt: 1 }), row('other', { createdAt: 2 }), row('child', { parentThreadId: 'active', status: 'active' })]);
  const view = selectProjectWorkspace(m, 'p1', { ids: ['active', 'h0', 'gone', 'child'], active: 'h0', sizes: {} }, { opened: null, historyOpened: 'h0', pendingCreated: null });
  assert.deepEqual(ids(view.paneThreads), ['active', 'h0']);
  assert.deepEqual(ids(view.rows), ['other', 'active', 'h0']);
  assert.equal(view.displayed.id, 'h0'); assert.equal(view.hasSubagents, true);
  assert.deepEqual(ids(view.history), ['h11', 'h10', 'h9', 'h8', 'h7', 'h6', 'h5', 'h4', 'h3', 'h2']);
  const opening = selectProjectWorkspace(model([], { opened: 'created' }), 'p1', undefined, { opened: 'created', historyOpened: null, pendingCreated: { id: 'created', projectId: 'p1' } });
  assert.equal(opening.openingCreated, true); assert.equal(opening.displayed, undefined);
  const tabs = selectThreadTabs(view.rows, m.workingIds, new Set(['active']), tr);
  assert.deepEqual(tabs.map(t => [t.id, t.canHide]), [['other', true], ['active', false], ['h0', false]]);
});

test('remembered conversation respects saved split, historical eligibility and unavailable fallbacks', () => {
  const m = model([row('active'), row('old', { latestAttentionAt: 20 }), row('child', { parentThreadId: 'active', status: 'active' })]);
  const saved = { p1: { id: 'old', history: true } };
  assert.deepEqual(selectProjectConversation(m, 'p1', undefined, saved), { historyOpened: 'old', opened: null });
  assert.deepEqual(selectProjectConversation(m, 'p1', { ids: ['active'], active: 'active', sizes: {} }, saved), { historyOpened: null, opened: 'active' });
  assert.deepEqual(selectProjectConversation(m, 'p1', { ids: ['gone'], active: 'gone', sizes: {} }, saved), { historyOpened: 'old', opened: null });
  assert.deepEqual(selectProjectConversation(m, 'p1', undefined, { p1: { id: 'old', history: false } }), { historyOpened: null, opened: 'active' });
});

test('project and pool models preserve captions, counts, pending threads and disconnected project pins', () => {
  const projects = [project, { ...secondProject, isPersonal: true }];
  const m = model([row('active', { status: 'active', queuedWork: 'waiting' }), thread('disconnected', 'p2', 'Home')], { projects });
  assert.deepEqual(selectProjectTabs(m, tr).map(p => [p.id, p.running, p.attention, p.queued, p.total]), [['p1', 1, 0, 1, 1]]);
  const entries = [{ projectId: 'p1', threadId: 'pending' }, { projectId: 'p2', threadId: 'disconnected' }, { projectId: 'missing', threadId: 'missing-thread' }];
  const pool = selectPoolWorkspace(m, { entries, active: 'disconnected', sizes: {}, open: true }, new Map([['pending', 'p1']]), 'p1', tr);
  assert.deepEqual(pool.rows.map(r => [r.id, r.pending, r.projectConnected, r.caption]), [['pending', true, true, project.name], ['disconnected', false, false, 'commonThreads'], ['missing-thread', false, false, 'projectUnavailable']]);
  assert.equal(pool.rows[0].title, 'openingThread'); assert.equal(pool.createProjectId, 'p2');
  assert.ok(pool.tabs.every(t => !t.canHide));
  assert.deepEqual(conversationItem(row('detail', { latestAttentionAt: 0, createdAt: 42, environment: { branchName: 'branch' } })), { id: 'detail', title: 'detail', detail: 'branch', updatedAt: 42 });
});

test('workspace indices rebuild from in-place updates and preserve first matches and duplicate tombstones', () => {
  const threads = [row('t')];
  const tracked = [{ id: 't', projectId: 'p1', visible: false, hiddenAttentionAt: 200, latestAttentionAt: 150 }, { id: 't', projectId: 'p1', visible: false, hiddenAttentionAt: 100, latestAttentionAt: 150 }];
  assert.deepEqual(ids(model(threads, { tracked }).allThreads), []);
  tracked[1].visible = true;
  assert.deepEqual(ids(model(threads, { tracked }).allThreads), ['t']);
  threads[0].isHidden = true; threads.push(row('t', { displayTitle: 'Visible duplicate' }), row('new'));
  const updated = model(threads, { opened: 't' });
  assert.equal(updated.byId.get('t').isHidden, true);
  assert.equal(updated.current.displayTitle, 'Visible duplicate');
  assert.equal(updated.conversationsByProject.get('p1').get('t').displayTitle, 'Visible duplicate');
  assert.deepEqual(ids(updated.allThreads), ['t', 'new']);
});
