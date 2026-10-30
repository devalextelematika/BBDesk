import { useEffect, useSyncExternalStore } from "react";
import {
  experimental_useSidebarNavigation,
  type ExperimentalSidebarNavigationProps,
  type ExperimentalSidebarNavigationState,
} from "@get-bb/plugin-sdk/app";

// BB provides this model only inside the sidebar. Keep the host's actions
// alive there; pages subscribe without trying to recreate navigation behavior.
let navigation: ExperimentalSidebarNavigationState | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => navigation;

export function LauncherNavigation({ experimental_Original: Original }: ExperimentalSidebarNavigationProps) {
  const current = experimental_useSidebarNavigation();
  useEffect(() => {
    navigation = current;
    listeners.forEach(listener => listener());
    return () => {
      if (navigation !== current) return;
      navigation = null;
      listeners.forEach(listener => listener());
    };
  }, [current]);
  return <Original/>;
}

export function useLauncherNavigation() {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}
