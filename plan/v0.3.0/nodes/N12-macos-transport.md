---
id: N12
title: macOS transport abstraction + WS client
model: sonnet
deps: [N02]
---

## Goal

Teach the macOS app to sync over WebSocket, keeping polling as an automatic
fallback, and expose a single observable connection state for N13 to render.

## The existing seam

`SyncTransport` (`apps/macos/…/Sync/SyncTransport.swift`) is already a protocol
with four methods, and `SyncEngine` holds it by protocol, not by concrete type.
`URLSessionSyncTransport` is the REST implementation. Add alongside it, do not
replace:

- `WebSocketSyncTransport` — `URLSessionWebSocketTask`, implementing §11 frames.
- `NegotiatingTransport` — calls `/v1/meta`, prefers WS when advertised, falls
  back to `URLSessionSyncTransport` per the §12 rules, and owns the retry
  policy.

## Engine changes

- `SyncEngine` publishes `ConnectionState` (the N03 enum). Everything the
  states need already exists in the engine, `AuthSession` and the retry timers
  — this is surfacing state, not inventing it.
- **The pull timer stays armed until `live` arrives and re-arms the instant the
  socket drops.** §12 requires this; it's what makes the fallback seamless
  instead of a sync gap.
- Inbound WS `events` frames go through the existing `applyRemote` path — same
  decryption, same LWW. Do not add a second apply path.
- Cursor persistence via the existing `SyncCursorStorage`, unchanged.

## Acceptance

- `cd apps/macos && swift test`.
- Tests with a fake WS transport: negotiation picks WS when advertised and REST
  when not; a mid-session socket drop reverts to polling **without losing or
  duplicating events**; reconnect resumes from the persisted cursor; backoff
  matches §12.
- `SyncEngineTests` and `AuthSessionTests` pass unmodified — the REST path is
  untouched.

## Out of scope

UI (N13). Changing the event model, crypto, or storage.
