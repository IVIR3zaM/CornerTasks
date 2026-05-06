# CornerTasks — Web

Mobile-first web app with feature parity with the v0.1.0 macOS app: add, edit (double-click / long-press), complete, optional due date, drag-to-reorder, and an archive tab.

**Stack:** Vite + React + TypeScript. IndexedDB for storage. `@dnd-kit/core` for reorder. No reactive framework beyond React.

## Standalone-first

This is a **local-only** build. Cloud sync is **off** by default and there is **no** `backendURL` baked into the bundle. Storage lives entirely in the browser's IndexedDB. The app makes no network calls. Cloud-sync UI and the encrypted sync engine arrive in iterations 9, 10, 11, 12.

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

## Layout

```
apps/web/
├── src/
│   ├── models/      — TaskItem, DueStatus, Prefs (mirror of Swift models)
│   ├── storage/     — IndexedDB-backed TaskStore
│   ├── sync/        — empty (filled in iteration 12)
│   ├── crypto/      — empty (filled in iteration 8)
│   └── ui/          — App, TaskList, ArchiveList, styles.css
└── tests/           — vitest + fake-indexeddb
```

`DueStatus` is ported verbatim from `apps/macos/.../Models/DueStatus.swift`. Five states (overdue / today / tomorrow / future / none) with matching color rules. If the macOS rule changes, change both.
