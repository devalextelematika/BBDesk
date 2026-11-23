import { useEffect, useState } from "react";
import { readStored, writeStored } from "../browser-storage";
import { closeAppLayout, emptyAppSplit, openAppLayout, readAppSplit, saveAppSplit, selectAppLayout } from "../split-layout";

const internalSplitKey = "bb-dashboard:internal-app-split";
export type ApplicationMode = "native" | "split" | "accordion";
const applicationModeKey = "bb-dashboard:application-mode:v1";

function readApplicationMode(): ApplicationMode {
  const saved = readStored(applicationModeKey, raw => {
    if (raw === "native" || raw === "split" || raw === "accordion") return raw;
    return "";
  }, "");
  if (saved) return saved;
  return readStored(internalSplitKey, raw => raw === true ? "split" : "native", "native");
}

/** Browser-local application layout and its split or accordion presentation mode. */
export function useAppSplit() {
  const [applicationMode, setApplicationMode] = useState(readApplicationMode);
  const [appSplit, setAppSplit] = useState(() => applicationMode === "native" ? emptyAppSplit() : readAppSplit());
  useEffect(() => saveAppSplit(appSplit), [appSplit]);
  const internalSplit = applicationMode !== "native";
  return {
    internalSplit, applicationMode, appSplit,
    changeApplicationMode(mode: ApplicationMode) {
      setApplicationMode(mode);
      if (mode === "native") setAppSplit(emptyAppSplit());
      else if (appSplit.appIds.length === 0) setAppSplit(readAppSplit());
      writeStored(applicationModeKey, mode);
      writeStored(internalSplitKey, mode !== "native");
    },
    openApp(id: string) {
      setAppSplit(previous => openAppLayout(previous, id));
    },
    closeApp(id: string) {
      setAppSplit(previous => closeAppLayout(previous, id));
    },
    setActiveApp(id: string) { setAppSplit(previous => selectAppLayout(previous, id)); },
    setOrder(order: string[]) { setAppSplit(previous => ({ ...previous, order })); },
    setWeights(sizes: Record<string, number>) { setAppSplit(previous => ({ ...previous, sizes })); },
  };
}
