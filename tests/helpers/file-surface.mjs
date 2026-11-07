import { loadPluginApp, renderSlot, createElement } from './dom.mjs';
export async function mountFileSurface({ href = "/E:/Development/BBDesk/CHANGELOG.md", sdk = {}, accepts = true } = {}) {
  const { definePluginApp } = await import("@get-bb/plugin-sdk/app");
  const { ChatFileSurface } = await import("../../chat-file-surface.tsx");
  const fixture = await loadPluginApp(() => Promise.resolve({ default: definePluginApp(builder => {
    builder.slots.navPanel({ id: "files", title: "Files", icon: "File", path: "files", component: ({ subPath }) => createElement(ChatFileSurface, { threadId: subPath || "thread-a" }, createElement("a", { href, target: "_blank" }, createElement("span", null, "Open report"))) });
  }) }));
  return renderSlot(fixture.navPanels[0], { subPath: "" }, {
    settings: { language: "en" }, openFilePreview: () => accepts,
    sdk: { threads: { get: async () => ({ environmentId: "env-a" }) }, environments: { get: async () => ({ hostId: "machine-a", path: "E:/Development/BBDesk" }) }, ...sdk },
  });
}
