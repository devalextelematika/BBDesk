import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { reconcileThread, hideThread, type Activity, type TrackedThread } from "./state";

const id = z.string().min(1).max(200);
const projectSchema = z.object({ id, enabled: z.boolean(), connectedAt: z.number().nonnegative() });
const configSchema = z.object({
  projects: z.array(projectSchema).max(100),
  launcher: z.array(z.object({ id, label: z.string().min(1).max(200) })).max(100),
});
const trackedSchema = z.object({ id, projectId: id, visible: z.boolean(), latestAttentionAt: z.number(), hiddenAttentionAt: z.number() });
export type DashboardConfig = z.infer<typeof configSchema>;
export const rpcContract = defineRpcContract({
  snapshot: { input: z.null(), output: z.object({ config: configSchema, tracked: z.array(trackedSchema), syncError: z.string().nullable(), syncedAt: z.number().nullable() }) },
  projects_set: { input: z.object({ ids: z.array(id).max(100) }), output: configSchema },
  launcher_set: { input: z.object({ items: configSchema.shape.launcher }), output: configSchema },
  thread_hide: { input: z.object({ threadId: id }), output: z.object({ hidden: z.boolean() }) },
});

export default async function plugin(bb: BbPluginApi) {
  const stored = configSchema.safeParse(await bb.storage.kv.get("config-v1"));
  let config: DashboardConfig = stored.success ? stored.data : { projects: [], launcher: [] };
  const tracked = new Map<string, TrackedThread>();
  for (const key of await bb.storage.kv.list("thread:")) {
    const parsed = trackedSchema.safeParse(await bb.storage.kv.get(key));
    if (parsed.success) tracked.set(parsed.data.id, parsed.data);
  }
  let syncedAt: number | null = null;
  let syncError: string | null = null;
  let disposed = false;
  let chain: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = chain.then(fn);
    chain = next.catch(() => undefined);
    return next;
  }
  function publish() { if (!disposed) bb.realtime.publish("dashboard-changed", {}); }
  async function saveConfig(next: DashboardConfig) {
    await bb.storage.kv.set("config-v1", next);
    config = next;
    publish();
    return next;
  }
  type Row = Awaited<ReturnType<typeof bb.sdk.threads.list>>[number];
  function activity(t: Row): Activity {
    return { ...t, runtimeStatus: t.runtime.displayStatus,
      backgroundAgents: t.activity.activeBackgroundAgentCount,
      backgroundCommands: t.activity.activeBackgroundCommandCount,
      workflows: t.activity.activeWorkflowCount };
  }
  async function observe(rows: Row[]) {
    let changed = false;
    for (const row of rows) {
      const project = config.projects.find(p => p.id === row.projectId && p.enabled);
      if (!project || row.visibility === "hidden" || row.archivedAt !== null || row.deletedAt !== null) continue;
      const previous = tracked.get(row.id);
      const next = reconcileThread(previous, activity(row), project.connectedAt);
      if (next && JSON.stringify(previous) !== JSON.stringify(next)) {
        await bb.storage.kv.set("thread:" + row.id, next);
        tracked.set(row.id, next);
        changed = true;
      }
    }
    if (changed) publish();
  }
  async function reconcileAll() {
    try {
      for (const project of config.projects.filter(p => p.enabled)) {
        // List results are arrays, not envelopes. Never truncate busy projects.
        for (let offset = 0; ; offset += 200) {
          const rows = await bb.sdk.threads.list({ projectId: project.id, archived: false, includeHidden: false, limit: 200, offset });
          await observe(rows);
          if (rows.length < 200 || disposed) break;
        }
      }
      syncedAt = Date.now();
      if (syncError !== null) { syncError = null; publish(); }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (syncError !== message) {
        syncError = message;
        bb.log.warn("Activity sync: " + syncError);
        publish();
      }
    }
  }
  bb.rpc.register(rpcContract, {
    snapshot: () => serial(async () => {
      // Realtime observation updates individual rows; reading a signal must not
      // rescan every project's full history on each streaming delta.
      if (syncedAt === null || syncError !== null || Date.now() - syncedAt >= 60_000) await reconcileAll();
      return { config, tracked: [...tracked.values()].filter(t => config.projects.some(p => p.id === t.projectId && p.enabled)), syncError, syncedAt };
    }),
    projects_set: ({ ids }) => serial(async () => {
      const projects = await bb.sdk.projects.list();
      const known = new Set(projects.map(p => p.id));
      const selected = new Set(ids);
      if (ids.some(projectId => !known.has(projectId))) throw new Error("Проект больше не доступен. Обновите список.");
      const next = config.projects.map(p => ({ ...p, enabled: selected.has(p.id) }));
      const now = Date.now();
      for (const projectId of selected) if (!next.some(p => p.id === projectId)) next.push({ id: projectId, enabled: true, connectedAt: now });
      await saveConfig({ ...config, projects: next });
      await reconcileAll();
      return config;
    }),
    launcher_set: ({ items }) => serial(() => saveConfig({ ...config, launcher: [...new Map(items.map(i => [i.id, i])).values()] })),
    thread_hide: ({ threadId }) => serial(async () => {
      const previous = tracked.get(threadId);
      if (!previous || !config.projects.some(p => p.id === previous.projectId && p.enabled)) return { hidden: false };
      const [row] = await bb.sdk.threads.list({ threadIds: [threadId], archived: false, limit: 1 });
      if (!row) return { hidden: false };
      const next = hideThread(previous, activity(row));
      await bb.storage.kv.set("thread:" + threadId, next);
      tracked.set(threadId, next);
      publish();
      return { hidden: true };
    }),
  });
  bb.background.service("activity", {
    async start(signal) {
      const dirty = new Set<string>();
      let full = false;
      const unsubscribe = bb.sdk.subscribe({ event: "thread:changed", callback: event => {
        if (event.changes.some(change => ["thread-created", "status-changed", "queue-changed", "interactions-changed", "events-appended", "archived-changed", "thread-deleted"].includes(change))) {
          if (event.id) dirty.add(event.id); else full = true;
        }
      } });
      const reconnect = bb.sdk.subscribe({ event: "realtime:connection", callback: event => { if (event.state === "connected") full = true; } });
      await serial(reconcileAll);
      let lastFull = Date.now();
      try {
        while (!signal.aborted) {
          await new Promise<void>(resolve => {
            const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
            const timer = setTimeout(done, 750);
            signal.addEventListener("abort", done, { once: true });
            if (signal.aborted) done();
          });
          if (signal.aborted) break;
          const ids = [...dirty]; dirty.clear();
          if (full || Date.now() - lastFull >= 60_000) {
            full = false; lastFull = Date.now(); await serial(reconcileAll);
          } else if (ids.length) {
            await serial(async () => {
              try {
                for (let offset = 0; offset < ids.length; offset += 200) await observe(await bb.sdk.threads.list({ threadIds: ids.slice(offset, offset + 200), archived: false, limit: 200 }));
              } catch (cause) { syncError = String(cause); full = true; publish(); }
            });
          }
        }
      } finally { unsubscribe(); reconnect(); }
    },
  });
  bb.onDispose(() => { disposed = true; });
}
