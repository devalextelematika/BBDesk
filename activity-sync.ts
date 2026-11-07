export interface ActivitySyncWork { full: boolean; projects: string[]; threads: string[] }

/** One logical read pass at a time; requests received during it remain pending. */
export function createActivitySync(run: (work: ActivitySyncWork, current: () => boolean, signal: AbortSignal) => Promise<void>) {
  const projects = new Set<string>();
  const threads = new Set<string>();
  let full = false;
  let enabled = true;
  let generation = 0;
  let flight: { full: boolean; controller: AbortController } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let nextAt = 0;
  function schedule() {
    if (!enabled || flight || timer !== undefined || !full && !projects.size && !threads.size) return;
    timer = setTimeout(() => { timer = undefined; void flush(); }, Math.max(0, nextAt - Date.now()));
  }
  async function flush() {
    if (!enabled) return;
    const work = { full, projects: [...projects], threads: [...threads] };
    full = false; projects.clear(); threads.clear();
    const owner = { full: work.full, controller: new AbortController() };
    const epoch = generation;
    const current = () => enabled && generation === epoch;
    flight = owner;
    let delay = 750;
    try { await run(work, current, owner.controller.signal); }
    catch {
      if (current()) {
        full ||= work.full;
        work.projects.forEach(id => projects.add(id));
        work.threads.forEach(id => threads.add(id));
        delay = 5_000;
      }
    } finally {
      if (flight === owner) {
        flight = null;
        nextAt = Date.now() + delay;
        schedule();
      }
    }
  }
  function stop() {
    enabled = false; generation++;
    flight?.controller.abort();
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined; flight = null;
    full = false; projects.clear(); threads.clear(); nextAt = 0;
  }
  return {
    requestFull(followUp = false) {
      if (!enabled || flight?.full && !followUp) return;
      full = true; schedule();
    },
    requestProjects(ids: readonly string[]) { if (enabled) { ids.forEach(id => projects.add(id)); schedule(); } },
    requestThreads(ids: readonly string[]) { if (enabled) { ids.forEach(id => threads.add(id)); schedule(); } },
    start() { stop(); enabled = true; },
    stop,
  };
}
