import { useEffect, useRef, useState } from "react";
import type { CatalogChange } from "../catalog-config";
import type { DashboardConfig } from "../contracts";

export function useCatalogActions(change: (operation: CatalogChange) => Promise<DashboardConfig>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [failed, setFailed] = useState<(() => void) | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function run(operation: CatalogChange, after?: (config: DashboardConfig) => void) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(null); setFailed(null);
    try {
      const config = await change(operation);
      if (mounted.current) after?.(config);
    } catch (cause) {
      if (mounted.current) {
        setError(cause);
        setFailed(() => () => { void run(operation, after); });
      }
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }
  return { pending, error, retry: failed, run };
}
