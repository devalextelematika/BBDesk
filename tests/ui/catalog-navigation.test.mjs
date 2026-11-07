import '../../scripts/test-loader.mjs';
import { test, app, renderSlot, fireEvent, cleanup, within, act, waitFor, createElement } from '../helpers/dom.mjs';
import { project, item, secondProject, thread, mount, showCatalog } from '../helpers/dashboard.mjs';
import { dragFire } from '../helpers/interactions.mjs';
import assert from 'node:assert/strict';
const { changeCatalog: applyCatalogChange } = await import('../../catalog-config.ts');

test("catalog app checkbox toggles membership without opening the app", async () => {
 const slot=mount({language:"en"}); const dialog=await showCatalog(slot);
 fireEvent.click(within(dialog).getByRole("tab",{name:"Applications",exact:true}));
 const row=within(dialog).getByRole("listitem",{name:item.label});
 const checkbox=within(row).getByRole("checkbox",{name:item.label});
 assert.equal(checkbox.checked,false);
 await act(async()=>fireEvent.click(checkbox));
 assert.equal(checkbox.checked,true); assert.equal(row.dataset.added,"true");
 assert.equal(slot.container.querySelectorAll(".db-launch-row").length,1);
 await act(async()=>fireEvent.click(checkbox));
 assert.equal(checkbox.checked,false); assert.equal(row.dataset.added,"false");
 assert.equal(slot.container.querySelectorAll(".db-launch-row").length,0);
 assert.equal(slot.navigation.inspection.sidebarNavigationCalls.length,0);
 assert.equal(slot.getByRole("dialog"),dialog);
});

test("catalog adds several projects without closing or switching the current chat", async () => {
  const third = { ...project, id: "p3", name: "Third project" };
  let serverConfig = { projects: [{ id: "p1", enabled: true, connectedAt: 100 }], launcher: [], sharedPool: true };
  const slot = mount({ language: "en", projects: [project, secondProject, third], threads: [thread("a", "p1", "Alpha")], rpcOverrides: {
    snapshot: () => ({ config: serverConfig, tracked: [], syncError: null, syncedAt: 150 }),
    catalog_change: operation => { serverConfig = applyCatalogChange(serverConfig, operation, 200); return structuredClone(serverConfig); },
  } });
  const chat = await slot.findByTestId("bb-thread-chat");
  const dialog = await showCatalog(slot);
  for (const target of [secondProject, third]) {
    const row = within(dialog).getByRole("listitem", { name: target.name });
    await act(async () => fireEvent.click(within(row).getByRole("checkbox")));
    assert.equal(slot.getByRole("dialog"), dialog);
    assert.equal(row.dataset.added, "true");
    assert.equal(slot.getByTestId("bb-thread-chat"), chat);
    assert.equal(slot.container.querySelector('.db-project-tab[aria-selected="true"]').id, "db-project-tab-p1");
  }
  assert.deepEqual(serverConfig.projects.filter(p => p.enabled).map(p => p.id), ["p1", "p2", "p3"]);
  assert.equal(within(dialog).queryByRole("button", { name: "Go to project" }), null);
  fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
  fireEvent.click(slot.getByRole("tab", { name: new RegExp("^" + secondProject.name + ",") }));
  assert.equal(slot.container.querySelector('.db-project-tab[aria-selected="true"]').id, "db-project-tab-p2");
});

test("catalog tabs and search preserve the native chat draft and selection", async () => {
  const slot = mount({ language: "en", connected: true, projects: [project, secondProject], threads: [thread("a", "p1", "Alpha")] });
  const chat = await slot.findByTestId("bb-thread-chat");
  const editor = document.createElement("textarea"); editor.value = "Draft retained"; chat.append(editor); editor.setSelectionRange(2, 7);
  const dialog = await showCatalog(slot);
  fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "no matches" } });
  assert.ok(within(dialog).getByText("No matches. Try a different name."));
  fireEvent.click(within(dialog).getByRole("tab", { name: "Applications" }));
  assert.equal(slot.getByTestId("bb-thread-chat"), chat);
  assert.equal(editor.value, "Draft retained"); assert.equal(editor.selectionStart, 2); assert.equal(editor.selectionEnd, 7);
  fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
  assert.equal(slot.getByTestId("bb-thread-chat"), chat);
});

