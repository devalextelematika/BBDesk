import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import {
  definePluginApp, useRpc, useRealtime, useRealtimeConnectionState, useSdk,
  experimental_useSidebarThreads as useThreads,
  experimental_SidebarNavigationIcon as NavigationIcon,
  useSidebarThreadDraftIds as useDraftIds,
  experimental_usePluginId as usePluginId,
  ThreadChat,
} from "@get-bb/plugin-sdk/app";
import { Icon, type IconName } from "./components/ui/icon";
import { ThreadIndicator } from "./components/thread-indicator";
import { ProjectTabs } from "./project-tabs";
import { ThreadTabs, compareThreadCreation, type ThreadTab } from "./thread-tabs";
import { SplitWorkspace } from "./split-workspace";
import { readSplitLayouts, saveSplitLayouts, selectSplitThread, startThreadDrag, threadDragType, type SplitLayouts } from "./split-layout";
import { readWorkspaceMemory, saveWorkspaceMemory } from "./workspace-memory";
import { ConversationMetadata, ConversationResults, type ConversationItem } from "./conversation-list";
import { useUndoExpiry } from "./undo-tab";
import { usePanelFocus } from "./hooks/use-panel-focus";
import { hasWork, isWorking, isSubagent, isFinishedSubagent, type Activity, type TrackedThread } from "./state";
import { followChatBottom } from "./chat-scroll";
import { preserveChatReading } from "./chat-reading";
import { ChatFileSurface } from "./chat-file-surface";
import { useLauncherPanel } from "./launcher-panel";
import { LauncherNavigation, useLauncherNavigation } from "./launcher-navigation";
import type { rpcContract, DashboardConfig } from "./server";
import type { MessageKey, Translator } from "./i18n";
import { useTranslation } from "./use-translation";
import { RememberThreadPermission, RememberingNewThreadComposer as NewThreadComposer } from "./permission-composers";
import "./styles.css";

