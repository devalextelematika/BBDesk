import { useRef, type CSSProperties } from "react";
import { useTranslation } from "../use-translation";

/**
 * Keyboard- and pointer-operated column separator. The owner keeps its own size
 * model: `measure` snapshots it when a gesture starts, and `resize` applies a
 * horizontal delta to that snapshot. Arrow keys measure afresh for each step.
 */
export function SplitDivider<S>({ valueNow, style, measure, resize, reset, onDragging }: {
  valueNow: number; style?: CSSProperties;
  measure: () => S; resize: (delta: number, start: S) => void; reset: () => void;
  onDragging?: (dragging: boolean) => void;
}) {
  const { t } = useTranslation();
  const drag = useRef<{ pointer: number; x: number; start: S } | null>(null);
  function finish() {
    if (!drag.current) return;
    drag.current = null;
    onDragging?.(false);
  }
  return <div className="db-split-divider" role="separator" aria-orientation="vertical" tabIndex={0}
    aria-label={t("resizeSplit")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={valueNow} style={style}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag.current = { pointer: event.pointerId, x: event.clientX, start: measure() };
      event.currentTarget.setPointerCapture(event.pointerId);
      onDragging?.(true);
    }}
    onPointerMove={event => { const current = drag.current; if (current?.pointer === event.pointerId) resize(event.clientX - current.x, current.start); }}
    onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    onDoubleClick={reset}
    onKeyDown={event => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      resize((event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 64 : 16), measure());
    }}/>;
}
