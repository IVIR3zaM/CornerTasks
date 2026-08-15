---
id: N02
title: Sync protocol v3 — WebSocket transport + REST fallback
model: opus
gate: human
deps: [N01]
---

## Goal

Specify WebSocket sync as a new **transport** over the existing event model —
not a new protocol. The event shape (§3), encryption (§2, §4), LWW resolution
(§5), server-assigned `seq` (§5.1), archive cutoff (§6) and DID-Auth → bearer
JWT exchange (§8) all carry over verbatim. What changes is how events move.

## Design constraints

1. **REST stays fully functional.** A client that cannot open a WebSocket must
   sync correctly forever on polling alone. WS is an optimisation, not a
   requirement.
2. **The cursor is the shared truth.** WS delivery and REST pull must yield the
   same `seq` ordering, so a client can switch transports mid-session without
   gaps or replays. On WS connect the client sends its cursor and the server
   drains everything after it before going live.
3. **Both runtimes, one wire format.** Lambda/API Gateway WS and the Node
   server must be indistinguishable to a client.
4. **Auth reuses the bearer JWT.** No second credential type. See D2 in
   `decisions.md` for the handshake — resolve it before writing this spec.

## Deliverables — `docs/sync-protocol.md`

- **§10 Transport negotiation.** New `GET /v1/meta` (unauthenticated) returning
  `{"protocolVersions":[2,3],"transports":["ws","rest"],"wsUrl":"…"}`. Clients
  prefer `ws` when advertised, else poll. A backend that omits `ws` is a valid,
  fully-supported deployment.
- **§11 WebSocket framing.** JSON frames, each with a `type`:
  - `auth` (client→server, first frame) → `auth_ok` / `auth_err`
  - `subscribe {cursor}` (client→server) → server drains `seq > cursor` as
    `events` frames, then `live`
  - `push {events}` (client→server) → `push_ack {accepted, rejected}`,
    same accept/reject semantics as `POST /v1/sync/push`
  - `events {events, nextCursor}` (server→client) — fan-out to the account's
    other connections
  - `ping`/`pong` heartbeat, interval and dead-peer timeout specified
- **§12 Reconnect and fallback.** Exponential backoff with jitter, bounds
  stated. Explicit rule for when a client gives up on WS and reverts to
  polling, and when it retries WS. **The pull timer must not be cancelled until
  `live` is received**, and must restart the moment the socket drops.
- **§13 Compatibility.** v2 REST clients keep working against a v3 server
  unchanged.

## Acceptance

- Every frame type has a worked example with real bytes, matching the style of
  the existing §9.
- The fallback rules are stated precisely enough that N12 and N14 can be
  implemented independently and still interoperate.
- D2 is marked RESOLVED in `decisions.md`.

## Out of scope

Implementation (N08, N10, N12, N14). Changing the event model or crypto.
