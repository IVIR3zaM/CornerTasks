#!/usr/bin/env bash
# vanish.sh — wipe every trace of CornerTasks from this Mac.
#
# Removes the three persistence layers used by the app (UserDefaults, the
# Application-Support SQLite DB, and the Keychain mnemonic) plus AppKit's
# saved-window-state cache. Re-launching afterwards boots a fresh install:
# cloud sync off, no key, empty task list.
#
# Note: this only resets the local device. If the same mnemonic has been
# pushed to your AWS backend, re-importing it will pull those tasks back.

set -u

# Quit the app first if it's running so it can't re-write state on the way out.
if pgrep -x CornerTasks >/dev/null; then
  echo "→ CornerTasks is running; asking it to quit…"
  osascript -e 'tell application "CornerTasks" to quit' 2>/dev/null || true
  for _ in 1 2 3 4 5; do
    pgrep -x CornerTasks >/dev/null || break
    sleep 0.5
  done
  if pgrep -x CornerTasks >/dev/null; then
    echo "  still running; killing." >&2
    pkill -x CornerTasks || true
  fi
fi

echo "→ Removing UserDefaults"
defaults delete CornerTasks 2>/dev/null || true
rm -f "$HOME/Library/Preferences/CornerTasks.plist"

echo "→ Removing local SQLite DB and queue"
rm -rf "$HOME/Library/Application Support/CornerTasks"

echo "→ Removing Keychain mnemonic (service: com.cornertasks.mnemonic)"
# `security delete-generic-password` returns non-zero if the item doesn't
# exist; that's fine for a clean slate, swallow it.
security delete-generic-password -s com.cornertasks.mnemonic >/dev/null 2>&1 || true

echo "→ Removing saved window state"
rm -rf "$HOME/Library/Saved Application State/CornerTasks.savedState"

echo "Done. Re-launch CornerTasks for a fresh install."
