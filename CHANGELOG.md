# Changelog

All notable changes to CornerTasks are recorded here. Dates are ISO-8601.
This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **v0.3.0 re-planned around backend flexibility; the FPP plan is abandoned.**
  The July 2026 First Person Project plan (`did:webvh` account, per-device
  `did:peer`, DIDComm v2.1 through a blind mediator, self-hosted VTA, local MCP
  agents, Raspberry Pi deployment) is dropped in full and removed from
  `ITERATIONS.md`; it is recoverable from git history if ever revived. v0.3.0 is
  now: **a backend the user chooses** — the same core running either as AWS
  Lambda or as a Docker container on their own machine — **WebSocket sync with
  REST polling retained as a fallback** on both backends, and a
  **connection-status indicator** in both apps. Identity (`did:key` from a BIP-39
  mnemonic), AES-256-GCM event encryption, LWW conflict resolution and the
  60-day archive cutoff are all unchanged. `backend/aws/` is no longer being
  archived — AWS remains a supported deployment.
- **v0.3.0 is planned as a dependency graph, not an iteration list.** The plan
  moved from `ITERATIONS.md` to `plan/v0.3.0/` (`graph.yaml` plus one file per
  node, each declaring its dependencies, model tier and the oracle that proves
  it done). `make v030-status` reports readiness; the `v030-build` skill
  executes the next ready node via model-tiered subagents (`ct-scribe`,
  `ct-implementer`, `ct-architect`). New architecture contract in
  `docs/ARCHITECTURE.md`.

### Removed

- **`PROMPT.md` retired.** The iteration-by-number agent driver is superseded by
  the v0.3.0 build graph and the `v030-build` skill. Its scope-check convention
  — split any unit too big for one cheap pass — carried over into that skill.
  Recoverable from git history.
- **New agent conventions** (`AGENTS.md`): every change adds a
  `CHANGELOG.md` entry under Unreleased, and documentation drift is fixed in
  the same PR it is noticed (or recorded in ITERATIONS.md Open questions).

## [v0.2.1] — 2026-05-21

### Fixed

- **Web due-date picker:** replaced the custom popover + Save/Cancel flow with
  a direct `showPicker()` call on a hidden `<input type="date">` — clicking the
  calendar icon now opens the OS picker in one step, matching the single-step
  flow users expect from the macOS app.
- **macOS panel appearance:** force-sets `NSAppearance` to `darkAqua` so the
  panel always renders in dark mode regardless of the system theme.

### CI / Infra

- **Tag-driven release pipeline:** umbrella `v*` tag orchestrates all
  components (backend → web → macOS) in order; scoped `backend-v*` / `web-v*`
  / `macos-v*` tags allow per-component hotfixes. OIDC-based AWS deploys
  replace manual `workflow_dispatch`.
- **All-or-nothing umbrella releases:** components no longer publish their own
  GitHub release slice. The umbrella creates a single release after all
  components succeed; on any failure the partial release and its git tag are
  deleted automatically so the tag can be re-pushed after fixing.
- **Node 22+ / Lambda `nodejs24.x`:** minimum Node raised from 20 → 22 across
  `apps/web` and `backend/aws`; CI workflows upgraded to Node 24; esbuild
  targets and `@types/node` aligned.
- **Pre-commit test gate:** `scripts/test-all.sh` mirrors CI exactly (lint +
  test + build) for all components with an optional `SCOPES` flag for targeted
  runs; `.githooks/pre-commit` stashes unstaged changes and narrows to touched
  paths so tests reflect the staged snapshot.
- **Backend URL handling:** `ApiUrl` / `WebUrl` are not echoed in CI logs and
  the public release body intentionally omits them; they are stored as
  maintainer-only repo Actions variables via a fine-grained PAT
  (`REPO_VAR_TOKEN`). An earlier attempt that used `::add-mask::` for this
  was reverted — masked values are stripped to empty strings when passed
  across the `workflow_call` boundary, which silently broke the post-deploy
  smoke (resolve saw an empty `inputs.api_url` and skipped the actual test
  while the reusable workflow still reported `success`).
- **`secrets.*` in step `if:` fix:** GitHub Actions rejects `secrets.*` in
  step-level `if:` expressions; routed through an `env:` boolean
  (`HAS_REPO_VAR_TOKEN`) instead.
- **`actions: write` on umbrella workflow:** granted so `release-all.yml` can
  call component reusable workflows.

### CI / Infra — rollback fixes (re-tagged v0.2.1)

The first `v0.2.1` umbrella run was rolled back; the re-tag includes the
following fixes for bugs uncovered by that run:

- **`workflow_call` detection in reusable workflows:** inside a workflow
  invoked via `workflow_call`, `github.event_name` reflects the *caller's*
  trigger (e.g. `push`), not `"workflow_call"`, so every
  `case "${{ github.event_name }}" in workflow_call) ...` discriminator in
  `release.yml` / `release-backend.yml` / `release-web.yml` was dead code.
  This caused the macOS resolve step to set `v=v0.2.1` (stripping the
  non-matching `macos-v` prefix from `v0.2.1`), uploading the DMG as
  `CornerTasks-v0.2.1-universal` while the umbrella's `finalize` tried to
  download `CornerTasks-0.2.1-universal` → not found. The component
  `publish-release` jobs were also breaking the umbrella's "single
  publisher" contract for the same reason. Fix: discriminate on
  `inputs.release_tag != ''` (only the umbrella sets it) for both the
  version/tag resolve and the publish gates.