test("catalog has only two tabs and searches original app names", async () => {
 const slot=mount({language:"en",launcher:[{id:item.id,label:"Personal shortcut"}]});
 const dialog=await showCatalog(slot);
 assert.deepEqual(within(dialog).getAllByRole("tab").map(tab=>tab.textContent),["Projects","Applications"]);
 assert.equal(dialog.querySelector("aside, [draggable], form"),null);
 fireEvent.click(within(dialog).getByRole("tab",{name:"Applications"}));
 fireEvent.change(within(dialog).getByRole("searchbox"),{target:{value:item.label}});
 assert.ok(within(dialog).getByRole("checkbox",{name:"Personal shortcut",checked:true}));
 assert.equal(within(dialog).getAllByRole("list").length,1);
 assert.equal(within(dialog).queryByRole("button",{name:"Open"}),null);
});

test("catalog unavailable saved applications can be disconnected", async () => {
 const slot=mount({language:"en",withNavigation:false,launcher:[{id:"missing",label:"Missing app"}]});
 const dialog=await showCatalog(slot);
 fireEvent.click(within(dialog).getByRole("tab",{name:"Applications"}));
 const checkbox=within(dialog).getByRole("checkbox",{name:/Missing app/});
 assert.equal(checkbox.disabled,false);
 await act(async()=>fireEvent.click(checkbox));
 assert.equal(slot.container.querySelectorAll(".db-launch-row").length,0);
 assert.equal(within(dialog).queryByRole("checkbox",{name:/Missing app/}),null);
});

test("real page source renders Russian empty state and authored SVG controls", async () => {
  const slot = mount();
  await slot.findByText("Выберите проекты для работы");
  assert.equal(app.navPanels[0].title, "BBDesk");
  assert.equal(app.navPanels[0].icon, "dashboard/mark");
  assert.equal(slot.queryByRole("heading", { level: 1 }), null);
  assert.equal(slot.queryByText("Мои проекты"), null);
  const header = slot.getByRole("banner");
  assert.equal(within(header).queryByRole("combobox"), null);
  assert.ok(within(header).getByRole("button", { name: "Настроить проекты и приложения" }));
  assert.equal(within(slot.container.querySelector(".db-project-bar")).queryByRole("button", { name: "Настроить проекты и приложения" }), null);
  assert.equal(within(header).queryByRole("button", { name: "Поиск тредов" }), null);
  const control = slot.getByRole("button", { name: "Настроить проекты и приложения" });
  assert.equal(header.lastElementChild.previousElementSibling, control);
  assert.equal(slot.getAllByRole("button", { name: control.getAttribute("aria-label") }).length, 1);
  assert.equal(control.textContent, "");
  assert.equal(slot.queryByRole("button", { name: "Catalog", exact: true }), null);
  assert.equal(control.querySelector("svg").getAttribute("viewBox"), "0 0 24 24");
  assert.ok(!/(?:Рџ|Рњ|СЃ|С‚|�)/u.test(slot.container.textContent));
});

test("catalog preserves custom app labels and has no ordering controls", async () => {
 const slot=mount({language:"en",launcher:[{id:item.id,label:"Custom label"}]});
 const dialog=await showCatalog(slot);
 fireEvent.click(within(dialog).getByRole("tab",{name:"Applications"}));
 assert.ok(within(dialog).getByRole("checkbox",{name:"Custom label",checked:true}));
 assert.equal(dialog.querySelector("[draggable], .db-catalog-grip, .db-catalog-lists"),null);
 assert.equal(within(dialog).queryByRole("textbox"),null);
});

