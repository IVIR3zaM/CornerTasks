# CornerTasks

**Version: v0.1.0** · **Next: v0.2.0 (in progress — see [`ITERATIONS.md`](ITERATIONS.md))**

A tiny task widget. v0.1.0 ships a macOS app that lives as a vertical strip pinned to the right edge of your screen. v0.2.0 adds a mobile-first web app, an end-to-end-encrypted AWS backend, and sync between devices.

## Features (v0.1.0, macOS)

- Always-on-top side panel running the full height of the screen
- Add tasks quickly, double-click to edit
- Created date shown on every active task
- Optional due date per task (popover date picker), with color-coded states:
  - **Red** — overdue
  - **Orange** — due today
  - **Yellow** — due tomorrow
  - **Blue** — due later
- Tick a task to move it to Archive (records added/completed/due dates)
- Drag and drop active tasks to reorder them
- Local SQLite storage (existing JSON data is migrated automatically)
- Dock icon shown by default; in-app setting to hide it (menu bar icon stays)
- Menu bar icon to show/hide the panel

## Coming in v0.2.0

- **Web app** (mobile-first) hosted on S3 + CloudFront, with the same feature set as the macOS app.
- **AWS serverless backend** (TypeScript SAM + DynamoDB) for optional cross-device sync.
- **Cloud sync is opt-in.** The released app is fully standalone by default and makes no network calls. If you don't want sync, you never see a network feature. If you do, you deploy your own backend to your own AWS account — see "Bring your own AWS" below.
- **Decentralized identity:** your account ID is a `did:key` derived from an Ed25519 keypair you control. The DID is visible in both the macOS and web Account screens.
- **End-to-end encryption** with AES-256-GCM. The key is derived on-device from a BIP-39 mnemonic. The maintainer of this project cannot read your tasks. Neither can the AWS account owner — including you.
- **Sync** (when enabled): every local change is queued and pushed every 10 minutes; the app polls every minute for remote updates. Last-writer-wins by timestamp. Archived tasks older than 2 months are not synced.
- **Enable flow**: *Generate new key* (new account) or *Import existing key* via mnemonic (macOS + web) or by scanning a QR from another CornerTasks device (web only — macOS shows the QR). A prominent red warning makes clear that importing merges the local tasks into the imported account.
- **DID and mnemonic export**: view the DID and the mnemonic in both apps; show a QR of the mnemonic on macOS for the web app to scan.

The full plan lives in [`ITERATIONS.md`](ITERATIONS.md). It is split so that each iteration is independently mergeable.

## How private is cloud sync?

- **Default state: OFF.** A freshly-installed CornerTasks makes zero outbound network calls. It is a standalone tool unless you change that.
- **When you enable it:** task fields are encrypted on-device with AES-256-GCM using a key derived from a private key only you control (BIP-39 mnemonic → Ed25519 → HKDF). The wire payload contains only `accountDid`, `deviceId`, `eventId`, `taskId`, `updatedAt`, and `op` in the clear; everything meaningful (title, dates, completion state, order) is inside an opaque ciphertext blob. **The maintainer of this project cannot read your tasks. Neither can anyone running the backend code, including yourself.**
- **API authentication is your DID.** Sign-in uses a standards-aligned DID-Auth flow: the app requests a one-time challenge, signs it with your Ed25519 private key as a DID-JWT (the same envelope used by SIOPv2 / DID-JWT), and exchanges it for a short-lived `Authorization: Bearer <token>`. The bearer token is held in memory only — never written to disk — and re-issued automatically when it expires. There is no API key, password, or shared secret to leak; only the holder of your mnemonic can produce a valid DID-JWT.
- **Auditable evidence:**
  - Wire format: [`docs/sync-protocol.md`](docs/sync-protocol.md) (added in iteration 4).
  - Encryption code: `apps/macos/Sources/CornerTasks/Crypto/` (Swift, iteration 7) and `apps/web/src/crypto/` (TypeScript, iteration 8). Cross-implementation test vectors in `docs/crypto-vectors.json` prove the two implementations produce identical ciphertext for the same input.
  - **End-to-end smoke test:** `backend/aws/scripts/sync-doctor.ts` walks the full challenge → DID-JWT → bearer → push → pull → decrypt round-trip against a deployed `ApiUrl`. Run locally with `CT_API_URL=… CT_MNEMONIC='…' npm run smoke-test --prefix backend/aws`, or let `.github/workflows/smoke-test.yml` run it after every backend deploy / on every PR that touches `apps/`, `backend/`, or `docs/sync-protocol.md`.
  - There is no key-escrow code anywhere in this repo. The encryption key never leaves the device.
- **Keychain access is on demand.** The macOS app does **not** read the Keychain at launch. The mnemonic is loaded only when you open Settings, expand "Show mnemonic" or "Show QR code", or the sync engine starts because cloud sync is on — so a user who never enables sync never sees a Keychain authorisation prompt.
- **Decentralized identity:** your account ID is a `did:key` whose private half lives only on your devices. Two devices with the same mnemonic share the same DID and join the same account.
- **The backend lives in your AWS account, not anyone else's.** See "Bring your own AWS" below. The released DMG never embeds a backend URL.

## Known limitations (v0.2.0)

