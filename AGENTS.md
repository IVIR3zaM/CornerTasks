# AGENTS.md

Guidance for AI agents working on this repository. Read this before making changes.

## Product

CornerTasks is a small macOS floating task widget. A vertical strip pinned to the right edge of the screen, always above other windows, that the user hides manually. Quick add, double-click to edit, tick to archive, optional due date with color coding.

## Core principle: keep it simple

This project is intentionally tiny. Resist any urge to over-engineer.

- One Swift file is fine. Do not split into many files until the file genuinely outgrows itself (>1000 lines of unrelated concerns).
- No external Swift package dependencies. The only library beyond the standard SDK is the system `SQLite3` (linked via `linkerSettings`).
- Plain SwiftUI + AppKit (`NSPanel`, `NSStatusItem`). No reactive frameworks, no DI containers, no architectural patterns beyond what SwiftUI provides.
- `UserDefaults` is the right tool for user preferences. Don't introduce a settings framework.
- No tests yet, and that's deliberate — the surface area is small enough to verify by running.

If a change feels like it needs a new abstraction layer, push back: most additions can be a few lines in the existing types.

## Project layout

```
.
├── AGENTS.md                — this file
├── README.md                — user-facing docs (keep features in sync)
├── Package.swift            — SPM manifest, links libsqlite3
├── build.sh                 — single entry point for building app + dmg (lives at root)
├── icon.png                 — source icon (build.sh generates the .icns)
├── AppBundle/Info.plist     — bundle metadata, version lives here
├── Sources/CornerTasks/
│   ├── CornerTasksApp.swift — everything: app delegate, store, views
│   └── Resources/           — bundled resources (currently the icns shipped in SPM build)
└── release/                 — DMG output (gitignored, except the dir itself)
```

## Storage

- SQLite at `~/Library/Application Support/CornerTasks/tasks.sqlite3`.
- Schema lives in `TaskStore.createSchema()`. Add columns via `ALTER TABLE` guarded by `columnExists(...)`. Don't introduce a migration framework.
- A legacy `tasks.json` is migrated once on launch then renamed to `tasks.json.migrated`.
- Every mutation calls `reload()`. That's wasteful in the abstract but keeps the UI/DB in lockstep with no observer machinery. Don't optimize until it matters.

## Window behavior

- The panel is an `NSPanel` at `.floating` level, full visible-screen height, pinned to the right edge.
- `showPanel()` always re-applies `defaultPanelFrame()` so reopening restores the strip layout. Do not call `setFrameAutosaveName` with a real name — we explicitly suppress macOS frame persistence.
- The user dismisses with the panel's close button or the menu bar "Show / Hide" entry. Don't auto-hide on focus loss.

## Dock visibility

- `LSUIElement` is intentionally absent from `Info.plist` — app shows in Dock by default.
- `Prefs.showInDock` (UserDefaults) flips `NSApp.setActivationPolicy` between `.regular` and `.accessory` live. The menu bar icon is always present regardless.

## Due dates & coloring

`DueStatus.of(date)` is the single source of truth for the four states (overdue / today / tomorrow / future). Both row backgrounds and `DueBadge` read from it. If you add a new color rule, update only `DueStatus`.

## Versioning

- Version lives in `AppBundle/Info.plist` (`CFBundleVersion` and `CFBundleShortVersionString`) and in the README "Version" line and changelog table.
- Bump both when releasing. Tag the commit `vX.Y.Z`.
- Current release: **v0.1.0**.

## Build

`./build.sh` is the only sanctioned build path. It:
1. Generates `CornerTasks.icns` from `icon.png` via `sips` + `iconutil`.
2. Runs `swift build -c release`.
3. Assembles `CornerTasks.app` with the icns at `Contents/Resources/CornerTasks.icns`.
4. Ad-hoc signs the bundle.
5. Builds `release/CornerTasks.dmg`.

The script uses `set -euo pipefail` and an EXIT trap to clean intermediates. Don't reintroduce silent failures.

## When making changes

- Update `README.md` if user-visible behavior changes.
- Update this file if architectural conventions change.
- Bump the version in `Info.plist` and the README changelog for any user-facing release.
- Run `./build.sh` end-to-end to confirm the bundle still builds before declaring done.
- Don't add files unless necessary. Don't add docs unless asked.
