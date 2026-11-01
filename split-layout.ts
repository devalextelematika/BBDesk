import type { DragEvent } from "react";

export type SplitLayout = { ids: string[]; active: string; sizes: Record<string, number> };
export type SplitLayouts = Record<string, SplitLayout>;
const storageKey = "bb-dashboard:split-layout:v1";
export const threadDragType = "application/x-bbdesk-thread";

export function startThreadDrag(event: DragEvent, projectId: string, threadId: string) {
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData(threadDragType, JSON.stringify({ projectId, threadId }));
}

export function readSplitLayouts(): SplitLayouts {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const result: SplitLayouts = {};
    for (const [project, value] of Object.entries(raw).slice(-100)) {
      if (!project || project.length > 200 || !value || typeof value !== "object") continue;
      const row = value as Partial<SplitLayout>;
      if (!Array.isArray(row.ids) || !row.ids.every(id => typeof id === "string" && id.length > 0 && id.length <= 200)) continue;
      const ids = [...new Set(row.ids)];
      if (!ids.length) continue;
      const sizes = Object.fromEntries(ids.map(id => [id, typeof row.sizes?.[id] === "number" && Number.isFinite(row.sizes[id]) && row.sizes[id] > 0 ? row.sizes[id] : 1]));
      result[project] = { ids, active: ids.includes(row.active ?? "") ? row.active! : ids[0]!, sizes };
    }
    return result;
  } catch { return {}; }
}

export function saveSplitLayouts(layouts: SplitLayouts) {
  try { window.localStorage.setItem(storageKey, JSON.stringify(layouts)); }
  catch { /* Resizing and navigation also work with blocked browser storage. */ }
}

export function selectSplitThread(layout: SplitLayout, id: string): SplitLayout {
  if (layout.ids.includes(id)) return { ...layout, active: id };
  const replaced = layout.active;
  const ids = layout.ids.map(value => value === replaced ? id : value);
  return { ids, active: id, sizes: Object.fromEntries(ids.map(value => [value, layout.sizes[value === id ? replaced : value] ?? 1])) };
}
