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

export type PoolEntry = { projectId: string; threadId: string };
export type SharedPool = { entries: PoolEntry[]; active: string; sizes: Record<string, number>; open: boolean };
export const sharedPoolLimit = 50;
export type PoolAddition = { pool: SharedPool; status: "added" | "present" | "limit" | "invalid" };
const poolStorageKey = "bb-dashboard:shared-pool:v1";
const emptyPool = (): SharedPool => ({ entries: [], active: "", sizes: {}, open: false });

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200;
}

export function readThreadDrag(transfer: { getData(type: string): string }): PoolEntry | null {
  try {
    const data: unknown = JSON.parse(transfer.getData(threadDragType) || "null");
    if (!data || typeof data !== "object") return null;
    const entry = data as Partial<PoolEntry>;
    return validId(entry.projectId) && validId(entry.threadId) ? { projectId: entry.projectId, threadId: entry.threadId } : null;
  } catch { return null; }
}

export function readSharedPool(): SharedPool {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(poolStorageKey) ?? "null");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyPool();
    const row = raw as Partial<SharedPool>;
    if (!Array.isArray(row.entries)) return emptyPool();
    const entries: PoolEntry[] = [];
    for (const entry of row.entries) {
      if (!entry || typeof entry !== "object") continue;
      const projectId = (entry as PoolEntry).projectId;
      const threadId = (entry as PoolEntry).threadId;
      if (!validId(projectId) || !validId(threadId) || entries.some(item => item.threadId === threadId)) continue;
      entries.push({ projectId, threadId });
      if (entries.length >= sharedPoolLimit) break;
    }
    const sizes = Object.fromEntries(entries.map(entry => {
      const size = row.sizes?.[entry.threadId];
      return [entry.threadId, typeof size === "number" && Number.isFinite(size) && size > 0 ? size : 1];
    }));
    return {
      entries, sizes, open: row.open === true,
      active: entries.some(entry => entry.threadId === row.active) ? row.active! : entries[0]?.threadId ?? "",
    };
  } catch { return emptyPool(); }
}

export function saveSharedPool(pool: SharedPool) {
  try { window.localStorage.setItem(poolStorageKey, JSON.stringify(pool)); }
  catch { /* Pinning and navigation also work with blocked browser storage. */ }
}

export function addPoolEntry(pool: SharedPool, entry: PoolEntry, target?: string, after = true): PoolAddition {
  if (!validId(entry.projectId) || !validId(entry.threadId)) return { pool, status: "invalid" };
  const existing = pool.entries.find(item => item.threadId === entry.threadId);
  if (existing) {
    const entries = pool.entries.map(item => item.threadId === entry.threadId ? { projectId: entry.projectId, threadId: entry.threadId } : item);
    return { pool: { ...pool, entries, active: entry.threadId }, status: "present" };
  }
  if (pool.entries.length >= sharedPoolLimit) return { pool, status: "limit" };
  const entries = [...pool.entries];
  const index = target ? entries.findIndex(item => item.threadId === target) : entries.findIndex(item => item.threadId === pool.active);
  entries.splice(index < 0 ? entries.length : index + Number(after), 0, { projectId: entry.projectId, threadId: entry.threadId });
  return { pool: { ...pool, entries, active: entry.threadId, sizes: {} }, status: "added" };
}

export function movePoolEntry(pool: SharedPool, threadId: string, targetId: string, after = true): SharedPool {
  if (!validId(threadId) || !validId(targetId) || threadId === targetId) return pool;
  const from = pool.entries.findIndex(item => item.threadId === threadId);
  const target = pool.entries.findIndex(item => item.threadId === targetId);
  if (from < 0 || target < 0) return pool;
  const entries = [...pool.entries];
  const [entry] = entries.splice(from, 1);
  const nextTarget = entries.findIndex(item => item.threadId === targetId);
  entries.splice(nextTarget + Number(after), 0, entry!);
  if (entries.every((item, index) => item === pool.entries[index])) return pool;
  return { ...pool, entries };
}

export function removePoolEntry(pool: SharedPool, threadId: string): SharedPool {
  const index = pool.entries.findIndex(item => item.threadId === threadId);
  if (index < 0) return pool;
  const entries = pool.entries.filter(item => item.threadId !== threadId);
  const active = pool.active === threadId ? entries[Math.min(index, entries.length - 1)]?.threadId ?? "" : pool.active;
  return { ...pool, entries, active, sizes: Object.fromEntries(Object.entries(pool.sizes).filter(([id]) => id !== threadId)) };
}
