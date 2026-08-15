---
id: N17
title: Release v0.3.0
model: opus
gate: human
deps: [N10, N13, N15, N16]
---

## Goal

Ship it. Human-gated: this node involves real hardware, a real tunnel, and
judgement about whether the thing is actually good.

## Manual verification (not automatable — do it yourself)

1. Fresh clone → `docker compose up` on the Mac → macOS app syncs against it.
2. `--profile tunnel` → open the web app on an iPhone over the ngrok URL →
   both devices converge in real time.
3. Kill the container mid-edit; confirm the indicator shows `queued`, then
   convergence on restart with nothing lost.
4. Restart ngrok to get a fresh URL; confirm the D1 remedy actually works.
   This is the most likely real-world failure and it must be exercised.
5. Side-by-side screenshots of all seven states, macOS vs web.

## Deliverables

- Version bumps: `Info.plist` (both keys), `apps/web/package.json`,
  `backend/*/package.json`, README version line.
- `CHANGELOG.md` — WS transport, backend choice, indicator; explicitly record
  that the FPP plan was abandoned.
- **Migration notes**: v0.2.0 AWS deployments keep working untouched (REST is
  unchanged, WS is additive). Document moving from AWS to self-hosted, and
  state plainly whether event history transfers or clients re-sync from zero.
- README: the backend-choice section — AWS vs local Docker, what each means for
  where data lives. This is the headline feature; lead with it.
- Tag `v0.3.0`; confirm the release workflow attaches the universal DMG and
  still needs no AWS secrets.

## Acceptance

- `bash scripts/test-all.sh` green, integration scope included.
- Released DMG starts with sync **off** and no backend URL baked in — the
  v0.2.0 privacy guarantee, re-verified.
- Every manual step above performed and recorded in the PR.

## Out of scope

Notarization, App Store, native iOS, publishing a Docker image to a registry.
