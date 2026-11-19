import { experimental_SidebarNavigationIcon as NavigationIcon, type ExperimentalSidebarNavigationItem } from "@get-bb/plugin-sdk/app";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useLauncherNavigation } from "../launcher-navigation";
import { useTranslation } from "../use-translation";
import { appWorkspaceId } from "../split-layout";
import { Icon } from "./ui/icon";
import { SplitDivider } from "./split-divider";
import { dropAfter } from "../dom-utils";
import { SmallButton } from "./workspace-button";

type AppPane = { id: string; label: string; icon?: ExperimentalSidebarNavigationItem["icon"] };

// Only a frame created by this workspace may use the BBDesk page as its launcher.
export function embeddedTarget() {
  try { return (window.frameElement as HTMLElement | null)?.dataset.bbdeskApp; }
  catch { return undefined; }
}

export function EmbeddedLaunch({ id }: { id: string }) {
  const navigation = useLauncherNavigation();
  const launched = useRef(false);
  const { t } = useTranslation();
  useEffect(() => {
    const item = navigation?.items.find(candidate => candidate.id === id);
    if (launched.current || !item || item.isLoading || item.isDisabled || item.action.kind !== "open-plugin-panel") return;
    launched.current = true;
    navigation!.actions.activate(id, { target: "current" });
  }, [navigation, id]);
  return <p role="status">{t("appLoading")}</p>;
}

// The inner host supplies each plugin's SDK context and resolves its registered path.
// Keep dialogs portalled into body above the panel. Scope the adjustment to this frame.
function fitEmbeddedPanel(frame: HTMLIFrameElement) {
  const doc = frame.contentDocument;
  if (!doc?.head || doc.getElementById("bbdesk-fit-panel")) return;
  const style = doc.createElement("style");
  style.id = "bbdesk-fit-panel";
  // The host header precedes the plugin body. Headers rendered by the plugin
  // live inside that body and keep their own controls and layout.
  style.textContent = `[id^="plugin-panel-main-pane-"] header:has(+ div > [data-testid="plugin-panel-body"]),
    [data-testid="app-layout-root"]:has([id^="plugin-panel-main-pane-"]) > [data-testid="app-sidebar-trigger-overlay"] {
      display:none !important;
    }
    [id^="plugin-panel-main-pane-"] {
      position:fixed !important; inset:0 !important; width:100vw !important; height:100dvh !important;
      z-index:30; background:var(--background);
    }`;
  doc.head.append(style);
}

export function ApplicationWorkspace({ panes, order, weights, setOrder, setWeights, close, openInBB, children }: {
  order: string[]; weights: Record<string, number>;
  setOrder: (order: string[]) => void; setWeights: (weights: Record<string, number>) => void;
  panes: AppPane[]; close: (id: string) => void; openInBB: (id: string) => void; children: ReactNode;
}) {
  const { t } = useTranslation();
  const strip = useRef<HTMLDivElement>(null);
  // CSS order keeps each iframe in its original DOM node and browsing context.
  const [moving, setMoving] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const mountedIds = [appWorkspaceId, ...panes.map(pane => pane.id)];
  const ids = [...order.filter(id => mountedIds.includes(id)), ...mountedIds.filter(id => !order.includes(id))];
  function finishMove() { setMoving(null); setDrop(null); }
  function place(source: string, target: string, after: boolean) {
    if (source === target || !ids.includes(source) || !ids.includes(target)) return;
    const next = ids.filter(id => id !== source);
    next.splice(next.indexOf(target) + Number(after), 0, source);
    setOrder(next);
  }
  const weight = (id: string) => weights[id] ?? 1;
  const lastPane = panes.at(-1)?.id;
  useEffect(() => {
    if (lastPane) strip.current?.lastElementChild?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [lastPane]);
  function columnProps(id: string) {
    return {
      "data-column-id": id,
      "data-app-drop": drop?.id === id ? drop.after ? "after" : "before" : undefined,
      style: { order: ids.indexOf(id) * 2, flexGrow: weight(id) },
      onDragOver(event: React.DragEvent<HTMLElement>) {
        if (moving === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDrop(moving === id ? null : { id, after: dropAfter(event) });
      },
      onDragLeave(event: React.DragEvent<HTMLElement>) {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null);
      },
      onDrop(event: React.DragEvent<HTMLElement>) {
        if (moving === null) return;
        event.preventDefault(); event.stopPropagation();
        place(moving, id, dropAfter(event));
        finishMove();
      },
    };
  }
  function measure() {
    const widths = new Map(Array.from(strip.current!.querySelectorAll<HTMLElement>(":scope > .db-app-column"),
      node => [node.dataset.columnId!, node.getBoundingClientRect().width] as const));
    return ids.map(id => widths.get(id) ?? 0);
  }
  function resize(index: number, widths: number[], delta: number) {
    if (widths.length !== ids.length || widths.some(width => width <= 0)) return;
    const left = widths[index - 1]!, right = widths[index]!;
    const move = Math.max(320 - left, Math.min(right - 320, delta));
    const next = widths.slice();
    next[index - 1] = left + move; next[index] = right - move;
    const average = widths.reduce((a, b) => a + b, 0) / widths.length;
    setWeights(Object.fromEntries(ids.map((id, i) => [id, next[i]! / average])));
  }
  return <div ref={strip} className="db-app-workspace" data-split={panes.length > 0 || undefined} data-app-moving={moving !== null || undefined}>
    <div className="db-app-column" {...columnProps(appWorkspaceId)}>{children}</div>
    {panes.map((pane, i) => {
      const index = i + 1;
      const leftWeight = weight(ids[i]!);
      return <Fragment key={pane.id}>
        <SplitDivider style={{ order: index * 2 - 1 }}
          valueNow={Math.round(100 * leftWeight / (leftWeight + weight(ids[index]!)))}
          measure={measure} resize={(delta, widths) => resize(index, widths, delta)}
          reset={() => { const widths = measure(); resize(index, widths, (widths[index]! - widths[i]!) / 2); }}
          onDragging={dragging => {
            if (!strip.current) return;
            if (dragging) strip.current.dataset.resizing = "true"; else delete strip.current.dataset.resizing;
          }}/>
        <section className="db-app-column" aria-label={pane.label} {...columnProps(pane.id)}>
          <div className="db-app-heading"><span className="db-app-icon" aria-hidden="true">
            {pane.icon ? <NavigationIcon icon={pane.icon} className="db-icon"/> : <Icon name="AppWindow" className="db-icon"/>}
          </span><strong draggable tabIndex={0} title={t("moveAppPane")}
            onDragStart={event => {
              event.dataTransfer.setData("application/x-bbdesk-app-pane", pane.id);
              event.dataTransfer.effectAllowed = "move";
              setMoving(pane.id);
            }}
            onDragEnd={finishMove}
            onKeyDown={event => {
              if (!event.altKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
              event.preventDefault();
              const after = event.key === "ArrowRight";
              const neighbor = ids[ids.indexOf(pane.id) + (after ? 1 : -1)];
              if (neighbor !== undefined) place(pane.id, neighbor, after);
            }}>{pane.label}</strong>
            <SmallButton icon="Columns2" label={t("openBbSplit")} onClick={() => openInBB(pane.id)}/>
            <SmallButton icon="X" label={t("closeSplit", { name: pane.label })} onClick={() => close(pane.id)}/>
          </div>
          <iframe title={pane.label} data-bbdesk-app={pane.id} src="/plugins/dashboard/home"
            onLoad={event => fitEmbeddedPanel(event.currentTarget)}/>
        </section>
      </Fragment>;
    })}
  </div>;
}
