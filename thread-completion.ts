import { hasWork, isWorking, sidebarActivity } from "./state";
import type { Thread } from "./workspace-selectors";

export interface Completion {
  at: number;
  pending: boolean;
  viewed: boolean;
}
interface Observation extends Completion {
  working: boolean;
  stopping: boolean;
  unread: boolean;
  attention: number;
}
export interface CompletionState {
  active: string | null;
  rows: ReadonlyMap<string, Observation>;
}
export const emptyCompletions = (): CompletionState => ({ active: null, rows: new Map() });

/** Reading an answer and acknowledging its completion are separate events.
 * Only leaving the selected thread acknowledges a completion already viewed there.
 */
export function observeCompletions(previous: CompletionState, threads: readonly Thread[], active: string | null, now: number): CompletionState {
  const rows = new Map<string, Observation>();
  let changed = previous.active !== active;
  for (const thread of threads) {
    if (rows.has(thread.id)) continue;
    const before = previous.rows.get(thread.id);
    const working = isWorking(sidebarActivity(thread));
    const successful = thread.status === "idle" && !hasWork(sidebarActivity(thread));
    const finished = successful && !!before?.working && !before.stopping;
    const newUnread = successful && thread.isUnread && (!before || before.attention !== thread.latestAttentionAt
      || !before.unread && !before.at);
    const fresh = finished || newUnread;
    let pending = fresh || !!before?.pending;
    let viewed = fresh ? false : !!before?.viewed;
    if (!successful) { pending = false; viewed = false; }
    else if (!fresh && previous.active === thread.id && active !== thread.id && viewed) { pending = false; viewed = false; }
    if (pending && active === thread.id) viewed = true;
    const at = finished ? now : newUnread ? thread.latestAttentionAt || now : before?.at ?? 0;
    const next: Observation = { at, pending, viewed, working, stopping: thread.status === "stopping", unread: thread.isUnread, attention: thread.latestAttentionAt };
    const same = before && (Object.keys(next) as (keyof Observation)[]).every(key => before[key] === next[key]);
    rows.set(thread.id, same ? before : next);
    if (!same) changed = true;
  }
  if (rows.size !== previous.rows.size) changed = true;
  return changed ? { active, rows } : previous;
}
