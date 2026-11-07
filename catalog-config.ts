import type { CatalogChange, DashboardConfig } from "./contracts";
export { catalogChangeSchema } from "./contracts";
export type { CatalogChange, CatalogKind } from "./contracts";

// Both full replacement and catalog ordering preserve disabled project history.
// Deduplication belongs to the full-list adapter, not to persisted catalog rows.
export function orderProjects(config: DashboardConfig, ids: readonly string[], now: number): DashboardConfig {
  const selected = new Set(ids);
  const previous = new Map(config.projects.map(entry => [entry.id, entry]));
  return { ...config, projects: [
    ...ids.map(id => ({ id, enabled: true, connectedAt: previous.get(id)?.connectedAt ?? now })),
    ...config.projects.filter(entry => !selected.has(entry.id)).map(entry => ({ ...entry, enabled: false })),
  ] };
}

function renameApplication(config: DashboardConfig, id: string, label: string): DashboardConfig {
  if (!config.launcher.some(entry => entry.id === id)) throw new Error("DASHBOARD_CATALOG_STALE");
  return { ...config, launcher: config.launcher.map(entry => entry.id === id ? { ...entry, label } : entry) };
}
function restorePosition(ids: readonly string[], change: Extract<CatalogChange, { type: "restore" }>): number {
  if (change.nextId && ids.includes(change.nextId)) return ids.indexOf(change.nextId);
  if (change.previousId && ids.includes(change.previousId)) return ids.indexOf(change.previousId) + 1;
  return ids.length;
}

// Transform only the requested entry against the server's latest configuration.
export function changeCatalog(config: DashboardConfig, change: CatalogChange, now: number): DashboardConfig {
  if (change.type === "pool") return { ...config, sharedPool: change.enabled };
  if (change.type === "rename") return renameApplication(config, change.id, change.label);
  const entries = change.kind === "project" ? config.projects.filter(entry => entry.enabled) : config.launcher;
  const ids = entries.map(entry => entry.id);
  const present = ids.includes(change.id);
  if (change.type === "remove") {
    return change.kind === "project"
      ? { ...config, projects: config.projects.map(entry => entry.id === change.id ? { ...entry, enabled: false } : entry) }
      : { ...config, launcher: config.launcher.filter(entry => entry.id !== change.id) };
  }
  if (change.type === "move") {
    if (!present || !ids.includes(change.targetId)) throw new Error("DASHBOARD_CATALOG_STALE");
    if (change.id === change.targetId) return config;
    ids.splice(ids.indexOf(change.id), 1);
    ids.splice(ids.indexOf(change.targetId) + Number(change.after), 0, change.id);
  } else {
    if (present) return config;
    if (ids.length >= 100) throw new Error("DASHBOARD_CATALOG_LIMIT");
    const position = change.type === "restore" ? restorePosition(ids, change) : ids.length;
    ids.splice(position, 0, change.id);
  }
  if (change.kind === "project") return orderProjects(config, ids, now);
  const previous = new Map(config.launcher.map(entry => [entry.id, entry]));
  return { ...config, launcher: ids.map(id => previous.get(id) ?? { id, label: "label" in change ? change.label ?? id : id }) };
}
