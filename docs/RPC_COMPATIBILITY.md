# RPC compatibility

BBDesk keeps the six existing RPC methods. The contract lives in `contracts.ts`; `server.ts` continues to export `rpcContract` and the `DashboardConfig` type. `catalog-config.ts` continues to export the catalog schema and types. Plugin identity, routes and storage keys are unchanged.

## Method inventory

| Method | Current package UI | Compatibility and behavior |
| --- | --- | --- |
| `snapshot` | Page refresh and realtime refresh | Returns last confirmed config/tracked, syncError and syncedAt. Reading it schedules background refresh when needed. |
| `projects_set` | No current UI caller | Replaces the enabled project list atomically. Input order is retained after deduplication. Other known projects remain disabled with their connection history. |
| `launcher_set` | No current UI caller | Replaces the whole application list atomically. Duplicate IDs retain first occurrence order and the last label. |
| `catalog_change` | Catalog membership/pool controls and project/application reordering | Changes one entry or the Shared Pool flag against the latest confirmed configuration. |
| `thread_hide` | Working conversation tabs | Changes dashboard tracking only. On success returns hidden:true and an undoToken; no native archive/delete/stop action is issued. |
| `thread_restore` | No current UI caller | Restores dashboard tracking using the current token and existing eligibility checks. It remains supported without reintroducing the old timed Undo tab. |

All methods have backend contract tests. The absence of a current UI caller does not establish that external clients do not use a method. The caller inventory covers this source tree; workspace-only instrumentation and historical verification copies do not prove which clients are currently installed. Remote scripts, other plugins and other clients cannot be exhaustively enumerated from the repository.

## Catalog operations

| Operation | Kinds | Current UI |
| --- | --- | --- |
| `add` | project, app | Membership checkboxes |
| `remove` | project, app | Membership checkboxes |
| `move` | project, app | Drag reordering in the project bar and application launcher |
| `restore` | project, app | Compatibility only |
| `rename` | app | Compatibility only |
| `pool` | Shared Pool flag | Projects tab checkbox |

Restore inserts before an available nextId, otherwise after an available previousId, otherwise at the end. Repeated add/restore of an existing entry keeps its position and label. Rename/restore remain small explicit compatibility paths and are not converted to full-list replacement.

## Preserved semantics

- Config mutations share project validation, transformation, schema validation, one durable config-v1 write, revision updates, publication and synchronization scheduling. Whole-list replacement is never implemented as separate add/remove RPCs.
- Project validation precedes catalog limit checks for newly connected projects. An unavailable project still reports DASHBOARD_PROJECT_UNAVAILABLE; stale catalog entries report DASHBOARD_CATALOG_STALE, and catalog capacity reports DASHBOARD_CATALOG_LIMIT.
- `projects_set` validates SDK project availability even for an empty list. An idempotent catalog add/restore of an already enabled project does not require that lookup.
- Existing connectedAt values and disabled project history survive. At most 100 projects can be enabled, while retained lifetime history can contain more than 100 projects.
- Whole-list input limits apply before deduplication. `launcher_set` preserves supplied label whitespace; catalog add/restore/rename trim labels through their existing schemas. Unknown input fields are stripped as before.
- Failed validation or persistence does not replace confirmed configuration, publish success or schedule a successful activity import. Subsequent operations remain usable.
- Up to 100 current thread undo tokens are kept in memory. Hiding again replaces that thread's token; successful restore consumes it. Eviction or plugin reload invalidates a token. Failed writes do not consume the token.
- Thread mutations and background reconciliation retain their distinct revision/cancellation rules. A confirmed manual hide/restore increments the thread revision; an activity observation does not masquerade as a new user action.

RPC input/output schemas and storage versions are unchanged. Removing methods or changing these forms requires a separate compatibility decision. Source tests and a build do not replace installed-host acceptance.
