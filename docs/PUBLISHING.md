# Publishing and verification

The repository root is the plugin directory containing package.json. Parent-workspace files, generated archives, dependencies, build output and machine-local reports are not part of the source repository.

## Repository and identity

- Repository: https://github.com/devalextelematika/BBDesk.
- Package name: bb-plugin-dashboard. Plugin ID: dashboard. Keep both stable to preserve routes and stored settings.
- License: MIT, copyright 2026 devalextelematika.
- THIRD_PARTY_NOTICES.md retains the MIT notices for BB (Michael Yong, 2026) and shadcn/ui (shadcn, 2023). The BB license was checked at desktop-v0.48.0, the original vendored component registry version. The unused component generator configuration has been removed; these notices remain. npm dependencies retain their own licenses.

## Language policy

The default interface language is English; Russian is the additional supported language. Interface language is a native BB plugin setting shared by clients of the same server. Missing preferences use English, including on existing installations. User content and native BB components are outside the translation catalogs.

The primary README, plugin description, overview, agent skill and release documentation are maintained in English. Russian text in the locale catalog, language option and test fixtures is intentional.

## Clean source verification

Review the complete intended file list, including hidden files and new untracked modules. `git ls-files -z --cached --others --exclude-standard` enumerates tracked and nonignored untracked candidates; omit paths deleted from the worktree and inspect every remaining candidate before copying. Gitignore rules do not remove secrets from tracked files and are not a content scanner. Keep dependency lockfiles synchronized with package metadata.

Create two separate directories outside the plugin root from that reviewed file list, preserving relative paths and current file bytes. Do not copy the parent workspace, existing `node_modules`, `dist`, runtime databases, credentials, archives, local reports or staging directories. Do not use `git archive HEAD` to verify uncommitted work: it omits modified bytes and new untracked modules. Record source hashes so both copies can be tied to the reviewed worktree. Check the intended commit again before a later publication.

In the development copy run:

```sh
npm ci --include=dev
npm run typecheck
npm test
npm run build
```

The portable test runner discovers root tests and `tests/` recursively, preloads the TS/TSX loader and runs files sequentially with Node's default process isolation. A group can be run with `npm test -- tests/ui/creation.test.mjs`. The full suite remains the release source check; a selected group is only focused evidence. See the README for test ownership and cleanup rules.

In the independent production copy, starting without `node_modules` or `dist`, run:

```sh
npm ci --omit=dev --omit=optional --ignore-scripts
npm run build
```

This checks the dependency omission policy used by BB Git installs; BB itself installs dependencies and builds through its own toolchain without package lifecycle scripts. A development build or a production install over an existing development tree does not establish this check. Zod and `@get-bb/plugin-sdk` are the production dependencies. The SDK is there because `contracts.ts` imports `defineRpcContract` from the SDK root and the server build bundles it from the plugin's own install, while Git installs omit devDependencies; `bb plugin types --check` enforces this. React and harness/tooling dependencies belong to development; do not promote test peers into production to make this check pass.

Record Node, npm, BB CLI and SDK versions independently. Two SDK versions matter:

- The exact `@get-bb/plugin-sdk` pin selects the build-time declarations and the bundled server helper. `bb plugin types` repins it to the running BB; it does not restrict which BB can install the plugin.
- `engines.bbPluginSdk` (`>=0.6.94 <0.7.0`) is what BB enforces for other users: managed installs refuse a host SDK outside the range and path installs load as incompatible. Keep its floor at the oldest SDK that is verified, not at the current pin, so a newer pin never blocks users on older BB.

`npm run test:sdk-floor` installs the floor SDK from `engines.bbPluginSdk` without saving, runs the typecheck and the full suite against it, and then restores the pinned SDK from the lockfile. Run it, together with `npm test` on the current pin, after every SDK repin and before raising the floor. Raise the floor only when the plugin starts using an API that the old SDK lacks, and record that in the changelog. A build with one CLI/SDK pair does not establish compatibility with every version allowed by `engines`; harness tests cover source compatibility, not a real older BB host.

