# AGENTS.md

Guidance for AI agents working on this repository. Read this before making changes.

> **v0.3.0 work is a dependency graph, not an iteration list.** Start at [`plan/v0.3.0/README.md`](plan/v0.3.0/README.md); run `make v030-status` to see which nodes are ready, and execute exactly one node per pass. The architectural contract is [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — read it before any v0.3.0 node. [`ITERATIONS.md`](ITERATIONS.md) is frozen v0.2.0 history. New to the graph model? [`plan/v0.3.0/HOW-IT-WORKS.md`](plan/v0.3.0/HOW-IT-WORKS.md) explains it.

## Product

CornerTasks is a small floating task widget. The first interface is a macOS app: a vertical strip pinned to the right edge of the screen, always above other windows, that the user hides manually. Quick add, double-click to edit, tick to archive, optional due date with color coding.

**Shipped in v0.2.x** (current release):

- A **web app** (mobile-first) hosted on S3 + CloudFront, with the same feature set.
- An **AWS serverless backend** (TypeScript SAM) that stores tasks in DynamoDB.
- **Cloud sync is opt-in.** The released app is fully standalone by default and makes zero network calls. Users who want sync deploy their own copy of `backend/aws/` to **their** AWS account. The maintainer does not host a shared backend.
- **Decentralized identity**: each account is a `did:key` derived from an Ed25519 keypair the user holds. Two devices with the same mnemonic share the same DID and the same account.
- **End-to-end encryption**: task fields are encrypted on-device with an AES-256-GCM key derived from the same BIP-39 mnemonic. The backend stores ciphertext only — neither the maintainer nor the AWS account owner can decrypt user data.
- **Sync** with conflict resolution by event timestamp; archived items older than 2 months are not synced.

**v0.3.0 (in progress)** makes the backend a **choice rather than a dependency**. The same server core (`backend/core/`) runs either as AWS Lambda or as a Docker container the user hosts themselves — including on their own laptop, with an outbound tunnel so their phone can reach it — so task data can be kept off third-party infrastructure entirely. Clients sync over **WebSocket**, with the v0.2.0 REST polling retained as a fully-supported fallback on both backends, and both apps gain a **connection-status indicator**. Identity (`did:key` from a BIP-39 mnemonic), AES-256-GCM encryption, LWW conflict resolution and the 60-day archive cutoff are **unchanged**, so the sections below stay accurate. Full picture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

> An earlier v0.3.0 plan (July 2026) rebuilt CornerTasks as a First Person Project example — `did:webvh`, DIDComm v2.1, a blind mediator, a personal VTA on a Raspberry Pi. **It was abandoned on 2026-08-15 and none of it is in scope.** Ignore any reference to it you find in older commits.

## Core principles

This project is intentionally small. Resist over-engineering — but v0.2.0 grows beyond a single file, so we now keep things organized:

- Split code by responsibility (storage, sync, crypto, UI). Don't introduce design patterns unless they clearly pay for themselves.
- Add unit tests for non-UI logic: crypto, sync queue, conflict resolution, encoding/decoding, mnemonic flow.
- Prefer the platform's standard library and a minimal set of dependencies. For crypto in Swift use Apple's `CryptoKit`; in TypeScript prefer the standard `crypto` module / `@aws-sdk/*`.
- For the **web** app, the native browser solution is the default — but when a native primitive proves unreliable across the browsers we target (Chrome, Safari desktop, Safari iOS, Firefox), reaching for a small, focused external library is acceptable. Document the reason in the PR. Example: `<input type="date">` was replaced with `react-day-picker` because iOS Safari's native sheet has a broken Reset button and no programmatic-clear path, and no amount of overlay/`showPicker()` shimming worked reliably across all four browsers.
- `UserDefaults` (macOS) and `localStorage`/IndexedDB (web) are fine for preferences. Don't introduce a settings framework.
- No reactive frameworks beyond what each platform provides natively (SwiftUI, React or vanilla web — TBD in iteration 6).

If a change feels like it needs a new abstraction layer, push back: most additions can be a few lines in the existing types.

## Repository layout (target for v0.2.0)

```
.
├── AGENTS.md                     — this file
├── README.md                     — user-facing docs (keep features in sync)
├── ITERATIONS.md                 — ordered v0.2.0 work plan
├── LICENSE
│
├── apps/
│   ├── macos/                    — Swift macOS app (was the repo root in v0.1.0)
│   │   ├── Package.swift
│   │   ├── AppBundle/Info.plist
│   │   ├── build.sh
│   │   ├── icon.png
│   │   ├── Sources/CornerTasks/
│   │   │   ├── App/              — AppDelegate, panel, status item
│   │   │   ├── Storage/          — SQLite TaskStore, schema, migrations
│   │   │   ├── Sync/             — outbound queue, poller, sync client
│   │   │   ├── Crypto/           — mnemonic, key derivation, encrypt/decrypt
│   │   │   ├── Models/           — TaskItem, DueStatus, SyncEvent
│   │   │   └── UI/               — ContentView and row views
│   │   └── Tests/CornerTasksTests/
│   │
│   └── web/                      — mobile-first web app
│       ├── package.json
│       ├── src/
│       │   ├── storage/          — IndexedDB-backed task store
│       │   ├── sync/             — same queue/poller contract as macOS
│       │   ├── crypto/           — same BIP-39 + AES-GCM scheme
│       │   ├── models/
│       │   └── ui/
│       └── tests/
│
├── backend/                      — v0.3.0: core + two runtimes (see below)
│   ├── core/                     — runtime-neutral: handlers, auth, JWT, Store, tests
│   ├── aws/                      — Lambda entries, DynamoDB store, SSM keys, template.yaml
│   ├── server/                   — standalone node:http + WebSocket server
│   └── docker/                   — Dockerfile, compose.yml, ngrok profile
│
└── docs/                         — protocol / encryption / sync notes (added as needed)
```

In v0.1.0 the macOS app lives at the repo root. Iteration 1 in [`ITERATIONS.md`](ITERATIONS.md) moves it under `apps/macos/`.

**v0.3.0 layout changes** (land node by node): `backend/` splits into `core/` (runtime-neutral handlers, auth, JWT, `Store` interface, tests), `aws/` (Lambda entry points, DynamoDB store, SSM keys, `template.yaml`), `server/` (standalone Node HTTP + WebSocket server) and `docker/` (Dockerfile, compose, ngrok profile). `plan/v0.3.0/` holds the build graph. `backend/aws/` is **not** archived — AWS stays a supported deployment.

## Design schema (SSOT for UI structure)

`design/` holds the **declarative, platform-agnostic description of every screen** in CornerTasks: tokens, components, screens, and per-platform overlays — all pure JSON. See [`design/README.md`](design/README.md) for the deep dive; what follows is what an agent needs to *act* on it.

### What it is the source of truth for

- **Structure** — which nodes a screen contains, in what order, with what props, on each platform.
- **Vocabulary** — the only colors, spacings, fonts, etc. that may be referenced (`tokens/`).
- **Component catalog** — the only component names a screen may use (`components/`).
- **Strings** — every user-facing string (`text/en.json`). Screens reference keys, never literals.
- **Platform divergence** — every difference between platforms must exist as an overlay op with a `reason` field. If macOS shows something web doesn't, there's an overlay file documenting why.

### What it is NOT the source of truth for

- **Behavior** — `action: "cloud.ping"` names the handler; the implementation is in code.
- **Data shape** — `valueBinding: "account.did"` is a hint; the model lives in Swift/TS.
- **Visual taste** — token *roles* are declared here, but whether `spacing.6` is the right value is a design call.
- **Per-row dynamic content** — task/archive row internals are still in app code.
- **Pixel-perfect rendering** — the previewer approximates hierarchy/spacing, not the real apps.

### Icon registry

`design/icons.json` is the single source of truth for every glyph. Each name maps to its `sfSymbol` (macOS) and one or more inline SVG `paths` (web + previewer). Add or rename an icon by editing this file *first*; the `Icon` component's `name` enum is checked against the registry keys. Don't redefine glyphs independently in `apps/macos` or `apps/web` — read from the registry.

### Hard rules — enforced by `make design-validate`

1. **Never put literal colors, spacings, or font sizes in a screen.** Use token refs like `"{color.surface}"` or `"{spacing.6}"`.
2. **Never put literal user-facing strings in a screen or component.** Add a key to `design/text/en.json` and reference it.
3. **Never use a component that isn't in `design/components/`.** Add the component definition first.
4. **Every node needs a stable, unique, dot-namespaced `id`** (e.g. `settings.account.did.label`). Ids are how overlays target nodes — renaming an id is a breaking change.
5. **Every platform difference is an overlay op.** Don't model a divergence by writing different code on each platform without an overlay; the validator's parity report is supposed to be the complete list of divergences.
6. **Every `action:` and `valueBinding`/`openBinding`/`dataBinding` must be registered in `design/actions.json`,** and every platform that the merged tree depends on must list it in `design/platforms/<name>/bindings.json`. This is what catches "we added a button in the schema but forgot to wire it in code" and "we deleted a screen but left an orphan handler."
7. **Every enum value on a state-driven visual prop must have a token mapping.** E.g. each `TaskRow.dueState` value (other than `none`) must have a `color.due.<value>` token. Adding a state without the matching token fails validation.
8. **No literal colors, dimensions, or px sizes inside `.dac-*` CSS in `design/tools/preview/generate.mjs`.** The previewer must consume tokens via `var(--…)`. Hex / `rgba()` / `\d+px` inside a `.dac-*` selector blocks the validator. Preview chrome (header / frame / inspector) is exempt — those styles are not part of the design system.
9. **Run `make design-validate` after every change.** It must exit 0. The validator is also wired into `scripts/test-all.sh` (scope: `design`), the pre-commit hook (triggers on any `design/*` change), and CI (`.github/workflows/ci-design.yml`) — but don't wait for those, run it locally as you work.

### Workflow for UI changes

When a task touches anything visible (a new row, a new screen, a per-platform difference, a string change, a color tweak):

1. **Edit JSON first.** Add the text key, add the node, write the overlay — whatever the change requires — under `design/`.
2. **`make design-validate`** — fix until green. The parity report tells you exactly what changed per platform.
3. **`make design-preview`** — open `design/preview/index.html`, click through the affected screens for both platforms, confirm the structure is right.
4. **Then implement in app code** (SwiftUI under `apps/macos/`, React under `apps/web/`). Both apps must end up matching the merged tree.
5. **Commit the JSON change in the same PR as the implementation.** Don't merge schema-only or code-only halves of a UI change.

### Adding a new screen

1. Create `design/screens/<screen-id>.json` (see existing files for shape).
2. Add a `titleKey` and any new text keys to `design/text/en.json`.
3. If a platform diverges, add `design/platforms/<platform>/overlays/<screen-id>.json`.
4. Validate, preview, implement.

### Adding a new action or binding

1. Register it in [`design/actions.json`](design/actions.json) — `actions.<id>` for fire-and-forget handlers, `bindings.<id>` for reactive values (give a `type` and `description`).
2. Reference it from a screen as `action: "<id>"` (Button), `valueBinding: "<id>"` (TextField, Toggle, …), `openBinding: "<id>"` (Disclosure, Sheet), or `dataBinding: "<id>"` (Repeat).
3. For every platform that the merged tree uses it on, add the id to that platform's `design/platforms/<name>/bindings.json` `implements.actions` or `implements.bindings`.
4. Implement the handler / state in that platform's app code.
5. `make design-validate` must end with `missing=0` for every platform.

### Adding a new dynamic list / row variant

The schema models lists with the `Repeat` component, which takes a `dataBinding` (a list-typed binding registered in `actions.json`) and contains exactly one child — the row template. Row components (`TaskRow`, `ArchiveRow`, …) declare every visual state as a prop, and their values are item-binding refs like `"{item.title}"` that resolve at render time.

For preview-time content, add sample rows to a fixture in [`design/fixtures/`](design/fixtures/) — `sample.json` (populated) and `empty.json` (empty-state) are the canonical pair. **When you add a new visual state to a row, extend the sample fixture to include an item that exercises it** — otherwise the previewer won't show what it looks like.

### Adding a per-platform difference

Pick the smallest overlay op that expresses the divergence:

| op         | use it when                                    |
|------------|------------------------------------------------|
| `hide`     | a node should not render on this platform      |
| `insert`   | this platform adds a node base doesn't have    |
| `override` | same node, slightly different props            |

Always include a `reason` field in the overlay file explaining *why* this platform diverges (capability, privacy, native idiom). Future agents read it to judge whether the divergence is still load-bearing.

### Adding a new component

1. Create `design/components/<Name>.json`. Follow an existing file (e.g. `Toggle.json`) for the prop-type vocabulary (`string|number|boolean|enum|token|textKey|array`).
2. Declare every prop the component accepts — unknown props on instances fail validation.
3. Specify `children: "none"` or `"many"`.
4. Provide `a11y.role` (and `labelFrom` if it has a textual label).
5. Implement the component in each platform's app code, mapping the prop names exactly.

### Adding a new platform

The full walkthrough is in [`design/README.md`](design/README.md) ("Adding a new platform"). Summary: create `design/platforms/<name>/platform.json` with honest `capabilities`, add overlays only for the screens that diverge from base, run validate + preview, then wire app code to read the merged tree.

### When you are reasoning about a UI question

Read the merged tree, not the source files. The validator's `applyOverlay` in [`design/tools/validate/validate.mjs`](design/tools/validate/validate.mjs) is the reference merge implementation — same function the previewer uses. Anything you conclude from reading SwiftUI/React directly might be wrong; the schema is the contract.

When the schema and the implementation disagree, **the schema wins** — fix the code, not the schema. (Unless the schema is itself wrong, in which case fix the schema first, then the code.)

## Storage (macOS)

- SQLite at `~/Library/Application Support/CornerTasks/tasks.sqlite3`.
- Schema lives in `TaskStore.createSchema()`. Add columns via `ALTER TABLE` guarded by `columnExists(...)`. Don't introduce a migration framework.
- A legacy `tasks.json` is migrated once on launch then renamed to `tasks.json.migrated`.
- v0.2.0 adds an outbound `sync_queue` table and an `updated_at` / `deleted_at` column on tasks (see iteration 4).

## Cloud sync — opt-in only

> **v0.3.0 note:** the three sections below (“Cloud sync”, “Sync model”, “Identity & encryption”) describe the **v0.2.0 stack still on `main`**, and all of it stays true in v0.3.0. What v0.3.0 adds is a **WebSocket transport** (with the REST polling described below retained as a fully-supported fallback) and a **choice of backend** — the same core deployed either as AWS Lambda or as a Docker container the user runs themselves. Identity, encryption, conflict resolution and the archive cutoff are unchanged. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the contract, [`plan/v0.3.0/`](plan/v0.3.0/README.md) for the build graph, and [`docs/connection-status.md`](docs/connection-status.md) for the connection-status vocabulary. Update these sections in the same PR as the node that changes the behavior.

- **Connection status is a contract, not a UI detail.** [`docs/connection-status.md`](docs/connection-status.md) defines the seven states (`disabled`, `checking`, `live`, `polling`, `syncing`, `queued`, `failed`), the exact function that resolves them, their precedence, the `color.conn.<state>` tokens, the English phrases down to the byte, and the 500 ms minimum dwell. Both apps implement it independently, so **treat it as normative the way `docs/sync-protocol.md` is normative**: if you change what the sync engine or the WebSocket client does with timers, backoff, tokens, or reachability, check whether it changes a state condition and update that document in the same PR.

- **Default state: cloud sync is OFF.** The app stores everything locally and makes no network calls. This is the released-binary default and the contract with users.
- The user enables cloud sync from Settings. Enabling requires (a) generating or importing a key, and (b) entering the `ApiUrl` of a backend they have deployed to **their own** AWS account.
- The released DMG MUST NOT contain a hard-coded `backendURL`. Verified at release time (iteration 14) and as part of E2E (iteration 13).
- Disabling cloud sync stops all timers; local data is untouched.

## Sync model (v0.2.0)

- **Push:** every local mutation appends an event to a local queue. Every 10 minutes (and on app start), undelivered events are batched, encrypted, and POSTed to the backend. Only runs while cloud sync is enabled.
- **Pull:** every 1 minute the app calls `pull?cursor=<opaque>` and merges any remote events. The cursor is server-assigned (per-account monotonic `seq`); clients persist whatever `nextCursor` the server returns and round-trip it next time. The bootstrap cursor is `"0"`. Only runs while cloud sync is enabled. See `docs/sync-protocol.md` §5.1, §7.2.
- **Conflict resolution:** last-writer-wins by event `updatedAt`. Per-field merging is out of scope; whole-task replacement is fine. (Conflict resolution is independent of the pull cursor — `updatedAt` orders the apply step, `seq` orders the wire delivery.)
- **Archive cutoff:** archived tasks with `completedAt` older than 60 days are not pushed and are ignored on pull.
- **API auth:** standards-aligned **DID-Auth → Bearer JWT** flow. The client requests a one-time challenge from `POST /v1/auth/challenge`, signs it as a DID-JWT (`alg: "EdDSA"`, `kid: <did>#<methodSpecificId>`, SIOPv2-shaped claims), exchanges it at `POST /v1/auth/token` for a short-lived bearer JWT, and sends `Authorization: Bearer <token>` on every sync call. The bearer JWT is server-issued (per-deploy EdDSA signing key in SSM) with default `exp = 1 h`; clients re-run the challenge flow on expiry. See `docs/sync-protocol.md` §8.

## Identity & encryption

- The user holds a BIP-39 mnemonic (12 words) — the only thing they need to back up. Everything else is deterministically derived.
- **Identity = `did:key`** built from an Ed25519 public key. The Ed25519 keypair is seeded from `HKDF-SHA256(seed, info="cornertasks-identity-ed25519", 32)`. The DID is the `accountDid` used by the sync protocol and is the only on-server identifier for an account.
- **Data encryption = AES-256-GCM** with a key from `HKDF-SHA256(seed, info="cornertasks-encryption-aesgcm", 32)`. Domain-separated `info` strings keep identity and confidentiality keys independent.
- Task fields encrypted before leaving the device: title, createdAt, completedAt, dueDate, order. Cleartext on the wire: `accountDid`, `deviceId`, `eventId`, `taskId`, `updatedAt`, `op`. See `docs/sync-protocol.md` (iteration 4).
- The mnemonic is stored in the macOS Keychain on macOS, and in IndexedDB (with explicit `// SENSITIVE` markers) on web. It is never sent to the server.
- **macOS Keychain access is on-demand, never on launch.** `AccountManager.init` does NOT read the Keychain. Callers invoke `loadIfPresent()` only when the user has signalled intent: opening Settings, expanding "Show mnemonic" / "Show QR code", or the sync engine starting because cloud sync is on. The on-disk default for cloud sync is off, so a fresh install never produces a Keychain authorisation prompt.
- **Revealing a secret on screen always passes through `RevealGate`.** The Keychain ACL has an "Always Allow" affordance the user can click; once they do, a Keychain read in our signed identity stops prompting. So we don't gate reveal on the Keychain at all — we run a fresh `LAPolicy.deviceOwnerAuthentication` check (Touch ID / device password) immediately before displaying the mnemonic or QR code. This is independent of, and not satisfied by, "Always Allow" on the keychain item.
- **Mnemonic accessibility is `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`.** Don't downgrade this to a syncable variant — the mnemonic must never copy to iCloud Keychain. Cross-device transfer is an explicit user action via QR scan or paste.
- The DID is always visible in both the macOS and web Account UIs once a key exists.
- **Enable-flow options:** *Generate new key* (creates a new account) or *Import existing key* via mnemonic (macOS + web) or QR scan (web only — macOS shows the QR for the web side to scan). The import branch must show a prominent red warning that this merges the local tasks into the imported account; the wording must match between macOS and web.

## Window behavior (macOS)

- The panel is an `NSPanel` at `.floating` level, full visible-screen height, pinned to the right edge.
- `showPanel()` always re-applies `defaultPanelFrame()` so reopening restores the strip layout. Do not call `setFrameAutosaveName` with a real name — we explicitly suppress macOS frame persistence.
- The user dismisses with the panel's close button or the menu bar "Show / Hide" entry. Don't auto-hide on focus loss.

## Dock visibility (macOS)

- `LSUIElement` is intentionally absent from `Info.plist` — app shows in Dock by default.
- `Prefs.showInDock` (UserDefaults) flips `NSApp.setActivationPolicy` between `.regular` and `.accessory` live. The menu bar icon is always present regardless.

## Due dates & coloring

`DueStatus.of(date)` is the single source of truth for the four states (overdue / today / tomorrow / future). Both row backgrounds and `DueBadge` read from it. If you add a new color rule, update only `DueStatus`. The web app must implement the same logic.

## Versioning

- Version lives in `apps/macos/AppBundle/Info.plist` (`CFBundleVersion` and `CFBundleShortVersionString`), in `apps/web/package.json`, and in the README "Version" line and changelog table.
- Bump all of them when releasing. Tag the commit `vX.Y.Z`.
- Current release: **v0.2.1**. v0.3.0 is in progress per [`ITERATIONS.md`](ITERATIONS.md).

## Build

- macOS: `cd apps/macos && ./build.sh` is the only sanctioned build path. It generates `CornerTasks.icns`, runs `swift build -c release`, assembles `CornerTasks.app`, ad-hoc signs, and writes `release/CornerTasks.dmg`. No AWS credentials are involved.
- Web: `cd apps/web && npm run build` produces `apps/web/dist/`. To publish, deploy the backend stack first, then `cd backend/aws && npm run deploy:web` to upload `dist/` to the stack's S3 bucket and invalidate CloudFront.
- Backend: `cd backend/aws && npm run deploy:dev` or `npm run deploy:prod` (SAM). See `backend/aws/README.md` for the BYO-AWS env vars and IAM requirements. The repo's `main`-branch GitHub Actions does **not** carry the maintainer's AWS credentials; CI deploys are an opt-in template that downstream forks wire up via OIDC.
- Smoke test: `backend/aws/scripts/sync-doctor.ts` runs the full wire protocol (challenge → DID-JWT → bearer → push → pull → decrypt) against a deployed `ApiUrl`. Invoke locally with `CT_API_URL=… CT_MNEMONIC='…' npm run smoke-test --prefix backend/aws`, or via [`.github/workflows/smoke-test.yml`](.github/workflows/smoke-test.yml) — runs after every backend deploy and on every PR touching `apps/`, `backend/`, or `docs/sync-protocol.md`. Any change that drifts the wire format from `docs/sync-protocol.md` must either (a) update the spec + doctor + clients in one PR, or (b) be caught by the doctor turning red. Don't merge a wire-format change without the doctor passing on a real deploy.

`build.sh` uses `set -euo pipefail` and an EXIT trap to clean intermediates. Don't reintroduce silent failures.

## Running all tests

- `scripts/test-all.sh` mirrors CI exactly. Per package it runs the same step order as `.github/workflows/ci-*.yml`:
  - `backend/aws` — `npm run lint` (eslint) → `npm test` (jest) → `npm run build` (tsc).
  - `apps/web` — `npm run lint` (tsc) → `npm test` (vitest) → `npm run build` (tsc + vite build).
  - `apps/macos` — `swift build -c debug` → `swift test`.
  - If `actionlint` is on PATH it lints `.github/workflows/*.yml` (catches workflow typos that would otherwise only surface on push).
  - If `shellcheck` is on PATH it lints `scripts/`, `.githooks/`, and `apps/macos/*.sh`.
- Flags: `SCOPES=backend,web,macos` (subset), `SKIP_MACOS=1`, `SKIP_BUILD=1`. On non-Darwin hosts the macOS suite skips automatically.
- The pre-commit hook at `.githooks/pre-commit` enables this. Setup once per clone with `git config core.hooksPath .githooks`. It:
  - Narrows `SCOPES` to the directories touched by the staged diff (matches CI's path filters; a backend-only change won't run web/macos tests).
  - Stashes unstaged changes with `--keep-index` so the test reflects exactly what's about to be committed, then restores on exit.
  - Treats any change under `.github/workflows/`, `scripts/`, `.githooks/`, or top-level guidance files as "run everything."
  - Bypass an individual commit with `git commit --no-verify` (CI will still run).
- Optional but recommended local installs: `brew install actionlint shellcheck`. The script skips them silently if absent.

## Working with ITERATIONS.md

- Each iteration is independently mergeable. Don't merge two iterations in one PR.
- After completing an iteration: tick its checkbox in `ITERATIONS.md`, update affected docs, commit. Do not start the next one in the same PR.
- If an iteration's plan turns out to be wrong, update `ITERATIONS.md` first (with a note), get human review, then implement.

## When making changes

- Never create a new git branch. Always work directly on the current branch.
- **Every change updates `CHANGELOG.md`.** Add an entry under the `## [Unreleased]` section at the top (create the section if it doesn't exist), in the file's existing style (`### Added` / `### Changed` / `### Fixed` / `### CI / Infra`). One or two lines per change, written for a user or downstream deployer, not a diff summary. At release, the Unreleased section is renamed to the version heading.
- **Fix documentation drift in the same PR you notice it.** If your change makes — or reveals — any document wrong (`docs/ARCHITECTURE.md`, `docs/sync-protocol.md`, `docs/connection-status.md`, `README.md`, `design/README.md`, this file, or an iteration body in `ITERATIONS.md`), update that document too. Don't ship code that contradicts a committed doc; don't leave a stale doc for the next agent to trip over. If the drift is too big to fix in-scope, record it as an entry in the active **Open questions** section of `ITERATIONS.md` instead — never silently ignore it.
- **If your change touches anything visible, update `design/` first** (tokens, components, screens, overlays, text keys) and run `make design-validate` until green. See "Design schema" above. Schema and implementation ship in the same PR.
- Update `README.md` if user-visible behavior changes.
- Update this file if architectural conventions change.
- Bump the version per "Versioning" above for any user-facing release.
- Run the relevant build end-to-end before declaring done. For macOS that's `./build.sh`; for backend, deploy to a dev stage and exercise both endpoints.
- Add unit tests for any new logic in `Crypto/`, `Sync/`, `Storage/` (macOS), or any non-UI module on web/backend.
- Don't add files unless necessary. Don't add docs unless asked.
