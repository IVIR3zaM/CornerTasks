# CornerTasks Architecture (v0.3.0 target)

CornerTasks v0.3.0 turns the app into a **real-world example of the First Person
Project (FPP)**: identity, device sync, and AI-agent access are all built on FPP
concepts — Personal Network Managers (PNMs) at the edge, a personal Verifiable
Trust Agent (VTA) as the always-on anchor, `did:webvh` identities, and DIDComm
v2.1 private channels routed through a blind mediator.

This document is the contract for v0.3.0. When an iteration in
[`ITERATIONS.md`](../ITERATIONS.md) and this document disagree, fix whichever is
wrong *first*, in its own commit, before implementing.

Reference reading (in priority order):

1. The First Person Project White Paper v1.2 — Parts 7 (First Person Network,
   PNMs, VTAs) and 8 (First Person AI agents).
2. [OpenVTC/verifiable-trust-infrastructure](https://github.com/OpenVTC/verifiable-trust-infrastructure)
   (VTI) — the Rust implementation this release builds on. **The READMEs may lag
   the code; when in doubt, read the code.** The repo is pre-1.0 and moves fast:
   pin a commit (see "Upstream pins" below) and re-verify behavior against the
   pinned tree, not the docs.
3. [did:webvh spec](https://identity.foundation/didwebvh/next/) and
   [DIDComm Messaging v2.1](https://identity.foundation/didcomm-messaging/spec/v2.1/).
4. [affinidi-tdk-rs `crates/messaging`](https://github.com/affinidi/affinidi-tdk-rs/tree/main/crates/messaging)
   — the DIDComm mediator and client crates.

## FPP concept mapping

| FPP concept | CornerTasks incarnation |
|---|---|
| **PNM** — edge client, sovereign wallet, the person's root of trust | Each client app: the macOS app and the web app (incl. mobile Safari). Holds its own device keys and the task-content encryption capability. Nothing above a PNM can read tasks. |
| **Personal VTA** — server-side agent whose keys are *controlled by PNM keys at the edge* | One small always-on `vta-service` instance (Raspberry Pi at home, behind Cloudflare Tunnel). Hosts the account `did:webvh`, owns the *CornerTasks context*, enrolls/revokes device and agent DIDs, performs key rotation. **Never holds task-content keys.** |
| **Private channels** — DIDComm v2.1 | Device↔device sync events, routed through the Affinidi DIDComm mediator (store-and-forward + pickup for offline devices). |
| **Account identity** | One `did:webvh` per account. Replaces v0.2.0's BIP-39 mnemonic → `did:key`. Web-resolvable; its DID document is the discovery root for everything else. |
| **Device identities** | Per-device DIDs (`did:peer`) enrolled under the account's CornerTasks context. Losing a device means revoking one DID; other devices are unaffected. |
| **First Person AI agents** — authenticated delegation | Each AI agent enrolls with its **own DID** and a narrow ACL in the CornerTasks context. Agents act through a local MCP server; every agent-created event is attributable to the agent's DID and revocable. |
| **VTC** — verifiable trust community | **Not used in v0.3.0.** A VTC models a multi-person community; personal sync doesn't need one. It becomes relevant if CornerTasks ever grows shared lists (family/team boards) — see "Future directions". |

## Topology

```
                HOME (Raspberry Pi, behind Starlink CGNAT)
   ┌──────────────────────────────────────────────────────────────┐
   │  deploy/ systemd units, native binaries (.env, pinned VTI)   │
   │                                                              │
   │   vta-service ───── hosts the account did:webvh              │
   │   (webvh feature)   (serves did.jsonl over HTTP),            │
   │                     CornerTasks context, device/agent ACLs,  │
   │                     key rotation                             │
   │                                                              │
   │   affinidi-messaging-mediator (fjall backend — no Redis)     │
   │                     blind store-and-forward + offline pickup │
   │                                                              │
   │   cloudflared ───── outbound tunnel → https://<your-domain>  │
   └──────────────────────────────────────────────────────────────┘
                             ▲  outbound-only HTTPS / WSS
        ┌────────────────────┼─────────────────────────┐
        │                    │                         │
  macOS app (PNM)      web app (PNM)            AI agents (own DIDs)
  vta-mobile-core      TS DIDComm client        local MCP server
  via UniFFI/Swift     IndexedDB + task keys    creates tasks locally,
  SQLite + task keys                            syncs like any device
```

- **No central task storage.** Tasks live only on devices. The mediator queues
  *encrypted* events transiently until the recipient picks them up. The Pi
  hosts identity and relay, not data.
- **No master device, no localhost hub.** Every device is an equal peer.
  Store-and-forward plus last-writer-wins by `updatedAt` (unchanged from
  v0.2.0) handles ordering.
- **VTA and mediator are separable.** They ship as two independent systemd
  services on the single Pi, each with its own DID, data dir, and unit file.
  Either can move to different hardware or a hosted provider later without
  touching any client — see "Discovery" below for why.

## Discovery: the DID document is the only configuration

Clients are configured with **exactly one value: the account `did:webvh`**.
There are no mediator-URL or VTA-URL settings anywhere in the apps.

Resolution chain (all standard did:webvh / DIDComm mechanics, implemented by
VTI — see `vta-service/src/did_webvh.rs`):

1. `did:webvh:<SCID>:<domain>[:<path>]` → fetch
   `https://<domain>/[<path>/]did.jsonl` (or `/.well-known/did.jsonl` for a
   root DID), verify the hash-chained log and SCID.
2. The DID document's `service` array contains a `DIDCommMessaging` entry whose
   `serviceEndpoint.uri` is the **mediator's DID**.
3. Resolve the mediator DID → its document carries the actual transport
   endpoint (HTTPS/WSS URL).
4. The VTA's own endpoint is likewise a service entry on the account DID
   document (or the VTA's DID referenced from it).

Consequences, and the reason this design is non-negotiable:

- **Moving the mediator or the VTA = rotating a service entry in a DID
  document.** Clients pick up the change on next resolution. No client ever
  needs re-configuring. Someone who already runs their own mediator points
  their account DID's service entry at it — that is the "bring your own
  infrastructure" story.
- **Pathful DIDs make the domain multi-tenant.** did:webvh supports path
  segments (`https://<domain>/<path>/did.jsonl`), so one domain and one Pi can
  host many identities — the CornerTasks account today, other family members
  or other apps later — without new infrastructure.

## Key separation (the confidentiality contract)

The v0.2.0 promise — *no server-side party can ever read task content* — is
kept, but the mechanism changes from a shared symmetric key to key separation:

| Key material | Lives | Never touches |
|---|---|---|
| Device DIDComm keys (per-device `did:peer`) | Device only — macOS Keychain / web IndexedDB (`// SENSITIVE`) | VTA, mediator, any server |
| Task-content encryption | DIDComm authcrypt between device DIDs (sender-authenticated, end-to-end) | mediator sees only routing envelopes; VTA sees nothing |
| Account did:webvh update/rotation keys | VTA sovereign wallet, **controlled by PNM keys at the edge** (FPP model: cloud keys subordinate to edge keys) | task-content path entirely |
| Agent DIDs | Enrolled via VTA context ACLs, keys held by the agent host (locally) | broader-than-ACL scopes |

Threat model outcomes:

- **Compromised mediator**: attacker sees ciphertext envelopes and traffic
  metadata (which DIDs talk, when). No content.
- **Compromised VTA / Pi**: attacker can disrupt identity operations (deny
  rotation, serve stale DID logs — mitigated by webvh's hash chain and
  pre-rotation) but reads no tasks, because task keys never exist there.
- **Compromised device**: exactly that device's data; revoke its DID from any
  other device, rotate, continue.
- **Cloudflare (tunnel ingress)**: sees TLS-terminated HTTP whose payloads are
  DIDComm ciphertext. Content stays unreadable; metadata is visible. If even
  that is unacceptable, swap the ingress (see below) — nothing else changes.

## Networking reality (why the design is outbound-only)

Two hard constraints shaped this, both verified empirically:

- **Starlink uses CGNAT**: no static IP, no inbound connections, no port
  forwarding. A Pi at home cannot accept connections from the internet
  directly.
- **Managed (MDM) work machines block inbound and local-network server
  sockets** but always allow outbound HTTPS/443. (This is why serving from a
  Mac's hostname/local IP failed while an ngrok tunnel worked: ngrok is
  outbound from both ends.)

Therefore **every participant only ever dials out**:

- Clients dial out to the mediator (WSS) and to DID-resolution URLs (HTTPS).
- The Pi dials out through **Cloudflare Tunnel** (`cloudflared`), which
  publishes `https://<your-domain>` → the Pi, surviving CGNAT and IP changes.
  Free tier, custom domain, stable hostname.
- The ingress is swappable by design: Tailscale Funnel, a cheap VPS doing raw
  TCP pass-through over WireGuard, or native IPv6 all slot in by changing only
  the `deploy/` config and the DNS record. Client configuration (the DID)
  never changes.

## Sync data flow

1. A device mutates a task → appends a sync event (same event model and
   `docs/sync-protocol.md` lineage as v0.2.0).
2. The event is authcrypted to each enrolled peer DID and handed to the
   mediator (outbound WSS).
3. Online peers receive it live; offline peers fetch queued messages via the
   DIDComm **pickup protocol** on next connect.
4. Receivers decrypt, apply, and resolve conflicts **last-writer-wins by event
   `updatedAt`** — unchanged from v0.2.0. Archive cutoff (60 days) unchanged.

New-device onboarding: an enrolled device (or the setup CLI) issues a DIDComm
**out-of-band invitation** rendered as a QR code; the new device scans it,
creates its `did:peer`, and is enrolled into the context by the VTA after
approval from an existing device. This replaces the v0.2.0 mnemonic-QR flow.

## AI agents

Phase 1 (in scope for v0.3.0): a **local MCP server** on the user's machine
exposing `create_task` / `update_task` / `complete_task` / `list_tasks`,
backed by the local task store. Local AI clients (Claude Desktop/Code,
IDE Copilot) call it; created events sync like any other device's. No task
data leaves the machine by the agent path — this keeps personal AI use
compatible with employer data-governance rules (no company data egress to
third-party infrastructure).

FPP's contribution is *accountable delegation*: each agent is enrolled with
its own DID and a narrow ACL in the CornerTasks context, so agent-created
events are cryptographically attributable and individually revocable
(White Paper Part 8, "authenticated delegation"). VTI ships `vta-mcp` (an MCP
server over VTA capabilities: sign, vault, resolve, VP issuance) which covers
the identity side; CornerTasks' own MCP server covers the task side.

Out of scope for v0.3.0: any cloud-hosted agent endpoint (e.g. Microsoft 365
Copilot integration). That requires employer-sanctioned, in-tenant hosting and
security review; do not build a personal internet-facing endpoint for it.

## Deployment target

- Hardware target: **the cheapest Pi that fits the memory budget — Raspberry
  Pi Zero 2 W (512 MB, aarch64, 64-bit Raspberry Pi OS Lite)**, headless,
  wall-mounted. The stack's **memory budget is ≤ 400 MB total RSS** (OS +
  vta-service + mediator + cloudflared); the two Rust services are expected
  at ~40–80 MB each. Iteration 15 measures the real footprint and iteration
  26 verifies on the actual hardware. If 512 MB proves too tight, add zram
  swap first; the hardware fallback is a **Pi 5 (2 GB)**. Any Pi 4/5 also
  works. A Pi **Pico does not** — it is a microcontroller without Linux.
- **No Docker on the Pi.** The services run as cross-compiled native binaries
  under systemd (`deploy/systemd/`, installed by `deploy/install.sh`) — the
  container runtime would cost 100–150 MB of the 512 MB budget for no
  functional gain. Local development and CI use the same binaries via
  `deploy/dev.sh`. Docker/compose packaging for bigger hosts may come later;
  it is not part of v0.3.0.
- Everything under `deploy/` is `.env`-driven: domain, DID path layout, ports,
  secrets backend, ingress choice. No secrets or personal domains committed.
- Binaries are built for aarch64 (Pi) and x86_64 (CI/dev) by
  `deploy/build.sh` (cross-compilation via `cross` / `cargo-zigbuild`; the
  spike records the working method). Rust is **never compiled on the Pi**.
- The VTA's secrets backend on the Pi is the platform keyring/file backend
  (documented in `deploy/README.md`); Nitro-Enclave/TEE deployment is an
  upstream capability we do not use in v0.3.0.

## Upstream pins

- `OpenVTC/verifiable-trust-infrastructure` — pinned by commit in
  `deploy/` (recorded in `deploy/.env.example` and the lockfile committed with
  iteration 15). Re-pin deliberately, in a dedicated PR, re-running the
  iteration-15 smoke checks.
- `affinidi-messaging-mediator` — the version VTI's pinned commit depends on;
  built with the **fjall** storage backend (embedded, no Redis). One upstream
  caveat to re-verify on every re-pin: some mediator features are
  redis-backend-only (see the feature comments in its `Cargo.toml`); v0.3.0
  must not depend on any of them.

## What v0.3.0 removes

- The AWS serverless backend (`backend/aws/`) and the REST pull/push protocol
  (v0.2.0 §5–§8 of `docs/sync-protocol.md`) — archived at release, not
  maintained. This is a hard cut; v0.2.x installs keep local data and
  re-onboard into an FPP account.
- The BIP-39 mnemonic / `did:key` identity and the AES-GCM-from-mnemonic wire
  encryption (superseded by per-device DIDs + DIDComm authcrypt).
- Backend-URL configuration in both apps.

## Future directions (explicitly not v0.3.0)

- **VTC for shared lists** — a family/team task board as a verifiable trust
  community.
- **Native iOS app** — feasible via `vta-mobile-core` (UniFFI targets iOS),
  blocked on an Apple developer account; the web app on mobile Safari is the
  interim answer.
- **Encrypted backup blobs on the VTA** — ciphertext-only backup/restore is an
  FPP-canonical personal-VTA duty, but v0.3.0 keeps "no task data off-device,
  full stop" and relies on multi-device redundancy.
- **Hosted/M365 agent endpoints** — only with employer-sanctioned in-tenant
  hosting.
