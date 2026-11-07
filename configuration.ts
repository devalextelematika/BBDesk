import type { CatalogChange, DashboardConfig } from "./contracts";
import { changeCatalog, orderProjects } from "./catalog-config";

export type ConfigMutation =
  | { method: "projects_set"; ids: string[]; sharedPool?: boolean }
  | { method: "launcher_set"; items: DashboardConfig["launcher"] }
  | { method: "catalog_change"; change: CatalogChange };

// null skips SDK validation; [] still validates the legacy empty replacement.
export function projectValidationIds(config: DashboardConfig, mutation: ConfigMutation): readonly string[] | null {
  if (mutation.method === "projects_set") return mutation.ids;
  if (mutation.method !== "catalog_change") return null;
  const change = mutation.change;
  return (change.type === "add" || change.type === "restore") && change.kind === "project"
    && !config.projects.some(entry => entry.id === change.id && entry.enabled) ? [change.id] : null;
}

export function changeConfiguration(config: DashboardConfig, mutation: ConfigMutation, now: number): DashboardConfig {
  switch (mutation.method) {
    case "projects_set":
      return { ...orderProjects(config, [...new Set(mutation.ids)], now), sharedPool: mutation.sharedPool ?? config.sharedPool };
    case "launcher_set":
      // Map retains first occurrence order and the last label for duplicate IDs.
      return { ...config, launcher: [...new Map(mutation.items.map(item => [item.id, item])).values()] };
    case "catalog_change":
      return changeCatalog(config, mutation.change, now);
  }
}
