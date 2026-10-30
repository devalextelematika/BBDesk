/** Persistent inclusion rules, independent of chat content and BB rendering. */
export interface Activity {
  id: string;
  projectId: string;
  parentThreadId?: string | null;
  lifecycleOwnerThreadId?: string | null;
  originKind?: string | null;
  status: string;
  runtimeStatus?: string;
  queuedWork: string;
  hasPendingInteraction: boolean;
  latestAttentionAt: number;
  backgroundAgents?: number;
  backgroundCommands?: number;
  workflows?: number;
}
export interface TrackedThread {
  id: string;
  projectId: string;
  visible: boolean;
  latestAttentionAt: number;
  hiddenAttentionAt: number;
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
export function isSubagent(t: Activity): boolean {
  return !!t.lifecycleOwnerThreadId || !!t.parentThreadId && t.originKind !== "fork";
}
export function isFinishedSubagent(t: Activity): boolean {
  return isSubagent(t) && !hasWork(t) && t.status !== "error";
}
export function reconcileThread(previous: TrackedThread | undefined, t: Activity, connectedAt: number): TrackedThread | undefined {
  if (isFinishedSubagent(t)) return previous ? {
    ...previous, visible: false, latestAttentionAt: t.latestAttentionAt,
    hiddenAttentionAt: Math.max(previous.hiddenAttentionAt, t.latestAttentionAt),
  } : undefined;
  if (!previous && !hasWork(t) && t.latestAttentionAt <= connectedAt) return undefined;
  return {
    id: t.id, projectId: t.projectId,
    visible: previous?.visible === true || hasWork(t)
      || t.latestAttentionAt > (previous?.hiddenAttentionAt ?? connectedAt),
    latestAttentionAt: t.latestAttentionAt,
    hiddenAttentionAt: previous?.hiddenAttentionAt ?? 0,
  };
}
export function hideThread(previous: TrackedThread, current: Activity): TrackedThread {
  if (hasWork(current)) throw new Error("Скрыть можно после завершения работы и ответа на запросы BB.");
  return { ...previous, visible: false, latestAttentionAt: current.latestAttentionAt, hiddenAttentionAt: current.latestAttentionAt };
}
