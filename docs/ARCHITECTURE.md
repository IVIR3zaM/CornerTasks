# CornerTasks Architecture (v0.3.0 target)

CornerTasks v0.3.0 makes the backend a **choice rather than a dependency**. The
same server core runs either as AWS Lambda or as a Docker container on hardware
you control — including your own laptop — and clients sync against it over
WebSocket, falling back to REST polling when a socket isn't available.

This document is the contract for v0.3.0. The build plan is a dependency graph
under [`plan/v0.3.0/`](../plan/v0.3.0/README.md), not a linear iteration list.
When a node file and this document disagree, fix whichever is wrong *first*, in
its own commit, before implementing.

> **Historical note.** An earlier v0.3.0 plan (July 2026) rebuilt CornerTasks as
> a First Person Project example — `did:webvh` identities, DIDComm v2.1 through
> a blind mediator, a personal VTA on a Raspberry Pi. That plan was abandoned in
> August 2026. No part of it is in scope. It may return as a later release; it
> is not this one.

## What changes from v0.2.0

| Area | v0.2.0 | v0.3.0 |
|---|---|---|
| Backend | AWS serverless only | AWS **or** self-hosted container, same core |
| Transport | REST pull/push polling | WebSocket preferred, REST polling as fallback |
| Hosting | The user's AWS account | AWS, or the user's own machine with an outbound tunnel |
| Connectivity UI | none | connection-status indicator in both apps |

Deliberately **unchanged**: BIP-39 mnemonic → `did:key` identity, AES-256-GCM
event encryption, last-writer-wins by `updatedAt`, server-assigned `seq`
ordering, the 60-day archive cutoff, and DID-Auth → bearer JWT. v0.3.0 adds a
transport and a deployment option; it does not touch the data model or the
cryptography.

## Backend choice

Both runtimes are first-class and share one implementation:

```
backend/core/     handlers, auth, JWT, DID verification, Store interface, tests
      │
      ├── backend/aws/      Lambda entry points, DynamoDB store, SSM keys,
      │                     template.yaml, API Gateway (HTTP + WebSocket)
      │
      └── backend/server/   Node HTTP + WebSocket server, SQLite store,
                            env/file keys  →  backend/docker/ packages it
```

The split is possible because the coupling is thin: of the nine modules in the
current backend that reference AWS, only `dynamo-store.ts` and the SSM branch of
`signing-key.ts` have runtime dependencies. The rest import *types* only. Core
declares its own `HttpEvent`/`HttpResult` shapes, which Lambda satisfies
natively and the Node adapter constructs.

Consequences worth stating plainly:

- **One protocol, two runtimes.** A client cannot tell which backend it is
  talking to, except through the capabilities each advertises at `/v1/meta`.
- **One test suite, two runtimes.** The conformance suite runs against both.
  That is the parity guarantee — not code review.
- **Neither runtime is the fallback for the other.** A user picks one.

## Self-hosted topology

The motivating case: task data that must not leave a specific machine, still
reachable from that person's other devices.

```
                  YOUR MACHINE
   ┌───────────────────────────────────────────────┐
   │  docker compose up                            │
   │                                               │
   │   cornertasks-server                          │
   │     REST + WebSocket, bound to 127.0.0.1      │
   │     SQLite in a named volume                  │
   │                                               │
   │   ngrok  (optional `tunnel` profile)          │
   │     outbound → https://<name>.ngrok.app       │
   └───────────────────────────────────────────────┘
                        ▲  outbound-only HTTPS / WSS
          ┌─────────────┴──────────────┐
     macOS app                    web app (iPhone, Safari)
```

- **Bound to loopback.** The container publishes to `127.0.0.1` only. Without
  the tunnel profile, nothing is reachable from the local network at all — not
  merely firewalled, not listening.
- **Encrypted at rest anyway.** SQLite holds the same ciphertext the AWS
  deployment holds. The server has no decryption capability in either runtime;
  self-hosting narrows *who can see metadata*, not who can read tasks.
- **The tunnel is opt-in and outbound.** ngrok dials out from your machine;
  nothing accepts inbound connections and no firewall rule is needed.

### Why outbound-only is non-negotiable

