import { readFile } from "node:fs/promises";

export const corruptText = /(?:Р[А-Яа-яЁёЀ-ӿ\u00A0-\u00BF]|С[Ђ-Џ\u0080-\u00BF\u2010-\u203F]){2,}|Рџ|Рњ|Рќ|РЎ|СЃ|С‚|вЂ[¦”–]|[ÐÑ][\u0080-\u00BF]|[\uFFFD\u0098]/u;
const sources = ["app.tsx", "launcher-navigation.tsx", "launcher-panel.tsx", "project-tabs.tsx", "thread-tabs.tsx", "server.ts", "state.ts", "package.json", "components/ui/icon.tsx", "components/thread-indicator.tsx", "i18n.ts", "use-translation.ts", "locales/en.ts", "locales/ru.ts", "README.md", "PLUGIN_OVERVIEW.md", "docs/PUBLISHING.md", "skills/dashboard/SKILL.md"];
sources.push("split-layout.ts", "split-workspace.tsx", "catalog.tsx", "catalog-model.ts", "catalog-config.ts", "hooks/use-catalog-actions.ts", "activity-sync.ts", "contracts.ts", "configuration.ts", "docs/RPC_COMPATIBILITY.md");
sources.push("workspace-selectors.ts", "hooks/use-dashboard-snapshot.ts");
sources.push("thread-completion.ts", "hooks/use-thread-completion.ts");
sources.push("workspace-transitions.ts", "hooks/use-workspace.ts", "hooks/use-workspace-actions.ts", "docs/WORKSPACE_TRANSITIONS.md");
const workspaceViews = ["components/project-workspace.tsx", "components/shared-pool-workspace.tsx", "components/workspace-chat.tsx", "components/workspace-button.tsx"];
sources.push("workspace-view-models.ts", ...workspaceViews);
for (const name of sources) {
  const bytes = await readFile(new URL("../" + name, import.meta.url));
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (corruptText.test(text)) throw new Error("Corrupt text encoding in " + name);
}
for (const name of ["app.tsx", "project-tabs.tsx", "thread-tabs.tsx", "launcher-panel.tsx", "catalog.tsx", ...workspaceViews]) {
  const text = await readFile(new URL("../" + name, import.meta.url), "utf8");
  if (/[\u0400-\u04ff]/u.test(text)) throw new Error("Move authored UI text into the language catalogs: " + name);
}
console.log("UTF-8 and localized UI source checks passed.");