type Thread = ReturnType<typeof useThreads>["threads"][number];
type Snapshot = { config: DashboardConfig; tracked: TrackedThread[]; syncError: string | null; syncedAt: number | null };
const activity = (t: Thread): Activity => ({ ...t, backgroundAgents: t.activity.backgroundAgents, backgroundCommands: t.activity.backgroundCommands, workflows: t.activity.workflows });
const needsAttention = (t: Thread) => t.hasPendingInteraction || t.status === "error" || t.queuedWork === "failed" || t.isUnread && !isWorking(activity(t));
const compareThreads = (a: Thread, b: Thread) => Number(needsAttention(b)) - Number(needsAttention(a)) || Number(isWorking(activity(b))) - Number(isWorking(activity(a))) || b.latestAttentionAt - a.latestAttentionAt || a.id.localeCompare(b.id);
function statusOf(t: Thread, tr: Translator) {
  if (t.hasPendingInteraction) return { text: tr("actionNeeded"), tone: "attention" };
  if (t.queuedWork === "failed" || t.status === "error") return { text: tr("error"), tone: "error" };
  if (t.runtimeStatus === "waiting-for-host") return { text: tr("waitingHost"), tone: "waiting" };
  if (t.runtimeStatus === "provisioning") return { text: tr("provisioning"), tone: "running" };
  if (t.status === "pending") return { text: tr("pending"), tone: "waiting" };
  if (t.status === "starting") return { text: tr("starting"), tone: "running" };
  if (t.status === "stopping") return { text: tr("stopping"), tone: "running" };
  if (isWorking(activity(t))) return { text: isSubagent(t) ? tr("subagentWorking") : tr("working"), tone: "running" };
  if (t.queuedWork === "waiting") return { text: tr("queued"), tone: "waiting" };
  if (t.isUnread) return { text: tr("newReply"), tone: "result" };
  if (t.status !== "idle") return { text: tr("unknownState"), tone: "unknown" };
  return { text: tr("read"), tone: "read" };
}
function Empty({ children }: { children: ReactNode }) { return <div className="db-empty" role="status">{children}</div>; }
function SmallButton({ label, icon, onClick, disabled = false }: { label: string; icon: IconName; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="db-icon-btn" title={label} aria-label={label} onClick={onClick} disabled={disabled}><Icon name={icon} className="db-icon"/></button>;
}
function ExpandedChat({ threadId, fillSpace = false }: { threadId: string; fillSpace?: boolean }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (fillSpace && viewport.current) return preserveChatReading(viewport.current, threadId);
  }, [threadId, fillSpace]);
  useEffect(() => {
    if (fillSpace || !viewport.current || !content.current) return;
    viewport.current.scrollIntoView?.({ block: "nearest" });
    return followChatBottom(viewport.current, content.current);
  }, [threadId, fillSpace]);
  return <div className="db-chat-surface" ref={viewport}><div ref={content}>
    <RememberThreadPermission threadId={threadId}/>
    <ChatFileSurface threadId={threadId}><ThreadChat threadId={threadId} variant="full" layout={fillSpace ? "contained" : "document"} permissionPolicy="editable"/></ChatFileSurface>
  </div></div>;
}
function ConnectionIndicator() {
  const { t: tr, isLoading } = useTranslation();
  const connection = useRealtimeConnectionState();
  const label = isLoading ? "BBDesk" : connection === "connected" ? tr("connected") : tr("reconnecting");
  return <span className="db-connection" role="status" title={label}><span className={connection === "connected" ? "db-dot running" : "db-dot waiting"} aria-hidden="true"/><span className="db-sr">{label}</span></span>;
}
function DashboardPage() {
  const [workspaceMemory] = useState(readWorkspaceMemory);
  const [splitLayouts, setSplitLayouts] = useState<SplitLayouts>(readSplitLayouts);
  useEffect(() => saveSplitLayouts(splitLayouts), [splitLayouts]);
  const { t: tr, language, isLoading: languageLoading } = useTranslation();
  const launcherPanel = useLauncherPanel();
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();
  const live = useThreads();
  const navigation = useLauncherNavigation();
  const pluginId = usePluginId();
  const drafts = useDraftIds();
  const connection = useRealtimeConnectionState();
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [notice, setNotice] = useState<MessageKey | "">("");
  const [opened, setOpened] = useState<string | null>(null);
  const [threadDragging, setThreadDragging] = useState(false);
  useEffect(() => {
    const start = (event: globalThis.DragEvent) => { if (Array.from(event.dataTransfer?.types ?? []).includes(threadDragType)) setThreadDragging(true); };
    const end = () => setThreadDragging(false);
    window.addEventListener("dragstart", start); window.addEventListener("dragend", end); window.addEventListener("drop", end, true);
    return () => { window.removeEventListener("dragstart", start); window.removeEventListener("dragend", end); window.removeEventListener("drop", end, true); };
  }, []);
  const [historyProject, setHistoryProject] = useState<string | null>(null);
  const [historyOpened, setHistoryOpened] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [pendingCreated, setPendingCreated] = useState<{ id: string; projectId: string } | null>(null);
  const creationIntent = useRef<object | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(workspaceMemory.projectId);
  const [searchVisible, setSearchVisible] = useState(false);
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [search, setSearch] = useState("");
  const [settings, setSettings] = useState<"projects" | "launcher" | null>(null);
  const settingsRef = useRef<HTMLElement>(null);
  const settingsOpener = useRef<HTMLElement | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const historyOpener = useRef<HTMLElement | null>(null);
  const searchPanelRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchOpener = useRef<HTMLElement | null>(null);
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
  usePanelFocus(settingsRef, settings, settingsOpener);
  usePanelFocus(historyRef, historyProject, historyOpener);
  usePanelFocus(searchPanelRef, searchVisible && !settings, searchOpener, searchInputRef);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [launcherDraft, setLauncherDraft] = useState<DashboardConfig["launcher"]>([]);
  const draggedEntry = useRef<string | null>(null);
  const [entryDropTarget, setEntryDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  const [draggingEntry, setDraggingEntry] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [undoHide, setUndoHide] = useState<{ id: string; projectId: string; token: string; tab: ThreadTab } | null>(null);
  const [undoPaused, setUndoPaused] = useState(false);
  const dismissUndo = useCallback(() => setUndoHide(null), []);
  useUndoExpiry(undoHide?.token, undoPaused || saving, dismissUndo);
  useEffect(() => {
    if (settings === "projects" && launcherPanel.compact && launcherPanel.open) launcherPanel.close();
  }, [settings, launcherPanel.compact, launcherPanel.open, launcherPanel.close]);
  const requestRunning = useRef(false);
  const requestAgain = useRef(false);
  const mounted = useRef(true);
  const enteredProject = useRef<string | null>(null);
  const report = useCallback((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    setError(message.includes("DASHBOARD_PROJECT_UNAVAILABLE") ? "projectGone"
      : message.includes("DASHBOARD_THREAD_UNAVAILABLE") ? "threadUnavailable" : "actionFailed");
  }, []);
  const refresh = useCallback(async () => {
    if (requestRunning.current) { requestAgain.current = true; return; }
    requestRunning.current = true;
    try {
      do {
        requestAgain.current = false;
        const next = await rpc.call("snapshot");
        if (mounted.current) { setData(next); setError(null); }
      } while (requestAgain.current && mounted.current);
    } catch (cause) { if (mounted.current) report(cause); }
    finally { requestRunning.current = false; }
  }, [rpc, report]);
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; }; }, [refresh]);
  useRealtime("dashboard-changed", refresh);
  useEffect(() => { if (connection === "connected") void refresh(); }, [connection, refresh]);
  const current = live.threads.find(t => t.id === opened && !t.isArchived && !t.isHidden);
  const config = data?.config;
  const trackedIds = new Set(data?.tracked.filter(t => t.visible).map(t => t.id));
  const connected = config?.projects.filter(p => p.enabled) ?? [];
  const activeProject = connected.find(project => project.id === activeProjectId) ?? connected[0] ?? null;
  const allThreads = live.threads.filter(t => !t.isHidden && !t.isArchived && connected.some(p => p.id === t.projectId)
    && !isFinishedSubagent(activity(t))
    && (trackedIds.has(t.id) || hasWork(activity(t)) || drafts.has(t.id) || opened === t.id
      || t.latestAttentionAt > (config?.projects.find(p => p.id === t.projectId)?.connectedAt ?? Infinity)
        && !data?.tracked.some(row => row.id === t.id && !row.visible && row.hiddenAttentionAt >= t.latestAttentionAt)));
  useEffect(() => {
    if (pendingCreated && current?.id === pendingCreated.id) setPendingCreated(null);
  }, [pendingCreated, current]);
  useEffect(() => {
    if (live.status !== "ready" || !opened || current && !isFinishedSubagent(activity(current))) return;
    // Spawn can resolve before the sidebar's live view includes the new thread.
    if (pendingCreated?.id === opened && !current) return;
    let manager = current;
    const visited = new Set<string>();
    while (manager && isSubagent(manager) && !visited.has(manager.id)) {
      visited.add(manager.id);
      const parentId = manager.lifecycleOwnerThreadId ?? manager.parentThreadId;
      manager = live.threads.find(t => t.id === parentId);
    }
    if (manager && !isSubagent(manager) && allThreads.some(t => t.id === manager.id)) {
      enteredProject.current = manager.projectId;
      setActiveProjectId(manager.projectId); setOpened(manager.id);
    } else setOpened(activeProject ? projectEntryThread(activeProject.id)?.id ?? null : null);
  }, [live.status, live.threads, opened, current, allThreads, pendingCreated]);
  useEffect(() => {
    if (live.status !== "ready" || !historyOpened || live.threads.some(t => t.id === historyOpened && t.projectId === activeProject?.id && !t.isHidden && !t.isArchived)) return;
    setHistoryOpened(null);
    setOpened(activeProject ? projectEntryThread(activeProject.id)?.id ?? null : null);
  }, [live.status, live.threads, historyOpened, activeProject?.id]);
  useEffect(() => {
    if (!data || live.status !== "ready") return;
    setSplitLayouts(previous => {
      let changed = false;
      const next: SplitLayouts = {};
      for (const [projectId, layout] of Object.entries(previous)) {
        const ids = layout.ids.filter(id => pendingCreated?.id === id && pendingCreated.projectId === projectId || live.threads.some(t => t.id === id && t.projectId === projectId && !t.isHidden && !t.isArchived && !isSubagent(t)));
        if (ids.length === layout.ids.length) { next[projectId] = layout; continue; }
        changed = true;
        if (ids.length) next[projectId] = { ...layout, ids, active: ids.includes(layout.active) ? layout.active : ids[0]! };
      }
      return changed ? next : previous;
    });
  }, [data, live.status, live.threads, pendingCreated]);
  const runningCount = allThreads.filter(t => isWorking(activity(t))).length;
  function projectEntryThread(projectId: string) {
    const threads = allThreads.filter(t => t.projectId === projectId && !isSubagent(t)).sort(compareThreads);
    return threads.find(t => statusOf(t, tr).tone === "attention")
      ?? threads.find(t => statusOf(t, tr).tone === "result")
      ?? threads.find(t => ["running", "waiting"].includes(statusOf(t, tr).tone))
      ?? threads.sort((a, b) => b.latestAttentionAt - a.latestAttentionAt || a.id.localeCompare(b.id))[0];
  }
  function restoreProject(projectId: string) {
    const layout = splitLayouts[projectId];
    const splitThread = layout && live.threads.find(t => t.id === layout.active && t.projectId === projectId && !t.isHidden && !t.isArchived);
    const choice = splitThread ? { id: splitThread.id, history: !allThreads.some(t => t.id === splitThread.id) } : workspaceMemory.conversations[projectId];
    const remembered = choice && live.threads.find(t => t.id === choice.id && t.projectId === projectId
      && !t.isHidden && !t.isArchived && !isSubagent(t) && (choice.history || allThreads.some(row => row.id === t.id)));
    setHistoryOpened(remembered && choice.history ? remembered.id : null);
    setOpened(remembered ? choice.history ? null : remembered.id : projectEntryThread(projectId)?.id ?? null);
  }
  useEffect(() => {
    if (!data || live.status !== "ready" || !activeProject) return;
    if (enteredProject.current === activeProject.id) return;
    enteredProject.current = activeProject.id;
    if (creating === activeProject.id) return;
    restoreProject(activeProject.id);
  }, [data, live.status, activeProject, allThreads, creating]);
  useEffect(() => {
    if (!activeProject || !data || live.status !== "ready") return;
    workspaceMemory.projectId = activeProject.id;
    const id = historyOpened ?? opened;
    if (!creating && id && live.threads.some(t => t.id === id && t.projectId === activeProject.id && !t.isArchived && !t.isHidden && !isSubagent(t))) {
      workspaceMemory.conversations[activeProject.id] = { id, history: !!historyOpened };
    }
    saveWorkspaceMemory(workspaceMemory);
  }, [activeProject?.id, data, live.status, live.threads, opened, historyOpened, creating, workspaceMemory]);
  const attentionCount = allThreads.filter(needsAttention).length;
  const projectConversations = live.threads.filter(t => t.projectId === activeProject?.id && !t.isHidden && !t.isArchived && !isSubagent(t));
  const searchResults = projectConversations.filter(t => (filter === "all" || needsAttention(t))
    && `${t.displayTitle} ${t.environment?.name ?? ""} ${t.environment?.branchName ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a, b) => b.latestAttentionAt - a.latestAttentionAt || a.id.localeCompare(b.id));
  const conversationItem = (t: Thread): ConversationItem => ({ id: t.id, title: t.displayTitle,
    detail: t.environment?.name ?? t.environment?.branchName ?? t.host?.name ?? "", updatedAt: t.latestAttentionAt || t.createdAt || 0 });
  function selectPane(projectId: string, id: string) {
    setSplitLayouts(previous => previous[projectId] ? { ...previous, [projectId]: selectSplitThread(previous[projectId]!, id) } : previous);
  }
  function addPane(id: string, target?: string, after = true) {
    const thread = live.threads.find(t => t.id === id && t.projectId === activeProject?.id && !t.isArchived && !t.isHidden && !isSubagent(t));
    if (!thread || !activeProject) return;
    const projectId = activeProject.id;
    const currentId = historyOpened ?? opened;
    setSplitLayouts(previous => {
      const layout = previous[projectId] ?? { ids: currentId ? [currentId] : [], active: currentId ?? id, sizes: {} };
      if (layout.ids.includes(id)) return { ...previous, [projectId]: { ...layout, active: id } };
      const ids = [...layout.ids];
      const index = target ? ids.indexOf(target) : ids.indexOf(layout.active);
      ids.splice(index < 0 ? ids.length : index + Number(after), 0, id);
      // Adding a column starts with equal widths, without remounting existing chats.
      return { ...previous, [projectId]: { ids, active: id, sizes: {} } };
    });
    // Selection is already handled above: do not replace the previous active column.
    if (allThreads.some(row => row.id === id)) { setOpened(id); setHistoryOpened(null); }
    else { setOpened(null); setHistoryOpened(id); }
    enteredProject.current = projectId;
    creationIntent.current = null; setPendingCreated(null); setCreating(null);
    setSearchVisible(false); setSearch("");
    if (compactWorkspace) setHistoryProject(null);
  }
  function removePane(id: string) {
    if (!activeProject) return;
    const layout = splitLayouts[activeProject.id];
    if (!layout) return;
    const ids = layout.ids.filter(value => value !== id);
    const next = layout.active === id ? ids[Math.min(layout.ids.indexOf(id), ids.length - 1)] : layout.active;
    const thread = live.threads.find(t => t.id === next);
    if (thread) openConversation(thread);
    setSplitLayouts(previous => ({ ...previous, [activeProject.id]: { ...layout, ids, active: next ?? "" } }));
  }
  function openConversation(t: Thread) {
    if (allThreads.some(row => row.id === t.id)) openThread(t);
    else {
      creationIntent.current = null; setPendingCreated(null); setOpened(null); setCreating(null);
      selectPane(t.projectId, t.id);
      setHistoryOpened(t.id);
    }
    setSearchVisible(false); setSearch("");
    if (compactWorkspace) setHistoryProject(null);
  }
  const projectTabs = connected.map(project => {
    const info = live.projects.find(p => p.id === project.id);
    const threads = allThreads.filter(t => t.projectId === project.id);
    const states = threads.map(t => ({ id: t.id, title: t.displayTitle, subagent: isSubagent(t), providerId: t.providerId, ...statusOf(t, tr) }));
    return { id: project.id, name: info?.name ?? tr("projectUnavailable"), available: !!info,
      running: states.filter(state => state.tone === "running").length,
      attention: states.filter(state => state.tone === "attention").length,
      queued: threads.filter(t => t.queuedWork === "waiting").length,
      total: threads.length,
      states };
  });
  function selectProject(id: string) {
    setHistoryProject(null); setHistoryOpened(null);
    creationIntent.current = null; setPendingCreated(null);
    enteredProject.current = id;
    setActiveProjectId(id); restoreProject(id); setCreating(null); setNotice("");
  }
  function openThread(t: Thread) {
    selectPane(t.projectId, t.id);
    setHistoryOpened(null);
    creationIntent.current = null; setPendingCreated(null);
    enteredProject.current = t.projectId;
    setActiveProjectId(t.projectId); setOpened(t.id); setCreating(null); setSettings(null); setNotice("");
  }
  function createInProject(id: string) {
    setHistoryProject(null); setHistoryOpened(null);
    creationIntent.current = {}; setPendingCreated(null);
    setActiveProjectId(id); setOpened(null); setCreating(id); setNotice("");
  }
  function toggleThread(t: Thread) {
    if ((splitLayouts[t.projectId]?.ids.length ?? 0) > 1) { openConversation(t); return; }
    setSplitLayouts(previous => {
      if (!previous[t.projectId]) return previous;
      const next = { ...previous }; delete next[t.projectId]; return next;
    });
    setHistoryOpened(null);
    creationIntent.current = null; setPendingCreated(null);
    setOpened(opened === t.id ? null : t.id); setCreating(null);
  }
  const apps = navigation?.items.filter(item => item.pluginId && item.pluginId !== pluginId) ?? [];
  function openSettings(next: "projects" | "launcher") {
    if (!config || saving) return;
    endEntryDrag();
    if (settings !== next) settingsOpener.current = document.activeElement as HTMLElement | null;
    setHistoryProject(null);
    setSelectedProjects(config.projects.filter(p => p.enabled).map(p => p.id));
    setLauncherDraft(config.launcher.map(item => ({ ...item })));
    setSettings(settings === next ? null : next);

  }
  async function saveSettings() {
    setSaving(true); setError(null);
    try {
      if (settings === "projects") await rpc.call("projects_set", { ids: selectedProjects });
      else await rpc.call("launcher_set", { items: launcherDraft });
      await refresh(); setSettings(null); setNotice("settingsSaved");
    } catch (cause) { report(cause); }
    finally { setSaving(false); }
  }
  async function hide(t: Thread) {
    setSaving(true);
    try {
      const result = await rpc.call("thread_hide", { threadId: t.id });
      if (!result.hidden) throw new Error("DASHBOARD_THREAD_UNAVAILABLE");
      setSplitLayouts(previous => {
        const layout = previous[t.projectId];
        if (!layout?.ids.includes(t.id)) return previous;
        const ids = layout.ids.filter(id => id !== t.id);
        return { ...previous, [t.projectId]: { ...layout, ids, active: layout.active === t.id ? ids[0] ?? "" : layout.active } };
      });
      const projectThreads = allThreads.filter(thread => thread.projectId === t.projectId && !isSubagent(thread)).sort(compareThreadCreation);
      const index = projectThreads.findIndex(thread => thread.id === t.id);
      const next = projectThreads[index + 1] ?? projectThreads[index - 1];
      if (workspaceMemory.conversations[t.projectId]?.id === t.id) delete workspaceMemory.conversations[t.projectId];
      const layout = splitLayouts[t.projectId];
      const remaining = layout?.ids.filter(id => id !== t.id) ?? [];
      if (layout?.active === t.id && remaining.length) {
        const replacement = remaining[0]!;
        const historical = !allThreads.some(thread => thread.id === replacement);
        setOpened(historical ? null : replacement);
        setHistoryOpened(historical ? replacement : null);
      } else setOpened(currentId => currentId === t.id ? next?.id ?? null : currentId);
      setUndoHide(result.undoToken ? { id: t.id, projectId: t.projectId, token: result.undoToken,
        tab: { id: t.id, createdAt: t.createdAt, title: t.displayTitle, detail: t.environment?.name ?? "", tone: "read", status: tr("read"), canHide: false } } : null);
      await refresh(); setNotice("threadHidden");
      return true;
    } catch (cause) { report(cause); return false; }
    finally { setSaving(false); }
  }
  async function restoreHidden() {
    if (!undoHide || saving) return;
    const returnFocus = document.activeElement?.classList.contains('db-thread-undo');
    setSaving(true); setError(null);
    try {
      const result = await rpc.call("thread_restore", { threadId: undoHide.id, undoToken: undoHide.token });
      if (!result.restored) throw new Error("DASHBOARD_THREAD_UNAVAILABLE");
      await refresh(); setUndoHide(null); setNotice("threadRestored");
      if (returnFocus) (launcherPanel.root.current?.querySelector<HTMLElement>('.db-thread-tabs [aria-selected="true"]')
        ?? launcherPanel.root.current?.querySelector<HTMLElement>('.db-thread-create'))?.focus();
    } catch (cause) { report(cause); }
    finally { setSaving(false); }
  }
  function moveApp(index: number, direction: -1 | 1) {
    const next = [...launcherDraft];
    [next[index], next[index + direction]] = [next[index + direction]!, next[index]!];
    setLauncherDraft(next);
  }
  function moveProject(index: number, direction: -1 | 1) {
    setSelectedProjects(previous => {
      const next = [...previous];
      [next[index], next[index + direction]] = [next[index + direction]!, next[index]!];
      return next;
    });
  }
  function endEntryDrag() {
    draggedEntry.current = null;
    setDraggingEntry(null);
    setEntryDropTarget(null);
  }
  function entryDropPosition(event: DragEvent<HTMLDivElement>, id: string) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { id, after: event.clientY >= rect.top + rect.height / 2 };
  }
  function dropEntry(event: DragEvent<HTMLDivElement>, id: string) {
    if (saving || !draggedEntry.current) return;
    event.preventDefault();
    const sourceId = draggedEntry.current;
    const target = entryDropPosition(event, id);
    if (settings === "projects") {
      setSelectedProjects(previous => {
        if (sourceId === id || !previous.includes(sourceId)) return previous;
        const next = previous.filter(projectId => projectId !== sourceId);
        const targetIndex = next.indexOf(id);
        if (targetIndex < 0) return previous;
        next.splice(targetIndex + Number(target.after), 0, sourceId);
        return next;
      });
    } else setLauncherDraft(previous => {
      const source = previous.find(row => row.id === sourceId);
      if (!source || sourceId === id) return previous;
      const next = previous.filter(row => row.id !== sourceId);
      const targetIndex = next.findIndex(row => row.id === id);
      if (targetIndex < 0) return previous;
      next.splice(targetIndex + Number(target.after), 0, source);
      return next;
    });
    endEntryDrag();
  }
  const settingsPanel = settings && <section ref={settingsRef} className="db-settings" role="dialog" aria-label={settings === "projects" ? tr("selectProjectsTitle") : tr("configureAppsTitle")}>
          <div className="db-settings-heading"><h3>{settings === "projects" ? tr("dashboardProjects") : tr("panelApps")}</h3><SmallButton label={tr("closeSettings")} icon="X" onClick={() => setSettings(null)} disabled={saving}/></div>
          <div className="db-settings-body">
          <p className="db-muted">{settings === "projects" ? tr("projectsHelp") : tr("appsHelp")}</p>
          <div className="db-checks">{settings === "projects" ? live.projects.filter(p => !p.isPersonal).map(project => <label key={project.id}><input type="checkbox" disabled={saving} checked={selectedProjects.includes(project.id)} onChange={e => setSelectedProjects(e.target.checked ? [...selectedProjects, project.id] : selectedProjects.filter(id => id !== project.id))}/>{project.name}</label>) : apps.map(item => <label key={item.id}><input type="checkbox" disabled={saving} checked={launcherDraft.some(entry => entry.id === item.id)} onChange={e => setLauncherDraft(e.target.checked ? [...launcherDraft, { id: item.id, label: item.label }] : launcherDraft.filter(entry => entry.id !== item.id))}/><NavigationIcon icon={item.icon} className="db-icon"/>{item.label}</label>)}</div>
          {settings === "launcher" && !navigation && <p className="db-muted">{tr("navigationHelp")}</p>}
          {settings === "launcher" && navigation && apps.length === 0 && <p className="db-muted">{tr("noApps")}</p>}
          {settings === "launcher" && launcherDraft.map((entry, index) => <div
            className="db-edit-app" key={entry.id}
            data-dragging={draggingEntry === entry.id || undefined}
            data-drop={entryDropTarget?.id === entry.id ? entryDropTarget.after ? "after" : "before" : undefined}
            onDragOver={event => {
              if (saving || !draggedEntry.current) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setEntryDropTarget(draggedEntry.current === entry.id ? null : entryDropPosition(event, entry.id));
            }}
            onDragLeave={event => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setEntryDropTarget(null);
            }}
            onDrop={event => dropEntry(event, entry.id)}
          >
            <button type="button" className="db-icon-btn db-app-drag" draggable={!saving && launcherDraft.length > 1}
              disabled={saving || launcherDraft.length < 2}
              title={tr("dragApp", { name: entry.label })} aria-label={tr("dragApp", { name: entry.label })}
              onDragStart={event => {
                if (saving) { event.preventDefault(); return; }
                draggedEntry.current = entry.id;
                setDraggingEntry(entry.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", entry.id);
                event.dataTransfer.setDragImage(event.currentTarget.parentElement!, 16, 16);
              }}
              onDragEnd={endEntryDrag}
              onKeyDown={event => {
                const direction = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
                if (!direction) return;
                event.preventDefault();
                if (index + direction >= 0 && index + direction < launcherDraft.length) moveApp(index, direction);
              }}
            ><Icon name="GripVertical" className="db-icon"/></button>
            <label className="db-sr" htmlFor={`app-${index}`}>{tr("appName")} {index + 1}</label><input id={`app-${index}`} className="db-input" maxLength={200} value={entry.label} disabled={saving} onChange={e => setLauncherDraft(launcherDraft.map((row, i) => i === index ? { ...row, label: e.target.value } : row))}/><SmallButton label={tr("moveAppUp", { name: entry.label })} icon="ArrowUp" disabled={saving || index === 0} onClick={() => moveApp(index, -1)}/><SmallButton label={tr("moveAppDown", { name: entry.label })} icon="ArrowDown" disabled={saving || index === launcherDraft.length - 1} onClick={() => moveApp(index, 1)}/><SmallButton label={tr("removeApp", { name: entry.label })} icon="X" disabled={saving} onClick={() => setLauncherDraft(launcherDraft.filter(row => row.id !== entry.id))}/></div>)}
          {settings === "projects" && selectedProjects.map((id, index) => {
            const entry = { id, label: live.projects.find(project => project.id === id)?.name ?? id };
            return <div
            className="db-edit-app db-edit-project" key={entry.id}
            data-dragging={draggingEntry === entry.id || undefined}
            data-drop={entryDropTarget?.id === entry.id ? entryDropTarget.after ? "after" : "before" : undefined}
            onDragOver={event => {
              if (saving || !draggedEntry.current) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setEntryDropTarget(draggedEntry.current === entry.id ? null : entryDropPosition(event, entry.id));
            }}
            onDragLeave={event => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setEntryDropTarget(null);
            }}
            onDrop={event => dropEntry(event, entry.id)}
          >
            <button type="button" className="db-icon-btn db-app-drag db-project-drag" draggable={!saving && selectedProjects.length > 1}
              disabled={saving || selectedProjects.length < 2}
              title={tr("dragProject", { name: entry.label })} aria-label={tr("dragProject", { name: entry.label })}
              onDragStart={event => {
                if (saving) { event.preventDefault(); return; }
                draggedEntry.current = entry.id;
                setDraggingEntry(entry.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", entry.id);
                event.dataTransfer.setDragImage(event.currentTarget.parentElement!, 16, 16);
              }}
              onDragEnd={endEntryDrag}
              onKeyDown={event => {
                const direction = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
                if (!direction) return;
                event.preventDefault();
                if (index + direction >= 0 && index + direction < selectedProjects.length) moveProject(index, direction);
              }}
            ><Icon name="GripVertical" className="db-icon"/></button>
            <span className="db-project-name" title={entry.label}>{entry.label}</span><SmallButton label={tr("moveProjectUp", { name: entry.label })} icon="ArrowUp" disabled={saving || index === 0} onClick={() => moveProject(index, -1)}/><SmallButton label={tr("moveProjectDown", { name: entry.label })} icon="ArrowDown" disabled={saving || index === selectedProjects.length - 1} onClick={() => moveProject(index, 1)}/><SmallButton label={tr("removeProject", { name: entry.label })} icon="X" disabled={saving} onClick={() => setSelectedProjects(selectedProjects.filter(id => id !== entry.id))}/></div>;
          })}
          {settings === "projects" && <p className="db-note">{tr("projectsNote")}</p>}
          </div>
          <div className="db-settings-footer"><button type="button" className="db-button db-primary" disabled={saving || settings === "launcher" && launcherDraft.some(row => !row.label.trim())} onClick={() => void saveSettings()}>{saving ? tr("saving") : tr("save")}</button><button type="button" className="db-button" disabled={saving} onClick={() => setSettings(null)}>{tr("cancel")}</button></div>
        </section>;
  return <div ref={launcherPanel.root} className={`db-root${launcherPanel.resizing ? " db-resizing" : ""}`} lang={language} aria-busy={languageLoading || undefined} style={{ ...launcherPanel.style, visibility: languageLoading ? "hidden" : undefined }} onKeyDown={event => {
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      if (settings) { event.preventDefault(); event.stopPropagation(); if (!saving) setSettings(null); return; }
      if (searchVisible) { event.preventDefault(); event.stopPropagation(); setSearchVisible(false); setSearch(""); return; }
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
        {[...allThreads].sort((a, b) => a.id.localeCompare(b.id)).map(t => {
          const state = statusOf(t, tr);
          const label = `${live.projects.find(project => project.id === t.projectId)?.name ?? tr("projectUnavailable")} · ${t.displayTitle}: ${state.text}`;
          return <button key={t.id} type="button" className="db-thread-indicator" data-thread-id={t.id} title={label} aria-label={label} aria-pressed={opened === t.id} onClick={() => openThread(t)}><ThreadIndicator tone={state.tone} subagent={isSubagent(t)}/></button>;
        })}
      </div>
      <div className="db-header-tools">
        <label className="db-filter"><span className="db-sr">{tr("showThreads")}</span><select aria-label={tr("showThreads")} value={filter} onChange={event => setFilter(event.target.value === "attention" ? "attention" : "all")}><option value="all">{tr("allThreads")}</option><option value="attention">{tr("attention")}</option></select></label>
        {searchVisible && <label className="db-search"><span className="db-sr">{tr("findThread")}</span><input ref={searchInputRef} type="search" autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder={tr("searchPlaceholder")} onKeyDown={event => {
          if (event.key === "ArrowDown") { event.preventDefault(); searchPanelRef.current?.querySelector<HTMLButtonElement>('.db-conversation-results button')?.focus(); }
        }}/></label>}
        <SmallButton label={searchVisible ? tr("closeSearch") : tr("searchThreads")} icon={searchVisible ? "X" : "Search"} onClick={() => {
          if (!searchVisible) { searchOpener.current = document.activeElement as HTMLElement | null; setSettings(null); setHistoryProject(null); }
          setSearchVisible(!searchVisible); if (searchVisible) setSearch("");
        }}/>
      </div>
      <span className="db-sr" role="status">{notice && tr(notice)}</span>
    </header>
    <div className="db-layout" data-launcher-open={launcherPanel.open} data-launcher-overlay={launcherPanel.overlayOpen}>
      <div ref={launcherPanel.panel} id={launcherPanel.panelId} className="db-launcher-shell" inert={!launcherPanel.open} aria-hidden={!launcherPanel.open}>
      <aside className="db-launcher" aria-label={tr("appsPanel")}>
        <div className="db-launcher-list">
        {!data ? <p className="db-muted">{tr("loading")}</p> : config!.launcher.length === 0 ? <div className="db-launcher-empty"><Icon name="LayoutGrid" className="db-empty-icon"/><p>{tr("appsEmpty")}</p><button type="button" className="db-button" onClick={() => openSettings("launcher")}>{tr("addApps")}</button></div> : config!.launcher.map(entry => {
          const item = apps.find(candidate => candidate.id === entry.id);
          const unavailable = !item || item.isLoading || item.isDisabled;
          return <div className="db-launch-row" key={entry.id}>
            <button type="button" className="db-launch-main" disabled={unavailable} title={unavailable ? tr("appUnavailableHelp") : entry.label} onClick={() => navigation?.actions.activate(entry.id, { target: "current" })}>
              {item ? <NavigationIcon icon={item.icon} className="db-icon"/> : <Icon name="AppWindow" className="db-icon"/>}<span className="db-launch-label">{entry.label}{unavailable && <small>{tr("unavailable")}</small>}</span>
            </button>
            <button type="button" className="db-launch-split" disabled={unavailable} title={tr("splitHelp")} aria-label={tr("openAlongside", { name: entry.label })} onClick={() => navigation?.actions.activate(entry.id, { target: "split" })}><Icon name="Columns2" className="db-icon"/></button>
          </div>;
        })}
        </div>
        <div className="db-launcher-footer"><SmallButton label={tr("configureApps")} icon="Settings2" onClick={() => openSettings("launcher")} disabled={!data || saving}/></div>
        {settings === "launcher" && <div className="db-settings-popover db-launcher-settings">{settingsPanel}</div>}
      </aside>
      <div className="db-launcher-resize" {...launcherPanel.resizeProps}/>
      </div>
      <div className="db-launcher-backdrop" aria-hidden="true" onClick={launcherPanel.close}/>
      <main ref={mainRef} className="db-main" aria-label={tr("workspace")} data-compact-workspace={compactWorkspace}>
        <div className="db-project-bar">
          {data && connected.length > 0 && <ProjectTabs projects={projectTabs} activeId={activeProject?.id ?? null} onSelect={selectProject} onCreate={createInProject}/>}
          <div className="db-project-tools"><SmallButton label={tr("selectProjects")} icon="Settings2" disabled={!data || saving} onClick={() => openSettings("projects")}/></div>
        </div>
        {settings === "projects" && <div className="db-settings-popover db-project-settings">{settingsPanel}</div>}
        <div className="db-project-content">
        {(error || data?.syncError || live.status === "error") && <div className="db-error" role="alert"><span>{error ? tr(error) : tr("syncFailed")}</span><button type="button" className="db-button" onClick={() => void refresh()}>{tr("retry")}</button></div>}
        {connection !== "connected" && <div className="db-warning" role="status">{tr("connectionWarning")}</div>}
        {!data || live.status === "loading" ? <Empty>{tr("loadingProjects")}</Empty> : connected.length === 0 ? <Empty><Icon name="FolderOpen" className="db-empty-icon"/><h3>{tr("chooseProjects")}</h3><p>{tr("chooseProjectsHelp")}</p><button type="button" className="db-button db-primary" onClick={() => openSettings("projects")}>{tr("selectProjects")}</button></Empty> : connected.map(projectConfig => {
          const project = live.projects.find(p => p.id === projectConfig.id);
          const active = projectConfig.id === activeProject?.id;
          if (!active) return <section key={projectConfig.id} id={`db-project-panel-${projectConfig.id}`} role="tabpanel" aria-labelledby={`db-project-tab-${projectConfig.id}`} hidden/>;
          const layout = splitLayouts[projectConfig.id];
          const paneThreads = (layout?.ids ?? []).map(id => live.threads.find(t => t.id === id && t.projectId === projectConfig.id && !t.isHidden && !t.isArchived && !isSubagent(t))).filter((t): t is Thread => !!t);
          const rows = [...allThreads, ...paneThreads.filter(t => !allThreads.some(row => row.id === t.id))].filter(t => t.projectId === projectConfig.id && !isSubagent(t) && (t.id === opened || layout?.ids.includes(t.id) || filter === "all" || needsAttention(t))).sort(compareThreadCreation);
          const openedSubagent = current && current.projectId === projectConfig.id && isSubagent(current) && !isFinishedSubagent(activity(current)) ? current : null;
          const hasSubagents = allThreads.some(t => t.projectId === projectConfig.id && isSubagent(t));
          const openingCreated = pendingCreated?.projectId === projectConfig.id && opened === pendingCreated.id && !current;
          const historyExpanded = historyProject === projectConfig.id;
          const history = live.threads.filter(t => t.projectId === projectConfig.id && !t.isHidden && !t.isArchived
            && !isSubagent(t) && !allThreads.some(row => row.id === t.id))
            .sort((a, b) => b.latestAttentionAt - a.latestAttentionAt || (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.id.localeCompare(b.id)).slice(0, 10);
          const displayed = historyOpened ? live.threads.find(t => t.id === historyOpened && t.projectId === projectConfig.id && !t.isHidden && !t.isArchived) : openedSubagent ?? rows.find(t => t.id === opened);
          const singleChat = !historyExpanded;
          return <section className="db-project db-project-workspace" data-single-chat={singleChat} data-history-open={historyExpanded} key={projectConfig.id} id={`db-project-panel-${projectConfig.id}`} role="tabpanel" aria-labelledby={`db-project-tab-${projectConfig.id}`}>
            <div className="db-thread-workspace" id="db-thread-workspace" inert={compactWorkspace && historyExpanded && !threadDragging || undefined}>
            {creating === projectConfig.id && <div className="db-create"><div className="db-chat-heading"><strong>{tr("newThreadTitle", { name: project?.name ?? tr("projectUnavailable") })}</strong><SmallButton label={tr("closeCreate")} icon="X" onClick={() => { creationIntent.current = null; setCreating(null); }}/></div><div className="db-new-composer"><NewThreadComposer key={projectConfig.id} defaultProjectId={projectConfig.id} draftKey={`dashboard-new-${projectConfig.id}`} placeholder={tr("promptPlaceholder")} layout="document" onSubmit={async request => {
              if (request.projectId !== projectConfig.id) throw new Error(tr("projectMismatch"));
              const intent = creationIntent.current;
              try {
                const created = await sdk.threads.spawn(request);
                if (mounted.current && intent === creationIntent.current) {
                  enteredProject.current = projectConfig.id;
                  setPendingCreated({ id: created.id, projectId: projectConfig.id });
                  selectPane(projectConfig.id, created.id);
                  setOpened(created.id); setCreating(null); setNotice("threadCreated");
                }
                void refresh();
              }
              catch (cause) { report(cause); throw cause; }
            }}/></div></div>}
            {openingCreated && <div className="db-chat"><div className="db-chat-heading"><span role="status">{tr("openingThread")}</span></div><ExpandedChat threadId={opened!} fillSpace/></div>}
            {!creating && (displayed || paneThreads.length > 0) && <SplitWorkspace
              projectId={projectConfig.id} ids={paneThreads.length ? paneThreads.map(t => t.id) : displayed ? [displayed.id] : []}
              activeId={layout?.active ?? displayed?.id ?? null} sizes={layout?.sizes ?? {}}
              onActivate={id => { const thread = live.threads.find(t => t.id === id); if (thread) openConversation(thread); }}
              onAdd={addPane} onResize={sizes => setSplitLayouts(previous => previous[projectConfig.id] ? { ...previous, [projectConfig.id]: { ...previous[projectConfig.id]!, sizes } } : previous)}
              renderPane={(id, split) => {
                const displayed = live.threads.find(t => t.id === id)!;
                return <div className="db-thread" key={displayed.id}>
              <div className="db-thread-line"><button type="button" className="db-thread-open" title={`${displayed.displayTitle} · ${conversationItem(displayed).detail} · ${statusOf(displayed, tr).text}`} aria-expanded="true" aria-controls={`chat-${displayed.id}`} onClick={() => split ? openConversation(displayed) : toggleThread(displayed)}>
                <ThreadIndicator tone={statusOf(displayed, tr).tone}/><span className="db-thread-text"><span className="db-thread-title">{displayed.displayTitle}{drafts.has(displayed.id) && tr("draftSuffix")}</span></span><span className={`db-state ${statusOf(displayed, tr).tone}`}>{statusOf(displayed, tr).text}</span>{!split && <Icon name="ChevronUp" className="db-icon"/>}</button>{split && <SmallButton label={tr("closeSplit", { name: displayed.displayTitle })} icon="X" onClick={() => removePane(displayed.id)}/>}
              </div>
              <div className="db-chat" id={`chat-${displayed.id}`}><ExpandedChat threadId={displayed.id} fillSpace/></div>
            </div>;
              }}/>}
            {!displayed && !paneThreads.length && !creating && !openingCreated && <div className="db-project-empty">{!project ? tr("projectAccessHelp") : filter === "attention" ? tr("noAttention") : hasSubagents ? tr("subagentsHelp") : rows.length ? tr("selectThread") : tr("noThreads")}</div>}
            </div>
            <ThreadTabs key={projectConfig.id} projectId={projectConfig.id} splitIds={paneThreads.map(t => t.id)} onOpenBeside={addPane} activeId={paneThreads.length ? layout!.active : historyOpened ?? opened} saving={saving} undo={undoHide?.projectId === projectConfig.id ? undoHide.tab : undefined} onUndo={() => void restoreHidden()} onUndoPauseChange={setUndoPaused} onHide={async id => { const thread = rows.find(t => t.id === id); return thread ? hide(thread) : false; }} threads={rows.map(t => ({ id: t.id, createdAt: t.createdAt, title: t.displayTitle, detail: t.environment?.name ?? t.environment?.branchName ?? t.host?.name ?? tr("environment"), tone: statusOf(t, tr).tone, status: statusOf(t, tr).text, canHide: allThreads.some(row => row.id === t.id) && !hasWork(activity(t)) && !drafts.has(t.id) }))}
              leadingAction={<button type="button" className="db-thread-create db-icon-btn" disabled={!project}
                title={tr("newThreadTitle", { name: project?.name ?? tr("projectUnavailable") })} aria-label={tr("newThreadInProject", { name: project?.name ?? tr("projectUnavailable") })}
                onClick={() => createInProject(projectConfig.id)}><Icon name="Plus" className="db-icon"/></button>}
              onSelect={id => { const thread = rows.find(t => t.id === id); if (thread) openConversation(thread); }}>
            <div className="db-history-bar"><button type="button" className="db-history-toggle" title={tr(historyExpanded ? "hideRecentThreads" : "showRecentThreads")} aria-label={tr(historyExpanded ? "hideRecentThreads" : "showRecentThreads")} aria-expanded={historyExpanded} aria-controls={`db-history-${projectConfig.id}`} onClick={() => {
              if (!historyExpanded) { historyOpener.current = document.activeElement as HTMLElement | null; setSearchVisible(false); setSearch(""); setSettings(null); }
              setHistoryProject(historyExpanded ? null : projectConfig.id);
            }}>{tr(historyExpanded ? "hideRecentThreads" : "showRecentThreads")}<Icon name={historyExpanded ? "ChevronDown" : "ChevronUp"} className="db-icon"/></button></div>
            </ThreadTabs>
            {historyExpanded && compactWorkspace && <div className="db-history-backdrop" style={{ pointerEvents: threadDragging ? "none" : undefined }} aria-hidden="true" onClick={() => setHistoryProject(null)}/>}
            {historyExpanded && <div ref={historyRef} className="db-history" id={`db-history-${projectConfig.id}`} role="region" aria-label={tr("recentThreads")}>
              <div className="db-picker-heading"><span>{tr("recentThreads")}</span><SmallButton label={tr("closeHistory")} icon="X" onClick={() => setHistoryProject(null)}/></div>
              {history.length === 0 ? <div className="db-project-empty">{tr("noRecentThreads")}</div> : history.map(t => <div className="db-history-entry" key={t.id}><button type="button" draggable onDragStart={event => startThreadDrag(event, projectConfig.id, t.id)} className="db-history-thread" aria-label={t.displayTitle} aria-pressed={historyOpened === t.id} aria-controls="db-thread-workspace" title={t.displayTitle} onClick={() => openConversation(t)}><span className="db-thread-title">{t.displayTitle}</span><ConversationMetadata item={conversationItem(t)}/></button><SmallButton label={tr("openAlongside", { name: t.displayTitle })} icon="Columns2" onClick={() => addPane(t.id)}/></div>)}
              {project && <a className="db-all-conversations" href={project.href}>{tr("allProjectThreads")}</a>}
            </div>}
          </section>;
        })}
        </div>
        {searchVisible && !settings && activeProject && <section ref={searchPanelRef} className="db-search-results" role="region" aria-label={tr("searchInProject", { name: live.projects.find(p => p.id === activeProject.id)?.name ?? tr("projectUnavailable") })}>
          <p className="db-search-scope">{tr("searchInProject", { name: live.projects.find(p => p.id === activeProject.id)?.name ?? tr("projectUnavailable") })} · {tr(filter === "attention" ? "attention" : "allThreads")}</p>
          <ConversationResults key={`${activeProject.id}:${search}:${filter}`} items={searchResults.map(conversationItem)} selectedId={historyOpened ?? opened} loading={!data || live.status === "loading"} failed={live.status === "error"}
            onSelect={id => { const thread = searchResults.find(t => t.id === id); if (thread) openConversation(thread); }}/>
        </section>}
      </main>
    </div>
  </div>;
}
export default definePluginApp(app => {
  app.slots.experimental_sidebarNavigation({ id: "launcher", title: "BBDesk", placement: "rail", component: LauncherNavigation });
  app.slots.navPanel({ id: "dashboard", title: "BBDesk", icon: "dashboard/mark", path: "home", component: DashboardPage, headerContent: ConnectionIndicator });
});
