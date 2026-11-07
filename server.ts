import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { randomUUID } from "node:crypto";
import { reconcileThread, hideThread, serverActivity as activity, type TrackedThread } from "./state";
import { languageSetting } from "./i18n";
import { configSchema, trackedSchema, rpcContract, type DashboardConfig } from "./contracts";
import { changeConfiguration, projectValidationIds, type ConfigMutation } from "./configuration";
import { createActivitySync, type ActivitySyncWork } from "./activity-sync";

// Keep the original source exports for existing SDK consumers.
export { rpcContract } from "./contracts";
export type { DashboardConfig } from "./contracts";

export default async function plugin(bb: BbPluginApi) {
  bb.settings.define({ language: languageSetting });
  const stored = configSchema.safeParse(await bb.storage.kv.get("config-v1"));
  let config: DashboardConfig = stored.success ? stored.data : { projects: [], launcher: [], sharedPool: true };
  const tracked = new Map<string, TrackedThread>();
  const undoTokens = new Map<string, string>();
  for (const key of await bb.storage.kv.list("thread:")) {
    const parsed = trackedSchema.safeParse(await bb.storage.kv.get(key));
    if (parsed.success) tracked.set(parsed.data.id, parsed.data);
  }
  let syncedAt: number | null = null;
  let syncError: string | null = null;
  let disposed = false;
  const projectRevisions = new Map<string, number>();
  const threadRevisions = new Map<string, number>();
  let revision = 0;
  let chain: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = chain.then(() => fn());
    chain = next.catch(() => undefined);
    return next;
  }
  function publish() { if (!disposed) bb.realtime.publish("dashboard-changed", {}); }
  async function saveConfig(next: DashboardConfig) {
    next = configSchema.parse(next);
    await bb.storage.kv.set("config-v1", next);
    const beforeProjects = new Map(config.projects.map(project => [project.id, project]));
    const afterProjects = new Map(next.projects.map(project => [project.id, project]));
    for (const id of new Set([...beforeProjects.keys(), ...afterProjects.keys()])) {
      const before = beforeProjects.get(id);
      const after = afterProjects.get(id);
      if (before?.enabled !== after?.enabled || before?.connectedAt !== after?.connectedAt)
        projectRevisions.set(id, ++revision);
    }
    config = next;
    publish();
    return next;
  }
  type Row = Awaited<ReturnType<typeof bb.sdk.threads.list>>[number];
  const projectVersions = () => new Map(config.projects.filter(project => project.enabled).map(project => [project.id, projectRevisions.get(project.id) ?? 0]));
  type ReadTicket = { revision: number; projects: Map<string, number> };
  const readTicket = (): ReadTicket => ({ revision, projects: projectVersions() });
  async function observe(rows: Row[], ticket: ReadTicket, current: () => boolean) {
    let changed = false;
    let fresh = true;
    for (const row of rows) {
      if (!current() || disposed) return false;
      const project = config.projects.find(p => p.id === row.projectId && p.enabled);
      if (!project || row.visibility === "hidden" || row.archivedAt !== null || row.deletedAt !== null) continue;
      if (ticket.projects.get(row.projectId) !== (projectRevisions.get(row.projectId) ?? 0)) {
        sync.requestProjects([row.projectId]); fresh = false; continue;
      }
      if ((threadRevisions.get(row.id) ?? 0) > ticket.revision) {
        sync.requestThreads([row.id]); fresh = false; continue;
      }
      const previous = tracked.get(row.id);
      const next = reconcileThread(previous, activity(row), project.connectedAt);
      if (next && JSON.stringify(previous) !== JSON.stringify(next)) {
        await bb.storage.kv.set("thread:" + row.id, next);
        // A write already started cannot be cancelled. Mirror its confirmed
        // result before releasing the queue, even if this read pass was stopped.
        tracked.set(row.id, next);
        changed = true;
        if (!current() || disposed) return false;
      }
    }
    if (changed) publish();
    return fresh;
  }
  async function reconcile(work: ActivitySyncWork, current: () => boolean, signal: AbortSignal) {
    const startedProjects = projectVersions();
    let fresh = true;
    try {
      for (const project of config.projects.filter(p => p.enabled && (work.full || work.projects.includes(p.id)))) {
        if (!config.projects.some(entry => entry.id === project.id && entry.enabled)
          || startedProjects.get(project.id) !== (projectRevisions.get(project.id) ?? 0)) { fresh = false; continue; }
        // List results are arrays, not envelopes. Never truncate busy projects.
        for (let offset = 0; ; offset += 200) {
          if (!current() || disposed) return;
          const ticket = readTicket();
          const rows = await bb.sdk.threads.list({ projectId: project.id, archived: false, includeHidden: false, limit: 200, offset, signal });
          if (!current() || disposed) return;
          if (!await serial(() => observe(rows, ticket, current))) fresh = false;
          if (rows.length < 200 || !current() || disposed) break;
          if (startedProjects.get(project.id) !== (projectRevisions.get(project.id) ?? 0)) break;
        }
      }
      if (!work.full) {
        for (let offset = 0; offset < work.threads.length; offset += 200) {
          if (!current() || disposed) return;
          const ticket = readTicket();
          const rows = await bb.sdk.threads.list({ threadIds: work.threads.slice(offset, offset + 200), archived: false, includeHidden: false, limit: 200, signal });
          if (!current() || disposed) return;
          await serial(() => observe(rows, ticket, current));
        }
      }
      await serial(async () => {
        if (!current() || disposed || !work.full) return;
        const latest = projectVersions();
        if (!fresh || latest.size !== startedProjects.size || [...latest].some(([id, value]) => startedProjects.get(id) !== value)) {
          sync.requestFull(true); return;
        }
        syncedAt = Date.now(); syncError = null; publish();
      });
    } catch (cause) {
      if (!current() || disposed) return;
      await serial(async () => {
        if (!current() || disposed) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        if (syncError !== message) { syncError = message; bb.log.warn("Activity sync: " + message); publish(); }
      });
      throw cause;
    }
  }
  const sync = createActivitySync(reconcile);
  function mutateConfig(mutation: ConfigMutation) {
    return serial(async () => {
      const ids = projectValidationIds(config, mutation);
      if (ids !== null) {
        const projects = await bb.sdk.projects.list({ includePersonal: true });
        const known = new Set(projects.map(project => project.id));
        if (ids.some(id => !known.has(id))) throw new Error("DASHBOARD_PROJECT_UNAVAILABLE");
      }
      const next = await saveConfig(changeConfiguration(config, mutation, Date.now()));
      sync.requestProjects(mutation.method === "projects_set" ? next.projects.filter(project => project.enabled).map(project => project.id) : ids ?? []);
      return next;
    });
  }
  async function commitThreadAction(next: TrackedThread) {
    await bb.storage.kv.set("thread:" + next.id, next);
    tracked.set(next.id, next);
    threadRevisions.set(next.id, ++revision);
  }
  async function hideTrackedThread(threadId: string) {
    const previous = tracked.get(threadId);
    if (!previous || !config.projects.some(p => p.id === previous.projectId && p.enabled)) return { hidden: false };
    const [row] = await bb.sdk.threads.list({ threadIds: [threadId], archived: false, limit: 1 });
    if (!row) return { hidden: false };
    await commitThreadAction(hideThread(previous, activity(row)));
    const undoToken = randomUUID();
    undoTokens.delete(threadId);
    undoTokens.set(threadId, undoToken);
    if (undoTokens.size > 100) undoTokens.delete(undoTokens.keys().next().value!);
    publish();
    return { hidden: true, undoToken };
  }
  async function restoreTrackedThread(threadId: string, undoToken: string) {
    const previous = tracked.get(threadId);
    if (undoTokens.get(threadId) !== undoToken || !previous || !config.projects.some(p => p.id === previous.projectId && p.enabled)) return { restored: false };
    const [row] = await bb.sdk.threads.list({ threadIds: [threadId], archived: false, includeHidden: false, limit: 1 });
    if (!row || row.visibility === "hidden" || row.archivedAt !== null || row.deletedAt !== null || row.projectId !== previous.projectId) return { restored: false };
    await commitThreadAction({ ...previous, visible: true, latestAttentionAt: row.latestAttentionAt });
    undoTokens.delete(threadId);
    publish();
    return { restored: true };
  }
  bb.rpc.register(rpcContract, {
    snapshot: () => serial(async () => {
      // Read confirmed state without awaiting SDK history. Initial snapshots may
      // have syncedAt:null; the completed pass publishes another signal.
      if (syncedAt === null || syncError !== null || Date.now() - syncedAt >= 60_000) sync.requestFull();
      return structuredClone({ config, tracked: [...tracked.values()].filter(t => config.projects.some(p => p.id === t.projectId && p.enabled)), syncError, syncedAt });
    }),
    projects_set: input => mutateConfig({ method: "projects_set", ...input }),
    launcher_set: input => mutateConfig({ method: "launcher_set", ...input }),
    catalog_change: change => mutateConfig({ method: "catalog_change", change }),
    thread_hide: ({ threadId }) => serial(() => hideTrackedThread(threadId)),
    thread_restore: ({ threadId, undoToken }) => serial(() => restoreTrackedThread(threadId, undoToken)),
  });
  bb.background.service("activity", {
    async start(signal) {
      if (signal.aborted || disposed) return;
      sync.start();
      const stop = () => sync.stop();
      signal.addEventListener("abort", stop, { once: true });
      const subscriptions: (() => void)[] = [];
      let lastFull = Date.now();
      try {
        subscriptions.push(bb.sdk.subscribe({ event: "thread:changed", callback: event => {
          if (signal.aborted || disposed) return;
          if (event.changes.some(change => ["thread-created", "status-changed", "queue-changed", "interactions-changed", "events-appended", "archived-changed", "thread-deleted"].includes(change))) {
            if (event.id) sync.requestThreads([event.id]); else sync.requestFull(true);
          }
        } }));
        subscriptions.push(bb.sdk.subscribe({ event: "realtime:connection", callback: event => { if (!signal.aborted && !disposed && event.state === "connected") sync.requestFull(true); } }));
        sync.requestFull();
        while (!signal.aborted) {
          await new Promise<void>(resolve => {
            const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
            const timer = setTimeout(done, 750);
            signal.addEventListener("abort", done, { once: true });
            if (signal.aborted) done();
          });
          if (signal.aborted) break;
          if (Date.now() - lastFull >= 60_000) { lastFull = Date.now(); sync.requestFull(); }
        }
      } finally { signal.removeEventListener("abort", stop); subscriptions.reverse().forEach(unsubscribe => unsubscribe()); sync.stop(); }
    },
  });
  bb.onDispose(() => { disposed = true; sync.stop(); });
}
