import { useEffect, useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import {
  definePluginApp, useRealtimeConnectionState, useSdk,
  experimental_useSidebarThreads as useThreads,
  useSidebarThreadDraftIds as useDraftIds,
  experimental_usePluginId as usePluginId,
} from "@get-bb/plugin-sdk/app";
import { ApplicationWorkspace, EmbeddedLaunch, embeddedTarget } from "./components/application-workspace";
import { Catalog } from "./catalog";
import type { CatalogChange } from "./catalog-config";
import { Icon } from "./components/ui/icon";
import { ThreadIndicator } from "./components/thread-indicator";
import { LauncherList } from "./components/launcher-list";
import { ProviderUsageDock } from "./components/provider-usage-dock";
import { readStored, writeStored } from "./browser-storage";
import { ProjectTabs } from "./project-tabs";
import { sharedPoolComposer, selectionFields } from "./workspace-transitions";
import { useWorkspace } from "./hooks/use-workspace";
import { useWorkspaceSync } from "./hooks/use-workspace-sync";
import { useThreadCompletion } from "./hooks/use-thread-completion";
import { useWorkspaceActions } from "./hooks/use-workspace-actions";
import { useAppSplit } from "./hooks/use-app-split";
import { useThreadDragging } from "./hooks/use-thread-dragging";
import { readThreadDrag, threadDragType, sharedPoolLimit, type PoolEntry } from "./split-layout";
import { usePanelFocus } from "./hooks/use-panel-focus";
import { useMobileComposerViewport } from "./hooks/use-mobile-composer-viewport";
import { isSubagent } from "./state";
import { useLauncherPanel } from "./launcher-panel";
import { LauncherNavigation, useLauncherNavigation } from "./launcher-navigation";
import type { DashboardConfig } from "./contracts";
import { useTranslation } from "./use-translation";
import { SmallButton } from "./components/workspace-button";
import { ProjectWorkspace } from "./components/project-workspace";
import { SharedPoolWorkspace } from "./components/shared-pool-workspace";
import { projectWorkspaceView, sharedPoolWorkspaceView } from "./workspace-view-models";
import { trapTab, useElementWidth } from "./dom-utils";
import "./styles.css";
import { useDashboardSnapshot } from "./hooks/use-dashboard-snapshot";
import { createWorkspaceModel, statusOf, namedProject, selectActiveProject, selectProjectTabs, selectProjectWorkspace, selectPoolWorkspace, type Thread } from "./workspace-selectors";

function Empty({ children }: { children: ReactNode }) { return <div className="db-empty" role="status">{children}</div>; }
function ConnectionWarning() {
  const { t: tr } = useTranslation();
  const connection = useRealtimeConnectionState();
  const connected = connection === "connected";
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(false);
    if (connected) return;
    const timer = setTimeout(() => setVisible(true), 3000);
    return () => clearTimeout(timer);
  }, [connected]);
  return !connected && visible ? <div className="db-warning" role="status">{tr("connectionWarning")}</div> : null;
}
const quotaVisibilityKey = "bb-dashboard:provider-usage-visible:v1";

