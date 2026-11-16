import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import {
  definePluginApp, useRealtimeConnectionState, useSdk,
  experimental_useSidebarThreads as useThreads,
  experimental_SidebarNavigationIcon as NavigationIcon,
  useSidebarThreadDraftIds as useDraftIds,
  experimental_usePluginId as usePluginId,
} from "@get-bb/plugin-sdk/app";
import { Catalog } from "./catalog";
import type { CatalogChange } from "./catalog-config";
import { Icon } from "./components/ui/icon";
import { ThreadIndicator } from "./components/thread-indicator";
import { ProjectTabs, SharedPoolButton } from "./project-tabs";

import { sharedPoolComposer, selectionFields } from "./workspace-transitions";
import { useWorkspace } from "./hooks/use-workspace";
import { useThreadCompletion } from "./hooks/use-thread-completion";
import { useWorkspaceActions } from "./hooks/use-workspace-actions";
import { readThreadDrag, threadDragType, sharedPoolLimit, type PoolEntry } from "./split-layout";
import { usePanelFocus } from "./hooks/use-panel-focus";
import { useMobileComposerViewport } from "./hooks/use-mobile-composer-viewport";
import { isSubagent, isFinishedSubagent, sidebarActivity as activity } from "./state";
import { useLauncherPanel } from "./launcher-panel";
import { LauncherNavigation, useLauncherNavigation } from "./launcher-navigation";
import type { DashboardConfig } from "./contracts";
import type { MessageKey } from "./i18n";
import { useTranslation } from "./use-translation";
import { SmallButton } from "./components/workspace-button";
import { ProjectWorkspace } from "./components/project-workspace";
import { SharedPoolWorkspace } from "./components/shared-pool-workspace";
import { projectWorkspaceView, sharedPoolWorkspaceView } from "./workspace-view-models";
import "./styles.css";

