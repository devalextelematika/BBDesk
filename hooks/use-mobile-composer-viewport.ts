import { useLayoutEffect, type RefObject } from "react";

const chatSelector = ".db-chat-surface, .db-new-composer";
const editorSelector = 'textarea:not([readonly]):not([disabled]), input:not([readonly]):not([disabled]), [contenteditable]:not([contenteditable="false"])';

// The frame keeps its natural host geometry while its child fits the visual
// viewport. Measuring the resized child would subtract the keyboard repeatedly.
export function useMobileComposerViewport(frameRef: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const view = frame?.ownerDocument.defaultView;
    const viewport = view?.visualViewport;
    if (!frame || !view || !viewport) return;
    const doc = frame.ownerDocument;
    let animation: number | undefined;
    let session = false;
    let width = view.innerWidth;
    let fullHeight = Math.max(view.innerHeight, doc.documentElement.clientHeight, viewport.height);

    const reset = () => {
      delete frame.dataset.mobileComposing;
      frame.style.removeProperty("--db-visible-height");
      frame.style.removeProperty("--db-visible-top");
    };
    const update = () => {
      animation = undefined;
      const rect = frame.getBoundingClientRect();
      const layoutHeight = Math.max(view.innerHeight, doc.documentElement.clientHeight, viewport.height);
      // A rotated phone starts a new height baseline, rather than comparing
      // landscape height with the previous portrait viewport.
      if (Math.abs(width - view.innerWidth) > 80) fullHeight = layoutHeight;
      width = view.innerWidth;
      fullHeight = Math.max(fullHeight, layoutHeight);
      const phoneSize = Math.min(view.screen.width, view.screen.height);
      const compact = rect.width <= 680 || phoneSize > 0 && phoneSize <= 680;
      const mobile = compact && view.matchMedia("(pointer: coarse)").matches;
      const keyboard = fullHeight - viewport.height >= 120;
      const active = doc.activeElement;
      const chat = active instanceof view.HTMLElement && frame.contains(active) ? active.closest(chatSelector) : null;
      const editor = chat && active?.closest(editorSelector);
      const textEditor = editor && (editor.tagName !== "INPUT" || /^(text|search|email|url|tel|password|number)$/.test((editor as HTMLInputElement).type));
      // Keep space stable when the native send/attachment controls receive focus
      // or iOS blurs the editor before its keyboard closing animation finishes.
      session = keyboard && (!!textEditor || session && (!!chat || active === doc.body));
      if (!mobile || !session || Math.abs(viewport.scale - 1) > 0.01 || rect.height <= 0) {
        reset();
        return;
      }
      const top = Math.max(rect.top, viewport.offsetTop);
      const bottom = Math.min(rect.bottom, viewport.offsetTop + viewport.height);
      frame.dataset.mobileComposing = "true";
      frame.style.setProperty("--db-visible-top", `${Math.max(0, top - rect.top)}px`);
      frame.style.setProperty("--db-visible-height", `${Math.max(0, bottom - top)}px`);
    };
    const schedule = () => {
      if (animation === undefined) animation = view.requestAnimationFrame(update);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(frame);
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    view.addEventListener("resize", schedule);
    view.addEventListener("scroll", schedule);
    frame.addEventListener("focusin", schedule);
    doc.addEventListener("focusout", schedule);
    update();
    return () => {
      observer?.disconnect();
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      view.removeEventListener("resize", schedule);
      view.removeEventListener("scroll", schedule);
      frame.removeEventListener("focusin", schedule);
      doc.removeEventListener("focusout", schedule);
      if (animation !== undefined) view.cancelAnimationFrame(animation);
      reset();
    };
  }, [frameRef]);
}
