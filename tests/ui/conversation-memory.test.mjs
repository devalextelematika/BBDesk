import '../../scripts/test-loader.mjs';
import { test, fireEvent, within, act } from '../helpers/dom.mjs';
import { project, secondProject, thread, mount } from '../helpers/dashboard.mjs';
import assert from 'node:assert/strict';

test("thread heading renders Russian status with environment only in the tooltip", async () => {
  const slot = mount({ connected: true, threads: [{
    id: "t1", projectId: "p1", displayTitle: "Проверка русского треда", status: "idle", runtimeStatus: "idle",
    queuedWork: "none", hasPendingInteraction: false, isUnread: false, isHidden: false, isArchived: false,
    latestAttentionAt: 150, activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    environment: { name: "Основное окружение" }, host: null,
  }] });
  await slot.findByTestId("bb-thread-chat");
  assert.ok(slot.getByText("Просмотрено"));
  const heading = slot.container.querySelector(".db-thread-open");
  assert.equal(within(heading).queryByText("Основное окружение"), null);
  assert.ok(heading.title.includes("Основное окружение"));
  assert.ok(slot.getByRole("button", { name: "Убрать «Проверка русского треда» с рабочего стола" }));
});

test("previous threads use BB update order, show compact titles and keep the selected chat when the panel closes", async () => {
  const previous = Array.from({ length: 12 }, (_, i) => thread(`old${i}`, "p1", `Прошлый ${i}`, { latestAttentionAt: 200 + i, updatedAt: 400 - i }));
  const slot = mount({ connected: true, threads: [thread("active", "p1", "Текущий"), ...previous], hiddenIds: previous.map(t => t.id) });
  const toggle = await slot.findByRole("button", { name: "Показать последние 10 тредов" });
  assert.equal(toggle.querySelector("path").getAttribute("d"), "m6 15 6-6 6 6");
  assert.equal(slot.queryByText("Прошлый 11"), null);
  fireEvent.click(toggle);
  const history = slot.getByRole("region", { name: "Прошлые треды" });
  assert.equal(toggle.querySelector("path").getAttribute("d"), "m6 9 6 6 6-6");
  assert.equal(history.querySelectorAll(".db-history-thread .db-state, .db-history-thread svg").length, 0);
  assert.ok(history.querySelector(".db-conversation-meta time"));
  assert.deepEqual([...history.querySelectorAll(".db-thread-title")].map(el => el.textContent), previous.slice(2).reverse().map(t => t.displayTitle));
  fireEvent.click(within(history).getByRole("button", { name: "Прошлый 11", exact: true }));
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "old11");
  assert.equal(slot.container.querySelectorAll(".db-thread-indicator").length, 1);
  assert.equal(slot.container.querySelector(".db-project").getAttribute("data-single-chat"), "false");
  fireEvent.click(within(history).getByRole("button", { name: "Прошлый 10", exact: true }));
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "old10");
  const selectedChat = slot.getByTestId("bb-thread-chat");
  fireEvent.click(within(history).getByRole("button", { name: "Прошлый 10", exact: true }));
  assert.equal(slot.getByTestId("bb-thread-chat"), selectedChat);
  fireEvent.click(slot.getByRole("button", { name: "Скрыть прошлые треды" }));
  assert.equal(slot.queryByRole("region", { name: "Прошлые треды" }), null);
  assert.equal(slot.getByTestId("bb-thread-chat"), selectedChat);
  fireEvent.click(slot.getByRole("button", { name: "Показать последние 10 тредов" }));
  assert.equal(slot.getByTestId("bb-thread-chat"), selectedChat);
  assert.equal(slot.container.querySelectorAll(".db-thread-indicator").length, 1);
});

