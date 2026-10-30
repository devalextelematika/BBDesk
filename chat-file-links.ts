import type { ExperimentalFileLocation } from "@get-bb/plugin-sdk/app";

export interface ChatFileLink { path: string; location: ExperimentalFileLocation | null }

// Read the authored href, never the browser's HTTP resolution of a local path.
export function parseChatFileLink(href: string): ChatFileLink | null {
  if (!href || href.trim() !== href || href.startsWith("//") || href.startsWith("#")) return null;
  let path = href;
  if (/^file:/i.test(path)) {
    try {
      const url = new URL(path);
      if (url.host || url.search) return null;
      path = url.pathname + url.hash;
    } catch { return null; }
  } else if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return null;
  try { path = decodeURIComponent(path); } catch { return null; }
  if (/[\u0000-\u001f\u007f?]/.test(path)) return null;
  let location: ExperimentalFileLocation | null = null;
  const suffix = /(?:#L(\d+)(?:C(\d+))?(?:-L?(\d+))?|:(\d+)(?::(\d+))?)$/.exec(path);
  if (suffix) {
    const line = Number(suffix[1] ?? suffix[4]);
    const column = suffix[2] ?? suffix[5];
    const endLine = suffix[3] === undefined ? null : Number(suffix[3]);
    if (![line, ...(column ? [Number(column)] : []), ...(endLine === null ? [] : [endLine])].every(n => Number.isSafeInteger(n) && n > 0) || endLine !== null && endLine < line) return null;
    location = endLine === null ? { kind: "line", line, column: column ? Number(column) : null }
      : { kind: "range", startLine: line, endLine };
    path = path.slice(0, suffix.index);
  }
  if (path.includes("#")) return null;
  path = path.replace(/\\/g, "/").replace(/^\/([a-z]:\/)/i, "$1");
  if (path.startsWith("//")) return null;
  // Root-relative BB routes are web links. Only root paths with a file basename
  // are candidates; recognized BB endpoints always retain their own behavior.
  if (/^\/(?:api|projects|threads|plugins|settings|attachments|assets)(?:\/|$)/.test(path)) return null;
  const basename = path.split("/").at(-1) ?? "";
  if (!basename || basename === "." || basename === "..") return null;
  if (!basename.includes(".") && location === null && !/^[a-z]:\//i.test(path) && !href.startsWith("file:")) return null;
  return { path, location };
}

export function resolveChatFilePath(path: string, workspaceRoot: string): string | null {
  const absolute = /^(?:[a-z]:\/|\/)/i.test(path);
  const combined = absolute ? path : `${workspaceRoot.replace(/\\/g, "/").replace(/\/$/, "")}/${path}`;
  const prefix = /^[a-z]:\//i.exec(combined)?.[0] ?? (combined.startsWith("/") ? "/" : null);
  if (!prefix) return null;
  const parts: string[] = [];
  for (const part of combined.slice(prefix.length).split("/")) {
    if (part === "..") { if (!parts.length) return null; parts.pop(); }
    else if (part && part !== ".") parts.push(part);
  }
  return prefix + parts.join("/");
}
