import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileThread, hideThread, isWorking, isSubagent, type Activity } from "./state.ts";
const row = (changes: Partial<Activity> = {}): Activity => ({ id: "t1", projectId: "p1", status: "idle", queuedWork: "none", hasPendingInteraction: false, latestAttentionAt: 20, ...changes });

test("initial connection excludes old completed and error results", () => {
  assert.equal(reconcileThread(undefined, row(), 100), undefined);
  assert.equal(reconcileThread(undefined, row({ status: "error" }), 100), undefined);
});
test("initial connection includes running, queue and user interaction", () => {
  for (const changes of [{ status: "active" }, { queuedWork: "waiting" }, { hasPendingInteraction: true }, { runtimeStatus: "waiting-for-host" }, { backgroundAgents: 1 }]) {
    assert.equal(reconcileThread(undefined, row(changes), 100)?.visible, true);
  }
});
test("running at connection is retained after completion and reading", () => {
  const running = reconcileThread(undefined, row({ status: "active" }), 100);
  const completed = reconcileThread(running, row({ latestAttentionAt: 150 }), 100);
  assert.equal(completed?.visible, true);
  assert.equal(reconcileThread(completed, row({ latestAttentionAt: 150 }), 100)?.visible, true);
});
test("a result produced while dashboard is closed is added, including when already read elsewhere", () => {
  assert.equal(reconcileThread(undefined, row({ latestAttentionAt: 150 }), 100)?.visible, true);
});
test("hide survives reread, rename, refresh and restart; a fresh result returns it", () => {
  const t = row({ latestAttentionAt: 150 });
  const initial = reconcileThread(undefined, t, 100)!;
  const hidden = hideThread(initial, t);
  assert.equal(reconcileThread(hidden, t, 100)?.visible, false);
  const restored = JSON.parse(JSON.stringify(hidden));
  assert.equal(reconcileThread(restored, t, 100)?.visible, false);
  assert.equal(reconcileThread(restored, row({ latestAttentionAt: 151 }), 100)?.visible, true);
});
test("new work or request returns a hidden thread even without a changed attention timestamp", () => {
  const t = row({ latestAttentionAt: 150 });
  const hidden = hideThread(reconcileThread(undefined, t, 100)!, t);
  for (const changes of [{ status: "active" }, { queuedWork: "waiting" }, { hasPendingInteraction: true }]) {
    assert.equal(reconcileThread(hidden, row({ ...t, ...changes }), 100)?.visible, true);
  }
});
test("hide rejects running/queued/interaction states including a race with resumed work", () => {
  const previous = reconcileThread(undefined, row({ latestAttentionAt: 150 }), 100)!;
  for (const changes of [{ status: "active" }, { queuedWork: "waiting" }, { hasPendingInteraction: true }]) {
    assert.throws(() => hideThread(previous, row(changes)));
  }
});
test("unknown idle status does not manufacture execution", () => {
  assert.equal(isWorking(row({ status: "future-state" })), false);
});

test("subagents disappear after completion, survive reload hidden and return on new work", () => {
  const child = row({ parentThreadId: "manager", status: "active" });
  const running = reconcileThread(undefined, child, 100);
  assert.equal(running?.visible, true);
  const completed = reconcileThread(running, { ...child, status: "idle", latestAttentionAt: 150 }, 100);
  assert.equal(completed?.visible, false);
  assert.equal(reconcileThread(JSON.parse(JSON.stringify(completed)), { ...child, status: "idle", latestAttentionAt: 151 }, 100)?.visible, false);
  assert.equal(reconcileThread(completed, child, 100)?.visible, true);
  assert.equal(reconcileThread(undefined, { ...child, status: "idle", latestAttentionAt: 150 }, 100), undefined);
});

test("subagent interactions, queue, errors and background work remain visible", () => {
  for (const changes of [{ hasPendingInteraction: true }, { queuedWork: "waiting" }, { queuedWork: "failed" }, { status: "error" }, { backgroundAgents: 1 }]) {
    const child = row({ parentThreadId: "manager", latestAttentionAt: 150, ...changes });
    assert.equal(reconcileThread(undefined, child, 100)?.visible, true);
  }
});

test("fork ancestry does not make an independent thread a subagent", () => {
  const fork = row({ parentThreadId: "source", originKind: "fork", latestAttentionAt: 150 });
  assert.equal(isSubagent(fork), false);
  assert.equal(reconcileThread(undefined, fork, 100)?.visible, true);
  assert.equal(isSubagent({ ...fork, lifecycleOwnerThreadId: "manager" }), true);
});
