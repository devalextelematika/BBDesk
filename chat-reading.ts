type ReadingPosition = { top: number; atBottom: boolean };
// Session-only and bounded; native BB continues to own the conversation and drafts.
const positions = new Map<string, ReadingPosition>();

export function preserveChatReading(root: HTMLElement, threadId: string) {
  const view = root.ownerDocument.defaultView!;
  const saved = positions.get(threadId);
  let restoring = !!saved && !saved.atBottom;
  let restored = false;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let target: HTMLElement | undefined;
  function findScroller() {
    return Array.from(root.querySelectorAll<HTMLElement>("*"))
      .filter(element => element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 1
        && /auto|scroll/.test(view.getComputedStyle(element).overflowY))
      .sort((a, b) => b.clientHeight - a.clientHeight)[0];
  }
  function remember() {
    if (!target || restoring) return;
    positions.delete(threadId);
    positions.set(threadId, { top: target.scrollTop, atBottom: target.scrollHeight - target.clientHeight - target.scrollTop < 64 });
    if (positions.size > 100) positions.delete(positions.keys().next().value!);
  }
  function restore() {
    target = findScroller();
    if (!restoring || !saved || !target || target.scrollHeight < saved.top + target.clientHeight) return;
    target.scrollTop = saved.top;
    restored = true;
    // Native asynchronous history loading can perform its own initial scroll.
    // Keep the reading position through that initial settling, then hand scrolling back.
    if (!settleTimer) settleTimer = setTimeout(() => { restoring = false; remember(); }, 1500);
  }
  function schedule() {
    if (restoring) restore();
  }
  function onScroll(event: Event) {
    const element = event.target;
    if (!(element instanceof view.HTMLElement)) return;
    if (!target || element.clientHeight > target.clientHeight) target = element;
    if (element !== target) return;
    if (restoring) schedule(); else remember();
  }
  function interact() {
    restoring = false;
    if (settleTimer) clearTimeout(settleTimer);
  }
  root.addEventListener("scroll", onScroll, true);
  for (const event of ["wheel", "pointerdown", "keydown"]) root.addEventListener(event, interact, { capture: true, passive: true });
  const observer = new view.MutationObserver(schedule);
  observer.observe(root, { childList: true, subtree: true });
  restore();
  return () => {
    target = findScroller() ?? target;
    if (!restoring || restored) { restoring = false; remember(); }
    if (settleTimer) clearTimeout(settleTimer);
    observer.disconnect();
    root.removeEventListener("scroll", onScroll, true);
    for (const event of ["wheel", "pointerdown", "keydown"]) root.removeEventListener(event, interact, true);
  };
}
