---
id: N14
title: Web transport abstraction + WS client
model: sonnet
deps: [N02]
---

## Goal

The N12 contract in TypeScript. Same negotiation, same fallback rules, same
state enum — implemented independently against the §11/§12 spec.

## Requirements

- `apps/web/src/sync/WebSocketTransport.ts` — browser `WebSocket`, §11 frames.
  Note the D2 constraint: no `Authorization` header is possible from a browser,
  which is why auth is a first frame.
- `apps/web/src/sync/NegotiatingTransport.ts` — `/v1/meta`, prefer WS, fall
  back per §12.
- Existing REST transport untouched.
- Engine exposes the same `ConnectionState` union as macOS.
- **Tab visibility**: close or idle the socket on `hidden`, reconnect and drain
  from the persisted cursor on `visible`. Mobile Safari will freeze or kill the
  socket when the tab backgrounds — an unhandled resume looks exactly like
  silent data loss, and this is the primary phone-over-ngrok use case.

## Acceptance

- `cd apps/web && npm test`.
- Mock-socket tests mirroring N12's matrix: negotiation both ways, mid-session
  drop → polling with no loss or duplication, cursor-resumed reconnect,
  backoff.
- A visibility test: background, push from another client, foreground, and the
  event arrives exactly once.
- Existing `SyncEngine.test.ts` passes unmodified.

## Out of scope

UI (N15).
