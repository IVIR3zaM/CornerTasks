# CornerTasks — macOS

Always-on-top side panel pinned to the right edge of the screen: add, edit (double-click), complete, optional due date with color coding, drag-to-reorder, and an archive tab.

**Stack:** Swift 5.9 / SwiftUI on macOS 13+. SQLite (system `libsqlite3`) for storage. Apple `CryptoKit` for crypto. No external Swift packages.

## Design schema

Screen structure lives in [`design/`](../../design/README.md). The macOS-specific
divergences are in [`design/platforms/macos/overlays/`](../../design/platforms/macos/overlays/):

- **`settings.json` overlay** — adds an Appearance section with the
  Show-in-Dock toggle, and adds a Debug section (log level, copy diagnostics,
  reset state, force crash). The QR-code *display* is in the base schema and
  shown on both platforms; only camera-based QR *scanning* is web-only and
  lives in the web overlay.

To consume the schema from SwiftUI, read the merged tree for `macos`
(base screen + overlay; the validator's `applyOverlay` is the reference
implementation), then map each component name to a SwiftUI view — `Stack`
→ `VStack`/`HStack`, `Section` → rounded container, `Toggle` → SwiftUI
`Toggle`, `Icon` → SF Symbol named by the logical `name`, etc.

## Standalone-first

This is a **local-only** build by default. Cloud sync is **off**, there is **no** `backendURL` baked into the binary, and storage lives entirely on-device at `~/Library/Application Support/CornerTasks/tasks.sqlite3`. With sync off, the app makes no network calls. Cloud-sync UI lands in iteration 9; the encrypted sync engine in iteration 11 (macOS) and 12 (web).

**Keychain access is on demand.** The app does **not** read the Keychain at launch. The mnemonic is loaded only when:

- you open Settings (so the Account section can show your DID),
- you expand "Show mnemonic" or "Show QR code" (defensive — fires in case Settings was bypassed), or
- the sync engine starts because cloud sync is on.

A user who never enables cloud sync never sees a Keychain authorisation prompt. Toggling cloud sync from Settings starts/stops the in-process sync engine without an app restart (via the `cornerTasksCloudSyncChanged` notification).

**Revealing the secret has its own gate.** Expanding "Show mnemonic" or "Show QR code" runs a fresh `LAPolicy.deviceOwnerAuthentication` check (`Sources/CornerTasks/Crypto/RevealGate.swift`) — Touch ID, Apple Watch, or device password — and *only* renders the secret on success. This prompt is independent of the Keychain ACL: a user who clicked "Always Allow" at Keychain-prompt time still has to authenticate again to display the mnemonic on screen. The mnemonic is also pinned to `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, so it never rides iCloud Keychain to other devices — moving an account between devices is an explicit QR / paste step.

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

## Reset to a clean slate

State persists in three places. To wipe everything and start as if the app were never installed, quit it (status bar → **Quit**) and run [`vanish.sh`](vanish.sh):

```sh
./vanish.sh
```

It removes:

| Layer        | Location                                                       |
| ------------ | -------------------------------------------------------------- |
| UserDefaults | `~/Library/Preferences/CornerTasks.plist` (cloud-sync toggle, backend URL, deviceId, sync interval, dock pref) |
| Local DB     | `~/Library/Application Support/CornerTasks/` (tasks + outbound queue) |
| Keychain     | login-keychain item with service `com.cornertasks.mnemonic`     |
| Window state | `~/Library/Saved Application State/CornerTasks.savedState`      |

Re-launching afterwards boots a fresh install: cloud sync off, no key, empty task list. **Note:** this only resets the local device — if the same mnemonic has been pushed to your AWS backend, re-importing it will pull those tasks back. To start server-side fresh, redeploy the backend with empty DynamoDB tables.

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
