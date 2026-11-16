import { conversationItem, completionTooltip, statusOf, selectThreadTabs, type Thread, type WorkspaceModel, type selectProjectWorkspace, type selectPoolWorkspace } from "./workspace-selectors";
import type { SplitLayout } from "./split-layout";
import type { Translator } from "./i18n";

type Project = ReturnType<WorkspaceModel["projectsById"]["get"]>;
type ConversationPresentation = { id: string; title: string; state: ReturnType<typeof statusOf>; metadata: ReturnType<typeof conversationItem>; draft: boolean; heading: string };
export function projectWorkspaceView({ projectId, project, selected, threadsById, layout, opened, historyOpened, creating, historyExpanded, compact, dragging, drafts, workingIds, poolIds, saving }: {
  projectId: string; project: Project; selected: ReturnType<typeof selectProjectWorkspace>; layout?: SplitLayout;
  opened: string | null; historyOpened: string | null; creating: string | null; historyExpanded: boolean; compact: boolean; dragging: boolean;
  drafts: ReadonlySet<string>; workingIds: ReadonlySet<string>; poolIds: string[]; saving: boolean; threadsById: ReadonlyMap<string, Thread>;
}, tr: Translator) {
  const tabs = selectThreadTabs(selected.rows, workingIds, drafts, tr);
  const tabById = new Map(tabs.map(tab => [tab.id, tab]));
  const rowById = new Map<string, Thread>();
  for (const row of selected.rows) if (!rowById.has(row.id)) rowById.set(row.id, row);
  const presentation = new Map<Thread, ConversationPresentation>();
  function present(thread: Thread): ConversationPresentation {
    const cached = presentation.get(thread); if (cached) return cached;
    const tab = rowById.get(thread.id) === thread ? tabById.get(thread.id) : undefined, state = tab ? { text: tab.status, tone: tab.tone } : statusOf(thread, tr);
    const metadata = conversationItem(thread);
    const result = { id: thread.id, title: thread.displayTitle, state, metadata, draft: drafts.has(thread.id),
      heading: `${thread.displayTitle} · ${metadata.detail} · ${state.text}${completionTooltip(thread, tr) ? ` · ${completionTooltip(thread, tr)}` : ""}` };
    presentation.set(thread, result); return result;
  }
  const ids = selected.paneThreads.length ? selected.paneThreads.map(t => t.id) : selected.displayed ? [selected.displayed.id] : [];
  const panes = new Map(ids.map(id => [id, present(threadsById.get(id)!)]));
  return {
    project: { id: projectId, name: project?.name ?? tr("projectUnavailable"), available: !!project, href: project?.href },
    creating: creating === projectId, openingId: selected.openingCreated ? opened : null,
    showConversations: !creating && (!!selected.displayed || selected.paneThreads.length > 0),
    split: { ids, activeId: layout?.active ?? selected.displayed?.id ?? null, sizes: layout?.sizes ?? {}, paneIds: selected.paneThreads.map(t => t.id), panes },
    tabs, selectedId: selected.paneThreads.length ? layout!.active : historyOpened ?? opened, poolIds, saving,
    emptyMessage: !project ? "projectAccessHelp" as const : selected.hasSubagents ? "subagentsHelp" as const : selected.rows.length ? "selectThread" as const : "noThreads" as const,
    empty: !selected.displayed && !selected.paneThreads.length && !creating && !selected.openingCreated,
    history: { open: historyExpanded, selectedId: historyOpened, rows: selected.history.map(thread => ({ ...present(thread), pinned: poolIds.includes(thread.id) })) },
    compact, dragging,
  };
}
export type ProjectWorkspaceView = ReturnType<typeof projectWorkspaceView>;

export function sharedPoolWorkspaceView(pool: ReturnType<typeof selectPoolWorkspace>, { active, sizes, creating, saving, drafts }: {
  active: string; sizes: Record<string, number>; creating: boolean; saving: boolean; drafts: ReadonlySet<string>;
}) {
  const rows = pool.rows.map(row => ({ id: row.id, title: row.title, caption: row.caption, state: row.state, draft: !!row.thread && drafts.has(row.thread.id),
    heading: [row.caption, row.title, row.state?.text, row.completionDetail].filter(Boolean).join(" · "), available: row.projectConnected && !!(row.thread || row.pending) }));
  return { ids: rows.map(row => row.id), rows: new Map(rows.map(row => [row.id, row])), activeId: active || rows[0]?.id || null, selectedId: active || null,
    sizes, creating, saving, createProjectId: pool.createProjectId, tabs: pool.tabs };
}
export type SharedPoolWorkspaceView = ReturnType<typeof sharedPoolWorkspaceView>;
