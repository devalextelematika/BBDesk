/** Follow loaded messages until the reader deliberately scrolls away from the end. */
export function followChatBottom(viewport: HTMLElement, content: HTMLElement): () => void {
  let following = true;
  let lastTop = viewport.scrollTop;
  const toBottom = () => {
    if (following) {
      viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      lastTop = viewport.scrollTop;
    }
  };
  const onScroll = () => {
    // Content growth can emit scroll events before ResizeObserver runs.
    // Only an upward movement means the reader has left the latest message.
    if (viewport.scrollTop < lastTop - 1) following = false;
    else if (viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 24) following = true;
    lastTop = viewport.scrollTop;
  };
  const onWheel = (event: WheelEvent) => { if (event.deltaY < 0) following = false; };
  viewport.addEventListener("scroll", onScroll, { passive: true });
  viewport.addEventListener("wheel", onWheel, { passive: true });
  const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(toBottom);
  resize?.observe(content);
  resize?.observe(viewport);
  toBottom();
  return () => {
    resize?.disconnect();
    viewport.removeEventListener("scroll", onScroll);
    viewport.removeEventListener("wheel", onWheel);
  };
}
