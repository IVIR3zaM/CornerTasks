# Open decisions — v0.3.0

Questions an unattended agent must **not** answer on its own. Each names the
nodes it blocks. Resolve by editing this file (append the answer under the
question and mark it `RESOLVED <date>`), then unblock the node in `graph.yaml`.

---

## D1 — The `audience` check breaks under rotating ngrok URLs

**Blocks:** N07, N09, N16 — **RESOLVED 2026-08-15: option (b), `PUBLIC_URL`.**

`BackendPing.ping()` (`apps/macos/…/Sync/BackendPing.swift`) rejects a backend
whose `/v1/auth/challenge` response `audience` doesn't match the URL the user
typed, and `lib/auth.ts` enforces the same `aud` claim on the bearer JWT. This
is a deliberate BYO-AWS misconfiguration guard. Free-tier ngrok issues a new
hostname on every restart, which would trip the guard on the intended setup.

**Decision:** the container reports `PUBLIC_URL` (from `.env`) as its
`audience`, regardless of request host. After an ngrok restart the user updates
`PUBLIC_URL` and the client-side URL. The guard stays intact.

Implementation notes for N07/N09:
- `PUBLIC_URL` is **required** when `CT_STORE=sqlite`; fail at startup with a
  clear message rather than defaulting to the request host, which would silently
  make the guard useless.
- `backend/docker/` ships a helper that restarts the tunnel and rewrites
  `PUBLIC_URL` in one command.
- The README documents a reserved ngrok domain as the friction-free upgrade.

---

## D2 — WebSocket authentication handshake

**Blocks:** N02, N08, N10 — **RESOLVED 2026-08-15: option (a), first-frame auth.**

Browsers cannot set an `Authorization` header when constructing a `WebSocket`,
and API Gateway cannot read custom headers on `$connect`. A query-string token
would put a credential in URLs that get logged everywhere.

**Decision:** connect unauthenticated, then the client sends
`{"type":"auth","token":"<bearer>"}` as its first frame. The server rejects all
other frame types until it passes and closes the socket after a 5s timeout. One
mechanism works identically on both runtimes, which is what keeps the
conformance suite single-sourced.

---

## D3 — Does AWS WebSocket support ship in v0.3.0 or wait?

**Blocks:** N10 — **RESOLVED 2026-08-15: option (a), both backends get WS in v0.3.0.**

API Gateway WebSocket is the most expensive node in the graph: a new API type, a
connection-ID table with TTL, three extra routes, and `ApiGatewayManagementApi`
fan-out. The user chose full transport parity at release rather than deferring
to v0.3.1.

N10 stays in the graph and remains a dependency of N17. It is `model: opus` and
its acceptance requires passing the **same** N16 conformance suite as the Node
server — cross-runtime parity is proven by tests, not by inspection.

---

## D4 — Where does `backend/aws/` end up?

**Blocks:** N04 — **RESOLVED 2026-08-15: shared core, two runtimes.**

The abandoned plan called for archiving `backend/aws/` at release. That is now
wrong — AWS is a supported choice. Structure, as specified in
`docs/ARCHITECTURE.md`:

```
backend/core/     shared: handlers, lib, types, Store interface, tests
backend/aws/      Lambda entry points + template.yaml (imports core)
backend/server/   Node HTTP + WS server (imports core)
backend/docker/   Dockerfile, compose.yml, .env.example, smoke.sh
```

Only `dynamo-store.ts` and the SSM branch of `signing-key.ts` stay
AWS-specific. Use `git mv` so history follows the files; N04 is a pure move with
no behavioural change.

---

## D5 — SQLite driver

**Blocks:** N05 — **RESOLVED 2026-08-15: `node:sqlite`.**

The `Store` interface is fully async, so a synchronous driver works fine behind
it. `node:sqlite` is built into Node 22+, and the repo already targets
`nodejs24.x` on Lambda — a zero-dependency store keeps the container small and
its build reproducible with no native compile step.

Fall back to `better-sqlite3` only if a concrete limitation appears; record it
here if so.

---

## No open decisions

All five are resolved. Add new ones here as they surface — an agent that hits an
ambiguity it cannot resolve from the node file should append it, mark the
affected node `blocked` in `graph.yaml`, and stop.
