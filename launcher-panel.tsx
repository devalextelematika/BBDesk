import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";

const storageKey = "bb-dashboard:launcher-layout:v1";
const defaultWidth = 208;
const minWidth = 176;
const maxWidth = 480;

function readLayout(): { open: boolean; width: number } {
  try {
    const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    return {
      open: typeof stored?.open === "boolean" ? stored.open : true,
      width: typeof stored?.width === "number" && Number.isFinite(stored.width)
        ? Math.min(maxWidth, Math.max(minWidth, stored.width)) : defaultWidth,
    };
  } catch { return { open: true, width: defaultWidth }; }
}

// Layout belongs to this browser, independently of the shared launcher entries.
export function useLauncherPanel() {
  const [layout, setLayout] = useState(readLayout);
  const [containerWidth, setContainerWidth] = useState(0);
  const [resizing, setResizing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ id: number; startX: number; startWidth: number } | null>(null);
  const panelId = useId();
  const upperBound = containerWidth > 0
    ? Math.min(maxWidth, Math.max(0, containerWidth - (containerWidth <= 680 ? 44 : 320))) : maxWidth;
  const lowerBound = Math.min(minWidth, upperBound);
  const width = Math.min(upperBound, Math.max(lowerBound, layout.width));

  useEffect(() => {
    if (!root.current) return;
    const measure = () => setContainerWidth(root.current?.clientWidth ?? 0);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (resizing) return;
    try { window.localStorage.setItem(storageKey, JSON.stringify(layout)); }
    catch { /* Storage can be unavailable; the panel still works for this session. */ }
  }, [layout, resizing]);

  function finishResize() { drag.current = null; setResizing(false); }
  useEffect(() => {
    window.addEventListener("blur", finishResize);
    return () => window.removeEventListener("blur", finishResize);
  }, []);

  function close() {
    if (panel.current?.contains(document.activeElement)) toggle.current?.focus();
    finishResize();
    setLayout(previous => ({ ...previous, open: false }));
  }
  function setWidth(next: number) {
    setLayout(previous => ({ ...previous, width: Math.round(Math.min(upperBound, Math.max(lowerBound, next))) }));
  }
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, startX: event.clientX, startWidth: width };
    setResizing(true);
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (current?.id === event.pointerId) setWidth(current.startWidth + event.clientX - current.startX);
  }
  function onPointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId) return;
    finishResize();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function onResizeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 50 : 10;
    const next = { ArrowLeft: width - step, ArrowRight: width + step, Home: lowerBound, End: upperBound }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setWidth(next);
  }
  return {
    root, panel, toggle, panelId, open: layout.open, resizing, close, compact: containerWidth > 0 && containerWidth <= 680,
    toggleOpen: () => layout.open ? close() : setLayout(previous => ({ ...previous, open: true })),
    style: { "--db-launcher-width": `${width}px` } as CSSProperties,
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape" && layout.open && !event.defaultPrevented) { event.preventDefault(); close(); }
    },
    resizeProps: {
      role: "separator", tabIndex: layout.open ? 0 : -1,
      "aria-label": "Ширина панели приложений", "aria-orientation": "vertical" as const,
      "aria-controls": panelId, "aria-valuemin": lowerBound, "aria-valuemax": upperBound,
      "aria-valuenow": width, "aria-valuetext": `${width} пикселей`,
      title: "Перетащите для изменения ширины. Стрелки ← → — с клавиатуры.",
      onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd,
      onLostPointerCapture: finishResize, onKeyDown: onResizeKeyDown,
    },
  };
}
