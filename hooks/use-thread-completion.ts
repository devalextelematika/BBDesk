import { useLayoutEffect, useState } from "react";
import { emptyCompletions, observeCompletions } from "../thread-completion";
import type { Thread } from "../workspace-selectors";

export function useThreadCompletion(threads: readonly Thread[], active: string | null, ready: boolean): readonly Thread[] {
  const [previous, setPrevious] = useState(emptyCompletions);
  const next = ready ? observeCompletions(previous, threads, active, Date.now()) : previous;
  useLayoutEffect(() => { if (next !== previous) setPrevious(next); }, [next, previous]);
  return threads.map(thread => ({ ...thread, completion: next.rows.get(thread.id) }));
}
