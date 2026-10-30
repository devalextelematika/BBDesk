import { Icon } from "./components/ui/icon";
import { ThreadIndicator } from "./components/thread-indicator";

export interface ProjectTab {
  id: string;
  name: string;
  available: boolean;
  running: number;
  attention: number;
  queued: number;
  total: number;
  states: { id: string; title: string; text: string; tone: string; subagent: boolean }[];
}

export function ProjectTabs({ projects, activeId, onSelect, onCreate }: {
  projects: ProjectTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (id: string) => void;
}) {
  return <div className="db-project-tabs" role="tablist" aria-label="Проекты">
    {projects.map(project => {
      const active = project.id === activeId;
      const summary = `в работе: ${project.running}, требуют внимания: ${project.attention}, в очереди: ${project.queued}, результаты: ${project.states.filter(state => state.tone === "result" || state.tone === "read").length}`;
      const description = !project.available ? "Недоступен" : project.states.length ? summary : project.total ? "Результаты" : "Нет активности";
      return <div className={`db-project-tab-wrap${active ? " selected" : ""}`} role="presentation" key={project.id}>
        <button type="button" role="tab" id={`db-project-tab-${project.id}`} aria-controls={`db-project-panel-${project.id}`}
          aria-selected={active} tabIndex={active ? 0 : -1} className="db-project-tab" aria-label={`${project.name}, ${summary}. ${project.states.map(state => `${state.title}: ${state.text}`).join("; ")}`} title={`${project.name}: ${description}`}
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
          <span className="db-project-tab-name">{project.name}</span>
          {project.states.length > 0 && <span className="db-project-tab-states">
            {[...project.states].sort((a, b) => a.id.localeCompare(b.id)).map(state =>
              <ThreadIndicator key={state.id} tone={state.tone} subagent={state.subagent} title={`${state.title}: ${state.text}`}/>
            )}
          </span>}
        </button>
        <button type="button" className="db-tab-create db-icon-btn" disabled={!project.available}
          title={`Новый тред · ${project.name}`} aria-label={`Новый тред в проекте «${project.name}»`}
          onClick={() => onCreate(project.id)}><Icon name="Plus" className="db-icon"/></button>
      </div>;
    })}
  </div>;
}
