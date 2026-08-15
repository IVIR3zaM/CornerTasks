#!/usr/bin/env bash
# N01 oracle: docs/ARCHITECTURE.md must not SPECIFY the abandoned FPP design.
# Blockquote lines (`> …`) are exempt — the historical note recording that the
# plan was abandoned is deliberate and must survive.
set -euo pipefail
DOC="$(dirname "$0")/../docs/ARCHITECTURE.md"

if grep -v '^>' "$DOC" | grep -niE 'did:webvh|DIDComm|blind mediator|personal VTA'; then
  echo "FAIL: docs/ARCHITECTURE.md still specifies the abandoned FPP design (above lines)."
  exit 1
fi
echo "PASS: no FPP specification outside the historical note."
