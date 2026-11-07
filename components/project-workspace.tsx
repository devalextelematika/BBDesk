import type { Ref } from "react";
import type { NewThreadComposerProps } from "@get-bb/plugin-sdk/app";
import { ThreadTabs } from "../thread-tabs";
import { SplitWorkspace } from "../split-workspace";
import { startThreadDrag } from "../split-layout";
import { RememberingNewThreadComposer as NewThreadComposer } from "../permission-composers";
import { ConversationMetadata } from "../conversation-list";
import { ThreadIndicator } from "./thread-indicator";
import { Icon } from "./ui/icon";
import { SmallButton } from "./workspace-button";
import { ExpandedChat } from "./workspace-chat";
import type { ProjectWorkspaceView } from "../workspace-view-models";
import type { Translator } from "../i18n";

export interface ProjectWorkspaceActions {
  create(): void; closeCreate(): void; submit: NewThreadComposerProps["onSubmit"];
  open(id: string): void; activate(id: string): void; toggle(id: string): void; hide(id: string): Promise<boolean>;
  add(id: string, target?: string, after?: boolean): void; closePane(id: string): void;
  resize(sizes: Record<string, number>): void; togglePool(id: string): void; history(open: boolean): void;
}
export function ProjectWorkspace({ projectId, model, actions, historyRef, tr }: {
  projectId: string; model: ProjectWorkspaceView | null; actions: ProjectWorkspaceActions; historyRef: Ref<HTMLDivElement>; tr: Translator;
}) {
  if (!model) return <section key={projectId} id={`db-project-panel-${projectId}`} role="tabpanel" aria-labelledby={`db-project-tab-${projectId}`} hidden/>;
  return <section className="db-project db-project-workspace" data-single-chat={!model.history.open} data-history-open={model.history.open} key={projectId} id={`db-project-panel-${projectId}`} role="tabpanel" aria-labelledby={`db-project-tab-${projectId}`}>
    <div className="db-thread-workspace" id="db-thread-workspace" inert={model.compact && model.history.open && !model.dragging || undefined}>
      {model.creating && <div className="db-create"><div className="db-chat-heading"><strong>{tr("newThreadTitle", { name: model.project.name })}</strong><SmallButton label={tr("closeCreate")} icon="X" onClick={actions.closeCreate}/></div><div className="db-new-composer"><NewThreadComposer key={projectId} defaultProjectId={projectId} draftKey={`dashboard-new-${projectId}`} placeholder={tr("promptPlaceholder")} layout="document" onSubmit={actions.submit}/></div></div>}
      {model.openingId && <div className="db-chat"><div className="db-chat-heading"><span role="status">{tr("openingThread")}</span></div><ExpandedChat threadId={model.openingId} fillSpace/></div>}
      {model.showConversations && <SplitWorkspace
        projectId={projectId} ids={model.split.ids} activeId={model.split.activeId} sizes={model.split.sizes}
        onActivate={actions.activate} onAdd={actions.add} onResize={actions.resize}
        renderPane={(id, split) => {
          const displayed = model.split.panes.get(id)!;
          return <div className="db-thread" key={displayed.id}>
            <div className="db-thread-line"><button type="button" className="db-thread-open" title={displayed.heading} aria-expanded="true" aria-controls={`chat-${displayed.id}`} onClick={() => split ? actions.activate(id) : actions.toggle(id)}>
              <ThreadIndicator tone={displayed.state.tone}/><span className="db-thread-text"><span className="db-thread-title">{displayed.title}{displayed.draft && tr("draftSuffix")}</span></span><span className={`db-state ${displayed.state.tone}`}>{displayed.state.text}</span>{!split && <Icon name="ChevronUp" className="db-icon"/>}</button>{split && <SmallButton label={tr("closeSplit", { name: displayed.title })} icon="X" onClick={() => actions.closePane(id)}/>}
            </div>
            <div className="db-chat" id={`chat-${displayed.id}`}><ExpandedChat threadId={displayed.id} fillSpace/></div>
          </div>;
        }}/>}
      {model.empty && <div className="db-project-empty">{tr(model.emptyMessage)}</div>}
    </div>
    <ThreadTabs key={projectId} projectId={projectId} splitIds={model.split.paneIds} poolIds={model.poolIds} onTogglePool={actions.togglePool} onOpenBeside={actions.add} activeId={model.selectedId} saving={model.saving} onHide={actions.hide} threads={model.tabs}
      leadingAction={<button type="button" className="db-thread-create db-icon-btn" disabled={!model.project.available}
        title={tr("newThreadTitle", { name: model.project.name })} aria-label={tr("newThreadInProject", { name: model.project.name })}
        onClick={actions.create}><Icon name="Plus" className="db-icon"/></button>}
      onSelect={actions.open}>
      <div className="db-history-bar"><button type="button" className="db-history-toggle" title={tr(model.history.open ? "hideRecentThreads" : "showRecentThreads")} aria-label={tr(model.history.open ? "hideRecentThreads" : "showRecentThreads")} aria-expanded={model.history.open} aria-controls={`db-history-${projectId}`} onClick={() => actions.history(!model.history.open)}>{tr(model.history.open ? "hideRecentThreads" : "showRecentThreads")}<Icon name={model.history.open ? "ChevronDown" : "ChevronUp"} className="db-icon"/></button></div>
    </ThreadTabs>
    {model.history.open && model.compact && <div className="db-history-backdrop" style={{ pointerEvents: model.dragging ? "none" : undefined }} aria-hidden="true" onClick={() => actions.history(false)}/>}
    {model.history.open && <div ref={historyRef} className="db-history" id={`db-history-${projectId}`} role="region" aria-label={tr("recentThreads")}>
      <div className="db-picker-heading"><span>{tr("recentThreads")}</span><SmallButton label={tr("closeHistory")} icon="X" onClick={() => actions.history(false)}/></div>
      {model.history.rows.length === 0 ? <div className="db-project-empty">{tr("noRecentThreads")}</div> : model.history.rows.map(t => <div className="db-history-entry" key={t.id}><button type="button" draggable onDragStart={event => startThreadDrag(event, projectId, t.id)} className="db-history-thread" aria-label={t.title} aria-pressed={model.history.selectedId === t.id} aria-controls="db-thread-workspace" title={t.title} onClick={() => actions.open(t.id)}><span className="db-thread-title">{t.title}</span><ConversationMetadata item={t.metadata}/></button><SmallButton label={tr(t.pinned ? "removeFromPool" : "addToPool", { name: t.title })} icon="Pin" pressed={t.pinned} onClick={() => actions.togglePool(t.id)}/><SmallButton label={tr("openAlongside", { name: t.title })} icon="Columns2" onClick={() => actions.add(t.id)}/></div>)}
      {model.project.available && <a className="db-all-conversations" href={model.project.href}>{tr("allProjectThreads")}</a>}
    </div>}
  </section>;
}
