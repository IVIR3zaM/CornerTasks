# CornerTasks — Web

Mobile-first web app with feature parity with the v0.1.0 macOS app: add, edit (double-click / long-press), complete, optional due date, drag-to-reorder, and an archive tab.

**Stack:** Vite + React + TypeScript. IndexedDB for storage. `@dnd-kit/core` for reorder. No reactive framework beyond React.

## Design schema

Screen structure lives in [`design/`](../../design/README.md). The web-specific
divergences are in [`design/platforms/web/overlays/`](../../design/platforms/web/overlays/):

- **`settings.json` overlay** — adds a QR-scan disclosure to the Account
  section (web has camera access, so the user can import an existing
  account by pointing the camera at another device's QR).

To consume the schema from React, read the merged tree for `web` (base screen
+ overlay; the validator's `applyOverlay` is the reference implementation),
then map each component name to a React component — `Stack` → flex container,
`Section` → `.section`, `Toggle` → checkbox with `role="switch"`, `Icon` →
inline SVG keyed off the logical `name`, etc.

## Standalone-first

This is a **local-only** build by default. Cloud sync is **off**, there is **no** `backendURL` baked into the bundle, and storage lives entirely in the browser's IndexedDB. With sync off, the app makes no network calls. Cloud-sync UI lands in iterations 9 (macOS) and 10 (web); the encrypted sync engine in iteration 11 (macOS) and 12 (web).

The "Show QR code" and "Show mnemonic" panels both render the same secret as the underlying mnemonic, so both carry the same red "treat like a password" warning.

## Develop

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # vitest (unit tests for TaskStore + DueStatus)
npm run build    # produces dist/
```

## Deploy

The web app is served only over HTTPS via CloudFront. Camera access (iteration 10) and clipboard helpers depend on a secure context, so HTTP serving is not a supported configuration.

After building, deploy with the backend tooling — the bucket name and CloudFront distribution come from the SAM stack outputs:

```sh
cd apps/web && npm run build
cd ../../backend/aws && AWS_REGION=us-east-1 STAGE=dev npm run deploy:web
```

## Wire-format parity

The web sync engine (iteration 12) MUST match the macOS engine byte-for-byte on the wire — same DID-JWT shape, same fixed-key-order plaintext encoder, same AAD construction, same archive-cutoff and last-writer-wins rules. Any change here that touches the wire format must keep `npm run smoke-test --prefix backend/aws` green against a deployed dev stack. CI runs that smoke test on every PR touching `apps/`, `backend/`, or `docs/sync-protocol.md` — see [`.github/workflows/smoke-test.yml`](../../.github/workflows/smoke-test.yml).

## Layout

```
apps/web/
├── src/
│   ├── models/      — TaskItem, DueStatus, Prefs (mirror of Swift models)
│   ├── storage/     — IndexedDB-backed TaskStore
│   ├── sync/        — empty (filled in iteration 12; mirrors apps/macos/.../Sync/)
│   ├── crypto/      — BIP-39 → HKDF → Ed25519 / AES-GCM (iteration 8)
│   └── ui/          — App, TaskList, ArchiveList, styles.css
└── tests/           — vitest + fake-indexeddb
```

`DueStatus` is ported verbatim from `apps/macos/.../Models/DueStatus.swift`. Five states (overdue / today / tomorrow / future / none) with matching color rules. If the macOS rule changes, change both.
