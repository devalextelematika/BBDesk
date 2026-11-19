import { useLayoutEffect, useRef } from "react";
import { ThreadChat } from "@get-bb/plugin-sdk/app";
import { RememberThreadPermission } from "../permission-composers";
import { ChatFileSurface } from "../chat-file-surface";
import { preserveChatReading } from "../chat-reading";

export function ExpandedChat({ threadId }: { threadId: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (viewport.current) return preserveChatReading(viewport.current, threadId);
  }, [threadId]);
  return <div className="db-chat-surface" ref={viewport}><div>
    <RememberThreadPermission threadId={threadId}/>
    <ChatFileSurface threadId={threadId}><ThreadChat threadId={threadId} variant="full" layout="contained" permissionPolicy="editable"/></ChatFileSurface>
  </div></div>;
}
