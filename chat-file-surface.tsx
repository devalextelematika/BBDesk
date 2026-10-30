import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useBbNavigate, useSdk } from "@get-bb/plugin-sdk/app";
import { parseChatFileLink, resolveChatFilePath } from "./chat-file-links";
import { useTranslation } from "./use-translation";

export function ChatFileSurface({ threadId, children }: { threadId: string; children: ReactNode }) {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const { t: tr } = useTranslation();
  const [failed, setFailed] = useState(false);
  const active = useRef<object | null>(null);
  useEffect(() => {
    active.current = {};
    setFailed(false);
    return () => { active.current = null; };
  }, [threadId]);
  function open(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button > 1 || !(event.target instanceof Element)) return;
    const anchor = event.target.closest("a[href]");
    if (!anchor || !event.currentTarget.contains(anchor)) return;
    const link = parseChatFileLink(anchor.getAttribute("href") ?? "");
    if (!link) return;
    // Stop the native Markdown anchor before it launches an HTTP URL or file://.
    event.preventDefault();
    event.stopPropagation();
    const activation = active.current;
    setFailed(false);
    void (async () => {
      try {
        const thread = await sdk.threads.get({ threadId });
        if (!thread.environmentId) throw new Error("Thread has no environment");
        const environment = await sdk.environments.get({ environmentId: thread.environmentId });
        const path = resolveChatFilePath(link.path, environment.path ?? "");
        if (active.current !== activation || !activation) return;
        if (!path || !navigate.experimental_openFilePreview({
          target: { kind: "host", hostId: environment.hostId, path }, location: link.location,
        })) setFailed(true);
      } catch { if (active.current === activation && activation) setFailed(true); }
    })();
  }
  return <div style={{ display: "contents" }} onClickCapture={open} onAuxClickCapture={open}>
    {failed && <p className="db-error" role="alert">{tr("fileOpenFailed")}</p>}
    {children}
  </div>;
}
