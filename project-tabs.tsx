import { useLayoutEffect, useRef } from "react";
import { experimental_ProviderIcon as ProviderIcon, experimental_useProviders as useProviders } from "@get-bb/plugin-sdk/app";
import { Icon } from "./components/ui/icon";
import { ThreadIndicator } from "./components/thread-indicator";
import { useTranslation } from "./use-translation";

type KnownProvider = ReturnType<typeof useProviders>["providers"][number];

export interface ProjectTab {
  id: string;
  name: string;
  available: boolean;
  running: number;
  attention: number;
  queued: number;
  total: number;
  states: { id: string; title: string; text: string; tone: string; subagent: boolean; providerId?: string }[];
}

function providerLabel(providerId: string, providers: readonly KnownProvider[]) {
  return providers.find(provider => provider.id === providerId)?.displayName || providerId;
}

function providerMarks(states: ProjectTab["states"], providers: readonly KnownProvider[]) {
  const marks: { id: string; name: string; provider: { id: string; logoUrl?: string | null; icon?: { glyph: string } | string | null; strings?: { iconTint?: { light: string; dark: string } | null } | null }; titles: string[] }[] = [];
  for (const state of states) {
    if (!state.providerId) continue;
    const existing = marks.find(mark => mark.id === state.providerId);
    if (existing) { existing.titles.push(state.title); continue; }
    const info = providers.find(provider => provider.id === state.providerId);
    marks.push({
      id: state.providerId,
      name: providerLabel(state.providerId, providers),
      provider: info ? { id: info.id, logoUrl: info.logoUrl, icon: info.icon ?? null, strings: { iconTint: info.strings?.iconTint ?? null } } : { id: state.providerId },
      titles: [state.title],
    });
  }
  return marks;
}

export function ProjectTabs({ projects, activeId, onSelect, onCreate }: {
  projects: ProjectTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (id: string) => void;
}) {
  const { t: tr } = useTranslation();
  const directory = useProviders();
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { root.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" }); }, [activeId]);
  return <div ref={root} className="db-project-tabs" role="tablist" aria-label={tr("projects")}>
    {projects.map(project => {
      const active = project.id === activeId;
      const summary = tr("projectSummary", { working: project.running, attention: project.attention, queued: project.queued, results: project.states.filter(state => state.tone === "result" || state.tone === "read").length });
      const description = !project.available ? tr("unavailableProject") : project.states.length ? summary : project.total ? tr("results") : tr("noActivity");
      const ordered = [...project.states].sort((a, b) => a.id.localeCompare(b.id));
      const marks = providerMarks(ordered, directory.providers);
      const threads = ordered.map(state => state.providerId ? `${state.title}: ${state.text} (${providerLabel(state.providerId, directory.providers)})` : `${state.title}: ${state.text}`).join("; ");
      return <div className={`db-project-tab-wrap${active ? " selected" : ""}`} role="presentation" key={project.id}>
        <button type="button" role="tab" id={`db-project-tab-${project.id}`} aria-controls={`db-project-panel-${project.id}`}
          aria-selected={active} tabIndex={active ? 0 : -1} className="db-project-tab" aria-label={`${project.name}, ${summary}. ${threads}`} title={`${project.name}: ${description}`}
          onClick={() => onSelect(project.id)} onKeyDown={event => {
            const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
            if (!delta && event.key !== "Home" && event.key !== "End") return;
            event.preventDefault();
            const index = projects.findIndex(candidate => candidate.id === project.id);
            const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? projects.length - 1 : (index + delta + projects.length) % projects.length;
            const next = projects[nextIndex]!;
            onSelect(next.id);
            const target = event.currentTarget.closest('[role="tablist"]')?.querySelector<HTMLButtonElement>(`[id="db-project-tab-${next.id}"]`);
            target?.focus();
            target?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
          }}>
          <span className="db-project-tab-identity">
            {marks.length > 0 && <span className="db-project-providers">
              {marks.map(mark => <span key={mark.id} className="db-project-provider-wrap" title={`${mark.name}: ${mark.titles.join(", ")}`}>
                <ProviderIcon providerKind="agent" provider={mark.provider} className="db-project-provider" aria-hidden="true"/>
              </span>)}
            </span>}
            <span className="db-project-tab-name">{project.name}</span>
          </span>
          {ordered.length > 0 && <span className="db-project-tab-states">
            {ordered.map(state =>
              <ThreadIndicator key={state.id} tone={state.tone} subagent={state.subagent} title={`${state.title}: ${state.text}`}/>
            )}
          </span>}
        </button>
        <button type="button" className="db-tab-create db-icon-btn" disabled={!project.available}
          title={tr("newThreadTitle", { name: project.name })} aria-label={tr("newThreadInProject", { name: project.name })}
          onClick={() => onCreate(project.id)}><Icon name="Plus" className="db-icon"/></button>
      </div>;
    })}
  </div>;
}