test("history excludes other projects, archived, hidden BB threads and subagents", async () => {
  const previous = [
    thread("previous", "p1", "Доступный прошлый"),
    thread("archived", "p1", "Архивный", { isArchived: true }),
    thread("hidden", "p1", "Скрытый BB", { isHidden: true }),
    thread("worker", "p1", "Субагент", { parentThreadId: "previous" }),
    thread("other", "p2", "Другой проект"),
  ];
  const slot = mount({ connected: true, threads: previous, hiddenIds: previous.map(t => t.id) });
  fireEvent.click(await slot.findByRole("button", { name: "Показать последние 10 тредов" }));
  const history = slot.getByRole("region", { name: "Прошлые треды" });
  assert.deepEqual([...history.querySelectorAll(".db-thread-title")].map(el => el.textContent), ["Доступный прошлый"]);
});

test("empty history has a localized empty state", async () => {
  const slot = mount({ connected: true, language: "en" });
  fireEvent.click(await slot.findByRole("button", { name: "Show last 10 threads" }));
  assert.ok(slot.getByText("No previous threads in this project."));
  await slot.setLanguage("ru");
  assert.ok(slot.getByText("В этом проекте пока нет прошлых тредов."));
});

test("subagents have indicators without rows and completion returns the open chat to the manager", async () => {
  const threads = [
    thread("manager", "p1", "Менеджер", { status: "active" }),
    thread("worker", "p1", "Research", { parentThreadId: "manager", status: "active" }),
  ];
  const slot = mount({ connected: true, threads });
  assert.equal((await slot.findByTestId("bb-thread-chat")).dataset.threadId, "manager");
  const tab = slot.getByRole("tab", { name: /^Тестовый проект,/ });
  const strip = slot.getByRole("group", { name: /^Треды всех проектов/ });
  assert.equal(tab.querySelectorAll(".db-dot").length, 2);
  assert.equal(slot.container.querySelectorAll(".db-thread-line").length, 1);
  assert.equal(slot.queryByRole("button", { name: /^Research/ }), null);
  fireEvent.click(within(strip).getByRole("button", { name: "Тестовый проект · Research: Субагент работает" }));
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "worker");
  assert.equal(slot.container.querySelectorAll(".db-thread-line").length, 1);
  threads[1] = { ...threads[1], status: "idle", isUnread: true, latestAttentionAt: 200 };
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "manager");
  assert.equal(tab.querySelectorAll(".db-dot").length, 1);
  assert.equal(strip.querySelectorAll(".db-dot").length, 1);
  assert.equal(slot.queryByText("Research"), null);
  assert.equal(slot.inspection.sdkCalls.filter(call => /archive|delete|stop|send/.test(call.method)).length, 0);
  threads[1] = { ...threads[1], status: "active" };
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(tab.querySelectorAll(".db-dot").length, 2);
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "manager");
});

test("finished subagents stay absent on mount while independent forks retain their rows", async () => {
  const slot = mount({ connected: true, threads: [
    thread("worker", "p1", "Завершённый Research", { parentThreadId: "manager", isUnread: true }),
    thread("fork", "p1", "Самостоятельная ветка", { parentThreadId: "manager", originKind: "fork", isUnread: true }),
  ] });
  assert.equal((await slot.findByTestId("bb-thread-chat")).dataset.threadId, "fork");
  assert.equal(slot.container.querySelectorAll(".db-thread-line").length, 1);
  assert.equal(slot.getByRole("tab", { name: /^Тестовый проект,/ }).querySelectorAll(".db-dot").length, 1);
  assert.equal(slot.queryByText("Завершённый Research"), null);
});

test("a project with only a subagent shows its indicator without auto-opening its chat", async () => {
  const threads = [thread("worker", "p1", "Research", { parentThreadId: "manager", status: "active" })];
  const slot = mount({ connected: true, threads });
  await slot.findByRole("tab", { name: /^Тестовый проект,/ });
  assert.equal(slot.container.querySelectorAll(".db-thread-line").length, 0);
  assert.equal(slot.queryByTestId("bb-thread-chat"), null);
  assert.equal(slot.getByRole("tab", { name: /^Тестовый проект,/ }).querySelectorAll(".db-dot").length, 1);
  fireEvent.click(slot.getByRole("button", { name: "Тестовый проект · Research: Субагент работает" }));
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "worker");
  threads[0] = { ...threads[0], status: "idle" };
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(slot.queryByTestId("bb-thread-chat"), null);
  assert.equal(slot.getByRole("tab", { name: /^Тестовый проект,/ }).querySelectorAll(".db-dot").length, 0);
});

