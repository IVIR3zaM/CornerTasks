#!/usr/bin/env bash
# Build CornerTasks.app and package it as a DMG.
#
# Env vars:
#   UNIVERSAL=1        Build a universal arm64+x86_64 binary (requires full Xcode).
#                      Defaults off for fast local dev. CI sets this.
#   VERSION=x.y.z      Override CFBundleVersion / CFBundleShortVersionString in
#                      the bundled Info.plist. Defaults to whatever's in the file.
#   DMG_NAME=foo.dmg   Output DMG filename (placed under release/). Default: CornerTasks.dmg
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

APP_NAME="CornerTasks"
APP_BUNDLE="${APP_NAME}.app"
ICON_SRC="icon.png"
ICONSET="${APP_NAME}.iconset"
ICNS="${APP_NAME}.icns"
DMG_DIR="dmg"
DMG_NAME="${DMG_NAME:-${APP_NAME}.dmg}"
DMG_OUT="release/${DMG_NAME}"
UNIVERSAL="${UNIVERSAL:-0}"

cleanup() {
  rm -rf "$ICONSET" "$ICNS" "$APP_BUNDLE" "$DMG_DIR"
}
trap cleanup EXIT

# 1. Generate .icns from icon.png
rm -rf "$ICONSET"
mkdir "$ICONSET"
sips -z 16 16     "$ICON_SRC" --out "$ICONSET/icon_16x16.png"     >/dev/null
sips -z 32 32     "$ICON_SRC" --out "$ICONSET/icon_16x16@2x.png"  >/dev/null
sips -z 32 32     "$ICON_SRC" --out "$ICONSET/icon_32x32.png"     >/dev/null
sips -z 64 64     "$ICON_SRC" --out "$ICONSET/icon_32x32@2x.png"  >/dev/null
sips -z 128 128   "$ICON_SRC" --out "$ICONSET/icon_128x128.png"   >/dev/null
sips -z 256 256   "$ICON_SRC" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
sips -z 256 256   "$ICON_SRC" --out "$ICONSET/icon_256x256.png"   >/dev/null
sips -z 512 512   "$ICON_SRC" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
sips -z 512 512   "$ICON_SRC" --out "$ICONSET/icon_512x512.png"   >/dev/null
sips -z 1024 1024 "$ICON_SRC" --out "$ICONSET/icon_512x512@2x.png" >/dev/null
iconutil -c icns "$ICONSET"

# 2. Build the binary (universal if requested, host arch otherwise)
if [[ "$UNIVERSAL" == "1" ]]; then
  echo "Building universal (arm64 + x86_64)…"
  swift build -c release --arch arm64 --arch x86_64
  BIN_PATH="$(swift build -c release --arch arm64 --arch x86_64 --show-bin-path)"
else
  swift build -c release
  BIN_PATH="$(swift build -c release --show-bin-path)"
fi

# 3. Assemble the .app bundle
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"
cp "$BIN_PATH/$APP_NAME" "$APP_BUNDLE/Contents/MacOS/"
cp AppBundle/Info.plist "$APP_BUNDLE/Contents/Info.plist"
cp "$ICNS" "$APP_BUNDLE/Contents/Resources/${APP_NAME}.icns"

# Optional version stamping.
if [[ -n "${VERSION:-}" ]]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $VERSION"           "$APP_BUNDLE/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$APP_BUNDLE/Contents/Info.plist"
fi

# Ad-hoc sign so launchd / Gatekeeper accept the unsigned local build.
codesign --force --deep --sign - "$APP_BUNDLE"

# Sanity-check architectures so a misconfigured CI run doesn't ship arm-only.
echo "Bundle architectures:"
lipo -info "$APP_BUNDLE/Contents/MacOS/$APP_NAME"

# 4. Build the DMG
mkdir -p release
rm -rf "$DMG_DIR"
mkdir -p "$DMG_DIR"
cp -R "$APP_BUNDLE" "$DMG_DIR/"
ln -s /Applications "$DMG_DIR/Applications"

rm -f "$DMG_OUT"
hdiutil create \
  -volname "$APP_NAME" \
  -srcfolder "$DMG_DIR" \
  -ov \
  -format UDZO \
  "$DMG_OUT"

echo "Built $DMG_OUT"
