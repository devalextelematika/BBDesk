import { useEffect, useLayoutEffect, useRef } from "react";
import { ThreadChat } from "@get-bb/plugin-sdk/app";
import { RememberThreadPermission } from "../permission-composers";
import { ChatFileSurface } from "../chat-file-surface";
import { followChatBottom } from "../chat-scroll";
import { preserveChatReading } from "../chat-reading";

export function ExpandedChat({ threadId, fillSpace = false }: { threadId: string; fillSpace?: boolean }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (fillSpace && viewport.current) return preserveChatReading(viewport.current, threadId);
  }, [threadId, fillSpace]);
  useEffect(() => {
    if (fillSpace || !viewport.current || !content.current) return;
    viewport.current.scrollIntoView?.({ block: "nearest" });
    return followChatBottom(viewport.current, content.current);
  }, [threadId, fillSpace]);
  return <div className="db-chat-surface" ref={viewport}><div ref={content}>
    <RememberThreadPermission threadId={threadId}/>
    <ChatFileSurface threadId={threadId}><ThreadChat threadId={threadId} variant="full" layout={fillSpace ? "contained" : "document"} permissionPolicy="editable"/></ChatFileSurface>
  </div></div>;
}