test("catalog tabs support keyboard navigation", async () => {
 const slot=mount({language:"en"}); const dialog=await showCatalog(slot);
 const projects=within(dialog).getByRole("tab",{name:"Projects"});
 fireEvent.keyDown(projects,{key:"ArrowRight"});
 const apps=within(dialog).getByRole("tab",{name:"Applications"});
 assert.equal(apps.getAttribute("aria-selected"),"true"); assert.equal(document.activeElement,apps);
 fireEvent.keyDown(apps,{key:"Home"}); assert.equal(document.activeElement,projects);
 fireEvent.click(within(dialog).getByRole("button",{name:"Done"}));
 assert.equal(slot.queryByRole("dialog"),null);
});

test("catalog project checkbox disconnects and reconnects immediately", async () => {
 const slot=mount({connected:true,language:"en",projects:[project,secondProject]});
 const dialog=await showCatalog(slot);
 const checkbox=within(dialog).getByRole("checkbox",{name:secondProject.name});
 assert.equal(checkbox.checked,true);
 await act(async()=>fireEvent.click(checkbox));
 assert.equal(checkbox.checked,false); assert.equal(slot.container.querySelector("#db-project-tab-p2"),null);
 await act(async()=>fireEvent.click(checkbox));
 assert.equal(checkbox.checked,true); assert.ok(slot.container.querySelector("#db-project-tab-p2"));
 assert.equal(slot.getByRole("dialog"),dialog);
});

test("a missing language preference uses English even with a Russian document language", async () => {
  const slot = mount({ language: null });
  await slot.findByText("Choose projects to follow");
  assert.equal(slot.container.querySelector(".db-root").lang, "en");
  assert.equal(slot.queryByRole("combobox", { name: "Show threads" }), null);
  assert.ok(slot.getByRole("button", { name: "Configure projects and applications" }));
  assert.equal(slot.queryByText("Выберите проекты для работы"), null);
});

test("switching language preserves mounted chat and catalog search and tab", async () => {
 const slot=mount({language:"en",connected:true,threads:[thread("t1","p1","Thread")]});
 const chat=await slot.findByTestId("bb-thread-chat"); const dialog=await showCatalog(slot);
 fireEvent.click(within(dialog).getByRole("tab",{name:"Applications"}));
 fireEvent.change(within(dialog).getByRole("searchbox"),{target:{value:"notes"}});
 await slot.setLanguage("ru");
 assert.equal(slot.getByTestId("bb-thread-chat"),chat);
 assert.equal(slot.getByRole("searchbox").value,"notes");
 assert.equal(slot.getByRole("tab",{name:"Приложения"}).getAttribute("aria-selected"),"true");
});

test("catalog errors translate when the language changes and do not navigate", async () => {
  const slot=mount({language:'en',rpcOverrides:{catalog_change:()=>{throw new Error('DASHBOARD_PROJECT_UNAVAILABLE')}}});
  await showCatalog(slot);
  await act(async()=>fireEvent.click(slot.getByRole('checkbox',{name:project.name})));
  await slot.findByText('This project is no longer available. Refresh the list.');
  await slot.setLanguage('ru');assert.ok(slot.getByText('Проект больше не доступен. Обновите список.'));
  assert.ok(slot.getByRole('dialog'));assert.equal(slot.container.querySelector('.db-project-tab'),null);
});

test("catalog adds a project in Russian without closing the catalog", async () => {
  const slot=mount();await slot.findByText('Выберите проекты для работы');
  fireEvent.click(within(slot.getByRole("banner")).getByRole('button',{name:'Настроить проекты и приложения',exact:true}));
  await act(async()=>fireEvent.click(slot.getByRole('checkbox',{name:project.name})));
  assert.ok(slot.getByRole('dialog'));
  fireEvent.click(slot.getByRole('button',{name:'Готово'}));
  assert.ok(slot.inspection.rpcCalls.some(c=>c.method==='catalog_change'&&c.input.type==='add'&&c.input.id==='p1'));
  assert.ok(slot.getByText('Сейчас нет активных тредов. Можно создать новый.'));
});

