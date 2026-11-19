import { useLayoutEffect, useState, type RefObject } from "react";

/** Whether a drag or drop position lies past the middle of the event's current target. */
export function dropAfter(event: { currentTarget: Element; clientX: number; clientY: number }, vertical = false): boolean {
  const rect = event.currentTarget.getBoundingClientRect();
  return vertical ? event.clientY >= rect.top + rect.height / 2 : event.clientX >= rect.left + rect.width / 2;
}

/**
 * Calls `measure` now, on resize of `element` or any extra target, and on window resize.
 * Prefers the global ResizeObserver and falls back to the element's window.
 */
export function observeResize(element: Element, measure: () => void, extraTargets: readonly Element[] = []): () => void {
  const view = element.ownerDocument.defaultView;
  const Observer = typeof ResizeObserver === "undefined" ? view?.ResizeObserver : ResizeObserver;
  const observer = Observer ? new Observer(measure) : null;
  for (const target of [element, ...extraTargets]) observer?.observe(target);
  view?.addEventListener("resize", measure);
  measure();
  return () => { observer?.disconnect(); view?.removeEventListener("resize", measure); };
}

/** The element's clientWidth, kept current; 0 until measured. */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    return observeResize(element, () => setWidth(element.clientWidth));
  }, [ref]);
  return width;
}

/** Keeps Tab and Shift+Tab inside `container` by wrapping at its first and last focusable element. */
export function trapTab(event: { key: string; shiftKey: boolean; preventDefault(): void }, container: HTMLElement, selector: string, skipHidden = false) {
  if (event.key !== "Tab") return;
  let items = Array.from(container.querySelectorAll<HTMLElement>(selector));
  if (skipHidden) items = items.filter(item => {
    for (let node: HTMLElement | null = item; node && node !== container; node = node.parentElement) {
      if (node.hidden || getComputedStyle(node).display === "none") return false;
    }
    return true;
  });
  const first = items[0], last = items.at(-1);
  const active = container.ownerDocument.activeElement;
  if (first && last && (event.shiftKey ? active === first : active === last)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}
