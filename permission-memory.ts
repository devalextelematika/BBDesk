import type { PluginComposerApi } from "@get-bb/plugin-sdk/app";

export type PermissionMode = NonNullable<NonNullable<PluginComposerApi["selection"]>["permissionMode"]>;
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
const isMode = (value: unknown): value is PermissionMode => value === "auto" || value === "full" || value === "accept-edits";
const key = (pluginId: string) => `bb-${pluginId}:last-permission-mode:v1`;

export function readPermissionMode(pluginId: string, storage?: Storage): PermissionMode | undefined {
  try {
    const value = (storage ?? window.localStorage).getItem(key(pluginId));
    return isMode(value) ? value : undefined;
  } catch { return undefined; }
}

export function rememberPermissionMode(pluginId: string, mode: unknown, storage?: Storage) {
  if (!isMode(mode)) return;
  // A browser that blocks preference storage must still be able to send.
  try { (storage ?? window.localStorage).setItem(key(pluginId), mode); } catch { /* Optional preference. */ }
}

export function rememberSubmittedPermission(composer: Pick<PluginComposerApi, "onSubmitted" | "selection">, pluginId: string, storage?: Storage) {
  // Read the live selection at acceptance, not the selection at subscription.
  // Opening a thread, editing a draft and failed sends never replace the default.
  return composer.onSubmitted(() => rememberPermissionMode(pluginId, composer.selection?.permissionMode, storage));
}