test("common threads remain a special catalog control and keep their distinct tab", async () => {
  const personal={...project,id:'home',name:'Personal',isPersonal:true};
  const slot=mount({language:'en',projects:[personal,project],threads:[thread('home-thread','home','Inbox')]});
  await showCatalog(slot);
  assert.equal(slot.queryByRole('listitem',{name:'Personal'}),null);
  await act(async()=>fireEvent.click(slot.getByRole('checkbox',{name:'Common threads'})));
  assert.ok(slot.getByRole('tab',{name:/^Common threads,/}).closest('.db-project-tools'));
  await act(async()=>fireEvent.click(slot.getByRole('checkbox',{name:project.name})));
  assert.equal(slot.getByRole('tab',{name:new RegExp('^'+project.name+',')}).closest('.db-project-tools'),null);
  assert.equal(slot.queryByRole('tab',{name:/^Personal,/}),null);
});

test("launcher main and adjacent-area controls issue separate native targets", async () => {
  const slot = mount({ launcher: [{ id: item.id, label: item.label }] });
  await slot.findByText("Заметки");
  fireEvent.click(slot.getByRole("button", { name: "Заметки", exact: true }));
  fireEvent.click(slot.getByRole("button", { name: "Открыть Заметки рядом", exact: true }));
  const calls = slot.navigation.inspection.sidebarNavigationCalls;
  assert.equal(calls.length, 2);
  assert.match(JSON.stringify(calls[0]), /current/);
  assert.match(JSON.stringify(calls[1]), /split/);
  assert.equal(slot.inspection.sidebarNavigationCalls.length, 0);
});

test("catalog includes hidden app panels, excludes itself and pins without opening", async () => {
  const slot=mount({language:'en',navigationItems:[{...item,isVisible:false},{...item,id:'dashboard/dashboard',pluginId:'dashboard',label:'BBDesk'}]});
  await showCatalog(slot, "Configure projects and applications");
  assert.equal(slot.queryByRole('listitem',{name:'BBDesk'}),null);
  fireEvent.click(slot.getByRole("tab",{name:"Applications"}));
  const entry=slot.getByRole('listitem',{name:item.label});
  assert.equal(entry.dataset.added,'false');
  assert.equal(within(entry).getByRole("checkbox").checked,false);
  assert.equal(slot.queryByText('Not added'),null);
  await act(async()=>fireEvent.click(within(entry).getByRole("checkbox")));
  assert.equal(entry.dataset.added,'true');
  assert.equal(within(entry).getByRole("checkbox").checked,true);

  assert.ok(slot.getByRole('dialog'));assert.equal(slot.navigation.inspection.sidebarNavigationCalls.length,0);
  assert.ok(slot.inspection.rpcCalls.some(c=>c.method==='catalog_change'&&c.input.id===item.id));
  fireEvent.click(slot.getByRole('button',{name:'Done'}));
  assert.ok(slot.getByRole('button',{name:item.label,exact:true}));
});

test("navigation wrapper preserves the original rail and releases stale actions when unmounted", async () => {
  const slot = mount({ launcher: [{ id: item.id, label: item.label }] });
  await slot.findByText("Заметки");
  assert.equal(slot.getByRole("button", { name: "Заметки", exact: true }).disabled, false);
  await act(async () => slot.navigation.lifecycle.unmount());
  assert.equal(slot.getByRole("button", { name: "Открыть Заметки рядом" }).disabled, true);
  fireEvent.click(slot.getByRole("button", { name: "Настроить проекты и приложения" }));
  fireEvent.click(slot.getByRole("tab", { name: "Приложения" }));
  assert.ok(slot.getByText(/выберите «BBDesk»/));
  assert.equal(slot.queryByText(/Установите плагин/), null);
  cleanup();
  const rail = renderSlot(app.experimentalSidebarNavigations[0], { isCompactViewport: false, placement: "rail", experimental_Original: () => createElement("span", null, "Original rail") }, { sidebarNavigation: { items: [] } });
  assert.ok(rail.getByText("Original rail"));
});

