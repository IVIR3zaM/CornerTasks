# CornerTasks — macOS

Always-on-top side panel pinned to the right edge of the screen: add, edit (double-click), complete, optional due date with color coding, drag-to-reorder, and an archive tab.

**Stack:** Swift 5.9 / SwiftUI on macOS 13+. SQLite (system `libsqlite3`) for storage. Apple `CryptoKit` for crypto. No external Swift packages.

## Standalone-first

This is a **local-only** build. Cloud sync is **off** by default and there is **no** `backendURL` baked into the binary. Storage lives entirely on-device at `~/Library/Application Support/CornerTasks/tasks.sqlite3`. The app makes no network calls. Cloud-sync UI and the encrypted sync engine arrive in iterations 9, 11, 12.

## Develop

```sh
swift run -c release            # launch the app
swift test                      # run unit tests (Crypto, DueStatus, Prefs, TaskStore, AccountManager, BackendPing)
swift build -c release          # build the release binary only

# Or open in Xcode
open Package.swift
```

Requires Xcode 15+ command-line tools (`xcode-select --install`).

## Release

`build.sh` is the only sanctioned packaging path. It generates `CornerTasks.icns` from `icon.png`, runs `swift build -c release`, assembles `CornerTasks.app`, ad-hoc signs it, and writes `release/CornerTasks.dmg`.

```sh
./build.sh                              # host arch only — fast local dev
UNIVERSAL=1 ./build.sh                  # universal arm64 + x86_64 (needs full Xcode)
VERSION=0.2.0 UNIVERSAL=1 ./build.sh    # also stamp Info.plist with a version
```

The DMG is **ad-hoc signed but not notarized**. End-user install instructions (quarantine bypass) live in the [top-level README](../../README.md#install-from-a-release-dmg).

### Releases via GitHub Actions

Pushing a `v*` tag (or running `workflow_dispatch`) triggers [`.github/workflows/release.yml`](../../.github/workflows/release.yml), which builds a universal DMG on a `macos-14` runner and attaches it to a GitHub Release.

```sh
git tag v0.2.0
git push origin v0.2.0
```

Bump the version in `AppBundle/Info.plist` (`CFBundleVersion` and `CFBundleShortVersionString`), the top-level README "Version" line, and the changelog table before tagging.

## Layout

```
apps/macos/
├── Package.swift
├── AppBundle/Info.plist
├── build.sh
├── icon.png
├── Sources/CornerTasks/
│   ├── App/         — AppDelegate, panel, status item
│   ├── Storage/     — SQLite TaskStore, schema, migrations
│   ├── Sync/        — outbound queue, poller, sync client
│   ├── Crypto/      — BIP-39 mnemonic, did:key, AES-256-GCM
│   ├── Models/      — TaskItem, DueStatus, Prefs, SyncEvent
│   ├── UI/          — ContentView and row views
│   └── Resources/
└── Tests/CornerTasksTests/
```

`DueStatus` is the single source of truth for the four color states (overdue / today / tomorrow / future). The web app ports it verbatim — if the rule changes here, change both.
