import type { DragEventHandler } from "react";
import type { NewThreadComposerProps } from "@get-bb/plugin-sdk/app";
import { ThreadTabs } from "../thread-tabs";
import { SplitWorkspace } from "../split-workspace";
import { RememberingNewThreadComposer as NewThreadComposer } from "../permission-composers";
import { sharedPoolComposer } from "../workspace-transitions";
import { ThreadIndicator } from "./thread-indicator";
import { Icon } from "./ui/icon";
import { SmallButton } from "./workspace-button";
import { ExpandedChat } from "./workspace-chat";
import type { SharedPoolWorkspaceView } from "../workspace-view-models";
import type { Translator } from "../i18n";

export interface SharedPoolWorkspaceActions {
  create(): void; closeCreate(): void; submit: NewThreadComposerProps["onSubmit"];
  activate(id: string): void; remove(id: string): void;
  toggle(projectId: string, id: string): void;
  add(projectId: string, threadId: string, target?: string, after?: boolean): void;
  move(threadId: string, targetId: string, after: boolean): void;
  resize(sizes: Record<string, number>): void;
}
export function SharedPoolWorkspace({ model, actions, drop, tr }: {
  model: SharedPoolWorkspaceView; actions: SharedPoolWorkspaceActions; tr: Translator;
  drop: { onDragOver: DragEventHandler; onDrop: DragEventHandler };
}) {
  return <section className="db-project db-project-workspace db-pool-workspace" id="db-shared-pool" aria-label={tr("sharedPool")}>
    <div className="db-thread-workspace" id="db-thread-workspace" {...drop}>
      {model.creating && <div className="db-create"><div className="db-chat-heading"><strong>{tr("newThreadTitle", { name: tr("sharedPool") })}</strong><SmallButton label={tr("closeCreate")} icon="X" onClick={actions.closeCreate}/></div><div className="db-new-composer"><NewThreadComposer key={sharedPoolComposer} defaultProjectId={model.createProjectId} draftKey="dashboard-new-shared-pool" placeholder={tr("promptPlaceholder")} layout="document" onSubmit={actions.submit}/></div></div>}
      {!model.creating && (model.ids.length > 0 ? <SplitWorkspace projectId="" crossProject ids={model.ids} activeId={model.activeId} sizes={model.sizes}
        onActivate={actions.activate}
        onAdd={(threadId, target, after, projectId) => { if (projectId) actions.add(projectId, threadId, target, after); }}
        onResize={actions.resize}
        renderPane={id => {
          const row = model.rows.get(id)!;
          return <div className="db-thread" key={id}>
            <div className="db-thread-line" data-tone={row.state?.tone ?? "unknown"}><button type="button" className="db-thread-open" title={row.heading} aria-expanded="true" aria-controls={`chat-${id}`} onClick={() => actions.activate(id)}>
              <ThreadIndicator tone={row.state?.tone ?? "unknown"}/><span className="db-thread-text"><span className="db-thread-project">{row.caption}</span><span className="db-thread-title">{row.title}{row.draft && tr("draftSuffix")}</span></span>{row.state && <span className={`db-state ${row.state.tone}`}>{row.state.text}</span>}
            </button><SmallButton label={tr("removeFromPool", { name: row.title })} icon="X" onClick={() => actions.remove(id)}/></div>
            {row.available ? <div className="db-chat" id={`chat-${id}`}><ExpandedChat threadId={id} fillSpace/></div> : <div className="db-project-empty">{tr("projectAccessHelp")}</div>}
          </div>;
        }}/> : <div className="db-project-empty">{tr("sharedPoolEmpty")}</div>)}
    </div>
    <ThreadTabs projectId="" preserveOrder poolRemoval onReorder={actions.move} threadsLabel={tr("sharedPoolThreads")} splitIds={model.ids} poolIds={model.ids} onTogglePool={(id, projectId) => actions.toggle(projectId, id)} onOpenBeside={actions.activate} activeId={model.selectedId} saving={model.saving} onHide={async () => false} onSelect={actions.activate} threads={model.tabs}
      leadingAction={<button type="button" className="db-thread-create db-icon-btn" title={tr("newThreadTitle", { name: tr("sharedPool") })} aria-label={tr("newThreadInPool")} onClick={actions.create}><Icon name="Plus" className="db-icon"/></button>}/>
  </section>;
}
