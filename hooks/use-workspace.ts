import { useCallback, useEffect, useRef, useState } from "react";
import { workspaceTransition, createWorkspaceState, type WorkspaceEvent } from "../workspace-transitions";
import { readSplitLayouts, readSharedPool, saveSplitLayouts, saveSharedPool } from "../split-layout";
import { readWorkspaceMemory, saveWorkspaceMemory } from "../workspace-memory";

export function useWorkspace() {
  const [state, commit] = useState(() => createWorkspaceState(readWorkspaceMemory(), readSplitLayouts(), readSharedPool()));
  const initialMemory = useRef(state.memory);
  const latest = useRef(state);
  const dispatch = useCallback((event: WorkspaceEvent) => {
    const next = workspaceTransition(latest.current, event);
    if (next !== latest.current) { latest.current = next; commit(next); }
    return next;
  }, []);
  const getState = useCallback(() => latest.current, []);
  useEffect(() => saveSplitLayouts(state.layouts), [state.layouts]);
  useEffect(() => saveSharedPool(state.pool), [state.pool]);
  useEffect(() => { if (state.memory !== initialMemory.current) saveWorkspaceMemory(state.memory); }, [state.memory]);
  return { state, dispatch, getState };
}