Inspect the resulting source and `dist` file manifests, artifact metadata and bundle content. Source and distribution must contain no runtime data, credentials, archives or machine-local verification materials. Keep detailed logs outside the repository or under ignored `docs/local/`.

## Build, packaging and local delivery

The build scripts are `prebuild` (UTF-8/localization source check), `build` (`bb plugin build`), and `prepack` (`npm run build`). `npm run build` produces `dist`; it does not create or upload a ZIP. Calling `bb plugin build` directly skips npm's prebuild hook, so run `node scripts/check-ui.mjs` explicitly for that path.

The supported source paths are the local-directory and Git installations shown in the README. Both build the plugin; local installation uses the chosen source directory and is a separate host-changing action. This verification does not install or reload anything.

This repository contains no ZIP or upload command: packaging for a particular BB project depends on that project's context, so it lives outside the plugin. The maintainer's workspace keeps it as `tools/share-zip.ps1` next to this checkout, with the delivery rules in that workspace's `AGENTS.md`. It builds the plugin, packages git-tracked and non-ignored files without tests, documentation and CI, adds `dist` and an installation README, uploads the archive as a project attachment, and verifies the bytes through the BB CLI and the printed HTTP link. Do not invent a download URL or report a delivery that did not occur. A localhost link works on the BB computer; the ZIP itself can be sent to others.

`prepack` alone is not an audited npm distribution configuration. npm publication is not the delivery path verified here. Before selecting it, review the actual `npm pack` file list and ensure the required bundles, metadata, assets and skills are included while local materials are excluded. No npm package or ZIP is published as part of source verification.

## Installed-host acceptance

Verify the installed plugin separately: English by default; both language choices in native plugin settings; persistence after reload; updates in another connected client; chat drafts, selection, reading position, file links and permissions; Catalog; split/pool layouts; hide success/failure; disconnection/reconnect; and delayed creation without navigation takeover. Test a full pool on isolated data without changing working pins. Use a fixture for artificial SDK delays rather than adding fault injection to the shipped runtime.

The SDK DOM harness verifies component behavior and mounted node identity, not BB's full native composer, routing, crash boundaries or a real mobile keyboard. Record unavailable devices and unrun scenarios as NOT RUN. Source tests and clean builds remain separate evidence from installed-host acceptance.

## Release identity and authorization

The package and lockfile identify **0.1.12**, a patch update from **0.1.11**. Release notes are in [releases/v0.1.12.md](releases/v0.1.12.md). Before publishing, recheck remote state and confirm that the intended tag is unused. Do not recreate or move an existing tag.

Publication requires an explicit owner instruction. Source verification alone does not authorize commits, pushes, tags, GitHub Releases, archive uploads or npm publication. At the authorized publication step, review the final source, commit it and use a new, unused version tag on that tested commit.

Before committing, include new source files and locale catalogs as well as changes to tracked files. Review `git status --short`, the staged diff and checks on the exact revision to be published. Do not commit `node_modules`, `dist`, archives or local verification notes. Installing from the default GitHub URL follows the published default branch. The historical pinned command remains:

```sh
bb plugin install git:https://github.com/devalextelematika/BBDesk.git@v0.1.6
```

Record actual source, clean-build, installed-host and published-revision results separately in the release review.

## CI scope

GitHub Actions installs development dependencies, type-checks the plugin and runs tests. It does not build with the BB CLI, install or reload the plugin, run live agents, upload archives or publish releases.

## Historical baseline

Before localization, the initial source preparation was checked on Windows with Node.js 24.22.1, npm 11.19.1 and BB 0.48.0. Type checking, 42 tests, a development build and a clean production-dependency build passed. The initial GitHub Actions run also passed. These are historical results, not verification of later local changes.

The original development README and older verification notes remain in ignored local files. Current verification results should distinguish local checks, live BB checks and checks run on the published revision.
