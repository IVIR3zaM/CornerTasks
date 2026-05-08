# Changelog

All notable changes to CornerTasks are recorded here. Dates are ISO-8601.
This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[v0.2.0]: https://github.com/IVIR3zaM/CornerTasks/releases/tag/v0.2.0
[v0.1.0]: https://github.com/IVIR3zaM/CornerTasks/releases/tag/v0.1.0