test("missing, loading and disabled destinations keep saved shortcuts disabled", async () => {
  const slot = mount({ launcher: [{ id: item.id, label: item.label }], navigationItems: [{ ...item, isDisabled: true }] });
  await slot.findByText("Заметки");
  assert.equal(slot.getByRole("button", { name: "Открыть Заметки рядом" }).disabled, true);
  slot.lifecycle.unmount();
  const missing = mount({ launcher: [{ id: item.id, label: item.label }], navigationItems: [] });
  await missing.findByText("Заметки");
  assert.equal(missing.getByRole("button", { name: "Открыть Заметки рядом" }).disabled, true);
  missing.lifecycle.unmount();
  const loading = mount({ launcher: [{ id: item.id, label: item.label }], navigationItems: [{ ...item, isLoading: true }] });
  await loading.findByText("Заметки");
  assert.equal(loading.getByRole("button", { name: "Открыть Заметки рядом" }).disabled, true);
});

test("long application labels stay intact in the DOM and split remains an independent button", async () => {
  const label = "Приложение с очень длинным названием для проверки узкой панели";
  const slot = mount({ launcher: [{ id: item.id, label }] });
  await slot.findByText(label);
  assert.equal(slot.getByRole("button", { name: label, exact: true }).querySelector("button"), null);
  assert.ok(slot.getByRole("button", { name: `Открыть ${label} рядом` }));
});

test("settings focus returns on Escape and handled native keys leave settings open", async () => {
  const slot = mount({ connected: true, threads: [thread("t1", "p1", "Thread")] });
  const opener = await slot.findByRole("button", { name: "Настроить проекты и приложения" });
  await waitFor(() => assert.equal(opener.disabled, false));
  opener.focus(); fireEvent.click(opener);
  const dialog = slot.getByRole("dialog", { name: "Каталог" });
  assert.ok(dialog.contains(document.activeElement));
  const event = new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }); event.preventDefault();
  fireEvent(document.activeElement, event);
  assert.ok(slot.getByRole("dialog", { name: "Каталог" }));
  fireEvent.keyDown(document.activeElement, { key: "Escape" });
  assert.equal(slot.queryByRole("dialog"), null);
  assert.equal(document.activeElement, opener);

});

test("dragging a project tab onto another reorders projects through catalog_change", async () => {
  const projects = [
    { ...project, id: "p1", name: "Первый" },
    { ...project, id: "p2", name: "Второй" },
    { ...project, id: "p3", name: "Третий" },
  ];
  const slot = mount({ connected: true, projects });
  await slot.findByRole("tab", { name: /Третий/ });
  const dataTransfer = { setData() {}, effectAllowed: "", dropEffect: "" };
  const wrap = id => slot.container.querySelector(`#db-project-tab-${id}`).closest(".db-project-tab-wrap");
  const tab = id => slot.container.querySelector(`#db-project-tab-${id}`);
  const order = () => [...slot.container.querySelectorAll(".db-project-tab")].map(el => el.id.replace("db-project-tab-", ""));
  // Dropping on the right half of another tab moves the source after it.
  dragFire(tab("p1"), "dragstart", {}, dataTransfer);
  dragFire(wrap("p3"), "dragover", { clientX: 10_000 }, dataTransfer);
  assert.equal(wrap("p3").getAttribute("data-drop"), "after");
  dragFire(wrap("p3"), "drop", { clientX: 10_000 }, dataTransfer);
  await waitFor(() => assert.deepEqual(order(), ["p2", "p3", "p1"]));
  assert.ok(slot.inspection.rpcCalls.some(call => call.method === "catalog_change"
    && call.input.type === "move" && call.input.kind === "project" && call.input.id === "p1" && call.input.targetId === "p3" && call.input.after === true));
  assert.ok([...slot.container.querySelectorAll('[role="status"]')].some(el => el.textContent === "Порядок обновлён."));
  // Dropping on the left half moves the source before the target.
  dragFire(tab("p1"), "dragstart", {}, dataTransfer);
  dragFire(wrap("p2"), "dragover", { clientX: -1 }, dataTransfer);
  assert.equal(wrap("p2").getAttribute("data-drop"), "before");
  dragFire(wrap("p2"), "drop", { clientX: -1 }, dataTransfer);
  await waitFor(() => assert.deepEqual(order(), ["p1", "p2", "p3"]));
  assert.ok(slot.inspection.rpcCalls.some(call => call.method === "catalog_change"
    && call.input.type === "move" && call.input.kind === "project" && call.input.id === "p1" && call.input.targetId === "p2" && call.input.after === false));
  // Releasing the drag without a drop clears the indicator.
  dragFire(tab("p1"), "dragstart", {}, dataTransfer);
  dragFire(wrap("p3"), "dragover", { clientX: -1 }, dataTransfer);
  dragFire(tab("p1"), "dragend", {}, dataTransfer);
  assert.equal(wrap("p3").getAttribute("data-drop"), null);
});

