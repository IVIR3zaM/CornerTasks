---
id: N08
title: WebSocket server (self-hosted runtime)
model: opus
deps: [N02, N07]
---

## Goal

Implement §11–§12 of the protocol on the Node server: real-time event delivery
between a user's own devices, with the REST endpoints still serving anyone who
can't hold a socket open.

## Why opus

The hard parts are ordering and lifecycle, and both are silent when wrong: a
client that misses events or replays them looks fine until data diverges. The
handler logic itself is trivial by comparison.

## Requirements

- **Auth**: first-frame `auth` per D2, reusing `lib/auth.ts` bearer
  verification. Reject every other frame until authenticated; close with a
  clear code on timeout (5s).
- **Subscribe/drain**: on `subscribe {cursor}`, call the same
  `queryEventsAfter` the REST pull uses, stream results as `events` frames,
  then send `live`. **Buffer anything arriving during the drain and flush it
  before `live`** — the gap between "read the backlog" and "start listening" is
  the classic dropped-event window.
- **Push**: `push {events}` goes through the *same* store path as
  `POST /v1/sync/push`. Do not duplicate accept/reject logic — call the shared
  function so REST and WS cannot drift.
- **Fan-out**: after a successful write, deliver to the account's other live
  connections, never the originator. Connections are grouped by `accountDid`
  from the verified token, never from a client-supplied field.
- **Heartbeat**: ping/pong per §11, drop dead peers, clean up the registry on
  close so the map can't leak.
- Cap connections per account; reject beyond it rather than degrading.

## Acceptance

- `cd backend/server && npm run test:ws` covering: auth success/failure/timeout;
  drain ordering with a backlog; **an event pushed by client A mid-drain
  arrives at client B exactly once, in seq order**; fan-out excludes the
  sender; heartbeat drops a silent peer; registry is empty after disconnects.
- A client that pushes over WS and pulls over REST sees a consistent log —
  same `seq` values, no gaps, no duplicates.

## Out of scope

AWS WS (N10), client implementations (N12, N14).
