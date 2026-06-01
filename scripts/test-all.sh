#!/usr/bin/env bash
# Run every check CI runs, locally. This is what the pre-commit hook calls,
# so failing here = failing in CI. Keep the steps in sync with:
#   .github/workflows/ci-backend.yml
#   .github/workflows/ci-web.yml
#   .github/workflows/ci-macos.yml
#
# Per-package step order mirrors CI:
#   backend/aws   npm run lint   →  npm test   →  npm run build
#   apps/web      npm run lint   →  npm test   →  npm run build
#   apps/macos    swift build -c debug   →  swift test
#
# Flags (env vars):
#   SKIP_MACOS=1            skip the Swift suite (auto on non-Darwin)
#   SKIP_BUILD=1            skip the per-package build step (faster, less safe)
#   SCOPES=backend,web,...  comma-separated whitelist; default = everything.
#                           The pre-commit hook narrows this to the
#                           directories actually touched by the staged diff.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
blue()  { printf '\n\033[34m== %s ==\033[0m\n' "$*"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$*"; }

SCOPES="${SCOPES:-backend,web,macos}"
want() { [[ ",${SCOPES}," == *",$1,"* ]]; }

# ---- backend/aws ---------------------------------------------------------
if want backend; then
  blue "backend/aws — lint, test, build"
  (
    cd backend/aws
    [ -d node_modules ] || npm ci
    npm run lint
    npm test
    [ "${SKIP_BUILD:-0}" = "1" ] || npm run build
  )
fi

# ---- apps/web ------------------------------------------------------------
if want web; then
  blue "apps/web — lint, test, build"
  (
    cd apps/web
    [ -d node_modules ] || npm ci
    npm run lint
    npm test
    [ "${SKIP_BUILD:-0}" = "1" ] || npm run build
  )
fi

# ---- apps/macos ----------------------------------------------------------
if want macos; then
  if [ "${SKIP_MACOS:-0}" = "1" ] || [ "$(uname -s)" != "Darwin" ]; then
    blue "apps/macos — skipped ($(uname -s), SKIP_MACOS=${SKIP_MACOS:-0})"
  elif ! command -v swift >/dev/null 2>&1; then
    yellow "apps/macos — swift not found on PATH; skipping. Install Xcode CLT or set SKIP_MACOS=1 to silence."
  else
    blue "apps/macos — swift build (debug) + swift test"
    (
      cd apps/macos
      [ "${SKIP_BUILD:-0}" = "1" ] || swift build -c debug
      swift test
    )
  fi
fi

# Optional helpers below: `command -v` can succeed for an asdf/mise shim
# whose underlying tool isn't actually installed (the shim exits 126). Probe
# with `--version` first so a missing tool is silently skipped rather than
# aborting the whole run.
have() { command -v "$1" >/dev/null 2>&1 && "$1" --version >/dev/null 2>&1; }

# ---- workflow file sanity (optional; runs only if actionlint is installed)
if have actionlint; then
  blue "actionlint — .github/workflows/*.yml"
  actionlint
fi

# ---- shell sanity (optional; runs only if shellcheck is installed) -------
if have shellcheck; then
  blue "shellcheck — scripts and hooks"
  # -x to follow sourced files; ignore vendored dirs.
  shellcheck -x scripts/*.sh .githooks/* apps/macos/build.sh apps/macos/vanish.sh
fi

green "All checks passed."
