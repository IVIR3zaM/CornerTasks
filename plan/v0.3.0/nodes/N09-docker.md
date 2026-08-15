---
id: N09
title: Docker packaging + ngrok profile
model: sonnet
deps: [N07, N08]
---

## Goal

`docker compose up` gives a working CornerTasks backend on the user's own
machine, with an optional tunnel so their phone can reach it. Task data stays
in a local volume and never touches third-party infrastructure.

## Files

- `backend/docker/Dockerfile` — multi-stage, non-root user, `node:24-alpine`,
  production deps only, `HEALTHCHECK` hitting `/v1/health`.
- `backend/docker/compose.yml`:
  - `cornertasks` service — named volume at `CT_DB_PATH`, env from `.env`,
    port published to **`127.0.0.1` only**, so nothing is exposed on the LAN
    even before the tunnel.
  - `ngrok` service under a `tunnel` profile (`docker compose --profile tunnel
    up`), so the default `up` stays fully local.
- `backend/docker/.env.example` — `CT_STORE=sqlite`, `CT_KEY_SOURCE=file`,
  `PUBLIC_URL`, `NGROK_AUTHTOKEN`, `CT_DB_PATH`, port.
- `backend/docker/smoke.sh` — build, up, wait for healthy, run the §9 worked
  example end to end, open a WS and round-trip one event, tear down.
- `backend/docker/README.md` — quickstart; key generation one-liner; how to
  point macOS and web at it; **the ngrok URL-rotation caveat and whichever D1
  option was chosen**; a plain statement of where data lives and what leaves
  the machine.

## Acceptance

- `bash backend/docker/smoke.sh` exits 0 from a clean clone with only
  `.env.example` copied and a key generated.
- Image builds on `linux/amd64` and `linux/arm64`.
- `docker compose down && up` preserves tasks (volume persistence).
- Without the `tunnel` profile, nothing is reachable from another host on the
  network — verify, don't assume.

## Out of scope

Publishing to a registry, orchestration beyond compose, TLS (ngrok terminates).
