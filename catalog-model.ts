import type { DashboardConfig } from "./contracts";
import type { CatalogKind } from "./catalog-config";

export interface CatalogEntry {
  id: string;
  kind: CatalogKind;
  name: string;
  originalName: string;
  available: boolean;
}
export function catalogEntries(config: DashboardConfig, projects: readonly { id: string; name: string; isPersonal: boolean }[],
  apps: readonly { id: string; label: string; isDisabled: boolean; isLoading: boolean }[]): CatalogEntry[] {
  return [
    ...projects.filter(project => !project.isPersonal).map(project => ({ id: project.id, kind: "project" as const, name: project.name, originalName: project.name, available: true })),
    ...apps.map(app => ({ id: app.id, kind: "app" as const, name: config.launcher.find(entry => entry.id === app.id)?.label ?? app.label, originalName: app.label, available: !app.isDisabled && !app.isLoading })),
  ];
}
