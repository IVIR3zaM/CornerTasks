---
id: N03
title: Connection-status state contract
model: opus
deps: [N02]
---

## Goal

One state vocabulary for sync connectivity, identical on macOS and web, derived
from what the transports actually do. The abandoned plan's table was written
for a DIDComm session (`resolving`, WSS dial, `authenticating`) and does not
describe this system — do not reuse it.

## Deliverable — `docs/connection-status.md`

State table with, per state: circle colour, pulsing or solid, English phrase,
and the precise condition that produces it. Proposed set, derived from
`SyncEngine` (push/pull timers, backoff), `AuthSession` (token lifecycle),
`BackendPing` (reachability) and the N02 WS state machine:

| State | Circle | Phrase (en) | Condition |
|---|---|---|---|
| `disabled` | gray, solid | Sync off | `cloudSyncEnabled == false` or no backend URL |
| `checking` | gray, pulsing | Connecting… | `/v1/meta`, ping, or token exchange in flight |
| `live` | green, solid | Connected | WS `live` received, idle |
| `polling` | green, solid | Connected (polling) | REST fallback active, last cycle succeeded |
| `syncing` | green, pulsing | Syncing… | push or pull in flight on either transport |
| `queued` | blue, solid | {n} changes waiting | Unreachable with a non-empty outbound queue |
| `failed` | red, pulsing | Disconnected — retrying in {n}s | Backoff active; detail shows the last error |

`live` and `polling` are deliberately separate: the user should be able to tell
that real-time delivery is degraded even though sync still works.

Also specify:
- **Precedence** when several conditions hold at once (`syncing` outranks
  `live`/`polling`; `queued` outranks `failed`).
- **Minimum dwell time** (~500 ms) so fast transitions don't strobe.
- Token naming: one `color.conn.<state>` semantic token per state — required by
  design-schema hard rule 7, and enforced by `make design-validate`.

## Acceptance

- Every state maps to a condition expressible from existing client state; no
  state requires data the clients don't have.
- Referenced from `AGENTS.md`.

## Out of scope

Design JSON (N11), platform code (N13, N15).