test("project tabs show only the selected project's threads", async () => {
  const slot = mount({ connected: true, projects: [project, secondProject], threads: [thread("t1", "p1", "Задача первого проекта"), thread("t2", "p2", "Задача второго проекта")] });
  await slot.findByRole("tab", { name: /^Тестовый проект,/ });
  assert.equal(slot.getAllByRole("tabpanel").length, 1);
  assert.ok(slot.getAllByText("Задача первого проекта"));
  assert.equal(slot.queryByText("Задача второго проекта"), null);
  fireEvent.click(slot.getByRole("tab", { name: /^Второй проект,/ }));
  assert.ok(slot.getAllByText("Задача второго проекта"));
  assert.equal(slot.queryByText("Задача первого проекта"), null);
  assert.equal(slot.getByRole("tab", { name: /^Второй проект,/ }).getAttribute("aria-selected"), "true");
});

test("header strip represents every thread once without visible labels or project grouping", async () => {
  const slot = mount({ connected: true, projects: [project, secondProject], threads: [
    thread("t1", "p1", "Первая работа", { status: "active" }),
    thread("t2", "p1", "Вторая работа", { status: "active", queuedWork: "waiting" }),
    thread("t3", "p1", "Нужен ответ", { status: "active", hasPendingInteraction: true }),
    thread("t4", "p1", "Готовый результат"),
    thread("t5", "p1", "Закрытый результат", { isArchived: true }),
  ] });
  const first = await slot.findByRole("tab", { name: /^Тестовый проект,/ });
  assert.equal(first.textContent, project.name);
  assert.equal(first.querySelectorAll(".db-dot").length, 4);
  assert.equal(first.querySelectorAll(".db-dot.running").length, 2);
  assert.equal(first.querySelectorAll(".db-dot.attention").length, 1);
  assert.equal(first.querySelectorAll(".db-dot.read").length, 1);
  assert.equal(first.querySelector(".db-dot.read").title, "Готовый результат: Просмотрено");
  const strip = within(slot.getByRole("banner")).getByRole("group", { name: /^Треды всех проектов/ });
  assert.equal(strip.textContent, "");
  assert.equal(strip.querySelectorAll(".db-dot").length, 4);
  assert.equal(strip.querySelectorAll(".db-dot.running").length, 2);
  assert.equal(strip.querySelectorAll(".db-dot.attention").length, 1);
  assert.equal(strip.querySelectorAll(".db-dot.read").length, 1);
  assert.equal(strip.querySelector(".db-dot.read").closest("button").title, "Тестовый проект · Готовый результат: Просмотрено");
  assert.ok(first.getAttribute("aria-label").includes("Готовый результат: Просмотрено"));
  const empty = slot.getByRole("tab", { name: /^Второй проект,/ });
  assert.equal(empty.querySelectorAll(".db-dot").length, 0);
  assert.equal(empty.textContent, secondProject.name);
  assert.ok(empty.title.includes("Нет активности"));
  assert.equal(strip.querySelectorAll(".db-dot").length, 4);
  assert.equal(first.querySelectorAll(".db-dot").length, 4);
});

