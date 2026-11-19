import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type DragEvent } from "react";
import { readThreadDrag, threadDragType } from "./split-layout";
import { dropAfter } from "./dom-utils";
import { SplitDivider } from "./components/split-divider";

export function SplitWorkspace({ ids, activeId, sizes, projectId, crossProject = false, onActivate, onAdd, onResize, renderPane }: {
  ids: string[]; activeId: string | null; sizes: Record<string, number>; projectId: string; crossProject?: boolean;
  onActivate: (id: string) => void; onAdd: (id: string, target?: string, after?: boolean, projectId?: string) => void;
  onResize: (sizes: Record<string, number>) => void;
  renderPane: (id: string, split: boolean) => ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
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
  function position(event: DragEvent, id: string) { return { id, after: dropAfter(event) }; }
  function measure(): Record<string, number> {
    return Object.fromEntries(Array.from(root.current!.querySelectorAll<HTMLElement>(".db-split-pane")).map(node => [node.dataset.threadId!, node.getBoundingClientRect().width || 320]));
  }
  function resize(left: string, right: string, delta: number, widths: Record<string, number>) {
    const change = Math.max(320 - widths[left]!, Math.min(widths[right]! - 320, delta));
    onResize({ ...widths, [left]: widths[left]! + change, [right]: widths[right]! - change });
  }
  const total = ids.reduce((sum, id) => sum + (sizes[id] ?? 1), 0) || 1;
  return <div ref={root} className="db-split-workspace" data-split={ids.length > 1 || undefined}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) finishDrag(); }}
    onDragEnd={finishDrag} onKeyDown={event => { if (event.key === "Escape" && drop) { finishDrag(); event.stopPropagation(); } }}>
    {ids.map((id, index) => <Fragment key={id}>
      {index > 0 && <SplitDivider
        valueNow={Math.round((sizes[ids[index - 1]!] ?? 1) / ((sizes[ids[index - 1]!] ?? 1) + (sizes[id] ?? 1)) * 100)}
        measure={measure} resize={(delta, widths) => resize(ids[index - 1]!, id, delta, widths)}
        reset={() => { const left = ids[index - 1]!; const average = ((sizes[left] ?? 1) + (sizes[id] ?? 1)) / 2; onResize({ ...sizes, [left]: average, [id]: average }); }}/>}
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
          const data = readThreadDrag(event.dataTransfer);
          if (data && (crossProject || data.projectId === projectId)) {
            const target = position(event, id); onAdd(data.threadId, target.id, target.after, data.projectId);
          }
        }}>{renderPane(id, ids.length > 1)}
      </div>
    </Fragment>)}
  </div>;
}
