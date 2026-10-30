import { useEffect, useRef } from "react";

export function ThreadIndicator({ tone, title, subagent = false }: { tone: string; title?: string; subagent?: boolean }) {
  const element = useRef<HTMLSpanElement>(null);
  const working = tone === "running" || tone === "waiting";
  useEffect(() => {
    const node = element.current;
    if (!working || !node) return;
    let visible = typeof IntersectionObserver === "undefined";
    const update = () => node.style.setProperty("--db-animation-play", visible && !document.hidden ? "running" : "paused");
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      update();
    });
    observer?.observe(node);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, [working]);
  return <span ref={element} className={`db-dot ${tone}${working ? " db-working" : ""}`} title={title} aria-hidden="true">
    {working && (subagent ? <svg className="db-subagent-working" width="12" height="12" viewBox="0 0 24 24" focusable="false">
      <g transform="translate(-2 2)"><g className="db-working-ring">
        <circle cx="12" cy="12" r="6.5" pathLength="100" strokeDasharray="16 9" transform="rotate(16.2 12 12)"/>
      </g></g>
      <circle cx="20" cy="4" r="3" fill="currentColor" stroke="none"/>
    </svg> : <svg className="db-working-ring" width="12" height="12" viewBox="0 0 24 24" focusable="false">
      <circle cx="12" cy="12" r="8" pathLength="100" strokeDasharray="16 9" transform="rotate(16.2 12 12)"/>
    </svg>)}
  </span>;
}
