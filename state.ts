/** Persistent inclusion rules, independent of chat content and BB rendering. */
export interface Activity {
  id: string;
  projectId: string;
  parentThreadId?: string | null;
  lifecycleOwnerThreadId?: string | null;
  originKind?: string | null;
  originPluginId?: string | null;
  status: string;
  runtimeStatus?: string;
  queuedWork: string;
  hasPendingInteraction: boolean;
  latestAttentionAt: number;
  backgroundAgents?: number;
  backgroundCommands?: number;
  workflows?: number;
  displayTitle?: string;
  createdAt?: number | null;
}
export interface TrackedThread {
  id: string;
  projectId: string;
  visible: boolean;
  latestAttentionAt: number;
  hiddenAttentionAt: number;
  backgroundMatched?: boolean;
  backgroundExposed?: boolean;
}
export type BackgroundRules = { enabled: boolean; substrings: readonly string[]; since: number };
export function matchesBackground(t: Pick<Activity, "displayTitle" | "createdAt">, rules?: BackgroundRules): boolean {
  return !!rules?.enabled && t.createdAt != null && t.createdAt >= rules.since
    && rules.substrings.some(value => value.trim() && (t.displayTitle ?? "").toLowerCase().includes(value.trim().toLowerCase()));
}
export function backgroundState(t: Activity, previous?: TrackedThread, rules?: BackgroundRules) {
  const matched = !!rules?.enabled && (previous?.backgroundMatched === true || matchesBackground(t, rules));
  const exposed = matched && (t.hasPendingInteraction || hasThreadFailure(t) || previous?.backgroundExposed === true && hasWork(t));
  return { matched, exposed };
}
/** Explicit adapters for the two public SDK activity shapes. */
export function sidebarActivity(t: Activity & { activity: { backgroundAgents: number; backgroundCommands: number; workflows: number } }): Activity {
  return { ...t, backgroundAgents: t.activity.backgroundAgents, backgroundCommands: t.activity.backgroundCommands, workflows: t.activity.workflows };
}
export function serverActivity(t: Activity & { runtime: { displayStatus: string }; activity: { activeBackgroundAgentCount: number; activeBackgroundCommandCount: number; activeWorkflowCount: number } }): Activity {
  return { ...t, runtimeStatus: t.runtime.displayStatus,
    backgroundAgents: t.activity.activeBackgroundAgentCount,
    backgroundCommands: t.activity.activeBackgroundCommandCount,
    workflows: t.activity.activeWorkflowCount };
}
export function isWorking(t: Activity): boolean {
  return ["active", "starting", "stopping", "pending"].includes(t.status)
    || ["provisioning", "waiting-for-host"].includes(t.runtimeStatus ?? "")
    || (t.backgroundAgents ?? 0) > 0 || (t.backgroundCommands ?? 0) > 0
    || (t.workflows ?? 0) > 0;
}
export function hasWork(t: Activity): boolean {
  return isWorking(t) || t.queuedWork !== "none" || t.hasPendingInteraction;
}
export function subagentOwnerId(t: Pick<Activity, "lifecycleOwnerThreadId" | "parentThreadId" | "originKind">): string | null {
  if (t.lifecycleOwnerThreadId) return t.lifecycleOwnerThreadId;
  // Delegated children can have only a parent, while independent forks also have ancestry.
  return t.originKind === "fork" ? null : t.parentThreadId || null;
}
export function isSubagent(t: Activity): boolean {
  // Delegation Router creates worker threads and stamps them with its plugin ID.
  return subagentOwnerId(t) !== null || (t.originKind !== "fork" && t.originPluginId === "delegation-router");
}
export function hasThreadFailure(t: Pick<Activity, "queuedWork" | "status">): boolean {
  return t.status === "error" || t.queuedWork === "failed";
}
export function isFinishedSubagent(t: Activity): boolean {
  // Read state and the selected chat affect the badge, never the worker's lifecycle.
  return isSubagent(t) && !hasWork(t) && !hasThreadFailure(t);
}
export function reconcileThread(previous: TrackedThread | undefined, t: Activity, connectedAt: number, rules?: BackgroundRules): TrackedThread | undefined {
  const background = backgroundState(t, previous, rules);
  if (background.matched) return {
    id: t.id, projectId: t.projectId, visible: background.exposed,
    latestAttentionAt: t.latestAttentionAt, hiddenAttentionAt: previous?.hiddenAttentionAt ?? 0,
    backgroundMatched: true, backgroundExposed: background.exposed,
  };
  if (isFinishedSubagent(t)) return previous ? {
    ...previous, visible: false, latestAttentionAt: t.latestAttentionAt,
    hiddenAttentionAt: Math.max(previous.hiddenAttentionAt, t.latestAttentionAt),
  } : undefined;
  const needsTracking = hasWork(t) || (isSubagent(t) && hasThreadFailure(t));
  if (!previous && !needsTracking && t.latestAttentionAt <= connectedAt) return undefined;
  return {
    id: t.id, projectId: t.projectId,
    visible: previous?.visible === true || needsTracking
      || t.latestAttentionAt > (previous?.hiddenAttentionAt ?? connectedAt),
    latestAttentionAt: t.latestAttentionAt,
    hiddenAttentionAt: previous?.hiddenAttentionAt ?? 0,
  };
}
export function hideThread(previous: TrackedThread, current: Activity): TrackedThread {
  if (hasWork(current)) throw new Error("DASHBOARD_THREAD_BUSY");
  return { ...previous, visible: false, latestAttentionAt: current.latestAttentionAt, hiddenAttentionAt: current.latestAttentionAt };
}
