import type { ConversationChoice } from "./workspace-memory";
import { addPoolEntry, removePoolEntry, movePoolEntry, selectSplitThread, type PoolEntry, type SharedPool, type SplitLayouts, type SplitLayout } from "./split-layout";
import { conversationThread, selectProjectConversation, compareThreadCreation, type WorkspaceModel } from "./workspace-selectors";
import { isSubagent } from "./state";
import type { MessageKey } from "./i18n";
import type { readWorkspaceMemory } from "./workspace-memory";

export const sharedPoolComposer = "shared-pool";
export type ConversationSelection = { kind: "none" } | { kind: "working" | "history"; id: string };
export type WorkspaceSelection = ConversationSelection
  | { kind: "project-composer"; projectId: string }
  | { kind: "pool-composer"; underneath: ConversationSelection };
export type CreatedThread = { id: string; projectId: string };
export interface WorkspaceState {
  selection: WorkspaceSelection;
  projectId: string | null;
  enteredProjectId: string | null;
  pendingCreated: CreatedThread | null;
  creation: { intent: object; projectId: string } | null;
  layouts: SplitLayouts;
  pool: SharedPool;
  memory: ReturnType<typeof readWorkspaceMemory>;
  notice: MessageKey | "";
  poolLimitNotice: boolean;
  unplaced: (PoolEntry & { title: string; reason: "limit" | "invalid" | "removed" })[];
  pendingPool: ReadonlyMap<string, string>;
  poolRequests: ReadonlyMap<object, ReadonlySet<string>>;
}
export function createWorkspaceState(memory: WorkspaceState["memory"], layouts: SplitLayouts, pool: SharedPool): WorkspaceState {
  return { memory, layouts, pool, projectId: memory.projectId, enteredProjectId: null, selection: { kind: "none" }, pendingCreated: null, creation: null,
    notice: "", poolLimitNotice: false, unplaced: [], pendingPool: new Map(), poolRequests: new Map() };
}
export type WorkspaceEvent =
  | { type: "project.select"; projectId: string; workspace: WorkspaceModel }
  | { type: "project.enter"; projectId: string; workspace: WorkspaceModel; expectedProjectId: string | null }
  | { type: "project.retain"; projectId: string | null }
  | { type: "conversation.open"; projectId: string; id: string; history: boolean; enter?: boolean }
  | { type: "conversation.toggle"; id: string }
  | { type: "selection.recover"; id: string | null; projectId?: string; history?: boolean; expectedSelection?: WorkspaceSelection }
  | { type: "created.open"; entry: CreatedThread }
  | { type: "create.start"; projectId: string; intent: object }
  | { type: "create.close" }
  | { type: "pool.show" }
  | { type: "spawn.project"; entry: CreatedThread; intent: object | null }
  | { type: "spawn.pool"; entry: CreatedThread; intent: object | null; operation: object; title: string }
  | { type: "pending.seen"; entry: CreatedThread }
  | { type: "pane.add"; projectId: string; id: string; history: boolean; target?: string; after: boolean }
  | { type: "pane.remove"; projectId: string; id: string; workspace: WorkspaceModel }
  | { type: "pane.resize"; projectId: string; sizes: Record<string, number> }
  | { type: "layouts.reconcile"; workspace: WorkspaceModel }
  | { type: "pool.reconcile"; workspace: WorkspaceModel }
  | { type: "pool.disable" }
  | { type: "pool.pin"; entry: PoolEntry; target?: string; after: boolean }
  | { type: "pool.remove" | "pool.activate"; id: string }
  | { type: "pool.move"; id: string; targetId: string; after: boolean }
  | { type: "pool.resize"; sizes: Record<string, number> }
  | { type: "pool.request" | "pool.failed"; operation: object }
  | { type: "pool.limit" }
  | { type: "thread.hidden"; entry: CreatedThread; workspace: WorkspaceModel }
  | { type: "memory.remember"; projectId: string; choice?: ConversationChoice; expectedSelection: WorkspaceSelection }
  | { type: "notice"; value: MessageKey | "" };