function DashboardPage() {
  const { t: tr, language, isLoading: languageLoading } = useTranslation();
  const launcherPanel = useLauncherPanel();
  const [showQuotaDock, setShowQuotaDock] = useState(() => readStored(quotaVisibilityKey, raw => raw !== false, true));
  function changeQuotaVisibility(next: boolean) {
    setShowQuotaDock(next);
    writeStored(quotaVisibilityKey, next);
  }
  const appSplit = useAppSplit();
  const { internalSplit, applicationMode } = appSplit;
  const snapshot = useDashboardSnapshot();
  const { rpc, data, error, setError, report, refresh, applyConfig, mounted } = snapshot;
  const sdk = useSdk();
  const live = useThreads();
  const navigation = useLauncherNavigation();
  const pluginId = usePluginId();
  const drafts = useDraftIds();
  const controller = useWorkspace();
  const { state: workspaceState, dispatch, getState } = controller;
  const { layouts: splitLayouts, pool: sharedPool, notice, poolLimitNotice, unplaced: unplacedPoolThreads, pendingCreated } = workspaceState;
  const { opened, historyOpened, creating } = selectionFields(workspaceState.selection);
  const threadDragging = useThreadDragging();
  const [historyProject, setHistoryProject] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const settingsOpener = useRef<HTMLElement | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const historyOpener = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const workspaceWidth = useElementWidth(mainRef);
  const compactWorkspace = workspaceWidth > 0 && workspaceWidth <= 680;
  usePanelFocus(historyRef, historyProject, historyOpener);
  const config = data?.config;
  const sharedPoolEnabled = config?.sharedPool !== false;
  const appPanes = appSplit.appSplit.appIds.flatMap(id => {
    const entry = config?.launcher.find(app => app.id === id);
    const icon = navigation?.items.find(item => item.id === id)?.icon;
    return entry ? [{ ...entry, icon }] : [];
  });
  const selectedThread = creating ? null : sharedPool.open ? sharedPool.active || sharedPool.entries[0]?.threadId || null : historyOpened ?? opened;
  const completionThreads = useThreadCompletion(live.threads, selectedThread, live.status === "ready");
  const workspace = createWorkspaceModel({ threads: completionThreads, projects: live.projects, config, tracked: data?.tracked, drafts, opened });
  const { connected, runningCount, attentionCount } = workspace;
  const activeProject = selectActiveProject(workspace, workspaceState.projectId);
  const { saving, hide, spawnProject, spawnPool } = useWorkspaceActions(controller, workspace, snapshot, sdk, tr);
  // Recover selections, drop stale columns and pins, enter the active project and
  // remember its conversation: see syncWorkspace in workspace-transitions.ts.
  useWorkspaceSync(controller, { workspace, liveReady: live.status === "ready", dataReady: !!data, poolEnabled: sharedPoolEnabled,
    selection: workspaceState.selection, projectId: workspaceState.projectId });
  const projectName = (projectId: string) => namedProject(workspace, projectId, tr);
  function addPane(id: string, target?: string, after = true) {
    if (!activeProject || !workspace.conversationsByProject.get(activeProject.id)?.has(id)) return;
    dispatch({ type: "pane.add", projectId: activeProject.id, id, history: !workspace.workingIds.has(id), target, after });
    if (compactWorkspace) setHistoryProject(null);
  }
  function eligiblePoolThread(projectId: string, threadId: string) {
    return workspace.connectedById.has(projectId) && !!workspace.conversationsByProject.get(projectId)?.has(threadId);
  }
  function showSharedPool() {
    setHistoryProject(null); setSettings(false);
    dispatch({ type: "pool.show" });
  }
  function togglePool(projectId: string, threadId: string) {
    if (getState().pool.entries.some(entry => entry.threadId === threadId)) dispatch({ type: "pool.remove", id: threadId });
    else pinPoolThread(projectId, threadId);
  }
  function pinPoolThread(projectId: string, threadId: string, target?: string, after = true) {
    if (eligiblePoolThread(projectId, threadId)) dispatch({ type: "pool.pin", entry: { projectId, threadId }, target, after });
  }
  function allowPoolDrop(event: DragEvent) {
    if (!Array.from(event.dataTransfer.types).includes(threadDragType)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }
  function dropOnPool(event: DragEvent) {
    if (!Array.from(event.dataTransfer.types).includes(threadDragType)) return;
    event.preventDefault();
    event.stopPropagation();
    const entry = readThreadDrag(event.dataTransfer);
    if (entry) pinPoolThread(entry.projectId, entry.threadId);
  }
  function openUnplacedPoolThread(entry: PoolEntry) {
    if (!workspace.connectedById.has(entry.projectId) || !workspace.projectsById.has(entry.projectId)) { setError("projectGone"); return; }
    const thread = workspace.byId.get(entry.threadId);
    if (thread && (thread.isHidden || thread.isArchived || thread.projectId !== entry.projectId || isSubagent(thread))) { setError("threadUnavailable"); return; }
    dispatch({ type: "created.open", entry: { id: entry.threadId, projectId: entry.projectId } });
    setHistoryProject(null); setSettings(false);
    setError(null);
  }
  function removePane(id: string) {
    if (!activeProject) return;
    dispatch({ type: "pane.remove", projectId: activeProject.id, id, workspace });
    if (compactWorkspace) setHistoryProject(null);
  }
  function openConversation(t: Thread) {
    if (workspace.workingIds.has(t.id)) openThread(t);
    else dispatch({ type: "conversation.open", projectId: t.projectId, id: t.id, history: true });
    if (compactWorkspace) setHistoryProject(null);
  }
  const projectTabs = selectProjectTabs(workspace, tr);
  function selectProject(id: string) {
    setHistoryProject(null);
    dispatch({ type: "project.select", projectId: id, workspace });
  }
  function openThread(t: Thread) {
    dispatch({ type: "conversation.open", projectId: t.projectId, id: t.id, history: false, enter: true });
    setSettings(false);
  }
  function createInProject(id: string) {
    setHistoryProject(null);
    dispatch({ type: "create.start", projectId: id });
  }
  function createInPool() {
    setHistoryProject(null); setSettings(false);
    dispatch({ type: "create.start", projectId: sharedPoolComposer });
  }
  function toggleThread(t: Thread) {
    if ((splitLayouts[t.projectId]?.ids.length ?? 0) > 1) { openConversation(t); return; }
    dispatch({ type: "conversation.toggle", id: t.id });
  }
  const apps = navigation?.items.filter(item => item.pluginId && item.pluginId !== pluginId) ?? [];
  function openAppAlongside(id: string, item: (typeof apps)[number] | undefined) {
    if (!internalSplit || item?.action?.kind !== "open-plugin-panel") { navigation?.actions.activate(id, { target: "split" }); return; }
    const existing = launcherPanel.root.current?.querySelectorAll<HTMLIFrameElement>("iframe[data-bbdesk-app]");
    const pane = Array.from(existing ?? []).find(frame => frame.dataset.bbdeskApp === id);
    if (pane) {
      appSplit.setActiveApp(id);
      pane.focus();
      pane.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    } else appSplit.openApp(id);
    if (launcherPanel.overlayOpen) launcherPanel.close();
  }
  function openSettings() {
    if (!config || saving) return;
    settingsOpener.current = document.activeElement as HTMLElement | null;
    setHistoryProject(null);
    setSettings(true);
  }
  async function changeCatalog(operation: CatalogChange) {
    let next: DashboardConfig;
    try { next = await rpc.call("catalog_change", operation); }
    catch (cause) { void refresh(); throw cause; }
    if (mounted.current) {
      // The initial project can be a fallback rather than an explicit choice.
      // Persist that choice before a reorder changes which entry comes first.
      dispatch({ type: "project.retain", projectId: activeProject?.id ?? null });
      applyConfig(next);
      void refresh();
    }
    return next;
  }
  function reorder(kind: "project" | "app", id: string, targetId: string, after: boolean) {
    if (saving) return;
    changeCatalog({ type: "move", kind, id, targetId, after })
      .then(() => { if (mounted.current) dispatch({ type: "notice", value: "catalogOrderSaved" }); })
      .catch(cause => report(cause));
  }
  const pool = selectPoolWorkspace(workspace, sharedPool, workspaceState.pendingPool, activeProject?.id, tr);
  const { states: poolStates, queued: poolQueued } = pool;
  return <div ref={launcherPanel.root} className={`db-root${launcherPanel.resizing ? " db-resizing" : ""}`} lang={language} aria-busy={languageLoading || undefined} style={{ ...launcherPanel.style, visibility: languageLoading ? "hidden" : undefined }} onKeyDown={event => {
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      if (settings) { event.preventDefault(); event.stopPropagation(); setSettings(false); return; }
      if (historyProject) { event.preventDefault(); event.stopPropagation(); setHistoryProject(null); return; }
    }
    // Keep keyboard focus inside an overlaid history picker, away from the covered chat.
    if (compactWorkspace && historyProject && historyRef.current) trapTab(event, historyRef.current, 'button:not(:disabled), a[href]');
    launcherPanel.onKeyDown(event);
  }}>
    <header className="db-header">
      <button ref={launcherPanel.toggle} type="button" className="db-icon-btn db-launcher-toggle" title={launcherPanel.open ? tr("hideApps") : tr("showApps")} aria-label={launcherPanel.open ? tr("hideApps") : tr("showApps")} aria-expanded={launcherPanel.open} aria-controls={launcherPanel.panelId} onClick={launcherPanel.toggleOpen}><Icon name={launcherPanel.open ? "PanelLeftClose" : "PanelLeftOpen"} className="db-icon"/></button>
      <div className="db-thread-indicators" role="group" aria-label={tr("activitySummary", { working: runningCount, attention: attentionCount })}>
        {workspace.indicators.map(t => {
          const state = statusOf(t, tr);
          const label = `${projectName(t.projectId)} · ${t.displayTitle}: ${state.text}`;
          return <button key={t.id} type="button" className="db-thread-indicator" data-thread-id={t.id} title={label} aria-label={label} aria-pressed={sharedPool.open ? sharedPool.active === t.id : opened === t.id} onClick={() => openThread(t)}><ThreadIndicator tone={state.tone} subagent={isSubagent(t)}/></button>;
        })}
      </div>
      <SmallButton label={tr("workspaceSettings")} icon="Settings2" disabled={!data || saving} onClick={openSettings}/>
      <span className="db-sr" role="status">{notice && tr(notice)}</span>
    </header>
    <div className="db-layout" data-launcher-open={launcherPanel.open} data-launcher-overlay={launcherPanel.overlayOpen}>
      <div ref={launcherPanel.panel} id={launcherPanel.panelId} className="db-launcher-shell" inert={!launcherPanel.open} aria-hidden={!launcherPanel.open}>
      <aside className="db-launcher" aria-label={tr("appsPanel")}>
        <LauncherList entries={data ? config!.launcher : null} apps={apps} applicationMode={applicationMode} tr={tr}
          onOpen={id => navigation?.actions.activate(id, { target: "current" })} onOpenAlongside={openAppAlongside}
          onReorder={(id, targetId, after) => reorder("app", id, targetId, after)}/>
        {showQuotaDock && <ProviderUsageDock visible={launcherPanel.open} tr={tr} language={language}/>}
      </aside>
      <div className="db-launcher-resize" {...launcherPanel.resizeProps}/>
      </div>
      <div className="db-launcher-backdrop" aria-hidden="true" onClick={launcherPanel.close}/>
      <ApplicationWorkspace panes={appPanes} mode={applicationMode} activeAppId={appSplit.appSplit.activeAppId}
        setActiveApp={appSplit.setActiveApp} order={appSplit.appSplit.order} weights={appSplit.appSplit.sizes}
        setOrder={appSplit.setOrder} setWeights={appSplit.setWeights} close={appSplit.closeApp}
        openInBB={id => { navigation?.actions.activate(id, { target: "split" }); appSplit.closeApp(id); }}>
      <main ref={mainRef} className="db-main" aria-label={tr("workspace")} data-compact-workspace={compactWorkspace}>
        <div className="db-project-bar" data-shared-pool={sharedPool.open && sharedPoolEnabled || undefined}>
          {data && projectTabs.length > 0 && <ProjectTabs projects={projectTabs}
            activeId={sharedPool.open ? null : activeProject?.id ?? null} onSelect={selectProject} onCreate={createInProject}
            onReorder={(id, targetId, after) => reorder("project", id, targetId, after)}
            sharedPool={connected.length > 0 && sharedPoolEnabled ? {
              name: tr("sharedPool"), help: tr("sharedPoolHelp"), pressed: sharedPool.open,
              drop: threadDragging, states: poolStates, queued: poolQueued,
              controls: sharedPool.open ? "db-shared-pool" : undefined,
              onSelect: showSharedPool, onCreate: createInPool, onDragOver: allowPoolDrop, onDrop: dropOnPool,
            } : undefined}/>}
        </div>
        <div className="db-project-content">
        {(error || data?.syncError || live.status === "error") && <div className="db-error" role="alert"><span>{error ? tr(error) : tr("syncFailed")}</span><button type="button" className="db-button" onClick={() => void refresh()}>{tr("retry")}</button></div>}
        {sharedPool.entries.length >= sharedPoolLimit && (poolLimitNotice || creating === sharedPoolComposer) && <div className="db-warning" role="status" data-pool-full>{tr("poolFull")}</div>}
        {unplacedPoolThreads.map(entry => <div key={entry.threadId} className="db-warning" role="status" data-created-thread-id={entry.threadId}>
          <span>{tr(entry.reason === "limit" ? "poolCreatedFull" : "poolCreatedUnpinned")} · {projectName(entry.projectId)} · {workspace.byId.get(entry.threadId)?.displayTitle ?? entry.title}</span>
          <button type="button" className="db-button" onClick={() => openUnplacedPoolThread(entry)}>{tr("openCreatedThread")}</button>
        </div>)}
        <ConnectionWarning/>
        {!data || live.status === "loading" ? <Empty>{tr("loadingProjects")}</Empty> : connected.length === 0 ? <Empty><Icon name="FolderOpen" className="db-empty-icon"/><h3>{tr("chooseProjects")}</h3><p>{tr("chooseProjectsHelp")}</p></Empty> : sharedPool.open && sharedPoolEnabled ? <SharedPoolWorkspace
          model={sharedPoolWorkspaceView(pool, { active: sharedPool.active, sizes: sharedPool.sizes, creating: creating === sharedPoolComposer, saving, drafts })}
          tr={tr} drop={{ onDragOver: allowPoolDrop, onDrop: dropOnPool }}
          actions={{ create: createInPool, closeCreate: () => dispatch({ type: "create.close" }), submit: spawnPool,
            activate: id => dispatch({ type: "pool.activate", id }), remove: id => dispatch({ type: "pool.remove", id }), toggle: togglePool, add: pinPoolThread,
            move: (id, targetId, after) => dispatch({ type: "pool.move", id, targetId, after }), resize: sizes => dispatch({ type: "pool.resize", sizes }) }}/>
        : connected.map(projectConfig => {
          const projectId = projectConfig.id;
          const selected = projectId === activeProject?.id ? selectProjectWorkspace(workspace, projectId, splitLayouts[projectId], { opened, historyOpened, pendingCreated }) : null;
          const model = selected ? projectWorkspaceView({ projectId, project: workspace.projectsById.get(projectId), selected, threadsById: workspace.byId, layout: splitLayouts[projectId], opened, historyOpened, creating,
            historyExpanded: historyProject === projectId, compact: compactWorkspace, dragging: threadDragging, drafts, workingIds: workspace.workingIds, poolIds: sharedPool.entries.map(entry => entry.threadId), saving }, tr) : null;
          return <ProjectWorkspace key={projectId} projectId={projectId} model={model} tr={tr} historyRef={historyRef}
            actions={{ create: () => createInProject(projectId), closeCreate: () => dispatch({ type: "create.close" }), submit: request => spawnProject(projectId, request),
              open: id => { const thread = selected?.rows.find(row => row.id === id) ?? selected?.history.find(row => row.id === id); if (thread) openConversation(thread); },
              activate: id => { const thread = workspace.byId.get(id); if (thread) openConversation(thread); },
              toggle: id => { const thread = workspace.byId.get(id); if (thread) toggleThread(thread); },
              hide: id => { const thread = selected?.rows.find(row => row.id === id); return thread ? hide(thread) : Promise.resolve(false); },
              add: addPane, closePane: removePane, resize: sizes => dispatch({ type: "pane.resize", projectId, sizes }), togglePool: id => togglePool(projectId, id),
              history: open => { if (open) { historyOpener.current = document.activeElement as HTMLElement | null; setSettings(false); } setHistoryProject(open ? projectId : null); } }}/>
        })}
        </div>

      </main>
      </ApplicationWorkspace>
    </div>
    {settings && config && <Catalog applicationMode={applicationMode} onApplicationMode={appSplit.changeApplicationMode} config={config} projects={live.projects} apps={apps} appsReady={!!navigation} projectsStatus={live.status}
      showQuotaDock={showQuotaDock} onQuotaDockVisibility={changeQuotaVisibility}
      opener={settingsOpener} change={changeCatalog} onClose={() => setSettings(false)}/>}
  </div>;
}
function DashboardViewport() {
  const frame = useRef<HTMLDivElement>(null);
  useMobileComposerViewport(frame);
  const target = embeddedTarget();
  return target ? <EmbeddedLaunch id={target}/> : <div ref={frame} className="db-viewport"><DashboardPage/></div>;
}
export default definePluginApp(app => {
  app.slots.experimental_sidebarNavigation({ id: "launcher", title: "BBDesk", placement: "rail", component: LauncherNavigation });
  app.slots.navPanel({ id: "dashboard", title: "BBDesk", icon: "dashboard/mark", path: "home", component: DashboardViewport });
});
