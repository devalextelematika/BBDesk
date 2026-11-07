import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc, useRealtime, useRealtimeConnectionState } from "@get-bb/plugin-sdk/app";
import type { rpcContract, DashboardConfig, DashboardSnapshot } from "../contracts";
import type { MessageKey } from "../i18n";

export function useDashboardSnapshot() {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [data, setData] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const configEpoch = useRef(0);
  const requestRunning = useRef(false);
  const requestAgain = useRef(false);
  const mounted = useRef(true);
  const report = useCallback((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    setError(message.includes("DASHBOARD_PROJECT_UNAVAILABLE") ? "projectGone"
      : message.includes("DASHBOARD_THREAD_UNAVAILABLE") ? "threadUnavailable" : "actionFailed");
  }, []);
  const refresh = useCallback(async () => {
    if (requestRunning.current) { requestAgain.current = true; return; }
    requestRunning.current = true;
    try {
      do {
        requestAgain.current = false;
        const epoch = configEpoch.current;
        const next = await rpc.call("snapshot");
        if (epoch !== configEpoch.current) { requestAgain.current = true; continue; }
        if (mounted.current) { setData(next); setError(null); }
      } while (requestAgain.current && mounted.current);
    } catch (cause) { if (mounted.current) report(cause); }
    finally { requestRunning.current = false; }
  }, [rpc, report]);
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; }; }, [refresh]);
  useRealtime("dashboard-changed", refresh);
  useEffect(() => { if (connection === "connected") void refresh(); }, [connection, refresh]);

  const applyConfig = useCallback((config: DashboardConfig) => {
    if (!mounted.current) return;
    configEpoch.current++;
    setData(previous => previous ? { ...previous, config } : previous);
  }, []);
  return { rpc, data, error, setError, report, refresh, applyConfig, mounted };
}
