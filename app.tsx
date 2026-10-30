import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  definePluginApp, useRpc, useRealtime, useRealtimeConnectionState, useSdk,
  experimental_useSidebarThreads as useThreads,
  experimental_SidebarNavigationIcon as NavigationIcon,
  useSidebarThreadDraftIds as useDraftIds,
  experimental_usePluginId as usePluginId,
  experimental_NewThreadComposer as NewThreadComposer,
  ThreadChat,
} from "@get-bb/plugin-sdk/app";
import { Icon, type IconName } from "./components/ui/icon";
import { ThreadIndicator } from "./components/thread-indicator";
import { ProjectTabs } from "./project-tabs";
import { hasWork, isWorking, isSubagent, isFinishedSubagent, type Activity, type TrackedThread } from "./state";
import { followChatBottom } from "./chat-scroll";
import { useLauncherPanel } from "./launcher-panel";
import { LauncherNavigation, useLauncherNavigation } from "./launcher-navigation";
import type { rpcContract, DashboardConfig } from "./server";
import "./styles.css";

type Thread = ReturnType<typeof useThreads>["threads"][number];
type Snapshot = { config: DashboardConfig; tracked: TrackedThread[]; syncError: string | null; syncedAt: number | null };
const activity = (t: Thread): Activity => ({ ...t, backgroundAgents: t.activity.backgroundAgents, backgroundCommands: t.activity.backgroundCommands, workflows: t.activity.workflows });
const needsAttention = (t: Thread) => t.hasPendingInteraction || t.status === "error" || t.queuedWork === "failed" || t.isUnread && !isWorking(activity(t));
function statusOf(t: Thread) {
  if (t.hasPendingInteraction) return { text: "Нужно действие", tone: "attention" };
  if (t.queuedWork === "failed" || t.status === "error") return { text: "Ошибка", tone: "error" };
  if (t.runtimeStatus === "waiting-for-host") return { text: "Ожидает подключения", tone: "waiting" };
  if (t.runtimeStatus === "provisioning") return { text: "Подготовка окружения", tone: "running" };
  if (t.status === "pending") return { text: "Ожидает запуска", tone: "waiting" };
  if (t.status === "starting") return { text: "Запускается", tone: "running" };
  if (t.status === "stopping") return { text: "Останавливается", tone: "running" };
  if (isWorking(activity(t))) return { text: isSubagent(t) ? "Субагент работает" : "Работает", tone: "running" };
  if (t.queuedWork === "waiting") return { text: "В очереди", tone: "waiting" };
  if (t.isUnread) return { text: "Новый ответ", tone: "result" };
  if (t.status !== "idle") return { text: "Неизвестное состояние", tone: "unknown" };
  return { text: "Просмотрено", tone: "read" };
}
function Empty({ children }: { children: ReactNode }) { return <div className="db-empty" role="status">{children}</div>; }
function SmallButton({ label, icon, onClick, disabled = false }: { label: string; icon: IconName; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="db-icon-btn" title={label} aria-label={label} onClick={onClick} disabled={disabled}><Icon name={icon} className="db-icon"/></button>;
}
function ExpandedChat({ threadId }: { threadId: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!viewport.current || !content.current) return;
    viewport.current.scrollIntoView?.({ block: "nearest" });
    return followChatBottom(viewport.current, content.current);
  }, [threadId]);
  return <div className="db-chat-surface" ref={viewport}><div ref={content}>
    <ThreadChat threadId={threadId} variant="full" layout="document" permissionPolicy="inherit"/>
  </div></div>;
}
function ConnectionIndicator() {
  const connection = useRealtimeConnectionState();
  const label = connection === "connected" ? "На связи" : "Обновление связи…";
  return <span className="db-connection" role="status" title={label}><span className={connection === "connected" ? "db-dot running" : "db-dot waiting"} aria-hidden="true"/><span className="db-sr">{label}</span></span>;
}
function DashboardPage() {
  const launcherPanel = useLauncherPanel();
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();
  const live = useThreads();
  const navigation = useLauncherNavigation();
  const pluginId = usePluginId();
  const drafts = useDraftIds();
  const connection = useRealtimeConnectionState();
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [opened, setOpened] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [pendingCreated, setPendingCreated] = useState<{ id: string; projectId: string } | null>(null);
  const creationIntent = useRef<object | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [searchVisible, setSearchVisible] = useState(false);
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [search, setSearch] = useState("");
  const [settings, setSettings] = useState<"projects" | "launcher" | null>(null);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [launcherDraft, setLauncherDraft] = useState<DashboardConfig["launcher"]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (settings === "projects" && launcherPanel.compact && launcherPanel.open) launcherPanel.close();
  }, [settings, launcherPanel.compact, launcherPanel.open, launcherPanel.close]);
  const requestRunning = useRef(false);
  const requestAgain = useRef(false);
  const mounted = useRef(true);
  const enteredProject = useRef<string | null>(null);
  const report = useCallback((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    setError(/[а-яё]/i.test(message) ? message : "Не удалось выполнить действие. Повторите попытку или проверьте соединение с BB.");
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
    } else setOpened(null);
  }, [live.status, live.threads, opened, current, allThreads, pendingCreated]);
  const runningCount = allThreads.filter(t => isWorking(activity(t))).length;
  useEffect(() => {
    if (!data || live.status !== "ready" || !activeProject) return;
    if (enteredProject.current === activeProject.id) return;
    enteredProject.current = activeProject.id;
    if (creating === activeProject.id) return;
    const threads = allThreads.filter(t => t.projectId === activeProject.id && !isSubagent(t));
    setOpened(threads.length === 1 ? threads[0]!.id : null);
  }, [data, live.status, activeProject, allThreads, creating]);
  const attentionCount = allThreads.filter(needsAttention).length;
  const projectTabs = connected.map(project => {
    const info = live.projects.find(p => p.id === project.id);
    const threads = allThreads.filter(t => t.projectId === project.id);
    const states = threads.map(t => ({ id: t.id, title: t.displayTitle, subagent: isSubagent(t), ...statusOf(t) }));
    return { id: project.id, name: info?.name ?? "Проект недоступен", available: !!info,
      running: states.filter(state => state.tone === "running").length,
      attention: states.filter(state => state.tone === "attention").length,
      queued: threads.filter(t => t.queuedWork === "waiting").length,
      total: threads.length,
      states };
  });
  function selectProject(id: string) {
    if (id === activeProject?.id) return;
    creationIntent.current = null; setPendingCreated(null);
    setActiveProjectId(id); setOpened(null); setCreating(null); setNotice("");
  }
  function openThread(t: Thread) {
    creationIntent.current = null; setPendingCreated(null);
    enteredProject.current = t.projectId;
    setActiveProjectId(t.projectId); setOpened(t.id); setCreating(null); setSettings(null); setNotice("");
  }
  function createInProject(id: string) {
    creationIntent.current = {}; setPendingCreated(null);
    setActiveProjectId(id); setOpened(null); setCreating(id); setNotice("");
  }
  function toggleThread(t: Thread) {
    creationIntent.current = null; setPendingCreated(null);
    setOpened(opened === t.id ? null : t.id); setCreating(null);
  }
  const apps = navigation?.items.filter(item => item.pluginId && item.pluginId !== pluginId) ?? [];
  function openSettings(next: "projects" | "launcher") {
    if (!config || saving) return;
    setSelectedProjects(config.projects.filter(p => p.enabled).map(p => p.id));
    setLauncherDraft(config.launcher.map(item => ({ ...item })));
    setSettings(settings === next ? null : next);

  }
  async function saveSettings() {
    setSaving(true); setError(null);
    try {
      if (settings === "projects") await rpc.call("projects_set", { ids: selectedProjects });
      else await rpc.call("launcher_set", { items: launcherDraft });
      await refresh(); setSettings(null); setNotice("Настройки сохранены.");
    } catch (cause) { report(cause); }
    finally { setSaving(false); }
  }
  async function hide(t: Thread) {
    setSaving(true);
    try {
      const result = await rpc.call("thread_hide", { threadId: t.id });
      if (!result.hidden) throw new Error("Тред уже недоступен. Обновите список.");
      if (opened === t.id) setOpened(null);
      await refresh(); setNotice("Тред убран с рабочего стола. Новый ответ или действие вернёт его.");
    } catch (cause) { report(cause); }
    finally { setSaving(false); }
  }
  function moveApp(index: number, direction: -1 | 1) {
    const next = [...launcherDraft];
    [next[index], next[index + direction]] = [next[index + direction]!, next[index]!];
    setLauncherDraft(next);
  }
  const settingsPanel = settings && <section className="db-settings" aria-label={settings === "projects" ? "Выбор проектов" : "Настройка приложений"}>
          <div className="db-settings-heading"><h3>{settings === "projects" ? "Проекты на рабочем столе" : "Приложения на панели"}</h3><SmallButton label="Закрыть настройки" icon="X" onClick={() => setSettings(null)} disabled={saving}/></div>
          <div className="db-settings-body">
          <p className="db-muted">{settings === "projects" ? "Добавляем текущую работу. Старые готовые ответы останутся в обычном BB." : "Выберите приложения. Порядок и названия можно изменить ниже."}</p>
          <div className="db-checks">{settings === "projects" ? live.projects.filter(p => !p.isPersonal).map(project => <label key={project.id}><input type="checkbox" disabled={saving} checked={selectedProjects.includes(project.id)} onChange={e => setSelectedProjects(e.target.checked ? [...selectedProjects, project.id] : selectedProjects.filter(id => id !== project.id))}/>{project.name}</label>) : apps.map(item => <label key={item.id}><input type="checkbox" disabled={saving} checked={launcherDraft.some(entry => entry.id === item.id)} onChange={e => setLauncherDraft(e.target.checked ? [...launcherDraft, { id: item.id, label: item.label }] : launcherDraft.filter(entry => entry.id !== item.id))}/><NavigationIcon icon={item.icon} className="db-icon"/>{item.label}</label>)}</div>
          {settings === "launcher" && !navigation && <p className="db-muted">Чтобы подключить приложения, выберите «BBDesk» в настройках BB → Внешний вид → Навигация.</p>}
          {settings === "launcher" && navigation && apps.length === 0 && <p className="db-muted">Нет доступных приложений. Установите плагин с отдельным экраном в BB.</p>}
          {settings === "launcher" && launcherDraft.map((entry, index) => <div className="db-edit-app" key={entry.id}><label className="db-sr" htmlFor={`app-${index}`}>Название приложения {index + 1}</label><input id={`app-${index}`} className="db-input" maxLength={200} value={entry.label} disabled={saving} onChange={e => setLauncherDraft(launcherDraft.map((row, i) => i === index ? { ...row, label: e.target.value } : row))}/><SmallButton label={`Переместить ${entry.label} выше`} icon="ArrowUp" disabled={saving || index === 0} onClick={() => moveApp(index, -1)}/><SmallButton label={`Переместить ${entry.label} ниже`} icon="ArrowDown" disabled={saving || index === launcherDraft.length - 1} onClick={() => moveApp(index, 1)}/><SmallButton label={`Убрать ${entry.label} с панели приложений`} icon="X" disabled={saving} onClick={() => setLauncherDraft(launcherDraft.filter(row => row.id !== entry.id))}/></div>)}
          {settings === "projects" && <p className="db-note">Отключение проекта только скрывает его здесь. Работа тредов продолжается.</p>}
          </div>
          <div className="db-settings-footer"><button type="button" className="db-button db-primary" disabled={saving || settings === "launcher" && launcherDraft.some(row => !row.label.trim())} onClick={() => void saveSettings()}>{saving ? "Сохранение…" : "Сохранить"}</button><button type="button" className="db-button" disabled={saving} onClick={() => setSettings(null)}>Отмена</button></div>
        </section>;
  return <div ref={launcherPanel.root} className={`db-root${launcherPanel.resizing ? " db-resizing" : ""}`} style={launcherPanel.style} onKeyDown={launcherPanel.onKeyDown}>
    <header className="db-header">
      <button ref={launcherPanel.toggle} type="button" className="db-icon-btn db-launcher-toggle" title={launcherPanel.open ? "Скрыть приложения" : "Показать приложения"} aria-label={launcherPanel.open ? "Скрыть приложения" : "Показать приложения"} aria-expanded={launcherPanel.open} aria-controls={launcherPanel.panelId} onClick={launcherPanel.toggleOpen}><Icon name={launcherPanel.open ? "PanelLeftClose" : "PanelLeftOpen"} className="db-icon"/></button>
      <div className="db-thread-indicators" role="group" aria-label={`Треды всех проектов. В работе: ${runningCount}. Требуют внимания: ${attentionCount}.`}>
        {[...allThreads].sort((a, b) => a.id.localeCompare(b.id)).map(t => {
          const state = statusOf(t);
          const label = `${live.projects.find(project => project.id === t.projectId)?.name ?? "Проект недоступен"} · ${t.displayTitle}: ${state.text}`;
          return <button key={t.id} type="button" className="db-thread-indicator" data-thread-id={t.id} title={label} aria-label={label} aria-pressed={opened === t.id} onClick={() => openThread(t)}><ThreadIndicator tone={state.tone} subagent={isSubagent(t)}/></button>;
        })}
      </div>
      <div className="db-header-tools">
        <label className="db-filter"><span className="db-sr">Показывать треды</span><select aria-label="Показывать треды" value={filter} onChange={event => setFilter(event.target.value === "attention" ? "attention" : "all")}><option value="all">Все треды</option><option value="attention">Требуют внимания</option></select></label>
        {searchVisible && <label className="db-search"><span className="db-sr">Найти тред</span><input type="search" autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Найти тред…"/></label>}
        <SmallButton label={searchVisible ? "Закрыть поиск" : "Поиск тредов"} icon={searchVisible ? "X" : "Search"} onClick={() => { setSearchVisible(!searchVisible); if (searchVisible) setSearch(""); }}/>
        <SmallButton label="Выбрать проекты" icon="FolderOpen" disabled={!data || saving} onClick={() => openSettings("projects")}/>
      </div>
      <span className="db-sr" role="status">{notice}</span>
    </header>
    <div className="db-layout" data-launcher-open={launcherPanel.open}>
      <div ref={launcherPanel.panel} id={launcherPanel.panelId} className="db-launcher-shell" inert={!launcherPanel.open} aria-hidden={!launcherPanel.open}>
      <aside className="db-launcher" aria-label="Панель приложений">
        <div className="db-launcher-list">
        {!data ? <p className="db-muted">Загрузка…</p> : config!.launcher.length === 0 ? <div className="db-launcher-empty"><Icon name="LayoutGrid" className="db-empty-icon"/><p>Ваши приложения под рукой</p><button type="button" className="db-button" onClick={() => openSettings("launcher")}>Добавить приложения</button></div> : config!.launcher.map(entry => {
          const item = apps.find(candidate => candidate.id === entry.id);
          const unavailable = !item || item.isLoading || item.isDisabled;
          return <div className="db-launch-row" key={entry.id}>
            <button type="button" className="db-launch-main" disabled={unavailable} title={unavailable ? "Приложение недоступно. Проверьте его в настройках BB." : entry.label} onClick={() => navigation?.actions.activate(entry.id, { target: "current" })}>
              {item ? <NavigationIcon icon={item.icon} className="db-icon"/> : <Icon name="AppWindow" className="db-icon"/>}<span className="db-launch-label">{entry.label}{unavailable && <small>Недоступно</small>}</span>
            </button>
            <button type="button" className="db-launch-split" disabled={unavailable} title="Открыть рядом; если невозможно — в новой вкладке" aria-label={`Открыть ${entry.label} рядом`} onClick={() => navigation?.actions.activate(entry.id, { target: "split" })}><Icon name="Columns2" className="db-icon"/></button>
          </div>;
        })}
        </div>
        <div className="db-launcher-footer"><SmallButton label="Настроить приложения" icon="Settings2" onClick={() => openSettings("launcher")} disabled={!data || saving}/></div>
        {settings === "launcher" && <div className="db-launcher-settings">{settingsPanel}</div>}
      </aside>
      <div className="db-launcher-resize" {...launcherPanel.resizeProps}/>
      </div>
      <div className="db-launcher-backdrop" aria-hidden="true" onClick={launcherPanel.close}/>
      <main className="db-main" aria-label="Рабочая область проектов">
        {data && connected.length > 0 && <ProjectTabs projects={projectTabs} activeId={activeProject?.id ?? null} onSelect={selectProject} onCreate={createInProject}/>}
        {settings === "projects" && settingsPanel}
        <div className="db-project-content">
        {(error || data?.syncError || live.status === "error") && <div className="db-error" role="alert"><span>{error ?? "Не удалось обновить активность BB. Проверьте соединение и повторите попытку."}</span><button type="button" className="db-button" onClick={() => void refresh()}>Повторить</button></div>}
        {connection !== "connected" && <div className="db-warning" role="status">Связь восстанавливается. Показанные состояния могут быть неактуальны.</div>}
        {!data || live.status === "loading" ? <Empty>Загружаем проекты и активность…</Empty> : connected.length === 0 ? <Empty><Icon name="FolderOpen" className="db-empty-icon"/><h3>Выберите проекты для работы</h3><p>Здесь появятся их треды, новые ответы и запросы вашего участия.</p><button type="button" className="db-button db-primary" onClick={() => openSettings("projects")}>Выбрать проекты</button></Empty> : connected.map(projectConfig => {
          const project = live.projects.find(p => p.id === projectConfig.id);
          const active = projectConfig.id === activeProject?.id;
          if (!active) return <section key={projectConfig.id} id={`db-project-panel-${projectConfig.id}`} role="tabpanel" aria-labelledby={`db-project-tab-${projectConfig.id}`} hidden/>;
          const rows = allThreads.filter(t => t.projectId === projectConfig.id && !isSubagent(t) && (t.id === opened || (filter === "all" || needsAttention(t)) && `${t.displayTitle} ${project?.name ?? ""} ${t.environment?.name ?? ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))).sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)) || Number(isWorking(activity(b))) - Number(isWorking(activity(a))) || b.latestAttentionAt - a.latestAttentionAt || a.id.localeCompare(b.id));
          const openedSubagent = current && current.projectId === projectConfig.id && isSubagent(current) && !isFinishedSubagent(activity(current)) ? current : null;
          const hasSubagents = allThreads.some(t => t.projectId === projectConfig.id && isSubagent(t));
          const openingCreated = pendingCreated?.projectId === projectConfig.id && opened === pendingCreated.id && !current;
          return <section className="db-project" key={projectConfig.id} id={`db-project-panel-${projectConfig.id}`} role="tabpanel" aria-labelledby={`db-project-tab-${projectConfig.id}`}>
            {creating === projectConfig.id && <div className="db-create"><div className="db-chat-heading"><strong>Новый тред · {project?.name}</strong><SmallButton label="Закрыть создание треда" icon="X" onClick={() => { creationIntent.current = null; setCreating(null); }}/></div><div className="db-new-composer"><NewThreadComposer key={projectConfig.id} defaultProjectId={projectConfig.id} draftKey={`dashboard-new-${projectConfig.id}`} placeholder="Что нужно сделать?" layout="document" onSubmit={async request => {
              if (request.projectId !== projectConfig.id) throw new Error("Для создания в этом проекте выберите его в поле «Проект».");
              const intent = creationIntent.current;
              try {
                const created = await sdk.threads.spawn(request);
                if (mounted.current && intent === creationIntent.current) {
                  enteredProject.current = projectConfig.id;
                  setPendingCreated({ id: created.id, projectId: projectConfig.id });
                  setOpened(created.id); setCreating(null); setNotice("Новый тред создан.");
                }
                void refresh();
              }
              catch (cause) { report(cause); throw cause; }
            }}/></div></div>}
            {openingCreated && <div className="db-chat" id={`chat-${opened}`}><div className="db-chat-heading"><span role="status">Тред создан. Обновляем состояние…</span><SmallButton label="Свернуть тред" icon="Minimize2" onClick={() => { setOpened(null); setPendingCreated(null); }}/></div><ExpandedChat threadId={opened!}/></div>}
            {openedSubagent && <div className="db-chat" id={`chat-${openedSubagent.id}`}><div className="db-chat-heading"><span>{openedSubagent.displayTitle}</span><SmallButton label="Свернуть тред" icon="Minimize2" onClick={() => setOpened(null)}/></div><ExpandedChat threadId={openedSubagent.id}/></div>}
            {rows.length === 0 ? !openedSubagent && !openingCreated && <div className="db-project-empty">{!project ? "Проверьте доступ к проекту или отключите его в настройках рабочего стола." : search ? "Треды не найдены." : filter === "attention" ? "Нет тредов, требующих внимания." : hasSubagents ? "Работа субагентов показана индикаторами проекта." : "Сейчас нет активных тредов. Можно создать новый."}</div> : rows.map(t => {
              const state = statusOf(t);
              return <div className="db-thread" key={t.id}>
                <div className={`db-thread-line ${opened === t.id ? "expanded" : ""}`}><button type="button" className="db-thread-open" aria-expanded={opened === t.id} aria-controls={`chat-${t.id}`} onClick={() => toggleThread(t)}><ThreadIndicator tone={state.tone}/><span className="db-thread-text"><span className="db-thread-title">{t.displayTitle}</span><span className="db-thread-detail">{t.environment?.name ?? t.environment?.branchName ?? t.host?.name ?? "Окружение BB"}{drafts.has(t.id) && " · есть черновик"}</span></span><span className={`db-state ${state.tone}`}>{state.text}{t.queuedWork === "waiting" && isWorking(activity(t)) ? " · есть очередь" : ""}</span><Icon name={opened === t.id ? "ChevronUp" : "ChevronDown"} className="db-icon"/></button>{!hasWork(activity(t)) && !drafts.has(t.id) && <SmallButton label={`Убрать «${t.displayTitle}» с рабочего стола`} icon="X" disabled={saving} onClick={() => void hide(t)}/>}</div>
                {opened === t.id && <div className="db-chat" id={`chat-${t.id}`}><ExpandedChat threadId={t.id}/></div>}
              </div>;
            })}
          </section>;
        })}
        </div>
      </main>
    </div>
  </div>;
}
export default definePluginApp(app => {
  app.slots.experimental_sidebarNavigation({ id: "launcher", title: "BBDesk", placement: "rail", component: LauncherNavigation });
  app.slots.navPanel({ id: "dashboard", title: "BBDesk", icon: "dashboard/mark", path: "home", component: DashboardPage, headerContent: ConnectionIndicator });
});
