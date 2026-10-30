import type { ReactNode, SVGProps } from "react";

// Plugin-owned control artwork; unknown host icon names otherwise become Zap.
// Launcher destinations still use BB's SidebarNavigationIcon for their artwork.
const paths = {
  PanelLeftClose: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m7-11-3 3 3 3"/></>,
  PanelLeftOpen: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m5-11 3 3-3 3"/></>,
  Settings2: <><path d="M4 6h3m4 0h9M4 12h9m4 0h3M4 18h3m4 0h9"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="18" r="2"/></>,
  LayoutGrid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  AppWindow: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/></>,
  Columns2: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/></>,
  Search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  FolderOpen: <><path d="M3 8V5a2 2 0 0 1 2-2h5l3 3h6a2 2 0 0 1 2 2v2M3 8h18l-3 12H3Z"/></>,
  Plus: <path d="M12 5v14M5 12h14"/>,
  X: <path d="m6 6 12 12M18 6 6 18"/>,
  Undo2: <><path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/></>,
  ArrowUp: <path d="M12 20V4m-6 6 6-6 6 6"/>,
  ArrowDown: <path d="M12 4v16m-6-6 6 6 6-6"/>,
  GripVertical: <><circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/></>,
  ChevronUp: <path d="m6 15 6-6 6 6"/>,
  ChevronDown: <path d="m6 9 6 6 6-6"/>,
  Minimize2: <path d="M9 3v6H3m18 6h-6v6M9 9 3 3m12 12 6 6"/>,
  Check: <path d="m5 12 4 4L19 6"/>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;
export type IconProps = SVGProps<SVGSVGElement> & { name: IconName };
export function Icon({ name, ...props }: IconProps) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-icon-root="" {...props}>{paths[name]}</svg>;
}
