# BBDesk

Your BB projects, chats and applications in one workspace.

BBDesk combines an application launcher, project tabs and live activity indicators. Embedded chat and new-thread creation use BB's native components.

![BBDesk with four projects, application shortcuts, live thread indicators, an active conversation with two subagents, conversation history, and tabs showing working, action needed, queued, new reply, error and read states.](https://raw.githubusercontent.com/devalextelematika/BBDesk/main/docs/images/bbdesk-overview.png)

[What the preview shows](docs/SHOWCASE.md).

## Features

- Choose projects to follow and switch between them.
- Read and continue threads directly in the workspace.
- Open local file links from embedded chat in BB's native file preview on the conversation's host, including line locations.
- Return to the last conversation in each project, including history, after switching projects or reloading the same browser tab.
- Search all available non-archived project conversations by title or environment, including older conversations beyond the recent ten. Search keeps the current chat open until a result is selected; the attention filter applies to results.
- Browse recent conversations with two-line titles, dates and environments, or open the full project in BB. On narrow workspaces history overlays the chat; project tabs stay in a single scrolling row.
- A hidden tab stays in its slot, dimmed with an Undo icon, for 12 seconds. Click it to restore. The window pauses on hover, focus and saving; restoring does not switch the current conversation. Only the most recent hide offers Undo; the same behavior applies inside More.
- Start a thread with its project preselected in BB's native composer.
- Change permission mode before the next prompt in an existing thread. New threads start with the last mode successfully used in BBDesk, remembered in this browser; BB still enforces provider and machine limits.
- Open registered application screens here or alongside using BB's native split action.
- Collapse and resize the application panel; its layout is remembered in your browser.
- Follow delegated agents through activity indicators without retaining completed subagent rows.

Connecting a project imports current work, queued work and pending questions. Earlier completed replies are not imported. New results remain until hidden. Hiding never archives or deletes a thread; fresh activity brings it back.

Settings, search and history close on Escape and return keyboard focus to their opener. Arrow Down moves from the search input to its results. Search results are displayed in batches of 50; Show more reveals additional matches. Project-conversation memory belongs to the current browser-tab session and does not change shared project settings. Native drafts and existing reading-position handling remain owned by their existing mechanisms.

## Requirements

- BB `>=0.48` with Plugin SDK `>=0.6.94 <0.7.0`.
- For local development: Node.js 24.22.1 and npm 11 (the verified environment), with `bb` on PATH.
- Internet access to download dependencies and build tools on first installation.

The plugin uses experimental BB APIs. The declared compatibility range does not mean that every version in that range has been tested. No external services or API keys are required.

## Install from GitHub

```sh
bb plugin install https://github.com/devalextelematika/BBDesk
```

Review the source proposed by BB and confirm installation.

## Install from local source

Open a terminal in the plugin directory, next to `package.json`:

```sh
npm ci --include=dev
npm run typecheck
npm test
npm run build
bb plugin install .
```

BB must be running for installation. It builds local plugins again during installation. Keep the source directory in a permanent location after installing from a local path.

## Get started

Open **BBDesk** in BB navigation, choose projects and configure application shortcuts. The stable plugin ID is `dashboard`; the page is `/plugins/dashboard/home` on your BB server.

If the launcher asks you to enable its navigation provider, choose **BBDesk** under **Settings → Appearance → Navigation**. It preserves BB's original rail and supplies the registered screens and native actions. Settings-only plugins do not provide launchable screens.

Selected projects and application shortcuts are stored on the BB server and shared by its clients. The application panel's width and open state are stored separately in each browser.

## Interface language

Open BB's settings for installed plugins, select **BBDesk**, and change **Interface language**:

- **English** is the default for new and existing installations without a saved preference.
- **Русский** enables the Russian interface.

The choice is stored by BB and shared across clients of the same BB server. No automatic language detection is used. Switching language updates BBDesk labels without resetting the selected project, open chat, search or unsaved launcher edits.

Project names, thread content, user-defined shortcut names and other applications keep their original text. BB's native chat and composer manage their own labels. The language selector itself uses the stable labels English and Русский.

## Development

```sh
npm run typecheck
npm test
npm run build
```

Tests use Node's test runner, the SDK fake host and the SDK DOM harness. They check activity rules, language settings, translation coverage and UI behavior. These checks do not replace testing an installed plugin in BB. CI runs type checking and tests; building requires the BB CLI.

After local installation, `bb plugin dev` rebuilds and reloads the plugin when files change.

Key files:

- `server.ts`: RPC, native plugin settings and activity tracking.
- `state.ts`: thread inclusion and hiding rules.
- `app.tsx`: workspace, embedded chat and new-thread composer.
- `launcher-navigation.tsx`: bridge to BB navigation.
- `launcher-panel.tsx`: application panel layout and persistence.
- `i18n.ts`, `locales/`, `use-translation.ts`: translation catalogs and language selection.
- `styles.css`, `components/`, `assets/`: styling and resources.

Keep the package name `bb-plugin-dashboard`: the `dashboard` ID, routes and stored settings depend on it. Adding another language requires a translated catalog and an explicit setting option; there is no user-facing translation editor.

Dependencies, generated `dist/`, archives and local verification reports are excluded from Git. See [publishing notes](docs/PUBLISHING.md) for release checks and authorization boundaries.

See the [changelog](CHANGELOG.md) for release changes. Installing from the GitHub URL follows the repository's default branch. To install version 0.1.4 explicitly, use `bb plugin install git:https://github.com/devalextelematika/BBDesk.git@v0.1.4`.

## License

[MIT](LICENSE). Copyright (c) 2026 devalextelematika. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for vendored UI notices. Installed npm dependencies retain their own licenses.
