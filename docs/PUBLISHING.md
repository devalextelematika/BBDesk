# Publishing and verification

The repository root is the plugin directory containing package.json. Parent-workspace files, generated archives, dependencies, build output and machine-local reports are not part of the source repository.

## Repository and identity

- Repository: https://github.com/devalextelematika/BBDesk.
- Package name: bb-plugin-dashboard. Plugin ID: dashboard. Keep both stable to preserve routes and stored settings.
- License: MIT, copyright 2026 devalextelematika.
- THIRD_PARTY_NOTICES.md retains the MIT notices for BB (Michael Yong, 2026) and shadcn/ui (shadcn, 2023). The BB license was checked at desktop-v0.48.0, the registry version recorded in components.json. npm dependencies retain their own licenses.

## Language policy

The default interface language is English; Russian is the additional supported language. Interface language is a native BB plugin setting shared by clients of the same server. Missing preferences use English, including on existing installations. User content and native BB components are outside the translation catalogs.

The primary README, plugin description, overview, agent skill and release documentation are maintained in English. Russian text in the locale catalog, language option and test fixtures is intentional.

## Before publishing

Review the complete staged file list, including hidden files. Gitignore rules do not remove secrets from tracked files and are not a content scanner. Keep dependency lockfiles synchronized with package metadata.

In a clean source copy run:

```sh
npm ci --include=dev
npm run typecheck
npm test
npm run build
```

Also check a clean build with production dependencies installed using `npm ci --omit=dev --omit=optional --ignore-scripts`, matching BB's Git installation dependency policy. A build from an existing development node_modules directory does not establish this.

Verify the installed plugin separately: English by default; both language choices in native plugin settings; persistence after reload; updates in another connected client; no loss of the open chat, search or unsaved edits; and usable layouts in narrow panes. Source tests and a build are separate evidence from a live BB check.

Publication requires an explicit owner instruction. Local implementation does not authorize commits, pushes, tags, GitHub Releases or npm publication. For a future release, choose the next version, synchronize package.json and package-lock.json, and use a new semver tag. Never move a published tag.

## Version 0.1.5

Version **0.1.5** has matching package and lockfile versions. `CHANGELOG.md` describes the changes since 0.1.4. The English GitHub Release title is **BBDesk v0.1.5**; its body is [docs/releases/v0.1.5.md](releases/v0.1.5.md).

Before committing, include new source files and locale catalogs as well as changes to tracked files. Review `git status --short`, the staged diff and the checks on the exact revision to be published. Do not commit `node_modules`, `dist`, archives or local verification notes.

Once publication is explicitly authorized, commit the reviewed source to the existing repository and push the intended branch. If a tagged release is requested, create a new `v0.1.5` tag on the tested commit and publish release notes from the changelog. The default-branch installation command in the README does not require a tag. A version-pinned installation after the tag is published is:

```sh
bb plugin install git:https://github.com/devalextelematika/BBDesk.git@v0.1.5
```

Record the actual check results and any remaining live-UI checks in the release review. Keep detailed machine-specific logs under ignored `docs/local/` or outside the repository.

## CI scope

GitHub Actions installs development dependencies, type-checks the plugin and runs tests. It does not build with the BB CLI, install or reload the plugin, run live agents, upload archives or publish releases.

## Historical baseline

Before localization, the initial source preparation was checked on Windows with Node.js 24.22.1, npm 11.19.1 and BB 0.48.0. Type checking, 42 tests, a development build and a clean production-dependency build passed. The initial GitHub Actions run also passed. These are historical results, not verification of later local changes.

The original development README and older verification notes remain in ignored local files. Current verification results should distinguish local checks, live BB checks and checks run on the published revision.
