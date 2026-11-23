import assert from "node:assert/strict";
import { act, dom, test, within, fireEvent, waitFor } from "../helpers/dom.mjs";
import { mount } from "../helpers/dashboard.mjs";

function provider(providerId, displayName, windows, fields = {}) {
  return { id: providerId, providerId, displayName, accountLabel: null, logoUrl: null, icon: null,
    usage: { status: "ok", windows, ...fields } };
}

test("the launcher dock shows localized quota summaries, details and saved visibility", async () => {
  const minutes = 60_000;
  const resetAt = value => new Date(Date.now() + value * minutes).toISOString();
  const limit = (label, usedPercent, resetsAt) => ({ label, usedPercent, resetsAt });
  const data = { machines: [
    { id: "host", displayName: "Local machine", status: "connected", error: null, providers: [
      provider("codex", "Codex", [limit("Weekly limit", 100, resetAt(1500)), limit("Five-hour limit", 80, resetAt(90))],
        { manualResetsAvailable: 0, accountEmail: "local@example.test" }),
      provider("claude-code", "Claude Code", [limit("Weekly · Sonnet", 95, resetAt(2900))]),
    ] },
    { id: "shared", displayName: "Shared machine", status: "connected", error: null, providers: [
      provider("codex", "Codex", [limit("Weekly limit", 12, resetAt(5))]),
    ] },
    { id: "offline", displayName: "Offline machine", status: "disconnected", error: null, providers: [
      provider("codex", "Codex", [limit("Weekly limit", 120, resetAt(5))]),
    ] },
  ] };
  const originalVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  const requests = [];
  const sdk = { plugins: { callRpc: args => {
    requests.push(args);
    return Promise.resolve(args.outputSchema.parse(data));
  } } };
  try {
    const slot = mount({ language: "en", sdk });
    const dock = within(slot.getByRole("region", { name: "Provider quotas" }));
    const compact = await dock.findByRole("button", { name: /Codex: 100% used.*Claude Code: 95% used/ });
    const badges = [...compact.querySelectorAll("[data-level]")];
    assert.deepEqual(badges.map(node => node.dataset.level), ["critical", "critical"]);
    assert.match(badges[0].title, /Weekly limit.*Local machine.*local@example\.test/);
    assert.equal(requests[0].pluginId, "bb--provider-usage");
    assert.equal(requests[0].input.force, false);
    fireEvent.click(compact);
    const all = dock.getByRole("button", { name: "All", pressed: true });
    assert.equal(document.activeElement, all);
    assert.equal(dock.getAllByRole("progressbar").length, 2);
    assert.equal(dock.getByRole("progressbar", { name: /Codex: 100% used.*local@example\.test/ }).value, 100);
    fireEvent.click(dock.getByRole("button", { name: "Claude Code" }));
    assert.ok(dock.getByText("Weekly limit · Sonnet"));
    fireEvent.click(dock.getByRole("button", { name: "Codex" }));
    assert.ok(dock.getByText("0 available"));
    assert.ok(dock.getByText(/^Resets in 1 day 1 hr/));
    await slot.setLanguage("ru");
    assert.equal(dock.getAllByText("Недельный лимит").length, 2);
    assert.ok(dock.getByText("Доступно: 0"));
    assert.ok(dock.getByText(/^До сброса 1 день 1 ч/));
    fireEvent.click(dock.getByRole("button", { name: "Claude Code" }));
    assert.ok(dock.getByText("Недельный лимит · Sonnet"));
    assert.equal(dock.queryByText("Ручные сбросы"), null);
    fireEvent.click(dock.getByRole("button", { name: "Все" }));
    assert.equal(dock.getAllByRole("progressbar").length, 2);
    slot.lifecycle.unmount();

    const reloaded = mount({ language: "ru", sdk });
    const reloadedDock = within(reloaded.getByRole("region", { name: "Квоты провайдеров" }));
    assert.ok(reloadedDock.getByRole("button", { name: "Все", pressed: true }));
    fireEvent.click(reloadedDock.getByRole("button", { name: "Свернуть квоты провайдеров" }));
    assert.ok(reloadedDock.getByRole("button", { name: /^Раскрыть квоты/ }));
    const settingsButton = reloaded.getByRole("button", { name: /Настроить проекты и приложения/ });
    await waitFor(() => assert.equal(settingsButton.disabled, false));
    fireEvent.click(settingsButton);
    fireEvent.click(reloaded.getByRole("tab", { name: "Дополнительно" }));
    fireEvent.click(reloaded.getByRole("checkbox", { name: "Показывать квоты провайдеров в панели приложений" }));
    assert.equal(document.querySelector(".db-quota"), null);
    assert.equal(dom.window.localStorage.getItem("bb-dashboard:provider-usage-visible:v1"), "false");
  } finally {
    if (originalVisibility) Object.defineProperty(document, "visibilityState", originalVisibility);
    else delete document.visibilityState;
  }
});

