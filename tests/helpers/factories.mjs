export const project = { id: "p1", name: "Тестовый проект", isPersonal: false, href: "/projects/p1", settingsHref: "/projects/p1/settings" };

export const item = { id: "notes/home", pluginId: "notes", label: "Заметки", icon: { kind: "plugin", pluginId: "notes", icon: null }, action: { kind: "plugin-panel", path: "home", pluginId: "notes" }, isDisabled: false, isLoading: false, isVisible: true, shortcut: null, badge: null };

export const secondProject = { ...project, id: "p2", name: "Второй проект" };

export function thread(id, projectId, displayTitle, changes = {}) {
  return { id, projectId, displayTitle, status: "idle", runtimeStatus: "idle", queuedWork: "none", hasPendingInteraction: false,
    isUnread: false, isHidden: false, isArchived: false, latestAttentionAt: 150,
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    environment: { name: "Основное окружение" }, host: null, ...changes };
}
