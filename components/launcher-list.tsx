import { useRef, useState } from "react";
import { experimental_SidebarNavigationIcon as NavigationIcon, type ExperimentalSidebarNavigationItem } from "@get-bb/plugin-sdk/app";
import type { DashboardConfig } from "../contracts";
import type { Translator } from "../i18n";
import { dropAfter } from "../dom-utils";
import { Icon } from "./ui/icon";

/** The configured applications in the left panel, reorderable by dragging. */
export function LauncherList({ entries, apps, internalSplit, tr, onOpen, onOpenAlongside, onReorder }: {
  entries: DashboardConfig["launcher"] | null; apps: readonly ExperimentalSidebarNavigationItem[]; internalSplit: boolean; tr: Translator;
  onOpen: (id: string) => void; onOpenAlongside: (id: string, item: ExperimentalSidebarNavigationItem | undefined) => void;
  onReorder: (id: string, targetId: string, after: boolean) => void;
}) {
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const dragged = useRef<string | null>(null);
  if (!entries) return <div className="db-launcher-list"><p className="db-muted">{tr("loading")}</p></div>;
  if (!entries.length) return <div className="db-launcher-list"><div className="db-launcher-empty"><Icon name="LayoutGrid" className="db-empty-icon"/><p>{tr("appsEmpty")}</p></div></div>;
  return <div className="db-launcher-list">{entries.map(entry => {
    const item = apps.find(candidate => candidate.id === entry.id);
    const unavailable = !item || item.isLoading || item.isDisabled;
    const dropMark = drop?.id === entry.id ? drop.after ? "after" : "before" : undefined;
    return <div className="db-launch-row" key={entry.id} draggable data-drop={dropMark} aria-dropeffect={drop ? "move" : undefined}
      onDragStart={event => {
        dragged.current = entry.id;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", `db-app:${entry.id}`);
      }}
      onDragEnd={() => { dragged.current = null; setDrop(null); }}
      onDragOver={event => {
        if (dragged.current === null || dragged.current === entry.id) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const after = dropAfter(event, true);
        setDrop(previous => previous?.id === entry.id && previous.after === after ? previous : { id: entry.id, after });
      }}
      onDrop={event => {
        const source = dragged.current;
        dragged.current = null; setDrop(null);
        if (!source || source === entry.id) return;
        event.preventDefault();
        event.stopPropagation();
        onReorder(source, entry.id, dropAfter(event, true));
      }}>
      <button type="button" className="db-launch-main" draggable={false} disabled={unavailable} title={unavailable ? tr("appUnavailableHelp") : entry.label} onClick={() => onOpen(entry.id)}>
        {item ? <NavigationIcon icon={item.icon} className="db-icon"/> : <Icon name="AppWindow" className="db-icon"/>}<span className="db-launch-label">{entry.label}{unavailable && <small>{tr("unavailable")}</small>}</span>
      </button>
      <button type="button" className="db-launch-split" draggable={false} disabled={unavailable} title={internalSplit ? tr("openAlongside", { name: entry.label }) : tr("splitHelp")} aria-label={tr("openAlongside", { name: entry.label })}
        onClick={() => onOpenAlongside(entry.id, item)}><Icon name="Columns2" className="db-icon"/></button>
    </div>;
  })}</div>;
}
