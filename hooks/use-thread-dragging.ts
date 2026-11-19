import { useEffect, useState } from "react";
import { threadDragType } from "../split-layout";

/** Whether a BBDesk thread is being dragged anywhere in the window. */
export function useThreadDragging() {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const start = (event: DragEvent) => { if (Array.from(event.dataTransfer?.types ?? []).includes(threadDragType)) setDragging(true); };
    const end = () => setDragging(false);
    window.addEventListener("dragstart", start); window.addEventListener("dragend", end); window.addEventListener("drop", end, true);
    return () => { window.removeEventListener("dragstart", start); window.removeEventListener("dragend", end); window.removeEventListener("drop", end, true); };
  }, []);
  return dragging;
}
