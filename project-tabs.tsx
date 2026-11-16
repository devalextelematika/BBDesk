import { useLayoutEffect, useRef, useState, type DragEvent } from "react";
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
  common?: boolean;
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

function ProjectFace({ name, states }: { name: string; states: ProjectTab["states"] }) {
  const directory = useProviders();
  const ordered = [...states].sort((a, b) => a.id.localeCompare(b.id));
  const marks = providerMarks(ordered, directory.providers);
  return <>
    <span className="db-project-tab-identity">
      {marks.length > 0 && <span className="db-project-providers">
        {marks.map(mark => <span key={mark.id} className="db-project-provider-wrap" title={`${mark.name}: ${mark.titles.join(", ")}`}>
          <ProviderIcon providerKind="agent" provider={mark.provider} className="db-project-provider" aria-hidden="true"/>
        </span>)}
      </span>}
      <span className="db-project-tab-name">{name}</span>
    </span>
    {ordered.length > 0 && <span className="db-project-tab-states">
      {ordered.map(state =>
        <ThreadIndicator key={state.id} tone={state.tone} subagent={state.subagent} title={`${state.title}: ${state.text}`}/>
      )}
    </span>}
  </>;
}

export function ProjectTabs({ projects, activeId, onSelect, onCreate, onReorder, label }: {
  projects: ProjectTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (id: string) => void;
  onReorder?: (id: string, targetId: string, after: boolean) => void;
  label?: string;
}) {
  const { t: tr } = useTranslation();
  const directory = useProviders();
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const tabs = [...projects.filter(project => !project.common), ...projects.filter(project => project.common)];
  const tabStop = tabs.some(project => project.id === activeId) ? activeId : tabs[0]?.id ?? null;
  useLayoutEffect(() => { root.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" }); }, [activeId]);
  function dropSide(event: DragEvent<HTMLElement>, id: string) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { id, after: event.clientX >= rect.left + rect.width / 2 };
  }
  return <div ref={root} className="db-project-tabs" role="tablist" aria-label={label ?? tr("projects")}>
    {tabs.map(project => {
      const active = project.id === activeId;
      const summary = tr("projectSummary", { working: project.running, attention: project.attention, queued: project.queued, results: project.states.filter(state => ["result", "completed", "read"].includes(state.tone)).length });
      const description = !project.available ? tr("unavailableProject") : project.states.length ? summary : project.total ? tr("results") : tr("noActivity");
      const ordered = [...project.states].sort((a, b) => a.id.localeCompare(b.id));
      const threads = ordered.map(state => state.providerId ? `${state.title}: ${state.text} (${providerLabel(state.providerId, directory.providers)})` : `${state.title}: ${state.text}`).join("; ");
      const dropMark = drop?.id === project.id ? drop.after ? "after" : "before" : undefined;
      return <div className={`db-project-tab-wrap${project.common ? " db-common-threads" : ""}${active ? " selected" : ""}`} role="presentation" key={project.id} data-drop={dropMark} aria-dropeffect={drop ? "move" : undefined}
        onDragOver={event => {
          if (!onReorder || drag.current === null || drag.current === project.id) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          const next = dropSide(event, project.id);
          setDrop(previous => previous?.id === next.id && previous.after === next.after ? previous : next);
        }}
        onDrop={event => {
          const source = drag.current;
          drag.current = null; setDrop(null);
          if (!onReorder || !source || source === project.id) return;
          event.preventDefault();
          event.stopPropagation();
          onReorder(source, project.id, dropSide(event, project.id).after);
        }}>
        <button type="button" role="tab" id={`db-project-tab-${project.id}`} aria-controls={`db-project-panel-${project.id}`}
          aria-selected={active} tabIndex={project.id === tabStop ? 0 : -1} className="db-project-tab" aria-label={`${project.name}, ${summary}. ${threads}`} title={`${project.name}: ${description}`}
          draggable={!!onReorder}
          onClick={() => onSelect(project.id)} onKeyDown={event => {
            const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
            if (!delta && event.key !== "Home" && event.key !== "End") return;
            event.preventDefault();
            const index = tabs.findIndex(candidate => candidate.id === project.id);
            const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + delta + tabs.length) % tabs.length;
            const next = tabs[nextIndex]!;
            onSelect(next.id);
            const target = event.currentTarget.closest('[role="tablist"]')?.querySelector<HTMLButtonElement>(`[id="db-project-tab-${next.id}"]`);
            target?.focus();
            target?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
          }}
          onDragStart={event => {
            if (!onReorder) return;
            drag.current = project.id;
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", `db-project:${project.id}`);
          }}
          onDragEnd={() => { drag.current = null; setDrop(null); }}>
          <ProjectFace name={project.name} states={project.states}/>
        </button>
        <button type="button" className="db-tab-create db-icon-btn" disabled={!project.available}
          title={tr("newThreadTitle", { name: project.name })} aria-label={tr("newThreadInProject", { name: project.name })}
          onClick={() => onCreate(project.id)}><Icon name="Plus" className="db-icon"/></button>
      </div>;
    })}
  </div>;
}

export function SharedPoolButton({ name, help, pressed, drop, states, queued, controls, onClick, onDragOver, onDrop }: {
  name: string; help: string; pressed: boolean; drop: boolean; states: ProjectTab["states"]; queued: number; controls?: string;
  onClick: () => void; onDragOver: (event: DragEvent<HTMLButtonElement>) => void; onDrop: (event: DragEvent<HTMLButtonElement>) => void;
}) {
  const { t: tr } = useTranslation();
  const directory = useProviders();
  const ordered = [...states].sort((a, b) => a.id.localeCompare(b.id));
  const summary = tr("projectSummary", {
    working: ordered.filter(state => state.tone === "running").length,
    attention: ordered.filter(state => state.tone === "attention").length,
    queued,
    results: ordered.filter(state => ["result", "completed", "read"].includes(state.tone)).length,
  });
  const threads = ordered.map(state => state.providerId ? `${state.title}: ${state.text} (${providerLabel(state.providerId, directory.providers)})` : `${state.title}: ${state.text}`).join("; ");
  return <button type="button" className="db-pool-toggle" data-drop={drop || undefined} aria-pressed={pressed} aria-controls={controls}
    aria-label={ordered.length ? `${name}, ${summary}. ${threads}` : name} title={ordered.length ? `${name}: ${summary}` : help}
    onClick={onClick} onDragOver={onDragOver} onDrop={onDrop}>
    <ProjectFace name={name} states={states}/>
  </button>;
}
