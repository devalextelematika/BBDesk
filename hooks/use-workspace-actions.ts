import { useRef, useState } from "react";
import type { useSdk } from "@get-bb/plugin-sdk/app";
import type { useWorkspace } from "./use-workspace";
import type { useDashboardSnapshot } from "./use-dashboard-snapshot";
import type { Translator } from "../i18n";
import { namedProject, type Thread, type WorkspaceModel } from "../workspace-selectors";
import { sharedPoolLimit } from "../split-layout";

type Sdk = ReturnType<typeof useSdk>;
type SpawnRequest = Parameters<Sdk["threads"]["spawn"]>[0];
export function useWorkspaceActions(controller: ReturnType<typeof useWorkspace>, workspace: WorkspaceModel, snapshot: ReturnType<typeof useDashboardSnapshot>, sdk: Sdk, tr: Translator) {
  const currentWorkspace = useRef(workspace); currentWorkspace.current = workspace;
  const [saving, setSaving] = useState(false);
  const { getState, dispatch } = controller;
  const { mounted, rpc, refresh, report } = snapshot;
  async function spawnProject(projectId: string, request: SpawnRequest) {
    if (request.projectId !== projectId) throw new Error(tr("projectMismatch"));
    const intent = getState().creation?.intent ?? null;
    try {
      const created = await sdk.threads.spawn(request);
      if (mounted.current) { dispatch({ type: "spawn.project", entry: { id: created.id, projectId }, intent }); void refresh(); }
    } catch (cause) { if (mounted.current) report(cause); throw cause; }
  }
  async function spawnPool(request: SpawnRequest) {
    if (getState().pool.entries.length >= sharedPoolLimit) { dispatch({ type: "pool.limit" }); throw new Error(tr("poolFull")); }
    const intent = getState().creation?.intent ?? null, operation = {};
    dispatch({ type: "pool.request", operation });
    try {
      const created = await sdk.threads.spawn(request);
      if (!mounted.current) return;
      const title = request.input?.find(part => part.type === "text")?.text.trim().slice(0, 160) || tr("newThreadTitle", { name: namedProject(workspace, request.projectId, tr) });
      dispatch({ type: "spawn.pool", entry: { id: created.id, projectId: request.projectId }, intent, operation, title });
      void refresh();
    } catch (cause) {
      if (mounted.current) { dispatch({ type: "pool.failed", operation }); report(cause); }
      throw cause;
    }
  }
  async function hide(thread: Thread) {
    setSaving(true);
    try {
      const result = await rpc.call("thread_hide", { threadId: thread.id });
      if (!mounted.current) return result.hidden;
      if (!result.hidden) throw new Error("DASHBOARD_THREAD_UNAVAILABLE");
      dispatch({ type: "thread.hidden", entry: { id: thread.id, projectId: thread.projectId }, workspace: currentWorkspace.current });
      await refresh();
      if (mounted.current) dispatch({ type: "notice", value: "threadHidden" });
      return true;
    } catch (cause) { if (mounted.current) report(cause); return false; }
    finally { if (mounted.current) setSaving(false); }
  }
  return { saving, hide, spawnProject, spawnPool };
}