test("header indicators separate work, results and blocking decisions", async () => {
  const threads = [
    thread("work", "p1", "Работа", { status: "active" }),
    thread("queued", "p1", "Очередь", { queuedWork: "waiting" }),
    thread("result", "p1", "Новый результат", { isUnread: true }),
    thread("decision", "p1", "Разрешение", { status: "active", hasPendingInteraction: true }),
    thread("error", "p1", "Ошибка", { status: "error" }),
    thread("unknown", "p1", "Неизвестный статус", { status: "future-state" }),
    thread("read", "p1", "Просмотренный результат"),
  ];
  const slot = mount({ connected: true, threads });
  await slot.findByRole("tab", { name: /^Тестовый проект, в работе: 1, требуют внимания: 1, в очереди: 1, результаты: 2/ });
  const tab = slot.getByRole("group", { name: /^Треды всех проектов/ });
  const projectTab = slot.getByRole("tab", { name: /^Тестовый проект,/ });
  assert.equal(tab.querySelectorAll(".db-dot").length, 7);
  assert.equal(projectTab.querySelectorAll(".db-dot").length, 7);
  for (const tone of ["running", "waiting", "result", "attention", "error", "unknown", "read"]) {
    assert.equal(tab.querySelectorAll(`.db-dot.${tone}`).length, 1);
    assert.equal(projectTab.querySelectorAll(`.db-dot.${tone}`).length, 1);
  }
  assert.equal(tab.querySelectorAll(".db-working-ring").length, 2);
  assert.ok(tab.querySelector(".db-dot.running svg"));
  assert.ok(tab.querySelector(".db-dot.waiting svg"));
  assert.equal(tab.querySelector(".db-dot.result svg"), null);
  assert.equal(tab.querySelector(".db-dot.attention svg"), null);
  assert.equal(tab.querySelector(".db-dot.result").closest("button").title, "Тестовый проект · Новый результат: Новый ответ");
  assert.equal(tab.querySelector(".db-dot.attention").closest("button").title, "Тестовый проект · Разрешение: Нужно действие");
  threads[3] = { ...threads[3], hasPendingInteraction: false };
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(tab.querySelectorAll(".db-dot.attention").length, 0);
  assert.equal(tab.querySelectorAll(".db-dot.running").length, 2);
  assert.equal(projectTab.querySelectorAll(".db-dot.attention").length, 0);
  assert.equal(projectTab.querySelectorAll(".db-dot.running").length, 2);
  threads[0] = { ...threads[0], status: "idle", isUnread: true };
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(tab.querySelectorAll(".db-dot.result").length, 2);
  assert.equal(tab.querySelectorAll(".db-working-ring").length, 2);
  threads[0] = { ...threads[0], isUnread: false };
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(tab.querySelectorAll(".db-dot.read").length, 1);
  assert.equal(projectTab.querySelectorAll(".db-dot.read").length, 1);
  assert.equal(tab.querySelectorAll(".db-dot.result").length, 2);
  assert.equal(projectTab.querySelectorAll(".db-dot.result").length, 2);
});

test("header opens a specific thread across projects and keeps stable indicator order", async () => {
  const threads = [thread("t3", "p2", "Выбранный тред"), thread("t1", "p1", "Первый тред"), thread("t2", "p2", "Другой тред")];
  const slot = mount({ connected: true, projects: [project, secondProject], threads });
  await slot.findByRole("tab", { name: /^Тестовый проект,/ });
  const strip = slot.getByRole("group", { name: /^Треды всех проектов/ });
  const ids = () => [...strip.querySelectorAll("button")].map(button => button.dataset.threadId);
  assert.deepEqual(ids(), ["t1", "t2", "t3"]);
  const indicator = within(strip).getByRole("button", { name: "Второй проект · Выбранный тред: Просмотрено" });
  fireEvent.click(indicator);
  assert.equal(slot.getByRole("tab", { name: /^Второй проект,/ }).getAttribute("aria-selected"), "true");
  const chat = slot.getByTestId("bb-thread-chat");
  assert.equal(chat.getAttribute("data-thread-id"), "t3");
  assert.equal(indicator.getAttribute("aria-pressed"), "true");
  threads[0] = { ...threads[0], status: "active" };
  threads.reverse();
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.deepEqual(ids(), ["t1", "t2", "t3"]);
  assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  assert.equal(indicator.getAttribute("aria-pressed"), "true");
});