- **Pull cursor uses client-set `updatedAt`, not a server-assigned sequence.** Today the backend indexes events by the `updatedAt` the originating client wrote, and pull returns events with `updatedAt >= since`. After a successful pull, clients advance `lastSyncedAt` to the server's `serverTime`. This races: an event whose `updatedAt` is older than a recent puller's `serverTime` but which arrives at the server *after* that pull would be silently filtered out on the next round. To absorb both that race and any client/server clock skew, both clients **rewind `lastSyncedAt` by 5 minutes on every advance** (`SyncEngine.cursorLookback` in macOS, `CURSOR_LOOKBACK_MS` in web). Re-delivered events are harmless because `applyRemote` is idempotent under last-writer-wins. The structural fix — a server-assigned monotonic cursor — is planned for a follow-up iteration before tagging v0.2.0.

## Bring your own AWS

CornerTasks does not ship with a hosted backend. To use cloud sync you deploy `backend/aws/` to your own AWS account, then point the app at the URL it prints.

```bash
# Prerequisites: AWS CLI configured (`aws configure` or env vars), Node 20+, SAM CLI.
git clone https://github.com/IVIR3zaM/CornerTasks
cd CornerTasks/backend/aws
npm install
AWS_REGION=us-east-1 STAGE=prod npm run deploy:prod
# → prints ApiUrl and WebUrl
```

Then in the app: **Settings → Cloud Sync → Enable** → paste the `ApiUrl` → generate or import your key. To publish the web app to your own CloudFront distribution: `cd apps/web && npm run build && cd ../../backend/aws && npm run deploy:web`.

Full IAM/permissions list and the optional GitHub Actions OIDC deploy template live in `backend/aws/README.md` (added in iteration 3). The maintainer's GitHub repo carries no AWS secrets; downstream forks wire up their own.

## Repository layout (target for v0.2.0)

```
.
├── apps/
│   ├── macos/    — Swift app (currently still at the repo root in v0.1.0)
│   └── web/      — mobile-first web app (added in v0.2.0)
├── backend/
│   └── aws/      — TypeScript serverless (DynamoDB)
├── docs/         — protocol / encryption / sync notes
├── AGENTS.md
├── README.md
└── ITERATIONS.md — ordered v0.2.0 work plan
```

In v0.1.0 the macOS app lived at the repo root. Iteration 2 of v0.2.0 moved it under `apps/macos/`.

## Requirements

- macOS 13+
- Swift 5.9 / Xcode 15+
- Node 20+ (for `apps/web` and `backend/aws`, once those land)

## Install (from a release DMG)

The DMG is **ad-hoc signed but not notarized** (notarization needs a paid Apple Developer account). On first launch macOS will show *"CornerTasks Not Opened — Apple could not verify…"* with only **Done** / **Move to Bin** buttons. That's normal. Pick one of:

**Easiest — Terminal:** drag the app to `/Applications`, then run

```bash
xattr -dr com.apple.quarantine /Applications/CornerTasks.app
```

and launch it. You only need to do this once per install.

**No Terminal:** drag the app to `/Applications`, double-click it once and dismiss the warning, then open **System Settings → Privacy & Security**, scroll to the bottom, and click **Open Anyway** next to the CornerTasks entry.

## Run from source

```bash
# macOS app — sources live under apps/macos/ as of v0.2.0.
cd apps/macos
swift run -c release

# Or open in Xcode
open apps/macos/Package.swift
```

## Build a distributable .app + .dmg

```bash
cd apps/macos
./build.sh                           # host arch only — fast local dev
UNIVERSAL=1 ./build.sh               # universal arm64 + x86_64 (needs full Xcode)
VERSION=0.1.0 UNIVERSAL=1 ./build.sh # also stamp Info.plist with a version
```

This generates the `.icns` from `icon.png`, builds the release binary, assembles `CornerTasks.app`, ad-hoc signs it, and writes the DMG to `release/`. `build.sh` runs `lipo -info` at the end so you can confirm both slices are present.

### Releases via GitHub Actions

A push of a `v*` tag (or a manual `workflow_dispatch`) triggers [`.github/workflows/release.yml`](.github/workflows/release.yml), which:

1. Builds a **universal** (arm64 + x86_64) DMG on a `macos-14` runner with full Xcode.
2. Uploads it as a workflow artifact.
3. On tag push, attaches it to a GitHub Release with auto-generated notes.

Cut a release:

```bash
git tag v0.1.1
git push origin v0.1.1
```

### Architectures: do you need separate Intel / Apple Silicon builds?

No. The universal binary contains both slices in one `.app`; macOS picks the right one at launch. Ship one DMG.

## Where data is stored

```text
~/Library/Application Support/CornerTasks/tasks.sqlite3
```

If a `tasks.json` from an older version is present, it is migrated on first launch and renamed to `tasks.json.migrated`. The mnemonic (v0.2.0, only when cloud sync is enabled) is stored in the macOS Keychain, not in this folder.

## Showing / hiding

- The panel always floats above other windows. Use the close button on the panel, or the menu bar icon's "Show / Hide" item, to hide it. Reopening always restores the full-height right-edge layout.
- The Dock icon can be toggled from the in-app settings (gear icon in the header).

## License

Licensed under the [Apache License 2.0](LICENSE).

## Releases

| Version | Notes |
| --- | --- |
| v0.1.0 | First release. SQLite storage, due dates with color coding, full-height side panel, dock-icon toggle. |
| v0.2.0 *(planned)* | Multi-platform layout, mobile-first web app on S3+CloudFront, BYO-AWS serverless backend, opt-in end-to-end-encrypted sync, decentralized `did:key` identity. See [`ITERATIONS.md`](ITERATIONS.md). |
