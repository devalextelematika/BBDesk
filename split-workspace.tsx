import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type DragEvent } from "react";
import { threadDragType } from "./split-layout";
import { useTranslation } from "./use-translation";

export function SplitWorkspace({ ids, activeId, sizes, projectId, onActivate, onAdd, onResize, renderPane }: {
  ids: string[]; activeId: string | null; sizes: Record<string, number>; projectId: string;
  onActivate: (id: string) => void; onAdd: (id: string, target?: string, after?: boolean) => void;
  onResize: (sizes: Record<string, number>) => void;
  renderPane: (id: string, split: boolean) => ReactNode;
}) {
  const { t: tr } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const drag = useRef<{ pointer: number; x: number; left: string; right: string; sizes: Record<string, number> } | null>(null);
  useEffect(() => {
    const end = () => setDrop(null);
    window.addEventListener("dragend", end);
    window.addEventListener("drop", end, true);
    return () => { window.removeEventListener("dragend", end); window.removeEventListener("drop", end, true); };
  }, []);
  useLayoutEffect(() => {
    const node = root.current?.querySelector<HTMLElement>('[data-active="true"]');
    node?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeId, ids.join(":")]);
  function finishDrag() { setDrop(null); }
  function position(event: DragEvent, id: string) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { id, after: event.clientX >= rect.left + rect.width / 2 };
  }
  function resize(left: string, right: string, delta: number, measurements?: Record<string, number>) {
    const next = measurements ?? Object.fromEntries(Array.from(root.current!.querySelectorAll<HTMLElement>(".db-split-pane")).map(node => [node.dataset.threadId!, node.getBoundingClientRect().width || 320]));
    const change = Math.max(320 - next[left]!, Math.min(next[right]! - 320, delta));
    onResize({ ...next, [left]: next[left]! + change, [right]: next[right]! - change });
  }
  const total = ids.reduce((sum, id) => sum + (sizes[id] ?? 1), 0) || 1;
  return <div ref={root} className="db-split-workspace" data-split={ids.length > 1 || undefined}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) finishDrag(); }}
    onDragEnd={finishDrag} onKeyDown={event => { if (event.key === "Escape" && drop) { finishDrag(); event.stopPropagation(); } }}>
    {ids.map((id, index) => <Fragment key={id}>
      {index > 0 && <div className="db-split-divider" role="separator" aria-orientation="vertical" tabIndex={0}
        aria-label={tr("resizeSplit")} aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round((sizes[ids[index - 1]!] ?? 1) / ((sizes[ids[index - 1]!] ?? 1) + (sizes[id] ?? 1)) * 100)}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault();
          const measurements = Object.fromEntries(Array.from(root.current!.querySelectorAll<HTMLElement>(".db-split-pane")).map(node => [node.dataset.threadId!, node.getBoundingClientRect().width || 320]));
          drag.current = { pointer: event.pointerId, x: event.clientX, left: ids[index - 1]!, right: id, sizes: measurements };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => { const moving = drag.current; if (moving?.pointer === event.pointerId) resize(moving.left, moving.right, event.clientX - moving.x, moving.sizes); }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
        onDoubleClick={() => { const left = ids[index - 1]!; const average = ((sizes[left] ?? 1) + (sizes[id] ?? 1)) / 2; onResize({ ...sizes, [left]: average, [id]: average }); }}
        onKeyDown={event => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault(); resize(ids[index - 1]!, id, (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 64 : 16));
        }}/>}
      <div className="db-split-pane" data-thread-id={id} data-active={id === activeId || undefined}
        data-drop={drop?.id === id ? drop.after ? "after" : "before" : undefined}
        style={ids.length > 1 ? { flex: `0 0 calc((100% - ${(ids.length - 1) * 7}px) * ${(sizes[id] ?? 1) / total})` } : undefined}
        onPointerDownCapture={() => { if (activeId !== id) onActivate(id); }}
        onFocusCapture={() => { if (activeId !== id) onActivate(id); }}
        onDragOverCapture={event => {
          if (!Array.from(event.dataTransfer.types).includes(threadDragType)) return;
          event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDrop(position(event, id));
        }}
        onDropCapture={event => {
          if (!Array.from(event.dataTransfer.types).includes(threadDragType)) return;
          event.preventDefault(); event.stopPropagation(); finishDrag();
          try {
            const data = JSON.parse(event.dataTransfer.getData(threadDragType));
            if (data.projectId === projectId && typeof data.threadId === "string") {
              const target = position(event, id); onAdd(data.threadId, target.id, target.after);
            }
          } catch { /* Ignore unrelated and malformed drags. */ }
        }}>{renderPane(id, ids.length > 1)}
      </div>
    </Fragment>)}
  </div>;
}