test("project tabs show one quiet provider icon for each distinct provider among open threads", async () => {
  const slot = mount({
    connected: true, language: "en", projects: [project, secondProject], hiddenIds: ["z"],
    providers: { status: "ready", providers: [
      { id: "claude", displayName: "Claude", logoUrl: "/logos/claude.svg", icon: { glyph: "Sparkle" }, strings: { iconTint: { light: "#111111", dark: "#eeeeee" } } },
      { id: "codex", displayName: "Codex", logoUrl: null },
      { id: "worker", displayName: "Worker", logoUrl: null },
    ] },
    threads: [
      thread("b", "p1", "Beta", { providerId: "claude" }),
      thread("a", "p1", "Alpha", { providerId: "codex" }),
      thread("c", "p1", "Gamma", { providerId: "claude" }),
      thread("sub", "p1", "Helper", { providerId: "worker", parentThreadId: "a", status: "active" }),
      thread("done", "p1", "Finished helper", { providerId: "retired", parentThreadId: "a" }),
      thread("z", "p1", "Hidden", { providerId: "ghost" }),
      thread("other", "p2", "Elsewhere", { providerId: "codex" }),
    ],
  });
  const tab = await slot.findByRole("tab", { name: /^Тестовый проект,/ });
  const icons = [...tab.querySelectorAll(".db-project-provider")];
  assert.deepEqual(icons.map(icon => icon.getAttribute("data-provider-id")), ["codex", "claude", "worker"]);
  assert.equal(icons[0].parentElement.getAttribute("title"), "Codex: Alpha");
  assert.equal(icons[1].parentElement.getAttribute("title"), "Claude: Beta, Gamma");
  assert.equal(icons[1].getAttribute("data-provider-logo"), "/logos/claude.svg");
  assert.equal(icons[1].getAttribute("data-provider-glyph"), "Sparkle");
  assert.equal(icons[1].getAttribute("data-provider-kind"), "agent");
  assert.equal(icons[0].getAttribute("aria-hidden"), "true");
  assert.equal(tab.querySelectorAll(".db-dot").length, 4);
  const name = tab.querySelector(".db-project-tab-name");
  assert.equal(name.textContent, "Тестовый проект");
  assert.ok(icons[0].compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(name.compareDocumentPosition(tab.querySelector(".db-project-tab-states")) & Node.DOCUMENT_POSITION_FOLLOWING);
  assert.match(tab.getAttribute("aria-label"), /Alpha: Read \(Codex\).*Beta: Read \(Claude\).*Gamma: Read \(Claude\).*Helper: Subagent working \(Worker\)/);
  assert.doesNotMatch(tab.getAttribute("aria-label"), /Finished helper|Hidden|Elsewhere/);
  const second = slot.getByRole("tab", { name: /^Второй проект,/ });
  assert.deepEqual([...second.querySelectorAll(".db-project-provider")].map(icon => icon.getAttribute("data-provider-id")), ["codex"]);
});

test("tabs expose live project status and support arrows, Home and End", async () => {
  const slot = mount({ connected: true, projects: [project, secondProject], threads: [thread("t1", "p1", "Работа", { status: "active" }), thread("t2", "p2", "Вопрос", { hasPendingInteraction: true })] });
  const first = await slot.findByRole("tab", { name: /^Тестовый проект, в работе: 1/ });
  const second = slot.getByRole("tab", { name: /^Второй проект, в работе: 0, требуют внимания: 1/ });
  fireEvent.keyDown(first, { key: "ArrowRight" });
  assert.equal(second.getAttribute("aria-selected"), "true");
  assert.equal(document.activeElement, second);
  fireEvent.keyDown(second, { key: "Home" });
  assert.equal(first.getAttribute("aria-selected"), "true");
  fireEvent.keyDown(first, { key: "End" });
  assert.equal(second.getAttribute("aria-selected"), "true");
});

test("project conversation memory survives navigation and remounts and falls back when a conversation disappears", async () => {
  const threads = [thread("a", "p1", "Running", { status: "active" }), thread("b", "p1", "Reading"), thread("c", "p2", "Other")];
  let slot = mount({ connected: true, projects: [project, secondProject], threads });
  await slot.findByTestId("bb-thread-chat");
  fireEvent.click(slot.getByRole("tab", { name: "Reading: Просмотрено" }));
  fireEvent.click(slot.getByRole("tab", { name: /^Второй проект,/ }));
  fireEvent.click(slot.getByRole("tab", { name: /^Тестовый проект,/ }));
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "b");
  slot.lifecycle.unmount();
  slot = mount({ connected: true, projects: [project, secondProject], threads });
  assert.equal((await slot.findByTestId("bb-thread-chat")).dataset.threadId, "b");
  slot.lifecycle.unmount();
  slot = mount({ connected: true, projects: [project, secondProject], threads: threads.filter(t => t.id !== "b") });
  assert.equal((await slot.findByTestId("bb-thread-chat")).dataset.threadId, "a");
});

