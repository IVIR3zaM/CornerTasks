# AGENTS.md

Guidance for AI agents working on this repository. Read this before making changes.

> Iterations for v0.2.0 are tracked in [`ITERATIONS.md`](ITERATIONS.md). If you are picking up work, start there — execute exactly one iteration per pass and stop.

## Product

CornerTasks is a small floating task widget. The first interface is a macOS app: a vertical strip pinned to the right edge of the screen, always above other windows, that the user hides manually. Quick add, double-click to edit, tick to archive, optional due date with color coding.

v0.2.0 introduces:

- A **web app** (mobile-first) hosted on S3 + CloudFront, with the same feature set.
- An **AWS serverless backend** (TypeScript SAM) that stores tasks in DynamoDB.
- **Cloud sync is opt-in.** The released app is fully standalone by default and makes zero network calls. Users who want sync deploy their own copy of `backend/aws/` to **their** AWS account. The maintainer does not host a shared backend.
- **Decentralized identity**: each account is a `did:key` derived from an Ed25519 keypair the user holds. Two devices with the same mnemonic share the same DID and the same account.
- **End-to-end encryption**: task fields are encrypted on-device with an AES-256-GCM key derived from the same BIP-39 mnemonic. The backend stores ciphertext only — neither the maintainer nor the AWS account owner can decrypt user data.
- **Sync** with conflict resolution by event timestamp; archived items older than 2 months are not synced.

## Core principles

This project is intentionally small. Resist over-engineering — but v0.2.0 grows beyond a single file, so we now keep things organized:

- Split code by responsibility (storage, sync, crypto, UI). Don't introduce design patterns unless they clearly pay for themselves.
- Add unit tests for non-UI logic: crypto, sync queue, conflict resolution, encoding/decoding, mnemonic flow.
- Prefer the platform's standard library and a minimal set of dependencies. For crypto in Swift use Apple's `CryptoKit`; in TypeScript prefer the standard `crypto` module / `@aws-sdk/*`.
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
├── backend/
│   └── aws/                      — Serverless (SAM or CDK; chosen in iteration 3)
│       ├── src/
│       │   ├── handlers/         — push, pull, list-since
│       │   ├── lib/              — DynamoDB access, validation
│       │   └── types/            — shared API request/response types
│       ├── tests/
│       └── template.yaml | cdk/  — infra
│
└── docs/                         — protocol / encryption / sync notes (added as needed)
```

In v0.1.0 the macOS app lives at the repo root. Iteration 1 in [`ITERATIONS.md`](ITERATIONS.md) moves it under `apps/macos/`.

## Storage (macOS)

- SQLite at `~/Library/Application Support/CornerTasks/tasks.sqlite3`.
- Schema lives in `TaskStore.createSchema()`. Add columns via `ALTER TABLE` guarded by `columnExists(...)`. Don't introduce a migration framework.
- A legacy `tasks.json` is migrated once on launch then renamed to `tasks.json.migrated`.
- v0.2.0 adds an outbound `sync_queue` table and an `updated_at` / `deleted_at` column on tasks (see iteration 4).

## Cloud sync — opt-in only

- **Default state: cloud sync is OFF.** The app stores everything locally and makes no network calls. This is the released-binary default and the contract with users.
- The user enables cloud sync from Settings. Enabling requires (a) generating or importing a key, and (b) entering the `ApiUrl` of a backend they have deployed to **their own** AWS account.
- The released DMG MUST NOT contain a hard-coded `backendURL`. Verified at release time (iteration 14) and as part of E2E (iteration 13).
- Disabling cloud sync stops all timers; local data is untouched.

## Sync model (v0.2.0)

- **Push:** every local mutation appends an event to a local queue. Every 10 minutes (and on app start), undelivered events are batched, encrypted, and POSTed to the backend. Only runs while cloud sync is enabled.
- **Pull:** every 1 minute the app calls a `since=<lastSyncedAt>` endpoint and merges any remote events. Only runs while cloud sync is enabled.
- **Conflict resolution:** last-writer-wins by event `updatedAt`. Per-field merging is out of scope; whole-task replacement is fine.
- **Archive cutoff:** archived tasks with `completedAt` older than 60 days are not pushed and are ignored on pull.
- **API auth:** standards-aligned **DID-Auth → Bearer JWT** flow. The client requests a one-time challenge from `POST /v1/auth/challenge`, signs it as a DID-JWT (`alg: "EdDSA"`, `kid: <did>#<methodSpecificId>`, SIOPv2-shaped claims), exchanges it at `POST /v1/auth/token` for a short-lived bearer JWT, and sends `Authorization: Bearer <token>` on every sync call. The bearer JWT is server-issued (per-deploy EdDSA signing key in SSM) with default `exp = 1 h`; clients re-run the challenge flow on expiry. See `docs/sync-protocol.md` §8.