- **Smoke fails loudly on empty `api_url`:** `smoke-test.yml` now errors
  (rather than silently skipping) when reached with no ApiUrl under any
  event other than `pull_request` / `workflow_dispatch`, so any future
  regression on the workflow_call boundary trips the umbrella's cleanup
  instead of marking smoke as a no-op success.
- **`sync-doctor` log scrub:** stopped printing the raw `apiUrl` and the
  server-returned `audience` (which is the canonical ApiUrl). Only the
  account DID is logged; the wire-step labels carry the rest.
- **`release-web.yml` log scrub:** removed the `echo "WebUrl: $web_url"`
  from `Capture stack outputs` and dropped the `$WEB_URL` value from the
  final smoke-error message.
- **Node.js 24 opt-in:** set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: 'true'`
  at workflow level across all eight workflow files to silence the Node 20
  deprecation warning ahead of the 2026-06-02 default flip without pinning
  every `actions/*@v4` to v5 individually.

## [v0.2.0] — 2026-05-08

Multi-platform release. The macOS app moved under `apps/macos/`, a mobile-first
web app shipped under `apps/web/`, and an opt-in serverless backend lives in
`backend/aws/`. Cloud sync is **off by default** and the released DMG embeds no
backend URL — users who want sync deploy `backend/aws/` to their own AWS
account.

### Added

- **Web app** (Vite + React, mobile-first), feature-parity with macOS:
  add / edit / archive / reorder, due-date color coding, IndexedDB storage,
  camera-based QR scan for key import.
- **AWS serverless backend** (TypeScript SAM + DynamoDB) with `push`, `pull`,
  and DID-Auth challenge / token endpoints. S3 + CloudFront static hosting
  for the web app, deployed via `npm run deploy:web`.
- **Decentralized identity:** each account is a `did:key` derived from a
  user-held BIP-39 mnemonic (Ed25519 via HKDF). DID visible in both apps.
- **End-to-end encryption:** task fields encrypted on-device with AES-256-GCM
  (key from the same mnemonic via a domain-separated HKDF). Backend stores
  ciphertext only. Cross-implementation test vectors in
  `docs/crypto-vectors.json` prove macOS and web produce identical ciphertext.
- **Sync engine** on both clients: push every 10 min, pull every 1 min,
  server-assigned monotonic `seq` cursor, last-writer-wins by `updatedAt`.
  Archived tasks older than 60 days are not synced.
- **DID-Auth → bearer JWT** flow (`POST /v1/auth/challenge` →
  `POST /v1/auth/token`); bearer JWT held in memory only, re-issued on expiry.
- **Account UI** on both platforms: enable / disable cloud sync, generate or
  import a key, view DID, view / show-QR of mnemonic, prominent red merge
  warning on import. macOS Keychain access is on-demand (never on launch);
  reveal of secrets gated by `LAPolicy.deviceOwnerAuthentication`.
- **`sync-doctor.ts`** smoke test (`backend/aws/scripts/`) running the full
  challenge → DID-JWT → bearer → push → pull → decrypt round-trip against a
  deployed `ApiUrl`. Wired into a GitHub Actions workflow.
- Repository docs: [`docs/sync-protocol.md`](docs/sync-protocol.md),
  [`docs/e2e-test.md`](docs/e2e-test.md), [`AGENTS.md`](AGENTS.md),
  [`ITERATIONS.md`](ITERATIONS.md).
- Version line in the footer of both apps.

### Changed

- Repo layout: macOS sources moved from the repo root to `apps/macos/`.
  The Swift sources are split by responsibility (`App/`, `Storage/`, `Sync/`,
  `Crypto/`, `Models/`, `UI/`) with unit tests for non-UI logic.
- `tasks.json` is migrated once and renamed to `tasks.json.migrated`
  (unchanged behavior; reaffirmed for the new layout).

### Security

- The released DMG never embeds a backend URL; cloud sync is off by default.
- Mnemonic stored in macOS Keychain with
  `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` (never copied to iCloud
  Keychain). Cross-device transfer is an explicit user action via QR or paste.
- No key escrow anywhere in the repo; the encryption key never leaves the
  device.

## [v0.1.0] — initial release

- macOS app only, single-file Swift source.
- Always-on-top right-edge panel, full visible-screen height.
- Quick add, double-click to edit, tick to archive.
- Optional due date per task with red / orange / yellow / blue color coding.
- Drag and drop to reorder active tasks.
- Local SQLite storage at `~/Library/Application Support/CornerTasks/tasks.sqlite3`,
  with one-shot migration from a legacy `tasks.json`.
- Dock icon toggle (menu bar icon always present).

[v0.2.1]: https://github.com/IVIR3zaM/CornerTasks/releases/tag/v0.2.1
[v0.2.0]: https://github.com/IVIR3zaM/CornerTasks/releases/tag/v0.2.0
[v0.1.0]: https://github.com/IVIR3zaM/CornerTasks/releases/tag/v0.1.0
