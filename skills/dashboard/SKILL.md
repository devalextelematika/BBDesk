---
name: dashboard
description: Use the BBDesk plugin's launcher and selected-project activity screen.
---

Open BBDesk through BB navigation. Add applications in launcher settings; the main button opens here, the split button opens alongside or in a new tab if BB cannot split. Project selection and launcher order belong to this plugin, not the BB sidebar. The stable plugin id remains `dashboard` and its page is `/plugins/dashboard/home`.

Connecting a project imports current work, queued work and pending interactions, not old completed answers. Subsequent results stay until manually hidden. Hiding never archives, deletes or stops a thread. Fresh activity returns hidden threads. Chat, drafts, attachments, execution and permissions are owned by BB.

Delegated subagents appear only as indicators in the header and their project tab, without thread rows or automatic chat expansion. Clicking an indicator can open the subagent chat. When its work completes, its indicators disappear and an open subagent chat returns to its manager, or closes if the manager is unavailable. Pending interactions, queued work and errors remain visible through indicators. Completed subagent results do not persist on the dashboard; their BB history is preserved. Independent forks retain ordinary thread behavior.

Project/launcher settings apply to this BB server and survive reload. Registered navigation screens are launchable; settings-only UI does not create a launcher destination. A removed plugin's shortcut remains disabled until removed or its destination returns.

The BBDesk navigation provider wraps BB's original rail and shares its live navigation model with the launcher. Automatic navigation selects it when no other third-party navigation provider takes precedence. If another provider is pinned, choose BBDesk under Settings → Appearance → Navigation to connect launcher destinations and native current/split actions. The thread-list provider, native navigation order and visibility settings are independent and remain in effect. Hidden navigation screens are still available to add to the launcher.

The center of the top bar shows one continuous line of thread indicators from all selected projects, without visible labels or project groups. Each indicator identifies its project, title and status through a tooltip and accessible label; click it to select that project and open that exact thread. Search and attention filters do not remove indicators. Order is stable across status changes, and indicators wrap when space is limited. Project tabs below repeat their own thread indicators beside the project name and remain available for navigation and new-thread creation. Their indicators use the same states and stable order as the top bar, with thread titles and statuses in tooltips.

The top-bar menu button hides/reveals the application panel. Drag its right edge to resize, or focus the separator and use Left/Right (Shift for larger steps), Home or End. Below 680px of dashboard width it overlays the workspace; click outside or press Escape to close. Open state and preferred width persist locally in each browser, separately from the shared project/launcher settings. Resizing the BB pane temporarily constrains the panel without changing its saved preferred width. Opening launcher settings in a narrow pane closes the drawer so the settings remain accessible.