## Identity & encryption

- The user holds a BIP-39 mnemonic (12 words) — the only thing they need to back up. Everything else is deterministically derived.
- **Identity = `did:key`** built from an Ed25519 public key. The Ed25519 keypair is seeded from `HKDF-SHA256(seed, info="cornertasks-identity-ed25519", 32)`. The DID is the `accountDid` used by the sync protocol and is the only on-server identifier for an account.
- **Data encryption = AES-256-GCM** with a key from `HKDF-SHA256(seed, info="cornertasks-encryption-aesgcm", 32)`. Domain-separated `info` strings keep identity and confidentiality keys independent.
- Task fields encrypted before leaving the device: title, createdAt, completedAt, dueDate, order. Cleartext on the wire: `accountDid`, `deviceId`, `eventId`, `taskId`, `updatedAt`, `op`. See `docs/sync-protocol.md` (iteration 4).
- The mnemonic is stored in the macOS Keychain on macOS, and in IndexedDB (with explicit `// SENSITIVE` markers) on web. It is never sent to the server.
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
- Current release: **v0.1.0**. v0.2.0 is in progress per [`ITERATIONS.md`](ITERATIONS.md).

## Build

- macOS: `cd apps/macos && ./build.sh` is the only sanctioned build path. It generates `CornerTasks.icns`, runs `swift build -c release`, assembles `CornerTasks.app`, ad-hoc signs, and writes `release/CornerTasks.dmg`. No AWS credentials are involved.
- Web: `cd apps/web && npm run build` produces `apps/web/dist/`. To publish, deploy the backend stack first, then `cd backend/aws && npm run deploy:web` to upload `dist/` to the stack's S3 bucket and invalidate CloudFront.
- Backend: `cd backend/aws && npm run deploy:dev` or `npm run deploy:prod` (SAM). See `backend/aws/README.md` for the BYO-AWS env vars and IAM requirements. The repo's `main`-branch GitHub Actions does **not** carry the maintainer's AWS credentials; CI deploys are an opt-in template that downstream forks wire up via OIDC.

`build.sh` uses `set -euo pipefail` and an EXIT trap to clean intermediates. Don't reintroduce silent failures.

## Working with ITERATIONS.md

- Each iteration is independently mergeable. Don't merge two iterations in one PR.
- After completing an iteration: tick its checkbox in `ITERATIONS.md`, update affected docs, commit. Do not start the next one in the same PR.
- If an iteration's plan turns out to be wrong, update `ITERATIONS.md` first (with a note), get human review, then implement.

## When making changes

- Update `README.md` if user-visible behavior changes.
- Update this file if architectural conventions change.
- Bump the version per "Versioning" above for any user-facing release.
- Run the relevant build end-to-end before declaring done. For macOS that's `./build.sh`; for backend, deploy to a dev stage and exercise both endpoints.
- Add unit tests for any new logic in `Crypto/`, `Sync/`, `Storage/` (macOS), or any non-UI module on web/backend.
- Don't add files unless necessary. Don't add docs unless asked.