test("history selection survives remount without importing the historical thread into working tabs", async () => {
  const threads = [thread("a", "p1", "Running", { status: "active" }), thread("old", "p1", "Previous", { latestAttentionAt: 10 })];
  let slot = mount({ connected: true, threads, hiddenIds: ["old"] });
  await slot.findByTestId("bb-thread-chat");
  fireEvent.click(slot.getByRole("button", { name: "Показать последние 10 тредов" }));
  fireEvent.click(within(slot.getByRole("region", { name: "Прошлые треды" })).getByRole("button", { name: "Previous" }));
  slot.lifecycle.unmount();
  slot = mount({ connected: true, threads, hiddenIds: ["old"] });
  assert.equal((await slot.findByTestId("bb-thread-chat")).dataset.threadId, "old");
  assert.equal(within(slot.getByRole("tablist", { name: "Треды проекта" })).queryByRole("tab", { name: /^Previous/ }), null);
});

test("green thread opens on project entry, respects manual collapse and reopens on return", async () => {
  const slot = mount({ connected: true, projects: [project, secondProject], threads: [
    thread("t1", "p1", "Первый тред", { isUnread: true }), thread("t2", "p2", "Второй тред", { status: "active" }),
  ] });
  assert.equal((await slot.findByTestId("bb-thread-chat")).dataset.threadId, "t1");
  fireEvent.click(slot.getByRole("button", { name: /^Первый тред/, expanded: true }));
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(slot.queryByTestId("bb-thread-chat"), null);
  fireEvent.click(slot.getByRole("tab", { name: /^Второй проект,/ }));
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "t2");
  fireEvent.click(slot.getByRole("tab", { name: /^Тестовый проект,/ }));
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "t1");
});

test("first project entry prioritizes attention and later returns preserve the conversation despite status changes", async () => {
  const threads = [
    thread("green", "p1", "Зелёный", { status: "active", latestAttentionAt: 900 }),
    thread("yellow-old", "p1", "Первый по времени", { hasPendingInteraction: true, latestAttentionAt: 200 }),
    thread("yellow-new", "p1", "Первый в списке", { hasPendingInteraction: true, latestAttentionAt: 300 }),
    thread("error", "p1", "Ошибка", { status: "error", latestAttentionAt: 1000 }),
    thread("read", "p1", "Прочитан"),
    thread("result", "p1", "Готовый результат", { isUnread: true, latestAttentionAt: 100 }),
  ];
  const slot = mount({ connected: true, projects: [project, secondProject], threads });
  assert.equal((await slot.findByTestId("bb-thread-chat")).dataset.threadId, "yellow-new");
  fireEvent.click(slot.getByRole("button", { name: /^Первый в списке/, expanded: true }));
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(slot.queryByTestId("bb-thread-chat"), null);
  fireEvent.click(slot.getByRole("tab", { name: /^Тестовый проект,/ }));
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "yellow-new");
  threads[1] = { ...threads[1], hasPendingInteraction: false };
  threads[2] = { ...threads[2], hasPendingInteraction: false };
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "yellow-new");
  fireEvent.click(slot.getByRole("tab", { name: /^Второй проект,/ }));
  fireEvent.click(slot.getByRole("tab", { name: /^Тестовый проект,/ }));
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "yellow-new");
  threads[5] = { ...threads[5], isUnread: false };
  await slot.behavior.emitRealtime("dashboard-changed", {});
  fireEvent.click(slot.getByRole("tab", { name: /^Тестовый проект,/ }));
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "yellow-new");
  for (const changes of [{ status: "pending" }, { status: "idle", isUnread: true }, { status: "idle", isUnread: false }]) {
    threads[0] = { ...threads[0], ...changes };
    await slot.behavior.emitRealtime("dashboard-changed", {});
    fireEvent.click(slot.getByRole("tab", { name: /^Тестовый проект,/ }));
    assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "yellow-new");
  }
});