test("dragging an application row onto another reorders the launcher through catalog_change", async () => {
  const slot = mount({ launcher: [{ id: "a1", label: "Альфа" }, { id: "a2", label: "Бета" }, { id: "a3", label: "Гамма" }] });
  await slot.findByText("Альфа");
  const dataTransfer = { setData() {}, effectAllowed: "", dropEffect: "" };
  const labels = () => [...slot.container.querySelectorAll(".db-launch-row .db-launch-label")].map(el => el.firstChild.textContent);
  const row = label => [...slot.container.querySelectorAll(".db-launch-row")].find(el => el.textContent.includes(label));
  dragFire(row("Альфа"), "dragstart", {}, dataTransfer);
  dragFire(row("Гамма"), "dragover", { clientY: 10_000 }, dataTransfer);
  assert.equal(row("Гамма").getAttribute("data-drop"), "after");
  dragFire(row("Гамма"), "drop", { clientY: 10_000 }, dataTransfer);
  await waitFor(() => assert.deepEqual(labels(), ["Бета", "Гамма", "Альфа"]));
  assert.ok(slot.inspection.rpcCalls.some(call => call.method === "catalog_change"
    && call.input.type === "move" && call.input.kind === "app" && call.input.id === "a1" && call.input.targetId === "a3" && call.input.after === true));
  dragFire(row("Альфа"), "dragstart", {}, dataTransfer);
  dragFire(row("Бета"), "dragover", { clientY: -1 }, dataTransfer);
  assert.equal(row("Бета").getAttribute("data-drop"), "before");
  dragFire(row("Бета"), "drop", { clientY: -1 }, dataTransfer);
  await waitFor(() => assert.deepEqual(labels(), ["Альфа", "Бета", "Гамма"]));
  // Dragging within the same row and released drags do not change the order.
  dragFire(row("Альфа"), "dragstart", {}, dataTransfer);
  dragFire(row("Альфа"), "dragover", { clientY: 0 }, dataTransfer);
  dragFire(row("Альфа"), "drop", { clientY: 0 }, dataTransfer);
  dragFire(row("Альфа"), "dragend", {}, dataTransfer);
  assert.deepEqual(labels(), ["Альфа", "Бета", "Гамма"]);
  assert.equal(row("Альфа").getAttribute("data-drop"), null);
});

test("closing a pending project addition prevents late navigation but retains its saved membership", async () => {
  let complete;
  let serverConfig = { projects: [{ id: "p1", enabled: true, connectedAt: 100 }], launcher: [], sharedPool: true };
  const slot = mount({ language: "en", projects: [project, secondProject], threads: [thread("a", "p1", "Alpha")], rpcOverrides: {
    snapshot: () => ({ config: serverConfig, tracked: [], syncError: null, syncedAt: 150 }),
    catalog_change: () => new Promise(resolve => { complete = resolve; }),
  } });
  const dialog = await showCatalog(slot);
  fireEvent.click(within(within(dialog).getByRole("listitem", { name: secondProject.name })).getByRole("checkbox"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
  // The authoritative follow-up snapshot contains the same successful mutation.
  serverConfig = { ...serverConfig, projects: [...serverConfig.projects, { id: "p2", enabled: true, connectedAt: 200 }] };
  await act(async () => complete(serverConfig));
  assert.equal(slot.queryByRole("dialog"), null);
  assert.equal(slot.inspection.rpcCalls.filter(call => call.method === "catalog_change").length, 1);
  assert.equal(slot.container.querySelector('#db-project-tab-p2')?.getAttribute("aria-selected"), "false");
  assert.equal(slot.container.querySelector('.db-project-tab[aria-selected="true"]')?.id, "db-project-tab-p1");
});
