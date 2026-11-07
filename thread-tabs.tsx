import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { ThreadIndicator } from "./components/thread-indicator";
import { useTranslation } from "./use-translation";
import { Icon } from "./components/ui/icon";
import { startThreadDrag } from "./split-layout";

export interface ThreadTab { id: string; createdAt?: number | null; title: string; detail: string; tone: string; status: string; canHide: boolean; projectId?: string; caption?: string }

import { compareThreadCreation } from "./workspace-selectors";
export { compareThreadCreation } from "./workspace-selectors";

export function ThreadTabs({ threads, projectId, splitIds, onOpenBeside, activeId, onSelect, onHide, saving, leadingAction, children, poolIds = [], onTogglePool, preserveOrder = false, threadsLabel, poolRemoval = false, onReorder }: {
  projectId: string; splitIds: string[]; onOpenBeside: (id: string) => void;
  threads: ThreadTab[]; activeId: string | null; onSelect: (id: string) => void; onHide: (id: string) => Promise<boolean>; saving: boolean; leadingAction?: ReactNode; children?: ReactNode;
  poolIds?: string[]; onTogglePool?: (threadId: string, projectId: string) => void; preserveOrder?: boolean; threadsLabel?: string; poolRemoval?: boolean;
  onReorder?: (threadId: string, targetId: string, after: boolean) => void;
}) {
  const { t: tr } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dragging = useRef<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const [width, setWidth] = useState(0);
  const [open, setOpen] = useState(false);
  const [restoreFocus, setRestoreFocus] = useState(false);
  useLayoutEffect(() => {
    if (!open) return;
    const panel = root.current?.querySelector<HTMLElement>('.db-thread-overflow');
    panel?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => { if (panel?.contains(document.activeElement)) trigger.current?.focus(); };
  }, [open]);
  useEffect(() => {
    if (!restoreFocus) return;
    (root.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')
      ?? root.current?.querySelector<HTMLButtonElement>('[role="tab"]'))?.focus();
    if (!threads.length) root.current?.querySelector<HTMLButtonElement>('.db-history-toggle')?.focus();
    setRestoreFocus(false);
  }, [restoreFocus, threads]);
  function hideControl(thread: ThreadTab) {
    return thread.canHide && <button type="button" className="db-thread-hide" disabled={saving}
      title={tr("hideThread", { name: thread.title })} aria-label={tr("hideThread", { name: thread.title })}
      onClick={async () => {
        if (await onHide(thread.id)) setRestoreFocus(true);
      }}><Icon name="X" className="db-icon"/></button>;
  }
  function beginThreadDrag(event: DragEvent<HTMLButtonElement>, thread: ThreadTab) {
    dragging.current = thread.id;
    startThreadDrag(event, thread.projectId || projectId, thread.id);
  }
  function endThreadDrag() {
    dragging.current = null;
    setDrop(null);
  }
  function reorderTarget(id: string, vertical: boolean) {
    if (!onReorder) return {};
    const afterHalf = (event: DragEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      return vertical ? event.clientY >= rect.top + rect.height / 2 : event.clientX >= rect.left + rect.width / 2;
    };
    return {
      onDragOver: (event: DragEvent<HTMLDivElement>) => {
        const source = dragging.current;
        if (!source || !threads.some(thread => thread.id === source)) return;
        if (source === id) { setDrop(current => current?.id === id ? null : current); return; }
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
        const after = afterHalf(event);
        setDrop(current => current?.id === id && current.after === after ? current : { id, after });
      },
      onDragLeave: (event: DragEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(current => current?.id === id ? null : current);
      },
      onDrop: (event: DragEvent<HTMLDivElement>) => {
        const source = dragging.current;
        if (!source || source === id || !threads.some(thread => thread.id === source)) return;
        event.preventDefault();
        event.stopPropagation();
        onReorder(source, id, afterHalf(event));
        setDrop(null);
      },
    };
  }
  function poolControl(thread: ThreadTab) {
    if (!onTogglePool) return null;
    const pinned = poolIds.includes(thread.id);
    const label = tr(pinned ? "removeFromPool" : "addToPool", { name: thread.title });
    return <button type="button" className={poolRemoval ? "db-thread-hide" : "db-thread-pin"} aria-pressed={poolRemoval ? undefined : pinned} title={label} aria-label={label}
      onClick={() => onTogglePool(thread.id, thread.projectId || projectId)}><Icon name={poolRemoval ? "X" : "Pin"} className="db-icon"/></button>;
  }
  useLayoutEffect(() => {
    const element = root.current!;
    const view = element.ownerDocument.defaultView;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const Observer = typeof ResizeObserver === "undefined" ? view?.ResizeObserver : ResizeObserver;
    const observer = Observer ? new Observer(measure) : null;
    observer?.observe(element);
    view?.addEventListener("resize", measure);
    return () => { observer?.disconnect(); view?.removeEventListener("resize", measure); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const entries = threads;
  const capacity = width ? Math.max(1, Math.floor((width - 132 - (leadingAction ? 36 : 0)) / (onTogglePool ? 194 : 168))) : entries.length;
  const visible = entries.slice(0, capacity);
  const selected = threads.find(thread => thread.id === activeId);
  if (selected && !visible.includes(selected) && visible.length) visible[visible.length - 1] = selected;
  if (!preserveOrder) visible.sort(compareThreadCreation);
  const overflow = entries.filter(thread => !visible.includes(thread));
  function choose(id: string) { onSelect(id); setOpen(false); }
  return <div className="db-thread-dock" ref={root} data-measured-width={width} onKeyDown={event => {
    if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    {leadingAction}
    <div className="db-thread-tabs" role="tablist" aria-label={threadsLabel ?? tr("projectThreads")}>
      {visible.map(thread => <div key={thread.id} className="db-thread-tab-item" role="presentation" data-selected={activeId === thread.id} data-drop={drop?.id === thread.id ? drop.after ? "after" : "before" : undefined} {...reorderTarget(thread.id, false)}><button type="button" role="tab" className="db-thread-tab"
        aria-selected={activeId === thread.id} aria-controls="db-thread-workspace" tabIndex={activeId === thread.id || !selected && thread === visible[0] ? 0 : -1}
        draggable onDragStart={event => beginThreadDrag(event, thread)} onDragEnd={endThreadDrag}
        title={`${thread.title} · ${thread.detail} · ${thread.status} · ${tr("splitDragHelp")}${onReorder ? ` · ${tr("poolReorderHelp")}` : ""}`} aria-label={thread.caption ? `${thread.caption} · ${thread.title}: ${thread.status}` : `${thread.title}: ${thread.status}`}
        onClick={() => choose(thread.id)} onKeyDown={event => {
          if (event.altKey && event.key === "Enter") { event.preventDefault(); onOpenBeside(thread.id); return; }
          const navigable = visible;
          const index = navigable.indexOf(thread);
          const next = event.key === "Home" ? 0 : event.key === "End" ? navigable.length - 1
            : event.key === "ArrowRight" ? (index + 1) % navigable.length : event.key === "ArrowLeft" ? (index + navigable.length - 1) % navigable.length : -1;
          if (next < 0) return;
          event.preventDefault(); choose(navigable[next]!.id);
          root.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}><ThreadIndicator tone={thread.tone}/><span className="db-thread-tab-title">{thread.caption ? `${thread.caption} · ${thread.title}` : thread.title}</span>{splitIds.length > 1 && splitIds.includes(thread.id) && <Icon name="Columns2" className="db-split-mark"/>}</button>{poolControl(thread)}{hideControl(thread)}</div>)}
    </div>
    {overflow.length > 0 && <button type="button" className="db-thread-more" ref={trigger} aria-expanded={open}
      aria-controls="db-thread-overflow" onClick={() => setOpen(!open)}>{tr("moreThreads", { count: overflow.length })}</button>}
    {children}
    {open && overflow.length > 0 && <section className="db-thread-overflow" id="db-thread-overflow" aria-label={tr("moreThreadsTitle")}>
      <div className="db-thread-overflow-list">{overflow.map(thread =>
        <div className="db-thread-overflow-item" key={thread.id} data-drop={drop?.id === thread.id ? drop.after ? "after" : "before" : undefined} {...reorderTarget(thread.id, true)}><button type="button" draggable onDragStart={event => beginThreadDrag(event, thread)} onDragEnd={endThreadDrag}
          onKeyDown={event => { if (event.altKey && event.key === "Enter") { event.preventDefault(); onOpenBeside(thread.id); setOpen(false); } }}
          onClick={() => { choose(thread.id); trigger.current?.focus(); }} title={`${thread.detail} · ${tr("splitDragHelp")}${onReorder ? ` · ${tr("poolReorderHelp")}` : ""}`}>
          <ThreadIndicator tone={thread.tone}/><span className="db-thread-tab-title">{thread.caption ? `${thread.caption} · ${thread.title}` : thread.title}</span><small>{thread.status}</small>
        </button>{poolControl(thread)}{hideControl(thread)}</div>)}</div>
    </section>}
  </div>;
}