export function selectionFields(selection: WorkspaceSelection): { opened: string | null; historyOpened: string | null; creating: string | null } {
  if (selection.kind === "project-composer") return { opened: null, historyOpened: null, creating: selection.projectId };
  if (selection.kind === "pool-composer") return { ...selectionFields(selection.underneath), creating: sharedPoolComposer };
  return { opened: selection.kind === "working" ? selection.id : null, historyOpened: selection.kind === "history" ? selection.id : null, creating: null };
}
function withoutComposer(selection: WorkspaceSelection): ConversationSelection {
  return selection.kind === "project-composer" ? { kind: "none" } : selection.kind === "pool-composer" ? selection.underneath : selection;
}
function choiceSelection(choice: ConversationChoice | null): ConversationSelection {
  return choice ? { kind: choice.history ? "history" : "working", id: choice.id } : { kind: "none" };
}
function poolOpen(pool: SharedPool, open: boolean) { return pool.open === open ? pool : { ...pool, open }; }
function restoredChoice(state: WorkspaceState, projectId: string, workspace: WorkspaceModel): ConversationSelection {
  const choice = selectProjectConversation(workspace, projectId, state.layouts[projectId], state.memory.conversations);
  return choiceSelection(choice.historyOpened ? { id: choice.historyOpened, history: true } : choice.opened ? { id: choice.opened, history: false } : null);
}
function selectPane(layouts: SplitLayouts, projectId: string, id: string): SplitLayouts {
  return layouts[projectId] ? { ...layouts, [projectId]: selectSplitThread(layouts[projectId], id) } : layouts;
}
/** Pane close uses its chronological neighbor; hide keeps the first remaining column. */
function removePane(layout: SplitLayout, id: string, replacement: "neighbor" | "first"): SplitLayout {
  const ids = layout.ids.filter(value => value !== id);
  const next = replacement === "first" ? ids[0] : ids[Math.min(layout.ids.indexOf(id), ids.length - 1)];
  return { ...layout, ids, active: layout.active === id ? next ?? "" : layout.active };
}
function openConversation(state: WorkspaceState, event: { projectId: string; id: string; history: boolean; enter?: boolean }): WorkspaceState {
  return { ...state, creation: null, selection: { kind: event.history ? "history" : "working", id: event.id }, pendingCreated: null,
    projectId: event.enter ? event.projectId : state.projectId, enteredProjectId: event.enter ? event.projectId : state.enteredProjectId,
    pool: poolOpen(state.pool, false),
    layouts: selectPane(state.layouts, event.projectId, event.id), notice: event.history ? state.notice : "" };
}
export function workspaceTransition(state: WorkspaceState, event: WorkspaceEvent): WorkspaceState {
  switch (event.type) {
    case "project.select": return { ...state, creation: null, projectId: event.projectId, enteredProjectId: event.projectId, pendingCreated: null, selection: restoredChoice(state, event.projectId, event.workspace), pool: poolOpen(state.pool, false), notice: "" };
    case "project.enter": {
      if (state.projectId !== event.expectedProjectId) return state;
      if (state.projectId === event.projectId && state.enteredProjectId === event.projectId) return state;
      let selection = state.selection;
      if (state.enteredProjectId !== event.projectId && !(selection.kind === "project-composer" && selection.projectId === event.projectId)) {
        const choice = restoredChoice(state, event.projectId, event.workspace);
        selection = selection.kind === "pool-composer" ? { ...selection, underneath: choice } : choice;
      }
      const cancelled = state.creation && state.creation.projectId !== sharedPoolComposer && state.creation.projectId !== event.projectId;
      return { ...state, projectId: event.projectId, enteredProjectId: event.projectId, selection, creation: cancelled ? null : state.creation };
    }
    case "project.retain": return state.projectId !== null || event.projectId === null ? state : { ...state, projectId: event.projectId };
    case "conversation.open": return openConversation(state, event);
    case "conversation.toggle": {
      const layouts = { ...state.layouts }; if (state.projectId) delete layouts[state.projectId];
      return { ...state, creation: null, layouts, pendingCreated: null, selection: selectionFields(state.selection).opened === event.id ? { kind: "none" } : { kind: "working", id: event.id } };
    }
    case "selection.recover": {
      if (event.expectedSelection && state.selection !== event.expectedSelection) return state;
      const choice: ConversationSelection = event.id ? { kind: event.history ? "history" : "working", id: event.id } : { kind: "none" };
      return { ...state, selection: state.selection.kind === "pool-composer" ? { ...state.selection, underneath: choice } : choice,
        projectId: event.projectId ?? state.projectId, enteredProjectId: event.projectId ?? state.enteredProjectId };
    }
    case "create.start": {
      if (event.projectId === sharedPoolComposer) {
        const previous = withoutComposer(state.selection);
        return { ...state, creation: { intent: event.intent, projectId: event.projectId }, notice: "", pool: poolOpen(state.pool, true), pendingCreated: null, selection: { kind: "pool-composer", underneath: previous.kind === "working" ? previous : { kind: "none" } } };
      }
      return { ...state, creation: { intent: event.intent, projectId: event.projectId }, notice: "", pool: poolOpen(state.pool, false), projectId: event.projectId, pendingCreated: null, selection: { kind: "project-composer", projectId: event.projectId } };
    }
    case "create.close": {
      const selection = withoutComposer(state.selection);
      return selection === state.selection && !state.creation ? state : { ...state, selection, creation: null };
    }
    case "pool.show": {
      const pool = poolOpen(state.pool, true), selection = withoutComposer(state.selection);
      return pool === state.pool && selection === state.selection && !state.creation ? state : { ...state, pool, selection, creation: null };
    }
    case "created.open": return { ...state, creation: null, projectId: event.entry.projectId, enteredProjectId: event.entry.projectId, pendingCreated: event.entry, selection: { kind: "working", id: event.entry.id },
      pool: poolOpen(state.pool, false), layouts: selectPane(state.layouts, event.entry.projectId, event.entry.id), notice: "threadCreated", unplaced: state.unplaced.filter(item => item.threadId !== event.entry.id) };
    case "spawn.project": return (state.creation?.intent ?? null) !== event.intent ? state : { ...state, pendingCreated: event.entry, enteredProjectId: event.entry.projectId, selection: { kind: "working", id: event.entry.id }, layouts: selectPane(state.layouts, event.entry.projectId, event.entry.id), notice: "threadCreated" };
    case "spawn.pool": {
      const poolRequests = new Map(state.poolRequests); const removed = poolRequests.get(event.operation)?.has(event.entry.id); poolRequests.delete(event.operation);
      const show = (state.creation?.intent ?? null) === event.intent;
      const result = removed ? { pool: state.pool, status: "removed" as const } : addPoolEntry(state.pool, { projectId: event.entry.projectId, threadId: event.entry.id });
      if (result.status === "added" || result.status === "present") {
        const pendingPool = new Map(state.pendingPool); pendingPool.set(event.entry.id, event.entry.projectId);
        return { ...state, poolRequests, pendingPool, poolLimitNotice: false,
          pool: show ? { ...result.pool, open: true } : { ...result.pool, active: state.pool.active || result.pool.active },
          ...(show ? { selection: withoutComposer(state.selection), pendingCreated: event.entry, notice: "threadCreated" as const } : {}) };
      }
      return { ...state, poolRequests, unplaced: [...state.unplaced, { projectId: event.entry.projectId, threadId: event.entry.id, title: event.title, reason: result.status }],
        ...(show ? { selection: withoutComposer(state.selection), notice: "" as const } : {}) };
    }
    case "pending.seen": return state.pendingCreated === event.entry ? { ...state, pendingCreated: null } : state;
    case "pane.add": {
      const fields = selectionFields(state.selection), currentId = fields.historyOpened ?? fields.opened;
      const layout = state.layouts[event.projectId] ?? { ids: currentId ? [currentId] : [], active: currentId ?? event.id, sizes: {} };
      let next = { ...layout, active: event.id };
      if (!layout.ids.includes(event.id)) {
        const ids = [...layout.ids], index = ids.indexOf(event.target ?? layout.active);
        ids.splice(index < 0 ? ids.length : index + Number(event.after), 0, event.id); next = { ids, active: event.id, sizes: {} };
      }
      return { ...state, creation: null, layouts: { ...state.layouts, [event.projectId]: next }, selection: { kind: event.history ? "history" : "working", id: event.id }, enteredProjectId: event.projectId, pendingCreated: null };
    }
    case "pane.remove": {
      const layout = state.layouts[event.projectId]; if (!layout) return state;
      const next = removePane(layout, event.id, "neighbor"); const thread = event.workspace.byId.get(next.active);
      const selected = thread ? openConversation(state, { projectId: thread.projectId, id: thread.id, history: !event.workspace.workingIds.has(thread.id), enter: event.workspace.workingIds.has(thread.id) }) : state;
      return { ...selected, layouts: { ...selected.layouts, [event.projectId]: next } };
    }
    case "pane.resize": return state.layouts[event.projectId] ? { ...state, layouts: { ...state.layouts, [event.projectId]: { ...state.layouts[event.projectId], sizes: event.sizes } } } : state;
    case "layouts.reconcile": {
      let changed = false; const layouts: SplitLayouts = {};
      for (const [projectId, layout] of Object.entries(state.layouts)) {
        const ids = layout.ids.filter(id => state.pendingCreated?.id === id && state.pendingCreated.projectId === projectId || event.workspace.conversationsByProject.get(projectId)?.has(id));
        if (ids.length === layout.ids.length) { layouts[projectId] = layout; continue; }
        changed = true; if (ids.length) layouts[projectId] = { ...layout, ids, active: ids.includes(layout.active) ? layout.active : ids[0]! };
      }
      return changed ? { ...state, layouts } : state;
    }
    case "pool.reconcile": {
      const pendingPool = new Map(state.pendingPool);
      for (const [id, projectId] of pendingPool) if (!state.pool.entries.some(entry => entry.threadId === id && entry.projectId === projectId) || event.workspace.threadsByProjectId.get(projectId)?.has(id)) pendingPool.delete(id);
      const entries = state.pool.entries.filter(entry => {
        if (pendingPool.get(entry.threadId) === entry.projectId || !event.workspace.connectedById.has(entry.projectId)) return true;
        const thread = event.workspace.threadsByProjectId.get(entry.projectId)?.get(entry.threadId);
        return !!thread && conversationThread(thread);
      });
      if (entries.length === state.pool.entries.length) return pendingPool.size === state.pendingPool.size ? state : { ...state, pendingPool };
      const ids = new Set(entries.map(entry => entry.threadId));
      return { ...state, pendingPool, pool: { ...state.pool, entries, active: ids.has(state.pool.active) ? state.pool.active : entries[0]?.threadId ?? "", sizes: Object.fromEntries(Object.entries(state.pool.sizes).filter(([id]) => ids.has(id))) } };
    }
    case "pool.disable": return !state.pool.open && state.selection.kind !== "pool-composer" && state.creation?.projectId !== sharedPoolComposer ? state : { ...state, pool: poolOpen(state.pool, false), selection: state.selection.kind === "pool-composer" ? state.selection.underneath : state.selection, creation: state.creation?.projectId === sharedPoolComposer ? null : state.creation };
    case "pool.pin": {
      const result = addPoolEntry(state.pool, event.entry, event.target, event.after);
      const poolLimitNotice = result.status === "limit";
      return result.pool === state.pool && poolLimitNotice === state.poolLimitNotice ? state : { ...state, poolLimitNotice, pool: result.pool };
    }
    case "pool.remove": {
      const pendingPool = new Map(state.pendingPool); pendingPool.delete(event.id);
      const poolRequests = new Map([...state.poolRequests].map(([operation, removed]) => [operation, new Set([...removed, event.id])]));
      return { ...state, pendingPool, poolRequests, pool: removePoolEntry(state.pool, event.id) };
    }
    case "pool.activate": return state.pool.active === event.id ? state : { ...state, pool: { ...state.pool, active: event.id } };
    case "pool.move": { const pool = movePoolEntry(state.pool, event.id, event.targetId, event.after); return pool === state.pool ? state : { ...state, pool }; }
    case "pool.resize": return { ...state, pool: { ...state.pool, sizes: event.sizes } };
    case "pool.request": { const poolRequests = new Map(state.poolRequests); poolRequests.set(event.operation, new Set()); return { ...state, poolRequests }; }
    case "pool.failed": { const poolRequests = new Map(state.poolRequests); poolRequests.delete(event.operation); return { ...state, poolRequests }; }
    case "pool.limit": return { ...state, poolLimitNotice: true };
    case "thread.hidden": {
      const { projectId, id } = event.entry; const layout = state.layouts[projectId];
      const remaining = layout?.ids.filter(value => value !== id) ?? [];
      const layouts = layout?.ids.includes(id) ? { ...state.layouts, [projectId]: removePane(layout, id, "first") } : state.layouts;
      const threads = (event.workspace.workingByProject.get(projectId) ?? []).filter(t => !isSubagent(t)).sort(compareThreadCreation);
      const index = threads.findIndex(t => t.id === id), next = threads[index + 1] ?? threads[index - 1];
      const fields = selectionFields(state.selection); let selection = state.selection;
      const activeProjectId = state.projectId ?? event.workspace.connected[0]?.id;
      if (activeProjectId === projectId && !state.pool.open && !fields.creating && (fields.historyOpened ?? fields.opened) === id) {
        if (layout?.active === id && remaining.length) selection = { kind: event.workspace.workingIds.has(remaining[0]!) ? "working" : "history", id: remaining[0]! };
        else if (fields.opened === id) selection = next ? { kind: "working", id: next.id } : { kind: "none" };
      }
      let memory = state.memory;
      if (memory.conversations[projectId]?.id === id) { const conversations = { ...memory.conversations }; delete conversations[projectId]; memory = { ...memory, conversations }; }
      return { ...state, layouts, selection, memory };
    }
    case "memory.remember": {
      if (state.projectId !== event.projectId || state.selection !== event.expectedSelection) return state;
      const previous = state.memory.conversations[event.projectId];
      if (state.memory.projectId === event.projectId && (!event.choice || previous?.id === event.choice.id && previous.history === event.choice.history)) return state;
      return { ...state, memory: { projectId: event.projectId, conversations: event.choice ? { ...state.memory.conversations, [event.projectId]: event.choice } : state.memory.conversations } };
    }
    case "notice": return state.notice === event.value ? state : { ...state, notice: event.value };
  }
}
