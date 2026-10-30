import { test } from "node:test";
import assert from "node:assert/strict";
import { readPermissionMode, rememberPermissionMode, rememberSubmittedPermission } from "./permission-memory.ts";

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

test("the latest accepted permission survives remounts and is isolated by plugin", () => {
  const store = storage();
  assert.equal(readPermissionMode("dashboard", store), undefined);
  rememberPermissionMode("dashboard", "full", store);
  assert.equal(readPermissionMode("dashboard", store), "full");
  rememberPermissionMode("dashboard", "accept-edits", store);
  assert.equal(readPermissionMode("dashboard", store), "accept-edits");
  assert.equal(readPermissionMode("another-plugin", store), undefined);
  rememberPermissionMode("dashboard", "invalid", store);
  assert.equal(readPermissionMode("dashboard", store), "accept-edits");
});

test("only successful submissions remember the live selection; unmount unsubscribes", () => {
  const store = storage();
  const listeners = new Set<() => void>();
  const composer = {
    selection: { permissionMode: "auto" as "auto" | "full" },
    onSubmitted(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const dispose = rememberSubmittedPermission(composer, "dashboard", store);
  composer.selection = { permissionMode: "full" };
  assert.equal(readPermissionMode("dashboard", store), undefined);
  listeners.forEach(listener => listener());
  assert.equal(readPermissionMode("dashboard", store), "full");
  dispose();
  composer.selection = { permissionMode: "auto" };
  listeners.forEach(listener => listener());
  assert.equal(readPermissionMode("dashboard", store), "full");
});

test("invalid stored modes and blocked storage do not prevent using the composer", () => {
  assert.equal(readPermissionMode("dashboard", { ...storage(), getItem: () => "invalid" }), undefined);
  const blocked = { getItem(): never { throw Error("blocked"); }, setItem(): never { throw Error("blocked"); } };
  assert.equal(readPermissionMode("dashboard", blocked), undefined);
  assert.doesNotThrow(() => rememberPermissionMode("dashboard", "auto", blocked));
});
