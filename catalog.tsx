import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { catalogEntries } from "./catalog-model";
import type { CatalogChange } from "./catalog-config";
import { useCatalogActions } from "./hooks/use-catalog-actions";
import { useTranslation } from "./use-translation";
import type { DashboardConfig } from "./contracts";

export type CatalogFilter = "all" | "project" | "app";
type Props = {
  config: DashboardConfig;
  projects: readonly { id: string; name: string; isPersonal: boolean }[];
  apps: readonly { id: string; label: string; isDisabled: boolean; isLoading: boolean }[];
  appsReady: boolean;
  projectsStatus: string;
  initialFilter: CatalogFilter;
  opener: RefObject<HTMLElement | null>;
  change: (operation: CatalogChange) => Promise<DashboardConfig>;
  onApp: (id: string) => void;
  onClose: () => void;
};

export function Catalog(props: Props) {
  const { config, projects, apps, appsReady, initialFilter, change, onClose, opener } = props;
  const { t: tr, language } = useTranslation();
  const action = useCatalogActions(change);
  const root = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<"project" | "app">(initialFilter === "app" ? "app" : "project");
  const [query, setQuery] = useState("");
  const busy = action.pending;
  const entries = catalogEntries(config, projects, apps);
  // Keep disconnected/unavailable saved entries removable in the same list.
  for (const entry of config.launcher) {
    if (!entries.some(row => row.kind === "app" && row.id === entry.id))
      entries.push({ kind: "app", id: entry.id, name: entry.label, originalName: entry.label, available: false });
  }
  for (const entry of config.projects.filter(row => row.enabled)) {
    if (!projects.some(row => row.id === entry.id))
      entries.push({ kind: "project", id: entry.id, name: entry.id, originalName: entry.id, available: false });
  }
  const personal = projects.find(project => project.isPersonal);
  useLayoutEffect(() => {
    const previous = opener.current;
    const element = root.current;
    input.current?.focus();
    // Inert only the background siblings, retaining their mounted native chat.
    const siblings = Array.from(element?.parentElement?.children ?? []).filter(child => child !== element);
    const inert = siblings.map(child => [child, child.hasAttribute("inert")] as const);
    inert.forEach(([child]) => child.setAttribute("inert", ""));
    return () => {
      inert.forEach(([child, wasInert]) => { if (!wasInert) child.removeAttribute("inert"); });
      if (previous?.isConnected && (!element || element.contains(document.activeElement) || document.activeElement === document.body)) previous.focus();
    };
  }, [opener]);
  const q = query.trim().toLocaleLowerCase();
  const filtered = entries.filter(entry => filter === entry.kind
    && `${entry.name} ${entry.originalName}`.toLocaleLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, language, { sensitivity: "base" }));
  const errorText = String(action.error).includes("DASHBOARD_PROJECT_UNAVAILABLE") ? tr("projectGone") : String(action.error).includes("DASHBOARD_CATALOG_LIMIT") ? tr("catalogLimit") : String(action.error).includes("DASHBOARD_CATALOG_STALE") ? tr("catalogStale") : tr("actionFailed");
  return <section ref={root} className="db-catalog-overlay" role="dialog" aria-modal="true" aria-label={tr("catalogTitle")} onKeyDown={event => {
    if (event.defaultPrevented) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (event.key === "Tab") {
      const focusable = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? [])
        .filter(element => {
          for (let node: HTMLElement | null = element; node && node !== root.current; node = node.parentElement) {
            if (node.hidden || getComputedStyle(node).display === "none") return false;
          }
          return true;
        });
      const first = focusable[0], last = focusable.at(-1);
      if (first && last && (event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
    }
  }}>
    <div className="db-catalog-window">
      <header className="db-catalog-heading"><div><h2>{tr("catalogTitle")}</h2><p>{tr("catalogSubtitle")}</p></div><button type="button" className="db-button" onClick={onClose}>{tr("catalogDone")}</button></header>
      <div className="db-catalog-tabs" role="tablist" aria-label={tr("catalogTitle")}>
        {(["project", "app"] as const).map(kind => <button key={kind} id={`db-catalog-tab-${kind}`} type="button" role="tab"
          aria-selected={filter === kind} aria-controls="db-catalog-panel" tabIndex={filter === kind ? 0 : -1}
          onClick={() => setFilter(kind)} onKeyDown={event => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              const next = event.key === "Home" ? "project" : event.key === "End" ? "app" : filter === "project" ? "app" : "project";
              setFilter(next); root.current?.querySelector<HTMLButtonElement>(`#db-catalog-tab-${next}`)?.focus();
            }
          }}>{tr(kind === "project" ? "projects" : "catalogApps")}</button>)}
      </div>
      <div className="db-catalog-browse" role="tabpanel" id="db-catalog-panel" aria-labelledby={`db-catalog-tab-${filter}`}>
        <input ref={input} className="db-input" aria-label={tr("catalogSearch")} placeholder={tr("catalogSearch")} type="search" value={query} onChange={event => setQuery(event.target.value)}/>
        <div className="db-catalog-results" aria-busy={busy}>
          {filter === "project" && props.projectsStatus !== "ready" && <p role="status" className="db-muted">{tr(props.projectsStatus === "error" ? "syncFailed" : "loadingProjects")}</p>}
          {filter === "app" && !appsReady && <p role="status" className="db-muted">{tr("navigationHelp")}</p>}
          <ul className="db-catalog-items" aria-label={tr(filter === "project" ? "projects" : "catalogApps")}>
            {filtered.map(entry => {
              const added = entry.kind === "project" ? config.projects.some(row => row.enabled && row.id === entry.id) : config.launcher.some(row => row.id === entry.id);
              return <li className="db-catalog-item" key={JSON.stringify([entry.kind, entry.id])} aria-label={entry.name} data-added={added}>
                <label title={entry.name}>
                  <input type="checkbox" checked={added} disabled={busy || !added && !entry.available}
                    onChange={event => void action.run({ type: event.target.checked ? "add" : "remove", kind: entry.kind, id: entry.id, label: entry.name })}/>
                  <span className="db-catalog-item-title">{entry.name}</span>
                  {!entry.available && <small>{tr("unavailable")}</small>}
                </label>
              </li>;
            })}
          </ul>
          {!filtered.length && (filter === "project" ? props.projectsStatus === "ready" : appsReady) && <p className="db-muted">{tr("catalogNoResults")}</p>}
        </div>
        {filter === "project" && <div className="db-catalog-special">
          {personal && <label><input type="checkbox" disabled={busy} checked={config.projects.some(entry => entry.id === personal.id && entry.enabled)} onChange={event => void action.run({ type: event.target.checked ? "add" : "remove", kind: "project", id: personal.id })}/>{tr("commonThreads")}</label>}
          <label><input type="checkbox" disabled={busy} checked={config.sharedPool !== false} onChange={event => void action.run({ type: "pool", enabled: event.target.checked })}/>{tr("sharedPool")}</label>
        </div>}
      </div>
      <footer className="db-catalog-footer">
        {action.error ? <div role="alert">{errorText} <button type="button" className="db-button" onClick={() => action.retry?.()} disabled={busy}>{tr("retry")}</button></div> : <span role="status">{busy ? tr("saving") : tr("catalogImmediate")}</span>}
      </footer>
    </div>
  </section>;
}