Managed (MDM) work machines block inbound and local-network server sockets while
allowing outbound HTTPS/443. This was verified empirically: serving from a Mac's
hostname or local IP failed, an ngrok tunnel worked, because ngrok is outbound
from both ends. Any future ingress option must preserve this property —
Tailscale Funnel and Cloudflare Tunnel both do; port-forwarding does not.

### The audience caveat

`BackendPing` on macOS and the JWT `aud` claim both verify that the backend's
canonical URL matches the URL the user configured — a deliberate guard against
the most common BYO-AWS misconfiguration. Free-tier ngrok issues a new hostname
on every restart, which would trip that guard on the intended setup.

Resolution: the container reports **`PUBLIC_URL`** as its audience, set in
`.env`. After an ngrok restart, update `PUBLIC_URL` and the client-side URL. The
guard stays intact and the failure mode stays diagnosable. A reserved ngrok
domain removes the friction entirely and is the recommended upgrade for daily
use.

## Transport

Clients discover capability, they do not assume it.

1. `GET /v1/meta` (unauthenticated) returns the protocol versions and transports
   a deployment supports, plus its WebSocket URL when it has one.
2. If `ws` is advertised, the client opens a socket, authenticates with the
   bearer JWT it already holds, sends its cursor, and receives the backlog
   followed by live events.
3. Otherwise — or on socket failure — the client polls the REST endpoints
   exactly as v0.2.0 did.

**REST is not deprecated and not a degraded mode.** A deployment that advertises
only `rest` is fully supported, and every client must sync correctly against it
indefinitely. The polling timer is only stood down once a socket reaches the
`live` state, and it restarts the instant the socket drops.

The cursor is what makes the two interchangeable: WebSocket delivery and REST
pull yield the same server-assigned `seq` ordering, so a client can switch
transports mid-session without gaps or replays.

Authentication is identical on both transports and on both runtimes: the
existing DID-Auth → bearer JWT exchange, with the token sent in a first
WebSocket frame rather than a header — browsers cannot set headers on a
`WebSocket`, and API Gateway cannot read custom headers on `$connect`, so one
mechanism satisfies every constraint.

Full framing, reconnect and fallback rules: `docs/sync-protocol.md` §10–§13.

## Connection status

Both apps show one indicator with one state vocabulary, defined in
`docs/connection-status.md` and expressed in `design/` before either app
implements it. `live` (WebSocket) and `polling` (REST fallback) are separate
visible states — a user should be able to tell that real-time delivery is
degraded even though sync still works.

## Threat model

| Adversary | Sees | Does not see |
|---|---|---|
| AWS / your cloud provider | ciphertext events, DIDs, timing, sizes | task content |
| ngrok (tunnel ingress) | TLS-terminated HTTP whose payloads are ciphertext | task content |
| Someone on your LAN | nothing — the port is loopback-bound | everything |
| Compromised device | that device's data | other accounts |

The v0.2.0 promise holds unchanged: **no server-side party can read task
content**, because no server-side party ever holds the encryption key. Choosing
the self-hosted backend narrows metadata exposure; it is not what protects
content.

## Deployment

- **AWS**: unchanged BYO-AWS story — `sam deploy` into the user's own account,
  now provisioning a WebSocket API alongside the HTTP API.
- **Docker**: `docker compose up` for local-only; `--profile tunnel` adds
  ngrok. Multi-arch image (amd64/arm64). Everything `.env`-driven; no secrets
  and no personal domains committed.
- The local Docker stack is also the integration-test harness — client suites
  run against a real container rather than mocks.

## Migration from v0.2.x

REST is unchanged and WebSocket is additive, so **existing AWS deployments keep
working without redeployment**. Clients upgrade independently: a v0.3.0 client
against a v0.2.0 backend simply finds no `/v1/meta`, and polls.

Moving from AWS to self-hosted is a re-onboard, not a data migration — local
task data survives on each device and re-syncs into the new backend.

## Future directions (explicitly not v0.3.0)

- Shared/family task lists.
- Native iOS app — blocked on an Apple developer account; the web app on mobile
  Safari is the interim answer.
- Publishing a prebuilt Docker image to a registry.
- Local MCP server for AI-agent access to tasks.
- The First Person Project architecture, if it is revisited.
