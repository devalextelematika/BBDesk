import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { catalogEntries } from "./catalog-model";
import type { CatalogChange } from "./catalog-config";
import { useCatalogActions } from "./hooks/use-catalog-actions";
import { useTranslation } from "./use-translation";
import { catalogChangeSchema, type DashboardConfig } from "./contracts";
import { trapTab } from "./dom-utils";
import type { ApplicationMode } from "./hooks/use-app-split";

const tabs = ["project", "app", "settings"] as const;
type Props = {
  applicationMode: ApplicationMode;
  onApplicationMode: (value: ApplicationMode) => void;
  showQuotaDock: boolean;
  onQuotaDockVisibility: (visible: boolean) => void;
  config: DashboardConfig;
  projects: readonly { id: string; name: string; isPersonal: boolean }[];
  apps: readonly { id: string; label: string; isDisabled: boolean; isLoading: boolean }[];
  appsReady: boolean;
  projectsStatus: string;
  opener: RefObject<HTMLElement | null>;
  change: (operation: CatalogChange) => Promise<DashboardConfig>;
  onClose: () => void;
};

export function Catalog(props: Props) {
  const { config, projects, apps, appsReady, change, onClose, opener } = props;
  const { t: tr, language } = useTranslation();
  const action = useCatalogActions(change);
  const root = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<typeof tabs[number]>("project");
  const [query, setQuery] = useState("");
  const [backgroundText, setBackgroundText] = useState(() => config.backgroundThreads?.substrings.join("\n") ?? "");
  const [backgroundInvalid, setBackgroundInvalid] = useState(false);
  const busy = action.pending;
  function saveBackground(enabled = config.backgroundThreads?.enabled ?? false) {
    const substrings = backgroundText.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    const parsed = catalogChangeSchema.safeParse({ type: "background", enabled, substrings });
    setBackgroundInvalid(!parsed.success);
    if (!parsed.success) return;
    if (enabled === (config.backgroundThreads?.enabled ?? false) && JSON.stringify(substrings) === JSON.stringify(config.backgroundThreads?.substrings ?? [])) return;
    void action.run(parsed.data, saved => setBackgroundText(saved.backgroundThreads?.substrings.join("\n") ?? ""));
  }
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
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (filter === "settings") saveBackground(); onClose(); }
    if (root.current) trapTab(event, root.current, 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]', true);
  }}>
    <div className="db-catalog-window">
      <header className="db-catalog-heading"><div><h2>{tr("catalogTitle")}</h2><p>{tr("catalogSubtitle")}</p></div><button type="button" className="db-button" onClick={onClose}>{tr("catalogDone")}</button></header>
      <div className="db-catalog-tabs" role="tablist" aria-label={tr("catalogTitle")}>
        {tabs.map(kind => <button key={kind} id={`db-catalog-tab-${kind}`} type="button" role="tab"
          aria-selected={filter === kind} aria-controls="db-catalog-panel" tabIndex={filter === kind ? 0 : -1}
          onClick={() => setFilter(kind)} onKeyDown={event => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              const next = event.key === "Home" ? "project" : event.key === "End" ? "settings" : tabs[(tabs.indexOf(kind) + (event.key === "ArrowLeft" ? 2 : 1)) % tabs.length]!;
              setFilter(next); root.current?.querySelector<HTMLButtonElement>(`#db-catalog-tab-${next}`)?.focus();
            }
          }}>{tr(kind === "settings" ? "extraSettings" : kind === "project" ? "projects" : "catalogApps")}</button>)}
      </div>
      <div className="db-catalog-browse" data-settings={filter === "settings" || undefined} role="tabpanel" id="db-catalog-panel" aria-labelledby={`db-catalog-tab-${filter}`}>
        {filter === "settings" ? <div className="db-catalog-special">
        <fieldset className="db-app-mode-settings">
          <legend>{tr("applicationModeSetting")}</legend>
          <p className="db-muted">{tr("applicationModeDescription")}</p>
          <div className="db-app-mode-options">
            <label><input type="radio" name="db-app-mode" value="native" checked={props.applicationMode === "native"} onChange={() => props.onApplicationMode("native")}/><span><strong>{tr("applicationModeNative")}</strong><small>{tr("applicationModeNativeDescription")}</small></span></label>
            <label><input type="radio" name="db-app-mode" value="split" checked={props.applicationMode === "split"} onChange={() => props.onApplicationMode("split")}/><span><strong>{tr("applicationModeSplit")}</strong><small>{tr("applicationModeSplitDescription")}</small></span></label>
            <label><input type="radio" name="db-app-mode" value="accordion" checked={props.applicationMode === "accordion"} onChange={() => props.onApplicationMode("accordion")}/><span><strong>{tr("applicationModeAccordion")}</strong><small>{tr("applicationModeAccordionDescription")}</small></span></label>
          </div>
        </fieldset>
        <label className="db-quota-setting">
          <input type="checkbox" checked={props.showQuotaDock} onChange={event => props.onQuotaDockVisibility(event.target.checked)}/>
          {tr("quotaShowSetting")}
        </label>
        <div className="db-background-settings">
          <label><input type="checkbox" data-background-toggle checked={config.backgroundThreads?.enabled ?? false} disabled={busy}
            onChange={event => saveBackground(event.target.checked)}/>{tr("backgroundSetting")}</label>
          <label className="db-background-label" htmlFor="db-background-substrings">{tr("backgroundSubstrings")}</label>
          <textarea id="db-background-substrings" className="db-input db-background-input" rows={5} value={backgroundText} disabled={busy}
            aria-describedby="db-background-description" aria-invalid={backgroundInvalid}
            onChange={event => { setBackgroundText(event.target.value); setBackgroundInvalid(false); }}
            onBlur={event => { if (!(event.relatedTarget instanceof HTMLElement && event.relatedTarget.hasAttribute("data-background-toggle"))) saveBackground(); }}/>
          <p id="db-background-description" className="db-muted">{tr("backgroundDescription")}</p>
          {backgroundInvalid && <p role="alert">{tr("backgroundLimit")}</p>}
        </div></div> : <>
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
        </>}
      </div>
      <footer className="db-catalog-footer">
        {action.error ? <div role="alert">{errorText} <button type="button" className="db-button" onClick={() => action.retry?.()} disabled={busy}>{tr("retry")}</button></div> : <span role="status">{busy ? tr("saving") : tr("catalogImmediate")}</span>}
      </footer>
    </div>
  </section>;
}
