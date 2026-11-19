// Browser-local preferences are optional: blocked or corrupt storage falls back
// to defaults, and failed writes keep the current session working.
type Area = "local" | "session";
const area = (kind: Area) => kind === "session" ? window.sessionStorage : window.localStorage;

/** Reads a JSON value and validates it with `parse`; any failure returns `fallback`. */
export function readStored<T>(key: string, parse: (raw: unknown) => T, fallback: T, kind: Area = "local"): T {
  try { return parse(JSON.parse(area(kind).getItem(key) ?? "null")); }
  catch { return fallback; }
}

export function writeStored(key: string, value: unknown, kind: Area = "local") {
  try { area(kind).setItem(key, JSON.stringify(value)); }
  catch { /* Optional persistence; the in-memory state stays authoritative. */ }
}
