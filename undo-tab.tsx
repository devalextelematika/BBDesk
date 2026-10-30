import { useEffect, useRef } from "react";
import { Icon } from "./components/ui/icon";
import { useTranslation } from "./use-translation";

export function useUndoExpiry(token: string | undefined, paused: boolean, onExpire: () => void) {
  const remaining = useRef(12000);
  useEffect(() => { remaining.current = 12000; }, [token]);
  useEffect(() => {
    if (!token || paused) return;
    const started = Date.now();
    const timer = setTimeout(onExpire, remaining.current);
    return () => { clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (Date.now() - started)); };
  }, [token, paused, onExpire]);
}

export function UndoTabButton({ title, saving, onUndo, onPauseChange }: {
  title: string; saving: boolean; onUndo: () => void; onPauseChange: (paused: boolean) => void;
}) {
  const { t: tr } = useTranslation();
  const hovered = useRef(false);
  const focused = useRef(false);
  useEffect(() => () => onPauseChange(false), [onPauseChange]);
  const label = tr("restoreThread", { name: title });
  return <button type="button" className="db-thread-tab db-thread-undo" title={label} aria-label={label} disabled={saving}
    onClick={onUndo} onMouseEnter={() => { hovered.current = true; onPauseChange(true); }} onMouseLeave={() => { hovered.current = false; onPauseChange(focused.current); }}
    onFocus={() => { focused.current = true; onPauseChange(true); }} onBlur={() => { focused.current = false; onPauseChange(hovered.current); }}>
    <span className="db-undo-tab-title">{title}</span><Icon name="Undo2" className="db-icon"/>
  </button>;
}
