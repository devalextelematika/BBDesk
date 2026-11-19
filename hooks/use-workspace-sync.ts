import { useEffect, useRef } from "react";
import type { WorkspaceSync } from "../workspace-transitions";
import type { useWorkspace } from "./use-workspace";

// Tests show every pass settles within three state changes. A longer chain means a
// synchronization rule fights itself; pausing keeps the page responsive instead of
// rendering in a loop, and the pause expires so later data can still be applied.
const maxChain = 20;
const pauseMs = 5_000;

/**
 * Runs the workspace synchronization pass after every render. A pass that changes
 * nothing keeps the same state object and causes no further render; a pass that
 * changes state renders again with a rebuilt model and synchronizes once more.
 */
export function useWorkspaceSync(controller: Pick<ReturnType<typeof useWorkspace>, "dispatch" | "getState">, sync: WorkspaceSync) {
  const chain = useRef({ count: 0, pausedUntil: 0, reported: false });
  useEffect(() => {
    const current = chain.current;
    if (current.pausedUntil) {
      if (Date.now() < current.pausedUntil) return;
      current.pausedUntil = 0; current.count = 0;
    }
    const before = controller.getState();
    const after = controller.dispatch({ type: "workspace.sync", ...sync });
    current.count = after === before ? 0 : current.count + 1;
    if (current.count < maxChain) return;
    current.pausedUntil = Date.now() + pauseMs;
    if (!current.reported) {
      current.reported = true;
      console.error("BBDesk: workspace synchronization did not settle; pausing it briefly.");
    }
  });
}
