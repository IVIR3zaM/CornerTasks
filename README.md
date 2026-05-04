# CornerTasks

**Version: v0.1.0**

A tiny macOS task widget that lives as a vertical strip pinned to the right edge of your screen, floating above other windows until you hide it.

## Features

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

## Requirements

- macOS 13+
- Swift 5.9 / Xcode 15+

## Run from source

```bash
swift run -c release
```

Or open in Xcode:

```bash
open Package.swift
```

## Build a distributable .app + .dmg

```bash
./build.sh
```

This generates the `.icns` from `icon.png`, builds a release binary, assembles `CornerTasks.app`, ad-hoc signs it, and writes `release/CornerTasks.dmg`.

`build.sh` lives at the repo root by convention — it's the single entry point a contributor runs after cloning. No need to hide it under a `scripts/` folder for a project this size.

## Where data is stored

```text
~/Library/Application Support/CornerTasks/tasks.sqlite3
```

If a `tasks.json` from an older version is present, it is migrated on first launch and renamed to `tasks.json.migrated`.

## Showing / hiding

- The panel always floats above other windows. Use the close button on the panel, or the menu bar icon's "Show / Hide" item, to hide it. Reopening always restores the full-height right-edge layout.
- The Dock icon can be toggled from the in-app settings (gear icon in the header).

## License

Licensed under the [Apache License 2.0](LICENSE).

## Releases

| Version | Notes |
| --- | --- |
| v0.1.0 | First release. SQLite storage, due dates with color coding, full-height side panel, dock-icon toggle. |
