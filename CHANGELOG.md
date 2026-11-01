# Changelog

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