test("full and partial refresh errors mark retained quotas until a healthy response", async context => {
  context.mock.getter(Object.getPrototypeOf(document), "visibilityState", () => "visible");
  context.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 23, 12, 0) });
  const report = (usedPercent, claude) => ({ machines: [{
    id: "host", displayName: "Local machine", status: "connected", error: null,
    providers: [provider("codex", "Codex", [{ label: "Weekly limit", usedPercent, resetsAt: null }]), claude],
  }] });
  const claude = usedPercent => provider("claude-code", "Claude Code", [{ label: "Weekly limit", usedPercent, resetsAt: null }]);
  let next = report(9, claude(82));
  const sdk = { plugins: { callRpc: async ({ outputSchema }) => {
    if (!next) throw new Error("RPC unavailable");
    return outputSchema.parse(next);
  } } };
  const slot = mount({ language: "en", sdk });
  const dock = within(slot.getByRole("region", { name: "Provider quotas" }));
  const compact = () => dock.getByRole("button", { name: /^Expand provider quotas/ });
  const warning = () => compact().querySelector(".db-quota-warning");
  const update = () => act(async () => document.dispatchEvent(new window.Event("visibilitychange")));
  await dock.findByRole("button", { name: /Codex: 9% used.*Claude Code: 82% used/ });
  assert.equal(warning(), null);

  context.mock.timers.tick(60_000);
  next = null;
  await update();
  assert.match(warning().title, /Could not refresh quotas.*Last successful update/);
  assert.match(compact().textContent, /9%82%/);
  fireEvent.click(compact());
  const lastUpdate = dock.getByText(/^Last successful update:/).textContent;
  const initialTime = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })
    .format(Date.UTC(2026, 10, 23, 12, 0));
  assert.equal(lastUpdate, "Last successful update: " + initialTime);
  fireEvent.click(dock.getByRole("button", { name: "Collapse provider quotas" }));

  context.mock.timers.tick(60_000);
  next = report(47, provider("claude-code", "Claude Code", [], { status: "error" }));
  await update();
  assert.match(warning().title, /Some quotas could not be refreshed/);
  assert.ok(warning().title.includes(lastUpdate));
  assert.match(compact().textContent, /47%82%/);

  next = report(50, claude(21));
  await update();
  assert.equal(warning(), null);
  assert.match(compact().textContent, /50%21%/);
  assert.doesNotMatch(compact().getAttribute("aria-label"), /Last successful update/);
});

test("an unavailable usage RPC leaves the applications panel usable", async context => {
  context.mock.getter(Object.getPrototypeOf(document), "visibilityState", () => "visible");
  const sdk = { plugins: { callRpc: () => Promise.reject(new Error("RPC unavailable")) } };
  const slot = mount({ language: "en", sdk });
  const dock = within(slot.getByRole("region", { name: "Provider quotas" }));
  fireEvent.click(await dock.findByRole("button", { name: /Could not load provider quotas/ }));
  assert.ok(dock.getByText("Could not load provider quotas."));
  assert.equal(dock.queryByRole("progressbar"), null);
  assert.ok(slot.getByRole("complementary", { name: "Applications panel" }));
});
