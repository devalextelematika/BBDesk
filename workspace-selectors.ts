import type { experimental_useSidebarThreads } from "@get-bb/plugin-sdk/app";
import type { DashboardConfig } from "./contracts";
import type { Translator, MessageKey } from "./i18n";
import type { ConversationItem } from "./conversation-list";
import type { ThreadTab } from "./thread-tabs";
import type { SharedPool, SplitLayout } from "./split-layout";
import type { ConversationChoice } from "./workspace-memory";
import { hasWork, isWorking, isSubagent, isFinishedSubagent, sidebarActivity, type TrackedThread } from "./state";
import type { Completion } from "./thread-completion";

type Live = ReturnType<typeof experimental_useSidebarThreads>;
export type Thread = Live["threads"][number] & { completion?: Completion };
type PendingCreated = { id: string; projectId: string } | null;
export const visibleThread = (t: Thread) => !t.isHidden && !t.isArchived;
export const conversationThread = (t: Thread) => visibleThread(t) && !isSubagent(t);
export const needsAttention = (t: Thread) => t.hasPendingInteraction || t.status === "error" || t.queuedWork === "failed" || (t.completion ? t.completion.pending && !t.completion.viewed : t.isUnread) && !isWorking(sidebarActivity(t));
export const compareThreads = (a: Thread, b: Thread) => Number(needsAttention(b)) - Number(needsAttention(a)) || Number(isWorking(sidebarActivity(b))) - Number(isWorking(sidebarActivity(a))) || b.latestAttentionAt - a.latestAttentionAt || a.id.localeCompare(b.id);
export function compareThreadCreation(a: { id: string; createdAt?: number | null }, b: { id: string; createdAt?: number | null }) {
  return (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.id.localeCompare(b.id);
}
export function threadState(t: Thread): { message: MessageKey; tone: string } {
  if (t.hasPendingInteraction) return { message: "actionNeeded", tone: "attention" };
  if (t.queuedWork === "failed" || t.status === "error") return { message: "error", tone: "error" };
  if (t.runtimeStatus === "waiting-for-host") return { message: "waitingHost", tone: "waiting" };
  if (t.runtimeStatus === "provisioning") return { message: "provisioning", tone: "running" };
  if (t.status === "pending") return { message: "pending", tone: "waiting" };
  if (t.status === "starting") return { message: "starting", tone: "running" };
  if (t.status === "stopping") return { message: "stopping", tone: "running" };
  if (isWorking(sidebarActivity(t))) return { message: isSubagent(t) ? "subagentWorking" : "working", tone: "running" };
  if (t.queuedWork === "waiting") return { message: "queued", tone: "waiting" };
  if (t.completion?.pending) return { message: t.completion.viewed ? "completedAt" : "newReply", tone: t.completion.viewed ? "completed" : "result" };
  if (t.isUnread && !t.completion?.at) return { message: "newReply", tone: "result" };
  if (t.status !== "idle") return { message: "unknownState", tone: "unknown" };
  return { message: "read", tone: "read" };
}
export function statusOf(t: Thread, tr: Translator) {
  const state = threadState(t);
  const time = t.completion?.at ? new Date(t.completion.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
  return { text: tr(state.message, { time }), tone: state.tone };
}
export function completionTooltip(t: Thread, tr: Translator) {
  return t.completion?.at ? tr("completedAt", { time: new Date(t.completion.at).toLocaleString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) }) : "";
}
function firstById<T extends { id: string }>(rows: readonly T[]) {
  const result = new Map<string, T>();
  for (const row of rows) if (!result.has(row.id)) result.set(row.id, row);
  return result;
}
function byProject(rows: readonly Thread[]) {
  const result = new Map<string, Thread[]>();
  for (const row of rows) { const group = result.get(row.projectId) ?? []; group.push(row); result.set(row.projectId, group); }
  return result;
}
/** Rebuilt from current inputs, so even in-place SDK updates cannot stale a cache. */
export function createWorkspaceModel({ threads, projects, config, tracked = [], drafts, opened }: {
  threads: readonly Thread[]; projects: Live["projects"]; config?: DashboardConfig; tracked?: readonly TrackedThread[]; drafts: ReadonlySet<string>; opened: string | null;
}) {
  const connected = config?.projects.filter(p => p.enabled) ?? [];
  const connectedById = firstById(connected);
  const configById = firstById(config?.projects ?? []);
  const byId = firstById(threads);
  const visibleById = firstById(threads.filter(visibleThread));
  const threadsByProject = byProject(threads);
  const threadsByProjectId = new Map([...threadsByProject].map(([id, rows]) => [id, firstById(rows)]));
  const visibleByProject = new Map([...threadsByProject].map(([id, rows]) => [id, firstById(rows.filter(visibleThread))]));
  const conversationsByProject = new Map([...threadsByProject].map(([id, rows]) => [id, firstById(rows.filter(conversationThread))]));
  // Preserve both visible membership and hidden tombstones, including old duplicates.
  const trackedById = new Map<string, { visible: boolean; hiddenAttentionAt?: number }>();
  for (const row of tracked) {
    const prior = trackedById.get(row.id);
    trackedById.set(row.id, { visible: !!prior?.visible || row.visible,
      hiddenAttentionAt: row.visible ? prior?.hiddenAttentionAt : Math.max(prior?.hiddenAttentionAt ?? -Infinity, row.hiddenAttentionAt) });
  }
  const allThreads = threads.filter(t => {
    const tracking = trackedById.get(t.id);
    return visibleThread(t) && connectedById.has(t.projectId) && !isFinishedSubagent(sidebarActivity(t))
    && (tracking?.visible || hasWork(sidebarActivity(t)) || drafts.has(t.id) || opened === t.id
      || t.latestAttentionAt > (configById.get(t.projectId)?.connectedAt ?? Infinity)
        && !(tracking?.hiddenAttentionAt !== undefined && tracking.hiddenAttentionAt >= t.latestAttentionAt));
  });
  return { byId, visibleById, visibleByProject, threadsByProject, threadsByProjectId, conversationsByProject, projectsById: firstById(projects), connected, connectedById, trackedById,
    allThreads, workingIds: new Set(allThreads.map(t => t.id)), workingByProject: byProject(allThreads),
    current: opened ? visibleById.get(opened) : undefined,
    indicators: [...allThreads].sort((a, b) => a.id.localeCompare(b.id)),
    runningCount: allThreads.filter(t => isWorking(sidebarActivity(t))).length,
    attentionCount: allThreads.filter(needsAttention).length };
}
export type WorkspaceModel = ReturnType<typeof createWorkspaceModel>;
export function projectEntryThread(model: WorkspaceModel, projectId: string) {
  const threads = (model.workingByProject.get(projectId) ?? []).filter(t => !isSubagent(t)).sort(compareThreads);
  return threads.find(t => threadState(t).tone === "attention")
    ?? threads.find(t => threadState(t).tone === "result")
    ?? threads.find(t => ["running", "waiting"].includes(threadState(t).tone))
    ?? threads.sort((a, b) => b.latestAttentionAt - a.latestAttentionAt || a.id.localeCompare(b.id))[0];
}
export function conversationItem(t: Thread): ConversationItem {
  return { id: t.id, title: t.displayTitle, detail: t.environment?.name ?? t.environment?.branchName ?? t.host?.name ?? "", updatedAt: t.latestAttentionAt || t.createdAt || 0 };
}
export function selectProjectConversation(model: WorkspaceModel, projectId: string, layout: SplitLayout | undefined, conversations: Record<string, ConversationChoice>) {
  const splitThread = layout && model.visibleByProject.get(projectId)?.get(layout.active);
  const choice = splitThread ? { id: splitThread.id, history: !model.workingIds.has(splitThread.id) } : conversations[projectId];
  const candidate = choice && model.conversationsByProject.get(projectId)?.get(choice.id);
  const remembered = candidate && (choice.history || model.workingIds.has(candidate.id)) ? candidate : undefined;
  return { historyOpened: remembered && choice.history ? remembered.id : null,
    opened: remembered ? choice.history ? null : remembered.id : projectEntryThread(model, projectId)?.id ?? null };
}
export function namedProject(model: WorkspaceModel, projectId: string, tr: Translator) {
  const info = model.projectsById.get(projectId);
  return info?.isPersonal ? tr("commonThreads") : info?.name ?? tr("projectUnavailable");
}
export function selectProjectTabs(model: WorkspaceModel, tr: Translator) {
  return model.connected.map(project => {
    const info = model.projectsById.get(project.id);
    const threads = model.workingByProject.get(project.id) ?? [];
    const states = threads.map(t => ({ id: t.id, title: t.displayTitle, subagent: isSubagent(t), providerId: t.providerId, ...statusOf(t, tr) }));
    return { id: project.id, name: namedProject(model, project.id, tr), common: !!info?.isPersonal, available: !!info,
      running: states.filter(state => state.tone === "running").length, attention: states.filter(state => state.tone === "attention").length,
      queued: threads.filter(t => t.queuedWork === "waiting").length, total: threads.length, states };
  });
}
export function selectThreadTabs(rows: readonly Thread[], workingIds: ReadonlySet<string>, drafts: ReadonlySet<string>, tr: Translator): ThreadTab[] {
  return rows.map(t => ({ id: t.id, createdAt: t.createdAt, title: t.displayTitle,
    detail: [t.environment?.name ?? t.environment?.branchName ?? t.host?.name ?? tr("environment"), completionTooltip(t, tr)].filter(Boolean).join(" · "),
    tone: statusOf(t, tr).tone, status: statusOf(t, tr).text, canHide: workingIds.has(t.id) && !hasWork(sidebarActivity(t)) && !drafts.has(t.id) }));
}
export function selectProjectWorkspace(model: WorkspaceModel, projectId: string, layout: SplitLayout | undefined, { opened, historyOpened, pendingCreated }: {
  opened: string | null; historyOpened: string | null; pendingCreated: PendingCreated;
}) {
  const conversations = model.conversationsByProject.get(projectId);
  const paneThreads = (layout?.ids ?? []).map(id => conversations?.get(id)).filter((t): t is Thread => !!t);
  const rows = [...(model.workingByProject.get(projectId) ?? []), ...paneThreads.filter(t => !model.workingIds.has(t.id))]
    .filter(t => !isSubagent(t)).sort(compareThreadCreation);
  const current = model.current;
  const openedSubagent = current && current.projectId === projectId && isSubagent(current) && !isFinishedSubagent(sidebarActivity(current)) ? current : null;
  const history = (model.threadsByProject.get(projectId) ?? []).filter(t => conversationThread(t) && !model.workingIds.has(t.id))
    .sort((a, b) => b.latestAttentionAt - a.latestAttentionAt || (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.id.localeCompare(b.id)).slice(0, 10);
  const historical = historyOpened ? model.visibleByProject.get(projectId)?.get(historyOpened) : undefined;
  return { paneThreads, rows, history, displayed: historyOpened ? historical : openedSubagent ?? rows.find(t => t.id === opened),
    hasSubagents: (model.workingByProject.get(projectId) ?? []).some(isSubagent),
    openingCreated: pendingCreated?.projectId === projectId && opened === pendingCreated.id && !current };
}
export function selectPoolWorkspace(model: WorkspaceModel, pool: SharedPool, pendingThreads: ReadonlyMap<string, string>, activeProjectId: string | undefined, tr: Translator) {
  const rows = pool.entries.map(entry => {
    const thread = model.threadsByProjectId.get(entry.projectId)?.get(entry.threadId);
    const pending = pendingThreads.get(entry.threadId) === entry.projectId;
    return { id: entry.threadId, projectId: entry.projectId, projectConnected: model.connectedById.has(entry.projectId), thread, pending,
      title: thread?.displayTitle ?? (pending ? tr("openingThread") : tr("unavailable")),
      caption: namedProject(model, entry.projectId, tr), completionDetail: thread ? completionTooltip(thread, tr) : "", state: thread ? statusOf(thread, tr) : null };
  });
  return { rows, byId: firstById(rows),
    states: rows.map(row => ({ id: row.id, title: row.title, text: row.state?.text ?? tr("projectUnavailable"), tone: row.state?.tone ?? "unknown", subagent: !!row.thread && isSubagent(row.thread), providerId: row.thread?.providerId })),
    queued: rows.filter(row => row.thread?.queuedWork === "waiting").length,
    createProjectId: rows.find(row => row.id === (pool.active || rows[0]?.id))?.projectId ?? activeProjectId ?? model.connected[0]?.id ?? "",
    tabs: rows.map(row => ({ id: row.id, projectId: row.projectId, createdAt: row.thread?.createdAt, title: row.title, caption: row.caption,
      detail: [row.thread?.environment?.name ?? row.thread?.environment?.branchName ?? row.thread?.host?.name ?? tr("environment"), row.thread && completionTooltip(row.thread, tr)].filter(Boolean).join(" · "),
      tone: row.state?.tone ?? "unknown", status: row.state?.text ?? tr("unavailable"), canHide: false })) };
}