import { useDashboardSnapshot } from "./hooks/use-dashboard-snapshot";
import { createWorkspaceModel, statusOf, projectEntryThread as selectProjectEntryThread, namedProject as selectProjectName, selectProjectTabs, selectProjectWorkspace, selectPoolWorkspace, type Thread } from "./workspace-selectors";

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
function DashboardPage() {
  const { t: tr, language, isLoading: languageLoading } = useTranslation();
  const launcherPanel = useLauncherPanel();
  const snapshot = useDashboardSnapshot();
  const { rpc, data, error, setError, report, refresh, applyConfig, mounted } = snapshot;
  const sdk = useSdk();
  const live = useThreads();
  const navigation = useLauncherNavigation();
  const pluginId = usePluginId();
  const drafts = useDraftIds();
  const controller = useWorkspace();
  const { state: workspaceState, dispatch, getState } = controller;
  const { layouts: splitLayouts, pool: sharedPool, notice, poolLimitNotice, unplaced: unplacedPoolThreads } = workspaceState;
  const setNotice = (value: MessageKey | "") => dispatch({ type: "notice", value });
  const { opened, historyOpened, creating } = selectionFields(workspaceState.selection);
  const { pendingCreated, projectId: activeProjectId } = workspaceState;
  const [threadDragging, setThreadDragging] = useState(false);
  const [appDrop, setAppDrop] = useState<{ id: string; after: boolean } | null>(null);
  const appDrag = useRef<string | null>(null);
  useEffect(() => {
    const start = (event: globalThis.DragEvent) => { if (Array.from(event.dataTransfer?.types ?? []).includes(threadDragType)) setThreadDragging(true); };
    const end = () => setThreadDragging(false);
    window.addEventListener("dragstart", start); window.addEventListener("dragend", end); window.addEventListener("drop", end, true);
    return () => { window.removeEventListener("dragstart", start); window.removeEventListener("dragend", end); window.removeEventListener("drop", end, true); };
  }, []);
  const [historyProject, setHistoryProject] = useState<string | null>(null);
  const [settings, setSettings] = useState<"projects" | "launcher" | "all" | null>(null);
  const settingsOpener = useRef<HTMLElement | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const historyOpener = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const compactWorkspace = workspaceWidth > 0 && workspaceWidth <= 680;
  useLayoutEffect(() => {
    if (!mainRef.current) return;
    const element = mainRef.current;
    const view = element.ownerDocument.defaultView;
    const measure = () => setWorkspaceWidth(element.clientWidth);
    measure();
    const Observer = typeof ResizeObserver === "undefined" ? view?.ResizeObserver : ResizeObserver;
    const observer = Observer ? new Observer(measure) : null;
    observer?.observe(element);
    view?.addEventListener("resize", measure);
    return () => { observer?.disconnect(); view?.removeEventListener("resize", measure); };
  }, []);
  usePanelFocus(historyRef, historyProject, historyOpener);
  const config = data?.config;
  const selectedThread = creating ? null : sharedPool.open ? sharedPool.active || sharedPool.entries[0]?.threadId || null : historyOpened ?? opened;
  const completionThreads = useThreadCompletion(live.threads, selectedThread, live.status === "ready");
  const workspace = createWorkspaceModel({ threads: completionThreads, projects: live.projects, config, tracked: data?.tracked, drafts, opened });
  const { current, connected, allThreads, runningCount, attentionCount } = workspace;
  const activeProject = workspace.connectedById.get(activeProjectId ?? "") ?? connected[0] ?? null;
  const { saving, hide, spawnProject, spawnPool } = useWorkspaceActions(controller, workspace, snapshot, sdk, tr);
  useEffect(() => {
    if (pendingCreated && (current?.id === pendingCreated.id || workspace.conversationsByProject.get(pendingCreated.projectId)?.has(pendingCreated.id))) dispatch({ type: "pending.seen", entry: pendingCreated });
  }, [pendingCreated, current, live.threads]);
  useEffect(() => {
    if (live.status !== "ready" || !opened || current && !isFinishedSubagent(activity(current))) return;
    // Spawn can resolve before the sidebar's live view includes the new thread.
    if (pendingCreated?.id === opened && !current) return;
    let manager = current;
    const visited = new Set<string>();
    while (manager && isSubagent(manager) && !visited.has(manager.id)) {
      visited.add(manager.id);
      const parentId = manager.lifecycleOwnerThreadId ?? manager.parentThreadId;
      manager = parentId ? workspace.byId.get(parentId) : undefined;
    }
    if (manager && !isSubagent(manager) && workspace.workingIds.has(manager.id)) {
      dispatch({ type: "selection.recover", projectId: manager.projectId, id: manager.id, expectedSelection: workspaceState.selection });
    } else dispatch({ type: "selection.recover", id: activeProject ? projectEntryThread(activeProject.id)?.id ?? null : null, expectedSelection: workspaceState.selection });
  }, [live.status, live.threads, opened, current, allThreads, pendingCreated]);
  useEffect(() => {
    if (live.status !== "ready" || !historyOpened || activeProject && workspace.visibleByProject.get(activeProject.id)?.has(historyOpened)) return;
    dispatch({ type: "selection.recover", id: activeProject ? projectEntryThread(activeProject.id)?.id ?? null : null, expectedSelection: workspaceState.selection });
  }, [live.status, live.threads, historyOpened, activeProject?.id]);
  useEffect(() => {
    if (!data || live.status !== "ready") return;
    dispatch({ type: "layouts.reconcile", workspace });
  }, [data, live.status, live.threads, pendingCreated]);
  const connectedIds = connected.map(project => project.id).join("\0");
  useEffect(() => {
    if (!data || live.status !== "ready") return;
    dispatch({ type: "pool.reconcile", workspace });
  }, [data, live.status, live.threads, connectedIds, pendingCreated]);
  const sharedPoolEnabled = config?.sharedPool !== false;
  useEffect(() => {
    if (sharedPoolEnabled) return;
    dispatch({ type: "pool.disable" });
  }, [sharedPoolEnabled]);
  function projectEntryThread(projectId: string) { return selectProjectEntryThread(workspace, projectId); }
  useEffect(() => {
    if (!data || live.status !== "ready" || !activeProject) return;
    dispatch({ type: "project.enter", projectId: activeProject.id, workspace, expectedProjectId: activeProjectId });
  }, [data, live.status, activeProject, allThreads, creating]);
  useEffect(() => {
    if (!activeProject || !data || live.status !== "ready") return;
    const id = historyOpened ?? opened;
    const choice = !creating && id && workspace.conversationsByProject.get(activeProject.id)?.has(id) ? { id, history: !!historyOpened } : undefined;
    dispatch({ type: "memory.remember", projectId: activeProject.id, choice, expectedSelection: workspaceState.selection });
  }, [activeProject?.id, data, live.status, live.threads, opened, historyOpened, creating]);
  function addPane(id: string, target?: string, after = true) {
    if (!activeProject || !workspace.conversationsByProject.get(activeProject.id)?.has(id)) return;
    dispatch({ type: "pane.add", projectId: activeProject.id, id, history: !workspace.workingIds.has(id), target, after });
    if (compactWorkspace) setHistoryProject(null);
  }
  function eligiblePoolThread(projectId: string, threadId: string) {
    return workspace.connectedById.has(projectId) ? workspace.conversationsByProject.get(projectId)?.get(threadId) ?? null : null;
  }
  function showSharedPool() {
    setHistoryProject(null); setSettings(null);
    dispatch({ type: "pool.show" });
  }
  function togglePool(projectId: string, threadId: string) {
    if (getState().pool.entries.some(entry => entry.threadId === threadId)) removePoolThread(threadId);
    else if (eligiblePoolThread(projectId, threadId)) pinPoolThread({ projectId, threadId });
  }
  function removePoolThread(threadId: string) {
    dispatch({ type: "pool.remove", id: threadId });
  }
  function pinPoolThread(entry: PoolEntry, target?: string, after = true) {
    dispatch({ type: "pool.pin", entry, target, after });
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
    const data = readThreadDrag(event.dataTransfer);
    if (!data || !eligiblePoolThread(data.projectId, data.threadId)) return;
    pinPoolThread(data);
  }
  function addPoolFromDrop(projectId: string, threadId: string, target?: string, after = true) {
    if (!eligiblePoolThread(projectId, threadId)) return;
    pinPoolThread({ projectId, threadId }, target, after);
  }
  function openUnplacedPoolThread(entry: PoolEntry) {
    if (!workspace.connectedById.has(entry.projectId) || !workspace.projectsById.has(entry.projectId)) { setError("projectGone"); return; }
    const thread = workspace.byId.get(entry.threadId);
    if (thread && (thread.isHidden || thread.isArchived || thread.projectId !== entry.projectId || isSubagent(thread))) { setError("threadUnavailable"); return; }
    dispatch({ type: "created.open", entry: { id: entry.threadId, projectId: entry.projectId } });
    setHistoryProject(null); setSettings(null);
    setError(null);
  }
  function removePane(id: string) {
    if (!activeProject) return;
    dispatch({ type: "pane.remove", projectId: activeProject.id, id, workspace });
    if (compactWorkspace) setHistoryProject(null);
  }
  function openConversation(t: Thread) {
    if (workspace.workingIds.has(t.id)) openThread(t);
    else {
      dispatch({ type: "conversation.open", projectId: t.projectId, id: t.id, history: true });
    }

    if (compactWorkspace) setHistoryProject(null);
  }
  function namedProject(projectId: string) { return selectProjectName(workspace, projectId, tr); }
  const projectTabs = selectProjectTabs(workspace, tr);
  function selectProject(id: string) {
    setHistoryProject(null);
    dispatch({ type: "project.select", projectId: id, workspace });
  }
  function openThread(t: Thread) {
    dispatch({ type: "conversation.open", projectId: t.projectId, id: t.id, history: false, enter: true });
    setSettings(null);
  }
  function createInProject(id: string) {
    setHistoryProject(null);
    dispatch({ type: "create.start", projectId: id, intent: {} });
  }
  function createInPool() {
    setHistoryProject(null); setSettings(null);
    dispatch({ type: "create.start", projectId: sharedPoolComposer, intent: {} });
  }
  function toggleThread(t: Thread) {
    if ((splitLayouts[t.projectId]?.ids.length ?? 0) > 1) { openConversation(t); return; }
    dispatch({ type: "conversation.toggle", id: t.id });
  }
  const apps = navigation?.items.filter(item => item.pluginId && item.pluginId !== pluginId) ?? [];
  function openSettings(next: "projects" | "launcher" | "all") {
    if (!config || saving) return;
    settingsOpener.current = document.activeElement as HTMLElement | null;
    setHistoryProject(null);
    setSettings(next);
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
      .then(() => { if (mounted.current) setNotice("catalogOrderSaved"); })
      .catch(cause => report(cause));
  }
  const pool = selectPoolWorkspace(workspace, sharedPool, workspaceState.pendingPool, activeProject?.id, tr);
  const { states: poolStates, queued: poolQueued } = pool;
  return <div ref={launcherPanel.root} className={`db-root${launcherPanel.resizing ? " db-resizing" : ""}`} lang={language} aria-busy={languageLoading || undefined} style={{ ...launcherPanel.style, visibility: languageLoading ? "hidden" : undefined }} onKeyDown={event => {
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      if (settings) { event.preventDefault(); event.stopPropagation(); setSettings(null); return; }
      if (historyProject) { event.preventDefault(); event.stopPropagation(); setHistoryProject(null); return; }
    }
    // Keep keyboard focus inside an overlaid history picker, away from the covered chat.
    if (event.key === "Tab" && compactWorkspace && historyProject && historyRef.current) {
      const buttons = historyRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]');
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (first && (event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus();
      }
    }
    launcherPanel.onKeyDown(event);
  }}>
    <header className="db-header">
      <button ref={launcherPanel.toggle} type="button" className="db-icon-btn db-launcher-toggle" title={launcherPanel.open ? tr("hideApps") : tr("showApps")} aria-label={launcherPanel.open ? tr("hideApps") : tr("showApps")} aria-expanded={launcherPanel.open} aria-controls={launcherPanel.panelId} onClick={launcherPanel.toggleOpen}><Icon name={launcherPanel.open ? "PanelLeftClose" : "PanelLeftOpen"} className="db-icon"/></button>
      <div className="db-thread-indicators" role="group" aria-label={tr("activitySummary", { working: runningCount, attention: attentionCount })}>
        {workspace.indicators.map(t => {
          const state = statusOf(t, tr);
          const label = `${namedProject(t.projectId)} · ${t.displayTitle}: ${state.text}`;
          return <button key={t.id} type="button" className="db-thread-indicator" data-thread-id={t.id} title={label} aria-label={label} aria-pressed={sharedPool.open ? sharedPool.active === t.id : opened === t.id} onClick={() => openThread(t)}><ThreadIndicator tone={state.tone} subagent={isSubagent(t)}/></button>;
        })}
      </div>
      <SmallButton label={tr("workspaceSettings")} icon="Settings2" disabled={!data || saving} onClick={() => openSettings("all")}/>
      <span className="db-sr" role="status">{notice && tr(notice)}</span>
    </header>
    <div className="db-layout" data-launcher-open={launcherPanel.open} data-launcher-overlay={launcherPanel.overlayOpen}>
      <div ref={launcherPanel.panel} id={launcherPanel.panelId} className="db-launcher-shell" inert={!launcherPanel.open} aria-hidden={!launcherPanel.open}>
      <aside className="db-launcher" aria-label={tr("appsPanel")}>
        <div className="db-launcher-list">
        {!data ? <p className="db-muted">{tr("loading")}</p> : config!.launcher.length === 0 ? <div className="db-launcher-empty"><Icon name="LayoutGrid" className="db-empty-icon"/><p>{tr("appsEmpty")}</p></div> : config!.launcher.map(entry => {
          const item = apps.find(candidate => candidate.id === entry.id);
          const unavailable = !item || item.isLoading || item.isDisabled;
          const dropMark = appDrop?.id === entry.id ? appDrop.after ? "after" : "before" : undefined;
          return <div className="db-launch-row" key={entry.id} draggable data-drop={dropMark} aria-dropeffect={appDrop ? "move" : undefined}
            onDragStart={event => {
              appDrag.current = entry.id;
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", `db-app:${entry.id}`);
            }}
            onDragEnd={() => { appDrag.current = null; setAppDrop(null); }}
            onDragOver={event => {
              if (appDrag.current === null || appDrag.current === entry.id) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              const rect = event.currentTarget.getBoundingClientRect();
              const after = event.clientY >= rect.top + rect.height / 2;
              setAppDrop(previous => previous?.id === entry.id && previous.after === after ? previous : { id: entry.id, after });
            }}
            onDrop={event => {
              const source = appDrag.current;
              appDrag.current = null; setAppDrop(null);
              if (!source || source === entry.id) return;
              event.preventDefault();
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              reorder("app", source, entry.id, event.clientY >= rect.top + rect.height / 2);
            }}>
            <button type="button" className="db-launch-main" draggable={false} disabled={unavailable} title={unavailable ? tr("appUnavailableHelp") : entry.label} onClick={() => navigation?.actions.activate(entry.id, { target: "current" })}>
              {item ? <NavigationIcon icon={item.icon} className="db-icon"/> : <Icon name="AppWindow" className="db-icon"/>}<span className="db-launch-label">{entry.label}{unavailable && <small>{tr("unavailable")}</small>}</span>
            </button>
            <button type="button" className="db-launch-split" draggable={false} disabled={unavailable} title={tr("splitHelp")} aria-label={tr("openAlongside", { name: entry.label })} onClick={() => navigation?.actions.activate(entry.id, { target: "split" })}><Icon name="Columns2" className="db-icon"/></button>
          </div>;
        })}
        </div>
      </aside>
      <div className="db-launcher-resize" {...launcherPanel.resizeProps}/>
      </div>
      <div className="db-launcher-backdrop" aria-hidden="true" onClick={launcherPanel.close}/>
      <main ref={mainRef} className="db-main" aria-label={tr("workspace")} data-compact-workspace={compactWorkspace}>
        <div className="db-project-bar" data-shared-pool={sharedPool.open && sharedPoolEnabled || undefined}>
          <div className="db-project-tools">{data && projectTabs.some(project => project.common) && <ProjectTabs projects={projectTabs.filter(project => project.common)} label={tr("commonThreads")} activeId={sharedPool.open ? null : activeProject?.id ?? null} onSelect={selectProject} onCreate={createInProject}/>}{data && connected.length > 0 && sharedPoolEnabled && <><SharedPoolButton name={tr("sharedPool")} help={tr("sharedPoolHelp")} pressed={sharedPool.open} drop={threadDragging} states={poolStates} queued={poolQueued} controls={sharedPool.open ? "db-shared-pool" : undefined} onClick={showSharedPool} onDragOver={allowPoolDrop} onDrop={dropOnPool}/><button type="button" className="db-tab-create db-icon-btn" title={tr("newThreadTitle", { name: tr("sharedPool") })} aria-label={tr("newThreadInPool")} onClick={createInPool}><Icon name="Plus" className="db-icon"/></button></>}</div>
          {data && projectTabs.some(project => !project.common) && <ProjectTabs projects={projectTabs.filter(project => !project.common)} activeId={sharedPool.open ? null : activeProject?.id ?? null} onSelect={selectProject} onCreate={createInProject} onReorder={(id, targetId, after) => reorder("project", id, targetId, after)}/>}
        </div>
        <div className="db-project-content">
        {(error || data?.syncError || live.status === "error") && <div className="db-error" role="alert"><span>{error ? tr(error) : tr("syncFailed")}</span><button type="button" className="db-button" onClick={() => void refresh()}>{tr("retry")}</button></div>}
        {sharedPool.entries.length >= sharedPoolLimit && (poolLimitNotice || creating === sharedPoolComposer) && <div className="db-warning" role="status" data-pool-full>{tr("poolFull")}</div>}
        {unplacedPoolThreads.map(entry => <div key={entry.threadId} className="db-warning" role="status" data-created-thread-id={entry.threadId}>
          <span>{tr(entry.reason === "limit" ? "poolCreatedFull" : "poolCreatedUnpinned")} · {namedProject(entry.projectId)} · {workspace.byId.get(entry.threadId)?.displayTitle ?? entry.title}</span>
          <button type="button" className="db-button" onClick={() => openUnplacedPoolThread(entry)}>{tr("openCreatedThread")}</button>
        </div>)}
        <ConnectionWarning/>
        {!data || live.status === "loading" ? <Empty>{tr("loadingProjects")}</Empty> : connected.length === 0 ? <Empty><Icon name="FolderOpen" className="db-empty-icon"/><h3>{tr("chooseProjects")}</h3><p>{tr("chooseProjectsHelp")}</p></Empty> : sharedPool.open && sharedPoolEnabled ? <SharedPoolWorkspace
          model={sharedPoolWorkspaceView(pool, { active: sharedPool.active, sizes: sharedPool.sizes, creating: creating === sharedPoolComposer, saving, drafts })}
          tr={tr} drop={{ onDragOver: allowPoolDrop, onDrop: dropOnPool }}
          actions={{ create: createInPool, closeCreate: () => dispatch({ type: "create.close" }), submit: spawnPool,
            activate: id => dispatch({ type: "pool.activate", id }), remove: removePoolThread, toggle: togglePool, add: addPoolFromDrop,
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
              history: open => { if (open) { historyOpener.current = document.activeElement as HTMLElement | null; setSettings(null); } setHistoryProject(open ? projectId : null); } }}/>
        })}
        </div>

      </main>
    </div>
    {settings && config && <Catalog config={config} projects={live.projects} apps={apps} appsReady={!!navigation} projectsStatus={live.status}
      initialFilter={settings === "projects" ? "project" : settings === "launcher" ? "app" : "all"} opener={settingsOpener}
      change={changeCatalog} onClose={() => setSettings(null)}
      onApp={id => { if (!navigation) throw new Error("Navigation unavailable"); navigation.actions.activate(id, { target: "current" }); }}/>}
  </div>;
}
function DashboardViewport() {
  const frame = useRef<HTMLDivElement>(null);
  useMobileComposerViewport(frame);
  return <div ref={frame} className="db-viewport"><DashboardPage/></div>;
}
export default definePluginApp(app => {
  app.slots.experimental_sidebarNavigation({ id: "launcher", title: "BBDesk", placement: "rail", component: LauncherNavigation });
  app.slots.navPanel({ id: "dashboard", title: "BBDesk", icon: "dashboard/mark", path: "home", component: DashboardViewport });
});
