import { useEffect, useState } from "react";
import { readStored, writeStored } from "../browser-storage";
import { emptyAppSplit, readAppSplit, saveAppSplit } from "../split-layout";

const internalSplitKey = "bb-dashboard:internal-app-split";

/** Browser-local application columns opened beside the workspace, and whether that mode is on. */
export function useAppSplit() {
  const [internalSplit, setInternalSplit] = useState(() => readStored(internalSplitKey, raw => raw === true, false));
  const [appSplit, setAppSplit] = useState(() => internalSplit ? readAppSplit() : emptyAppSplit());
  useEffect(() => saveAppSplit(appSplit), [appSplit]);
  return {
    internalSplit, appSplit,
    changeSplitMode(value: boolean) {
      setInternalSplit(value);
      if (!value) setAppSplit(emptyAppSplit());
      writeStored(internalSplitKey, value);
    },
    openApp(id: string) {
      setAppSplit(previous => previous.appIds.includes(id) ? previous : { ...previous, appIds: [...previous.appIds, id] });
    },
    closeApp(id: string) {
      setAppSplit(previous => {
        const sizes = { ...previous.sizes };
        delete sizes[id];
        return { appIds: previous.appIds.filter(app => app !== id), order: previous.order.filter(app => app !== id), sizes };
      });
    },
    setOrder(order: string[]) { setAppSplit(previous => ({ ...previous, order })); },
    setWeights(sizes: Record<string, number>) { setAppSplit(previous => ({ ...previous, sizes })); },
  };
}
