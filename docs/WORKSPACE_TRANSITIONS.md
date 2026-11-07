# Workspace transitions

`workspace-transitions.ts` computes state from typed events. `use-workspace` owns dispatch and browser persistence; `use-workspace-actions` owns asynchronous SDK/RPC calls. Focus, catalog visibility and the history picker stay with their UI components.

Selection is one of: none, working conversation, historical conversation, project composer, or pool composer. A pool composer carries a separate conversation underlay so closing it can return to the existing project chat. Project composers cannot simultaneously select a working or historical conversation.

Split layouts, pool membership/layout, session memory and pending operations are independent of selection. Starting another composer replaces the current intent; each pool request also has its own operation identity. A successful result retains that intent for further completions from the same creation batch, even after the composer has closed. Explicit closure, navigation or cancellation invalidates it. A late request may still add its result to the pool while preserving newer navigation.

| Event | Result |
| --- | --- |
| project.select | Restore that project's saved split/conversation or entry fallback, close the pool, cancel creation intent |
| project.enter | Apply initial/fallback selection once for the project; preserve a composer targeting that project |
| project.retain | Record an implicit project before catalog reordering changes the fallback |
| conversation.open | Select a working/history conversation and update the active split column; leave the pool |
| conversation.toggle | Collapse/reopen a single working conversation and remove its single-column layout |
| selection.recover | Replace a disappeared conversation or completed subagent with its manager/entry fallback |
| create.start / create.close | Start a fresh intent or stop its composer; retain the pool composer's project underlay |
| spawn.project | Open a created thread before sidebar delivery only when its intent still matches |
| pool.request / pool.failed | Track/release an independent pool request; a failure keeps the native draft |
| spawn.pool | Use current pool capacity, preserve newer selection, and retain any unplaced result with an Open action |
| created.open | Open an unplaced result in its owning project, protected until sidebar delivery |
| pending.seen | Clear only the matching created-thread placeholder after sidebar delivery |
| pane.add / pane.remove | Add/focus a column or close it using its adjacent surviving column |
| pane.resize | Store adjacent widths without changing selection |
| layouts.reconcile | Remove unavailable columns while retaining a pending created thread |
| pool.show | Show the pool and close any composer without deleting its entries |
| pool.disable | Close the pool/composer without deleting entries or pending results |
| pool.pin / pool.remove | Add/remove membership, recording explicit unpinning for every in-flight request |
| pool.activate / pool.move / pool.resize | Change the pool's active column, order or widths independently of project layouts |
| pool.reconcile | Settle delivered pending entries, remove unavailable connected-project threads, retain disconnected-project pins |
| thread.hidden | On RPC success only, remove the slot and saved selection; replace a still-selected split column with its first survivor, or use chronological tab neighbors |
| memory.remember | Record a valid current project/conversation while preserving its previous conversation on collapse |
| notice | Update transient feedback without changing workspace selection |

## Ordering and race guards

Dispatch calculates from the latest state immediately, then commits that value to React. This keeps two pool completions in one React batch from consuming the same last slot. The reducer performs no SDK/RPC, storage or DOM work and does not mutate its input maps or sets.

Project-entry effects carry the project they observed; selection/memory effects carry their observed selection. An effect computed before newer navigation cannot restore the old project. Pending-created settlement likewise targets the observed entry, so it cannot clear another request's newer result.

Each composer start gets a new intent identity. Project completion is ignored after navigation, closure or disconnection has replaced that intent. A late pool completion still pins its result when possible, preserving the newer active column and navigation. If the pool fills or the thread was explicitly unpinned, the result remains available through its Open action.

Disabling the pool is a terminal composer cancellation: a pending result can still be pinned, but cannot reopen the disabled pool or reopen it when visibility is enabled again. Disconnecting the composing project restores an available project's selection and rejects late navigation from the old composer. These rules avoid retaining a hidden active composer after its view is unavailable.

Hide applies to the current workspace when the RPC completes. A background completion cannot switch a newly selected conversation or another project. A refused/failed hide sends no success transition and leaves selection and columns intact.

## Persistence

The existing `bb-dashboard:workspace-session:v1`, `bb-dashboard:split-layout:v1` and `bb-dashboard:shared-pool:v1` adapters and payload formats remain in use. Initial reads happen once per mount. Writes occur in effects for the relevant changed slice; remembering an unchanged selection returns the existing state. Pending request identities, transient notices and unplaced-result controls are not added to browser storage.

Source/unit and SDK harness tests verify transitions, late results, existing drafts, blocked storage and stable persistence. They do not replace installed-host acceptance.
