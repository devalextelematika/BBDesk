import assert from "node:assert/strict";
import { act, dom, test, within, fireEvent, waitFor } from "../helpers/dom.mjs";
import { mount } from "../helpers/dashboard.mjs";

function provider(providerId, displayName, windows, fields = {}) {
  return { id: providerId, providerId, displayName, accountLabel: null, logoUrl: null, icon: null,
    usage: { status: "ok", windows, ...fields } };
}

test("the launcher dock shows localized quota summaries, details and saved visibility", async context => {
  const minutes = 60_000;
  context.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 23, 12, 0) });
  let tickCountdown;
  const setInterval = window.setInterval.bind(window);
  context.mock.method(window, "setInterval", (callback, delay, ...args) => {
    if (delay === minutes) tickCountdown = callback;
    return setInterval(callback, delay, ...args);
  });
  const resetAt = value => new Date(Date.now() + value * minutes).toISOString();
  const limit = (label, usedPercent, resetsAt) => ({ label, usedPercent, resetsAt });
  const data = { machines: [
    { id: "host", displayName: "Local machine", status: "connected", error: null, providers: [
      provider("codex", "Codex", [limit("Weekly limit", 100, resetAt(1500)), limit("Five-hour limit", 80, resetAt(90)), limit("Daily limit", 24, resetAt(60))],
        { manualResetsAvailable: 0, accountEmail: "local@example.test" }),
      provider("claude-code", "Claude Code", [limit("Weekly · Sonnet", 95, resetAt(2900))]),
    ] },
    { id: "shared", displayName: "Shared machine", status: "connected", error: null, providers: [
      { ...provider("codex", "Codex", [limit("Weekly limit", 12, resetAt(5))]), id: "source:codex-account" },
    ] },
    { id: "offline", displayName: "Offline machine", status: "disconnected", error: null, providers: [
      provider("codex", "Codex", [limit("Weekly limit", 120, resetAt(5))]),
      provider("cursor", "Cursor", []),
    ] },
  ] };
  const originalVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  const requests = [];
  const sdk = { plugins: { callRpc: args => {
    requests.push(args);
    return Promise.resolve(args.outputSchema.parse({ machines: data.machines.map(machine => ({
      ...machine,
      providers: machine.providers.map(provider => ({
        ...provider, usage: args.input.providerIds.includes(provider.providerId) ? provider.usage : null,
      })),
    })) }));
  } } };
  try {
    const slot = mount({ language: "en", sdk });
    const dock = within(slot.getByRole("region", { name: "Provider quotas" }));
    const compact = await dock.findByRole("button", { name: /Codex: 80% used.*Codex: 24% used.*Codex: 100% used.*Claude Code: 95% used/ });
    const segments = [...compact.querySelectorAll(".db-quota-segment")];
    assert.deepEqual(segments.map(node => node.dataset.level), ["warning", "critical", "critical"]);
    assert.deepEqual(segments.map(node => node.querySelector("progress").value), [80, 100, 95]);
    assert.equal(compact.textContent.trim(), "");
    assert.deepEqual([...compact.querySelectorAll(".db-quota-summary")].map(node => node.querySelectorAll("progress").length), [2, 1, 0]);
    assert.match(segments[1].title, /Weekly limit.*Local machine.*local@example\.test/);
    assert.equal(segments[2].parentElement.dataset.single, "true");
    assert.equal(requests[0].pluginId, "bb--provider-usage");
    assert.equal(requests[0].input.force, false);
    assert.deepEqual(requests.map(({ input }) => input.providerIds), [[], ["codex", "claude-code"]]);
    fireEvent.click(compact);
    const all = dock.getByRole("button", { name: "All", pressed: true });
    assert.equal(document.activeElement, all);
    const overview = document.querySelector(".db-quota-content");
    assert.doesNotMatch(overview.textContent, /Codex|Claude Code|%/);
    assert.deepEqual([...overview.querySelectorAll(".db-quota-segment-label")].map(node => node.textContent), ["5 hr", "Day", "7 d", "7 d"]);
    const countdowns = () => [...overview.querySelectorAll(".db-quota-countdown")].map(node => node.textContent);
    assert.deepEqual(countdowns(), ["1h 30m", "1h", "1d 1h", "2d"]);
    context.mock.timers.tick(minutes);
    await act(async () => tickCountdown());
    assert.deepEqual(countdowns(), ["1h 29m", "59m", "1d", "2d"]);
    assert.equal(requests.length, 2);
    context.mock.timers.setTime(Date.UTC(2026, 10, 23, 12, 0));
    await act(async () => tickCountdown());
    assert.equal(dock.getAllByRole("progressbar").length, 4);
    assert.equal(dock.getByRole("progressbar", { name: /Codex: 100% used.*local@example\.test/ }).value, 100);
    fireEvent.click(dock.getByRole("button", { name: "Claude Code" }));
    assert.ok(dock.getByText("Weekly limit · Sonnet"));
    assert.equal(dock.queryByText("Claude Code"), null);
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
    assert.equal(dock.getAllByRole("progressbar").length, 4);
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
  const values = () => [...compact().querySelectorAll("progress")].map(node => node.value);
  const warning = () => compact().querySelector(".db-quota-warning");
  const update = () => act(async () => document.dispatchEvent(new window.Event("visibilitychange")));
  await dock.findByRole("button", { name: /Codex: 9% used.*Claude Code: 82% used/ });
  assert.equal(warning(), null);

  context.mock.timers.tick(60_000);
  next = null;
  await update();
  assert.match(warning().title, /Could not refresh quotas.*Last successful update/);
  assert.deepEqual(values(), [9, 82]);
  fireEvent.click(compact());
  assert.deepEqual([...document.querySelectorAll(".db-quota-content .db-quota-countdown")].map(node => node.textContent), ["—", "—"]);
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
  assert.deepEqual(values(), [47, 82]);

  next = report(50, claude(21));
  await update();
  assert.equal(warning(), null);
  assert.deepEqual(values(), [50, 21]);
  assert.doesNotMatch(compact().getAttribute("aria-label"), /Last successful update/);
});

