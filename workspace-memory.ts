export type ConversationChoice = { id: string; history: boolean };
type WorkspaceMemory = { projectId: string | null; conversations: Record<string, ConversationChoice> };
const key = "bb-dashboard:workspace-session:v1";

export function readWorkspaceMemory(): WorkspaceMemory {
  const empty: WorkspaceMemory = { projectId: null, conversations: {} };
  try {
    const raw = JSON.parse(window.sessionStorage.getItem(key) ?? "null");
    if (!raw || typeof raw !== "object") return empty;
    const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200;
    const conversations = Object.fromEntries(Object.entries(raw.conversations ?? {}).slice(-100).filter(([projectId, value]) => {
      const choice = value as ConversationChoice | null;
      return validId(projectId) && choice && validId(choice.id) && typeof choice.history === "boolean";
    }));
    return { projectId: validId(raw.projectId) ? raw.projectId : null, conversations: conversations as Record<string, ConversationChoice> };
  } catch { return empty; }
}

export function saveWorkspaceMemory(memory: WorkspaceMemory) {
  try { window.sessionStorage.setItem(key, JSON.stringify(memory)); }
  catch { /* Session persistence is optional; navigation must remain usable. */ }
}
