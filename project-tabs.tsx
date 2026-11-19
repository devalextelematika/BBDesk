import { useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent } from "react";
import { experimental_ProviderIcon as ProviderIcon, experimental_useProviders as useProviders } from "@get-bb/plugin-sdk/app";
import { Icon } from "./components/ui/icon";
import { ThreadIndicator } from "./components/thread-indicator";
import { useTranslation } from "./use-translation";
import { dropAfter, observeResize } from "./dom-utils";

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

interface SharedPoolTab {
  name: string; help: string; pressed: boolean; drop: boolean;
  states: ProjectTab["states"]; queued: number; controls?: string;
  onSelect: () => void; onCreate: () => void;
  onDragOver: (event: DragEvent<HTMLButtonElement>) => void;
  onDrop: (event: DragEvent<HTMLButtonElement>) => void;
}

export function ProjectTabs({ projects, activeId, onSelect, onCreate, onReorder, sharedPool }: {
  projects: ProjectTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (id: string) => void;
  onReorder?: (id: string, targetId: string, after: boolean) => void;
  sharedPool?: SharedPoolTab;
}) {
  const { t: tr } = useTranslation();
  const directory = useProviders();
  const root = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const drag = useRef<string | null>(null);
  const openedByDrag = useRef(false);
  const menuId = useId();
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const [capacity, setCapacity] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const poolId = menuId + '-pool';
  const tabs: ProjectTab[] = [...projects.filter(project => !project.common), ...projects.filter(project => project.common)];
  if (sharedPool) tabs.push({ id: poolId, name: sharedPool.name, available: true,
    running: sharedPool.states.filter(state => state.tone === 'running').length,
    attention: sharedPool.states.filter(state => state.tone === 'attention').length,
    queued: sharedPool.queued, total: sharedPool.states.length, states: sharedPool.states });
  const selectedId = sharedPool?.pressed ? poolId : activeId;
  function select(id: string) { if (id === poolId) sharedPool?.onSelect(); else onSelect(id); }
  const visible = tabs.slice(0, capacity ?? tabs.length);
  const overflow = tabs.slice(capacity ?? tabs.length);
  const tabStop = visible.some(project => project.id === selectedId) ? selectedId : visible[0]?.id ?? null;
  const activeOverflow = overflow.find(project => project.id === selectedId);

  // Keep overflow tabs measurable but inert: activity, fonts and host pane resizing
  // can all change the number of complete tabs that fit in the available space.
  useLayoutEffect(() => {
    const element = root.current!;
    const row = strip.current!;
    const view = element.ownerDocument.defaultView!;
    const measure = () => {
      const width = element.clientWidth;
      if (!width) return;
      const style = view.getComputedStyle(element);
      const available = width - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0');
      const widths = Array.from(row.children).map(child => child.getBoundingClientRect().width);
      const gap = parseFloat(view.getComputedStyle(row).gap) || 0;
      const total = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * gap;
      const budget = available - (total > available ? (trigger.current?.getBoundingClientRect().width || 32) + gap : 0);
      let used = 0;
      let count = 0;
      for (const width of widths) {
        const next = used + (count ? gap : 0) + width;
        if (next > budget) break;
        used = next;
        count++;
      }
      setCapacity(previous => previous === count ? previous : count);
    };
    const stop = observeResize(element, measure, Array.from(row.children));
    void element.ownerDocument.fonts?.ready.then(measure);
    return stop;
  }, [projects, directory.providers, sharedPool]);
  useLayoutEffect(() => {
    if (!open || openedByDrag.current) return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const doc = root.current!.ownerDocument;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const focusOut = (event: FocusEvent) => { if (!drag.current && !root.current?.contains(event.target as Node)) setOpen(false); };
    doc.addEventListener('pointerdown', close);
    doc.addEventListener('focusin', focusOut);
    return () => { doc.removeEventListener('pointerdown', close); doc.removeEventListener('focusin', focusOut); };
  }, [open]);
  useLayoutEffect(() => {
    if (!overflow.length && open) {
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"], .db-pool-toggle[aria-pressed="true"]')?.focus();
    }
  }, [overflow.length, open]);
  function renderProject(project: ProjectTab, inMenu = false, hidden = false) {
    const active = project.id === selectedId;
    const pool = project.id === poolId ? sharedPool : undefined;
    const reorderable = !!onReorder && !project.common && !pool;
    const summary = tr('projectSummary', { working: project.running, attention: project.attention, queued: project.queued, results: project.states.filter(state => ['result', 'completed', 'read'].includes(state.tone)).length });
    const description = !project.available ? tr('unavailableProject') : project.states.length ? summary : project.total ? tr('results') : tr('noActivity');
    const threads = [...project.states].sort((a, b) => a.id.localeCompare(b.id)).map(state => state.providerId ? state.title + ': ' + state.text + ' (' + providerLabel(state.providerId, directory.providers) + ')' : state.title + ': ' + state.text).join('; ');
    const dropMark = drop?.id === project.id ? drop.after ? 'after' : 'before' : undefined;
    return <div className={'db-project-tab-wrap' + (project.common ? ' db-common-threads' : '') + (active ? ' selected' : '') + (pool ? ' db-shared-pool-tab' : '')} role="presentation" key={project.id}
      data-overflow={hidden || undefined} aria-hidden={hidden || undefined} inert={hidden || undefined} data-drop={dropMark}
      onDragOver={event => {
        if (!reorderable || !drag.current || drag.current === project.id) return;
        event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
        const next = { id: project.id, after: dropAfter(event, inMenu) };
        setDrop(previous => previous?.id === next.id && previous.after === next.after ? previous : next);
      }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null); }}
      onDrop={event => {
        const source = drag.current;
        drag.current = null; setDrop(null);
        if (!reorderable || !onReorder || !source || source === project.id) return;
        event.preventDefault(); event.stopPropagation();
        onReorder(source, project.id, dropAfter(event, inMenu));
      }}>
      <button type="button" role={inMenu ? 'menuitemradio' : pool ? 'button' : 'tab'} id={inMenu ? undefined : 'db-project-tab-' + project.id}
        aria-controls={pool ? pool.controls : 'db-project-panel-' + project.id} aria-selected={inMenu || pool ? undefined : active} aria-pressed={pool && !inMenu ? active : undefined} aria-checked={inMenu ? active : undefined}
        tabIndex={inMenu ? -1 : project.id === tabStop ? 0 : -1} className={pool ? "db-pool-toggle" : "db-project-tab"} data-drop={pool?.drop || undefined}
        onDragOver={pool?.onDragOver} onDrop={pool?.onDrop} aria-label={pool && !project.states.length ? project.name : project.name + ', ' + summary + '. ' + threads} title={pool ? project.states.length ? project.name + ': ' + summary : pool.help : project.name + ': ' + description}
        draggable={reorderable}
        onClick={() => { select(project.id); if (inMenu) { setOpen(false); trigger.current?.focus(); } }}
        onKeyDown={event => {
          if (inMenu) return;
          const index = visible.indexOf(project);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1
            : event.key === 'ArrowRight' ? (index + 1) % visible.length : event.key === 'ArrowLeft' ? (index + visible.length - 1) % visible.length : -1;
          if (next < 0) return;
          event.preventDefault(); select(visible[next]!.id);
          strip.current?.children[next]?.querySelector<HTMLButtonElement>('button')?.focus();
        }}
        onDragStart={event => {
          if (!reorderable) return;
          drag.current = project.id;
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', 'db-project:' + project.id);
        }}
        onDragEnd={() => { drag.current = null; setDrop(null); }}>
        <ProjectFace name={project.name} states={project.states}/>
      </button>
      <button type="button" role={inMenu ? 'menuitem' : undefined} className="db-tab-create db-icon-btn" disabled={!project.available}
        title={tr('newThreadTitle', { name: project.name })} aria-label={pool ? tr('newThreadInPool') : tr('newThreadInProject', { name: project.name })}
        onClick={() => { if (pool) pool.onCreate(); else onCreate(project.id); if (inMenu) { setOpen(false); trigger.current?.focus(); } }}><Icon name="Plus" className="db-icon"/></button>
    </div>;
  }
  const moreLabel = tr('moreProjects', { count: overflow.length });
  return <div ref={root} className="db-project-tabs" onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    <div className="db-project-tab-strip" ref={strip} role="tablist" aria-label={tr('projects')}>
      {tabs.map((project, index) => renderProject(project, false, index >= visible.length))}
    </div>
    <button type="button" className="db-project-more db-icon-btn" ref={trigger} hidden={!overflow.length} aria-label={moreLabel}
      title={activeOverflow ? moreLabel + ' · ' + activeOverflow.name : moreLabel} data-selected={!!activeOverflow || undefined}
      aria-haspopup="menu" aria-expanded={open && !!overflow.length} aria-controls={open ? menuId : undefined}
      onClick={() => { openedByDrag.current = false; setOpen(!open); }}
      onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openedByDrag.current = false; setOpen(true); } }}
      onDragOver={event => { if (onReorder && drag.current || sharedPool?.drop) { event.preventDefault(); event.dataTransfer.dropEffect = drag.current ? 'move' : 'copy'; openedByDrag.current = true; setOpen(true); } }}>
      <Icon name="MoreHorizontal" className="db-icon"/>
    </button>
    {open && overflow.length > 0 && <div id={menuId} className="db-project-overflow" role="menu" aria-label={moreLabel}
      onKeyDown={event => {
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const index = items.indexOf(event.target as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index + items.length - 1) % items.length : -1;
        if (next >= 0) { event.preventDefault(); items[next]?.focus(); }
      }}>{overflow.map(project => renderProject(project, true))}</div>}
  </div>;
}