test("quota refresh and cache age follow the highest connected usage", async context => {
  const minute = 60_000;
  let visibility = "visible";
  context.mock.getter(Object.getPrototypeOf(document), "visibilityState", () => visibility);
  const timers = new Map();
  let timerId = -1;
  const originalSetTimeout = window.setTimeout.bind(window);
  const originalClearTimeout = window.clearTimeout.bind(window);
  context.mock.method(window, "setTimeout", (callback, delay, ...args) => {
    if (delay < minute) return originalSetTimeout(callback, delay, ...args);
    const id = timerId--;
    timers.set(id, { callback, delay });
    return id;
  });
  context.mock.method(window, "clearTimeout", id => {
    if (!timers.delete(id)) originalClearTimeout(id);
  });
  const changeVisibility = value => act(async () => {
    visibility = value;
    document.dispatchEvent(new window.Event("visibilitychange"));
  });
  let usedPercent = 79;
  const requests = [];
  const sdk = { plugins: { callRpc: async ({ input, outputSchema }) => {
    if (input.providerIds.length) requests.push(input.maxAgeMs);
    return outputSchema.parse({ machines: [
      { id: "host", displayName: "Local", status: "connected", error: null, providers: [
        provider("codex", "Codex", [{ label: "Weekly limit", usedPercent, resetsAt: null }]),
      ] },
      { id: "offline", displayName: "Offline", status: "disconnected", error: null, providers: [
        provider("codex", "Codex", [{ label: "Weekly limit", usedPercent: 100, resetsAt: null }]),
      ] },
    ] });
  } } };
  const slot = mount({ language: "en", sdk });
  await slot.findByRole("button", { name: /Codex: 79% used/ });
  const delays = () => Array.from(timers.values(), timer => timer.delay);
  assert.deepEqual(delays(), [5 * minute]);

  for (const [usage, nextMinutes] of [[80, 3], [90, 1], [45, 5]]) {
    const [[id, { callback, delay }]] = timers;
    timers.delete(id);
    usedPercent = usage;
    await act(async () => callback());
    assert.equal(requests.at(-1), delay);
    assert.deepEqual(delays(), [nextMinutes * minute]);
  }

  await changeVisibility("hidden");
  assert.deepEqual(delays(), []);
  assert.deepEqual(requests, [5, 5, 3, 1].map(value => value * minute));
  await changeVisibility("visible");
  assert.equal(requests.at(-1), 5 * minute);
  assert.equal(requests.length, 5);
  assert.deepEqual(delays(), [5 * minute]);
  slot.lifecycle.unmount();
  assert.deepEqual(delays(), []);
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
