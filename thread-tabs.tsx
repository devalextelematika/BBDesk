import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ThreadIndicator } from "./components/thread-indicator";
import { useTranslation } from "./use-translation";
import { Icon } from "./components/ui/icon";
import { UndoTabButton } from "./undo-tab";
import { startThreadDrag } from "./split-layout";

export interface ThreadTab { id: string; createdAt?: number | null; title: string; detail: string; tone: string; status: string; canHide: boolean }

export function compareThreadCreation(a: { id: string; createdAt?: number | null }, b: { id: string; createdAt?: number | null }) {
  return (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.id.localeCompare(b.id);
}

export function ThreadTabs({ threads, projectId, splitIds, onOpenBeside, activeId, onSelect, onHide, saving, leadingAction, children, undo, onUndo, onUndoPauseChange }: {
  projectId: string; splitIds: string[]; onOpenBeside: (id: string) => void;
  threads: ThreadTab[]; activeId: string | null; onSelect: (id: string) => void; onHide: (id: string) => Promise<boolean>; saving: boolean; leadingAction?: ReactNode; children?: ReactNode;
  undo?: ThreadTab; onUndo: () => void; onUndoPauseChange: (paused: boolean) => void;
}) {
  const { t: tr } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const undoPlacement = useRef<{ id: string; index: number } | null>(null);
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
      ?? root.current?.querySelector<HTMLButtonElement>('[role="tab"]')
      ?? root.current?.querySelector<HTMLButtonElement>('.db-thread-undo'))?.focus();
    if (!threads.length) root.current?.querySelector<HTMLButtonElement>('.db-history-toggle')?.focus();
    setRestoreFocus(false);
  }, [restoreFocus, threads]);
  function hideControl(thread: ThreadTab) {
    return thread.canHide && <button type="button" className="db-thread-hide" disabled={saving}
      title={tr("hideThread", { name: thread.title })} aria-label={tr("hideThread", { name: thread.title })}
      onClick={async () => {
        undoPlacement.current = { id: thread.id, index: visible.findIndex(row => row.id === thread.id) };
        if (await onHide(thread.id)) setRestoreFocus(true);
      }}><Icon name="X" className="db-icon"/></button>;
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
  const pending = undo && !threads.some(thread => thread.id === undo.id) ? undo : undefined;
  const entries = pending ? [...threads, pending].sort(compareThreadCreation) : threads;
  const capacity = width ? Math.max(1, Math.floor((width - 132 - (leadingAction ? 36 : 0)) / 168)) : entries.length;
  const visible = pending && undoPlacement.current?.id === pending.id && undoPlacement.current.index < 0 && capacity <= threads.length
    ? threads.slice(0, capacity) : entries.slice(0, capacity);
  if (pending && undoPlacement.current?.id === pending.id && undoPlacement.current.index >= 0 && !visible.includes(pending)) {
    visible[Math.min(undoPlacement.current.index, visible.length - 1)] = pending;
  }
  const selected = threads.find(thread => thread.id === activeId);
  if (selected && !visible.includes(selected) && visible.length) {
    const reversedIndex = [...visible].reverse().findIndex(thread => thread !== pending);
    if (reversedIndex >= 0) visible[visible.length - 1 - reversedIndex] = selected;
  }
  visible.sort(compareThreadCreation);
  const overflow = entries.filter(thread => !visible.includes(thread));
  function choose(id: string) { onSelect(id); setOpen(false); }
  return <div className="db-thread-dock" ref={root} data-measured-width={width} onKeyDown={event => {
    if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    {leadingAction}
    <div className="db-thread-tabs" role="tablist" aria-label={tr("projectThreads")}>
      {visible.map(thread => thread === pending ? <div key={thread.id} className="db-thread-tab-item" role="presentation" data-undo="true"><UndoTabButton title={thread.title} saving={saving} onUndo={onUndo} onPauseChange={onUndoPauseChange}/></div> : <div key={thread.id} className="db-thread-tab-item" role="presentation" data-selected={activeId === thread.id}><button type="button" role="tab" className="db-thread-tab"
        aria-selected={activeId === thread.id} aria-controls="db-thread-workspace" tabIndex={activeId === thread.id || !selected && thread === visible[0] ? 0 : -1}
        draggable onDragStart={event => startThreadDrag(event, projectId, thread.id)}
        title={`${thread.title} · ${thread.detail} · ${thread.status} · ${tr("splitDragHelp")}`} aria-label={`${thread.title}: ${thread.status}`}
        onClick={() => choose(thread.id)} onKeyDown={event => {
          if (event.altKey && event.key === "Enter") { event.preventDefault(); onOpenBeside(thread.id); return; }
          const navigable = visible.filter(row => row !== pending);
          const index = navigable.indexOf(thread);
          const next = event.key === "Home" ? 0 : event.key === "End" ? navigable.length - 1
            : event.key === "ArrowRight" ? (index + 1) % navigable.length : event.key === "ArrowLeft" ? (index + navigable.length - 1) % navigable.length : -1;
          if (next < 0) return;
          event.preventDefault(); choose(navigable[next]!.id);
          root.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}><ThreadIndicator tone={thread.tone}/><span>{thread.title}</span>{splitIds.length > 1 && splitIds.includes(thread.id) && <Icon name="Columns2" className="db-split-mark"/>}</button>{hideControl(thread)}</div>)}
    </div>
    {overflow.length > 0 && <button type="button" className="db-thread-more" ref={trigger} aria-expanded={open}
      aria-controls="db-thread-overflow" onClick={() => setOpen(!open)}>{tr("moreThreads", { count: overflow.length })}</button>}
    {children}
    {open && overflow.length > 0 && <section className="db-thread-overflow" id="db-thread-overflow" aria-label={tr("moreThreadsTitle")}>
      <div className="db-thread-overflow-list">{overflow.map(thread =>
        <div className="db-thread-overflow-item" key={thread.id} data-undo={thread === pending || undefined}>{thread === pending
          ? <UndoTabButton title={thread.title} saving={saving} onUndo={onUndo} onPauseChange={onUndoPauseChange}/>
          : <><button type="button" draggable onDragStart={event => { startThreadDrag(event, projectId, thread.id); }}
          onKeyDown={event => { if (event.altKey && event.key === "Enter") { event.preventDefault(); onOpenBeside(thread.id); setOpen(false); } }}
          onClick={() => { choose(thread.id); trigger.current?.focus(); }} title={`${thread.detail} · ${tr("splitDragHelp")}`}>
          <ThreadIndicator tone={thread.tone}/><span>{thread.title}</span><small>{thread.status}</small>
        </button>{hideControl(thread)}</>}</div>)}</div>
    </section>}
  </div>;
}
