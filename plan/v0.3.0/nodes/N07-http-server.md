---
id: N07
title: HTTP adapter + standalone Node server
model: sonnet
deps: [N04, N05, N06]
---

## Goal

Serve the four existing endpoints from a plain Node process, with the core
handlers running unmodified.

## Approach

The handlers take `HttpEvent` → `HttpResult` (N04). Write one adapter that
builds an `HttpEvent` from a `node:http` `IncomingMessage` and writes the
`HttpResult` back:

- `headers` — lowercase all keys, as API Gateway does. Case handling is where
  a hand-rolled adapter usually diverges from Lambda; `lib/auth.ts` reads
  `authorization`.
- `queryStringParameters` — from the parsed URL; `{}` never `undefined`.
- `body` — raw string, with a size cap (reject >1 MB with 413).
- `requestContext.http.{method,path}` — populated for `lib/api-url.ts`.

Routes, mapped exactly as `template.yaml` declares them:

| Method | Path | Handler |
|---|---|---|
| POST | `/v1/auth/challenge` | `handlers/auth/challenge` |
| POST | `/v1/auth/token` | `handlers/auth/token` |
| POST | `/v1/sync/push` | `handlers/push` |
| GET | `/v1/sync/pull` | `handlers/pull` |
| GET | `/v1/meta` | new (N02) — advertises transports |
| GET | `/v1/health` | new — liveness for Docker/compose |

`/v1/meta` reports `audience` from `PUBLIC_URL` (see D1). `/v1/health` checks
the store responds and must not require auth or leak account data.

## Files

- `backend/server/src/{adapter,router,index}.ts`, `package.json`, `tsconfig.json`
- `backend/server/tests/` — adapter unit tests plus a supertest-style pass over
  all six routes.

## Acceptance

- `cd backend/server && npm test`.
- **Parity test:** the same request run through the adapter and through a
  direct handler call produces identical status and body. This is what proves
  the adapter doesn't silently diverge from Lambda.
- The full `docs/sync-protocol.md` §9 worked example (challenge → token → push
  → pull) succeeds against the running server with only the base URL changed.

## Out of scope

WebSocket (N08), Docker (N09), TLS — ngrok terminates it.
