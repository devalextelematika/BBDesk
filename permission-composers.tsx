import { useEffect, useState } from "react";
import {
  useComposers,
  experimental_usePluginId as usePluginId,
  experimental_NewThreadComposer as NewThreadComposer,
  type NewThreadComposerProps,
} from "@get-bb/plugin-sdk/app";
import { readPermissionMode, rememberPermissionMode, rememberSubmittedPermission } from "./permission-memory";

export function RememberThreadPermission({ threadId }: { threadId: string }) {
  const pluginId = usePluginId();
  const composers = useComposers();
  useEffect(() => {
    const dispose = composers
      .filter(composer => composer.scope.kind === "thread" && composer.scope.threadId === threadId)
      .map(composer => rememberSubmittedPermission(composer, pluginId));
    return () => dispose.forEach(unsubscribe => unsubscribe());
  }, [composers, pluginId, threadId]);
  return null;
}

export function RememberingNewThreadComposer(props: NewThreadComposerProps) {
  const pluginId = usePluginId();
  // Seed once. Updating a default prop while typing would reset all host pickers.
  const [permissionMode] = useState(() => readPermissionMode(pluginId));
  return <NewThreadComposer {...props} defaultPermissionMode={permissionMode} onSubmit={async request => {
    await props.onSubmit(request);
    rememberPermissionMode(pluginId, request.permissionMode);
  }}/>;
}
