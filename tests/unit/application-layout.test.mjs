import test from "node:test";
import assert from "node:assert/strict";
import { closeAppLayout, emptyAppSplit, openAppLayout, selectAppLayout } from "../../split-layout.ts";

test("opening applications updates the active accordion app", () => {
  let layout = openAppLayout(emptyAppSplit(), "github");
  layout = openAppLayout(layout, "logs");
  layout = openAppLayout(layout, "telegram");

  assert.deepEqual(layout.appIds, ["github", "logs", "telegram"]);
  assert.equal(layout.activeAppId, "telegram");
});

test("selecting an app changes only its active id", () => {
  const layout = openAppLayout(openAppLayout(emptyAppSplit(), "github"), "logs");
  assert.equal(selectAppLayout(layout, "github").activeAppId, "github");
  assert.equal(layout.activeAppId, "logs");
});

test("closing the active app selects the next app, or the previous app at the end", () => {
  let layout = openAppLayout(openAppLayout(openAppLayout(emptyAppSplit(), "github"), "logs"), "telegram");

  layout = selectAppLayout(layout, "logs");
  layout = closeAppLayout(layout, "logs");
  assert.deepEqual(layout.appIds, ["github", "telegram"]);
  assert.equal(layout.activeAppId, "telegram");

  layout = selectAppLayout(layout, "telegram");
  layout = closeAppLayout(layout, "telegram");
  assert.deepEqual(layout.appIds, ["github"]);
  assert.equal(layout.activeAppId, "github");

  layout = closeAppLayout(layout, "github");
  assert.equal(layout.appIds.length, 0);
  assert.equal(layout.activeAppId, "");
});
