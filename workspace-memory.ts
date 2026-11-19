import { readStored, writeStored } from "./browser-storage";

export type ConversationChoice = { id: string; history: boolean };
type WorkspaceMemory = { projectId: string | null; conversations: Record<string, ConversationChoice> };
const key = "bb-dashboard:workspace-session:v1";
const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200;

export function readWorkspaceMemory(): WorkspaceMemory {
  const empty: WorkspaceMemory = { projectId: null, conversations: {} };
  return readStored(key, raw => {
    if (!raw || typeof raw !== "object") return empty;
    const row = raw as { projectId?: unknown; conversations?: unknown };
    const conversations = Object.fromEntries(Object.entries(row.conversations ?? {}).slice(-100).filter(([projectId, value]) => {
      const choice = value as ConversationChoice | null;
      return validId(projectId) && choice && validId(choice.id) && typeof choice.history === "boolean";
    }));
    return { projectId: validId(row.projectId) ? row.projectId : null, conversations: conversations as Record<string, ConversationChoice> };
  }, empty, "session");
}

export function saveWorkspaceMemory(memory: WorkspaceMemory) { writeStored(key, memory, "session"); }
