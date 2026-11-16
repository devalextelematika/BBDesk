# Changelog

## 0.1.8 — 2026-11-16

- Sort projects and applications alphabetically by their displayed names in Catalog settings. Sorting follows the interface language and ignores letter case, including when searching.
- Preserve the saved order of connected projects and application shortcuts in their workspace panels.
- Keep a green completion check and completion time on the selected conversation until leaving it. Background results remain green until selected and left, including in split layouts and Shared pool. A new run replaces the check with work status.

A patch update from 0.1.7. See [release notes](docs/releases/v0.1.8.md) for verification results and limits.

## 0.1.7 — 2026-11-07

- Replace separate setup forms with a searchable Catalog containing Projects and Applications tabs. Checkbox changes apply immediately and keep Catalog, the current project and native chat mounted. Connected entries are green; Common threads and Shared pool have separate checkboxes.
- Use one small settings button in the top toolbar. Reorder projects and applications in their panels; remove duplicate selected lists, navigation, label editing and Undo controls from Catalog.
- Remove the five-second Undo placeholder when hiding a conversation; tabs close immediately after a successful hide, including in More. Preserve the current conversation when a background hide completes, and retain a tab if hiding fails.
- Enforce the 50-conversation Shared pool limit before creation, preserve a blocked draft, and offer Open for results that cannot be placed after a race. Late results respect newer navigation, explicit unpinning and composer cancellation after disabling the pool or disconnecting a project.
- Return confirmed activity snapshots promptly and refresh in the background, with coalescing, retries and cancellation/revision guards. Saved configuration remains confirmed if a later activity import fails; only a complete successful pass advances the full-sync timestamp and clears its error.
- Separate configuration transformations, snapshot refresh, workspace selectors/transitions, asynchronous actions and project/pool views. Retain existing RPC schemas, compatibility operations and storage formats.
- Remove unused UI dependencies and vendored components. Keep Zod as the only production dependency and make development/test dependencies explicit. Split tests into independent backend, UI and unit groups with shared cleanup helpers and a portable runner.
- Fit mobile chat to the visible viewport while the software keyboard is open. Temporarily hide dashboard navigation and bottom thread tabs during typing, then restore them without remounting the native chat.

A patch update from 0.1.6. Source/harness and clean-build verification are separate from installed-host and mobile-device acceptance. See [release notes](docs/releases/v0.1.7.md) for verification results and limits.

## 0.1.6 — 2026-11-02

- Pin conversations from connected projects into a Shared pool with native chats side by side. Add them by drag-and-drop or pin controls in tabs, More and history without leaving the current project.
- Reorder pool tabs and columns, resize columns and remember membership, order, open view, active column and widths locally in each browser. Removing a pool column only unpins its thread.
- Create a new conversation from the pool and pin it automatically.
- Toggle Shared pool visibility in project settings without clearing saved pool conversations. The visibility preference is shared across clients.
- Connect personal conversations outside projects through Common threads, with a separate settings checkbox and navigation tab.
- Keep project navigation and the selected chat stable when a background hide request completes after navigation.
- Apply the 100-project selection limit to enabled projects while retaining disconnected project history.
- Let wrapped project tabs use the full width below the first row while keeping Common threads, Shared pool and settings at the upper right. Preserve the single scrolling row in narrow workspaces.

Existing project, launcher and language settings are preserved. See the release notes for verification results and limits.

## 0.1.5 — 2026-11-01

- Open multiple native conversations side by side by dragging a bottom tab, overflow entry or history conversation into the workspace. Alt+Enter on a tab and Open alongside in history offer keyboard alternatives.
- Resize adjacent chat columns with the pointer or arrow keys; double-click a divider to equalize their widths. Remember the layout, active column and widths locally per project. Columns scroll horizontally when the 320px minimum width requires it.
- Select an active column and replace only its conversation when switching tabs, or focus a conversation already open alongside. Closing a column leaves its thread available without hiding, archiving or stopping it.
- Reorder selected projects in settings with drag handles, keyboard controls or up/down buttons. Save the order across clients and reloads while preserving project connection history; Cancel discards draft changes.
- Show one provider icon per distinct agent provider on each project tab, with provider and conversation details in tooltips.
- Sort bottom conversation tabs by creation time, newest first, while preserving chronological neighbors and Undo placement.
- Simplify conversation headings by moving environment details into the tooltip.

Existing project, launcher and language settings are preserved. Split layouts are browser-local; project order is shared by clients of the same BB server. See the release notes for installation and verification details.

## 0.1.4 — 2026-10-30

- Add English and Russian interface languages through BB's native plugin settings. English is the default.
- Search project conversation history beyond the recent list, with incremental result display.
- Remember the selected conversation for each project within the current browser-tab session.
- Switch conversations using bottom tabs, with overflow controls and a timed Undo action after hiding a tab.
- Remember the last successfully submitted permission mode for new threads in the same browser. BB continues to enforce provider and machine restrictions.
- Improve keyboard focus, narrow-pane history, launcher behavior and reading-position restoration.
- Open local file links from embedded chat in BB's native file preview on the conversation's host, preserving line locations.

The plugin ID remains `dashboard`; existing project and application settings are preserved. This version uses experimental BB APIs; see the README for compatibility and verification limits.

## 0.1.3

Initial GitHub source baseline with the BBDesk workspace, project activity tracking, embedded native chat, configurable application launcher, MIT license and source-check CI.