test("project entry falls back to the latest read result and preserves manual collapse until return", async () => {
  const threads = [
    thread("old", "p1", "Старый результат", { latestAttentionAt: 200, updatedAt: 1000 }),
    thread("latest", "p1", "Последний результат", { latestAttentionAt: 400, updatedAt: 500 }),
    thread("other", "p2", "Другой проект", { latestAttentionAt: 900 }),
    thread("hidden", "p1", "Скрытый", { latestAttentionAt: 1100, isHidden: true }),
    thread("archived", "p1", "Архивный", { latestAttentionAt: 1200, isArchived: true }),
    thread("child", "p1", "Завершённый агент", { latestAttentionAt: 1300, parentThreadId: "latest" }),
  ];
  const slot = mount({ connected: true, projects: [project, secondProject], threads });
  assert.equal((await slot.findByTestId("bb-thread-chat")).dataset.threadId, "latest");
  fireEvent.click(slot.getByRole("button", { name: /^Последний результат/, expanded: true }));
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(slot.queryByTestId("bb-thread-chat"), null);
  fireEvent.click(slot.getByRole("tab", { name: /^Второй проект,/ }));
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "other");
  fireEvent.click(slot.getByRole("tab", { name: /^Тестовый проект,/ }));
  assert.equal(slot.getByTestId("bb-thread-chat").dataset.threadId, "latest");
});

test("chat fills the workspace with one or multiple threads", async () => {
  const threads = [thread("t1", "p1", "Работа", { status: "active" })];
  const slot = mount({ connected: true, threads });
  const chat = await slot.findByTestId("bb-thread-chat");
  assert.equal(chat.dataset.layout, "contained");
  threads.push(thread("t2", "p1", "Другой тред"));
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  assert.equal(chat.dataset.layout, "contained");
  assert.ok(slot.getByText("Другой тред"));
  assert.equal(chat.dataset.layout, "contained");
  threads.pop();
  await slot.behavior.emitRealtime("dashboard-changed", {});
  assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  assert.equal(chat.dataset.layout, "contained");
});

test("a single gray or red thread opens as the last worked thread on project entry", async () => {
  for (const changes of [{}, { status: "error" }]) {
    const slot = mount({ connected: true, threads: [thread("t1", "p1", "Тред", changes)] });
    assert.equal((await slot.findByTestId("bb-thread-chat")).dataset.threadId, "t1");
    slot.lifecycle.unmount();
  }
});

test("accepted prompts and work transitions keep the same chat mounted until manually closed", async () => {
  const subscriptions = new Set();
  const threads = [thread("t1", "p1", "Открытый тред"), thread("t2", "p1", "Другой тред")];
  const slot = mount({ connected: true, threads, sdk: {
    subscribe: subscription => { subscriptions.add(subscription); return () => subscriptions.delete(subscription); },
  } });
  const chat = await slot.findByTestId("bb-thread-chat");
  assert.equal(chat.dataset.threadId, "t1");
  await act(async () => {
    for (const subscription of subscriptions) subscription.callback({ metadata: { eventTypes: ["turn/input/accepted"] } });
  });
  assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  for (const changes of [
    { status: "starting" }, { status: "active", queuedWork: "waiting" },
    { hasPendingInteraction: true }, { hasPendingInteraction: false, queuedWork: "none" }, { status: "idle" },
  ]) {
    threads[0] = { ...threads[0], ...changes };
    await slot.behavior.emitRealtime("dashboard-changed", {});
    assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  }
  assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  fireEvent.click(slot.getByRole("button", { name: /^Открытый тред/, expanded: true }));
  assert.equal(slot.queryByTestId("bb-thread-chat"), null);
});
