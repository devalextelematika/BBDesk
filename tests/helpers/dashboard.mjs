import { project, item } from './factories.mjs';
export { project, item, secondProject, thread } from './factories.mjs';
import { app, renderSlot, act, createElement, fireEvent, waitFor } from './dom.mjs';

import assert from 'node:assert/strict';

const { changeCatalog: applyCatalogChange } = await import('../../catalog-config.ts');

export function mount({ connected = false, launcher = [], threads = [], hiddenIds = [], draftThreadIds = [], projects = [project], sdk = {}, navigationItems = [item], withNavigation = true, language = "ru", rpcOverrides = {}, threadStatus = "ready", providers = undefined } = {}) {
  // Existing regression scenarios explicitly exercise Russian. null omits the preference.
  const languageSettings = language === null ? {} : { language };
  let snapshot = { config: { projects: connected ? projects.map(p => ({ id: p.id, enabled: true, connectedAt: 100 })) : [], launcher }, tracked: threads.map(t => ({ id: t.id, projectId: t.projectId, visible: !hiddenIds.includes(t.id), latestAttentionAt: t.latestAttentionAt, hiddenAttentionAt: hiddenIds.includes(t.id) ? t.latestAttentionAt : 0 })), syncError: null, syncedAt: 150 };
  const navigation = withNavigation ? renderSlot(app.experimentalSidebarNavigations[0], {
    isCompactViewport: false, placement: "rail", experimental_Original: () => null,
  }, { pluginId: "dashboard", sidebarNavigation: { items: navigationItems } }) : null;
  const slot = renderSlot(app.navPanels[0], { subPath: "" }, {
    pluginId: "dashboard",
    settings: languageSettings,
    sidebarThreads: { status: threadStatus, projects, threads },
    providers,
    sidebarDraftThreadIds: draftThreadIds,
    // Pages have no sidebar navigation context in BB. Only the bridge above does.
    sdk: { subscribe: () => () => {}, ...sdk },
    rpc: {
      snapshot: () => structuredClone(snapshot),
      catalog_change: change => { snapshot.config = applyCatalogChange(snapshot.config, change, 100); return structuredClone(snapshot.config); },
      projects_set: ({ ids, sharedPool }) => { snapshot.config.projects = ids.map(id => ({ id, enabled: true, connectedAt: 100 })); if (typeof sharedPool === "boolean") snapshot.config.sharedPool = sharedPool; return snapshot.config; },
      launcher_set: ({ items }) => { snapshot.config.launcher = items; return snapshot.config; },
      thread_hide: ({ threadId }) => {
        const row = snapshot.tracked.find(t => t.id === threadId);
        if (!row) return { hidden: false };
        row.visible = false; row.hiddenAttentionAt = row.latestAttentionAt;
        return { hidden: true, undoToken: `undo-${threadId}` };
      },
      thread_restore: ({ threadId }) => {
        const row = snapshot.tracked.find(t => t.id === threadId);
        if (!row) return { restored: false };
        row.visible = true; return { restored: true };
      },
      ...rpcOverrides,
    },
  });
  const unmount = slot.lifecycle.unmount;
  slot.lifecycle.unmount = () => { unmount(); navigation?.lifecycle.unmount(); };
  return Object.assign(slot, { navigation, async setLanguage(value) {
    languageSettings.language = value;
    await act(async () => slot.lifecycle.rerender(createElement(app.navPanels[0].component, { subPath: "" })));
  } });
}

export async function showCatalog(slot, name = "Configure projects and applications") {
  const button = await slot.findByRole("button", { name, exact: true });
  await waitFor(() => assert.equal(button.disabled, false));
  fireEvent.click(button);
  return await slot.findByRole("dialog");
}
