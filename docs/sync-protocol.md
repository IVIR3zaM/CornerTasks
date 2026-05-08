# CornerTasks Sync Protocol (v0.2.0)

This document is the wire-format contract between CornerTasks clients (macOS app, web app) and a CornerTasks backend (`backend/aws/`). It is normative: both clients and the server are implemented against this spec.

Cloud sync is **opt-in**. A CornerTasks install that has not enabled sync MUST NOT speak this protocol or make any network calls.

Status: stable for v0.2.0. Authentication is Ed25519 request signing (§8) — required from day one.

## 1. Identity — `did:key`

An account is identified by a `did:key` derived from an Ed25519 keypair the user holds. Two devices with the same BIP-39 mnemonic derive the same Ed25519 keypair and therefore share the same DID and the same account.

- The Ed25519 seed is `HKDF-SHA256(bip39Seed, info="cornertasks-identity-ed25519", L=32)`.
- The DID string is the standard `did:key` encoding of the Ed25519 public key: `did:key:` + multibase-base58btc of the multicodec prefix `0xed 0x01` followed by the 32-byte public key.
- Example: `did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSdiCnPMkF4eRpwFNGGq`.

The DID is the only on-server identifier for an account. The server never sees the mnemonic, the Ed25519 private key, or the AES key.

## 2. Encryption — AES-256-GCM

- Key: `HKDF-SHA256(bip39Seed, info="cornertasks-encryption-aesgcm", L=32)`.
- Cipher: AES-256-GCM.
- Nonce: 12 random bytes per event, never reused with the same key.
- Auth tag: 16 bytes, appended to the ciphertext (standard GCM concatenation).

`info` strings for identity and encryption are domain-separated, so the Ed25519 seed and AES key are independent even though they come from the same BIP-39 seed.

## 3. Event

An `Event` is the unit of synchronization. One event represents one mutation of one task on one device.

```json
{
  "accountDid": "did:key:z6Mk...",
  "deviceId": "9f1c7c2e-7b8b-4f2e-9b21-2d2a5a0b9a31",
  "eventId":  "5d9e8d1d-5a83-4c1d-9c1f-2a8c4c6e7f01",
  "taskId":   "a4b2c1d0-1111-2222-3333-444455556666",
  "updatedAt":"2026-05-05T17:42:11.000Z",
  "op":       "upsert",
  "ciphertext":"base64url(...)",
  "nonce":     "base64url(12 bytes)"
}
```

Cleartext fields:

| Field        | Type                       | Notes |
|--------------|----------------------------|-------|
| `accountDid` | `did:key:...` string       | Account identifier (§1). |
| `deviceId`   | UUID v4 string             | Random per device, generated on first launch and stored locally. Used for tie-breaking and debugging only. |
| `eventId`    | UUID v4 string             | Random per event. Used for idempotency and conflict tie-break. |
| `taskId`     | UUID v4 string, **canonical lowercase** | Random — leaks no information about the user's tasks. Stable across edits to the same task. MUST be the canonical lowercase RFC 4122 form (e.g. `a4b2c1d0-1111-2222-3333-444455556666`). Clients MUST lowercase before emitting events and SHOULD lowercase on receipt for backwards-compat with v0.2.0-pre clients that emitted uppercase. |
| `updatedAt`  | ISO 8601 string, UTC, ms   | Wall-clock time on the originating device when the mutation happened. Used for last-writer-wins (§5). |
| `op`         | `"upsert"` \| `"delete"`   | Mutation kind. `delete` events have an empty plaintext object inside `ciphertext`. |
| `ciphertext` | base64url string           | AES-256-GCM ciphertext + auth tag of the encrypted payload (§4). |
| `nonce`      | base64url string, 12 bytes | GCM nonce. |

Encrypted payload (the plaintext that goes into `ciphertext` for `op="upsert"`):

```json
{
  "title":       "Buy milk",
  "createdAt":   "2026-05-04T10:00:00.000Z",
  "completedAt": null,
  "dueDate":     "2026-05-06",
  "order":       3
}
```

For `op="delete"`, the plaintext is `{}`.

## 4. Encryption details

- Encrypt: `ciphertext = AES-256-GCM(key, nonce, JSON.stringify(plaintext), aad = accountDid || "|" || taskId || "|" || eventId)`.
- The AAD binds an event's ciphertext to its identifying tuple, so a server (or attacker) cannot rebind a ciphertext to a different `taskId` or `accountDid` without breaking the auth tag.
- `JSON.stringify` MUST emit keys in the order shown in §3 (title, createdAt, completedAt, dueDate, order). Implementations should round-trip through a serializer that preserves this order; cross-implementation vectors live in `docs/crypto-vectors.json` (added in iteration 8).

## 5. Conflict resolution

- The server stores the latest event per `taskId` per `accountDid`. "Latest" means the maximum `updatedAt`.
- Tie-break: lexicographic comparison of `eventId`. (UUID strings as opaque bytes.)
- Clients apply the same rule when merging pulled events into local state: replace the local row whose `taskId` matches if the incoming event has a strictly newer `updatedAt`, or equal `updatedAt` and a lexicographically greater `eventId`.

Per-field merging is **out of scope** for v0.2.0. A whole-task replacement is correct.

## 6. Archive cutoff

- A task is "archived" once its plaintext `completedAt` is non-null.
- Clients MUST NOT push events for archived tasks where `completedAt < now - 60 days`.
- Servers MUST filter such events out on pull as defense-in-depth — but since the server cannot read `completedAt` (it is encrypted), this filtering happens by `updatedAt`: events with `updatedAt < now - 60 days` AND a stored `op="upsert"` whose subsequent events have not arrived MAY be pruned. In practice the server retains the latest event per task indefinitely; pruning is a future operational concern, not a protocol requirement.

## 7. Endpoints

Base URL is the `ApiUrl` printed by the user's BYO-AWS deploy. There is no maintainer-hosted backend.

### 7.1 `POST /v1/sync/push`

Request body:

```json
{
  "accountDid": "did:key:z6Mk...",
  "events": [ Event, Event, ... ]
}
```

Response body:

```json
{
  "accepted": ["<eventId>", "<eventId>"],
  "rejected": [
    { "eventId": "<eventId>", "reason": "stale" }
  ]
}
```

- The server MUST reject any event whose `accountDid` does not match the top-level `accountDid`.
- The server MAY reject events that are older than the currently-stored event for the same `taskId` (`reason: "stale"`). Clients MUST treat acceptance and stale-rejection as equally successful — both mean the local queue entry can be deleted.
- Pushes are idempotent on `eventId`: re-pushing the same `eventId` returns it under `accepted` (or `rejected` if it was superseded), never a 5xx.

### 7.2 `GET /v1/sync/pull`

Query parameters:

- `accountDid` — required.
- `since` — required. ISO 8601 UTC timestamp. Server returns events with `updatedAt >= since`.

Response body:

```json
{
  "events": [ Event, ... ],
  "serverTime": "2026-05-05T17:42:11.000Z"
}
```

- `serverTime` is the server's clock at response time. Clients use it as the next `since` value to avoid relying on their own clock.
- The events array is ordered by `updatedAt` ascending, with `eventId` ascending as tie-break — same ordering as conflict resolution (§5).

## 8. Authentication — DID-Auth → Bearer JWT

CornerTasks uses a standards-aligned **DID-Auth** flow (challenge / DID-signed JWT response, in the spirit of SIOPv2 and DID-JWT). The user's `did:key` is the identity; the Ed25519 private key it represents is what proves possession. Once proven, the server issues a short-lived bearer JWT that clients send as `Authorization: Bearer <token>` on every sync call.

There is no API key, OAuth provider, or shared secret. The only thing the server trusts at sign-in time is "this DID-JWT was signed by the holder of the private key for this DID."

```
┌────────┐ 1. POST /v1/auth/challenge { accountDid }                         ┌────────┐
│        │ ──────────────────────────────────────────────────────────────▶ │        │
│        │ 2. { challenge, audience, expiresAt }                             │        │
│ Client │ ◀────────────────────────────────────────────────────────────── │ Server │
│        │ 3. POST /v1/auth/token  { accountDid, didJwt }                    │        │
│        │ ──────────────────────────────────────────────────────────────▶ │        │
│        │ 4. { accessToken, tokenType: "Bearer", expiresIn, expiresAt }    │        │
│        │ ◀────────────────────────────────────────────────────────────── │        │
│        │ 5. POST /v1/sync/push   Authorization: Bearer <accessToken>      │        │
└────────┘ ──────────────────────────────────────────────────────────────▶ └────────┘
```

### 8.1 `POST /v1/auth/challenge` — get a nonce

Request body:

```json
{ "accountDid": "did:key:z6Mk..." }
```

Response body:

```json
{
  "challenge":  "5Yp...base64url(32 random bytes)...",
  "audience":   "https://abc123.execute-api.us-east-1.amazonaws.com/prod",
  "expiresAt":  "2026-05-05T17:47:11.000Z"
}
```

- `challenge` — 32 random bytes, base64url-encoded, no padding. Single-use, scoped to the requesting DID, server-side TTL of **5 minutes**.
- `audience` — the canonical API base URL the client MUST place in the DID-JWT's `aud` claim. Lets the same client implementation work against any BYO-AWS deploy without hard-coding URLs.
- The challenge is **not** a secret. Issuing a challenge proves nothing; only the signed response in §8.2 does.

### 8.2 `POST /v1/auth/token` — exchange a DID-JWT for a Bearer token

The client builds a **DID-JWT** (compact JWS, Ed25519) and posts it back. This is the same envelope used by SIOPv2 / DID-JWT libraries, so off-the-shelf verifiers work.

JWS protected header:

```json
{
  "alg":   "EdDSA",
  "typ":   "JWT",
  "kid":   "<accountDid>#<methodSpecificId>"
}
```

`<methodSpecificId>` is the part of the DID after `did:key:` (e.g. `z6Mk...`). For `did:key`, the verification method's id is conventionally `<did>#<methodSpecificId>`.

JWS payload (claims):

```json
{
  "iss":   "<accountDid>",
  "sub":   "<accountDid>",
  "aud":   "<audience from §8.1>",
  "nonce": "<challenge from §8.1>",
  "iat":   1746466931,
  "exp":   1746467231
}
```

- `iss` and `sub` MUST equal the `accountDid` from the challenge request.
- `aud` MUST match `audience` byte-for-byte.
- `nonce` MUST match the `challenge` byte-for-byte.
- `exp` MUST be ≤ `iat + 300` (5 minutes). The server rejects DID-JWTs with longer lifetimes.

Signature is Ed25519 over `base64url(header) + "." + base64url(payload)`. The compact JWS is `header.payload.signature` with each segment base64url-encoded, no padding.

Request body:

```json
{
  "accountDid": "did:key:z6Mk...",
  "didJwt":     "eyJhbGciOi...header.eyJpc3M...payload.k7Hn...signature"
}
```

Server verification:

1. Parse the JWS. Reject malformed input with `400 invalid_did_jwt`.
2. Recover the Ed25519 public key from `accountDid` (§8.5).
3. Verify the signature.
4. Check `iss`/`sub` equal `accountDid`.
5. Check `aud` equals the deploy's canonical base URL.
6. Check `nonce` matches a stored challenge for this DID, and atomically delete it so it cannot be replayed.
7. Check `iat`/`exp`: `now ∈ [iat - 60s, exp]`, `exp - iat ≤ 300s`.

On success, the server issues a Bearer JWT (§8.3) and returns:

```json
{
  "accessToken": "eyJhbGciOi...",
  "tokenType":   "Bearer",
  "expiresIn":   3600,
  "expiresAt":   "2026-05-05T18:42:11.000Z"
}
```

### 8.3 Bearer JWT (server-issued)

The access token is a standalone JWT signed by the **server's** key (per-deploy, generated on first deploy, stored in AWS SSM Parameter Store as a `SecureString` — see iteration 5).

JWT header:

```json
{ "alg": "EdDSA", "typ": "JWT", "kid": "ct-server-<deployId>" }
```

Default algorithm is `EdDSA` to match the rest of the system. Deployments MAY use `HS256` (HMAC-SHA-256) with a per-deploy secret instead — the iteration 5 template documents both options. Clients do not verify this token; they only present it.

JWT claims:

| Claim | Type      | Notes |
|-------|-----------|-------|
| `iss` | string    | The deploy's canonical base URL (same value as `audience` in §8.1). |
| `sub` | string    | The `accountDid` that authenticated. |
| `aud` | string    | `cornertasks-sync-v1`. |
| `iat` | NumericDate | Issue time. |
| `exp` | NumericDate | Issue time + **1 hour** (default; configurable per deploy). |
| `jti` | string    | UUID v4. Permits future revocation lists. |

The server has no session state. Validation is done by checking the JWT's signature and `exp` on every sync call. There is no refresh token in v0.2.0 — clients re-run the challenge / token flow when their access token expires (or on a `401 token_expired`).

### 8.4 Using the Bearer token

Every call to `/v1/sync/push` and `/v1/sync/pull` MUST include:

```
Authorization: Bearer <accessToken>
```

Server-side processing of a sync request:

1. Extract the JWT from the `Authorization` header. Missing → `401 missing_token`.
2. Verify the signature with the deploy's signing key. Fail → `401 bad_token`.
3. Check `exp`. Past → `401 token_expired`.
4. Check `aud == "cornertasks-sync-v1"`. Mismatch → `401 bad_token`.
5. Bind the request: the JWT's `sub` MUST equal the request's `accountDid` (body for push, query for pull) and every event's `accountDid`. Mismatch → `403 did_mismatch`.

### 8.5 Public-key recovery from the DID

To recover the Ed25519 public key from a `did:key`:

1. Strip the `did:key:z` prefix.
2. Multibase-decode the remainder as base58btc.
3. Verify the first two bytes are `0xed 0x01` (Ed25519 multicodec).
4. Take the next 32 bytes as the public key.

This is identical for the auth-token endpoint and (in the future) any other DID-based check. Both the macOS app, the web app, and the backend share fixtures for this in `docs/crypto-vectors.json`.

### 8.6 Failure responses

| Status | `error`        | `reason`               | When |
|--------|----------------|------------------------|------|
| 400    | `bad_request`  | `invalid_did_jwt`      | DID-JWT malformed at `/v1/auth/token`. |
| 400    | `bad_request`  | `invalid_did`          | `accountDid` is not a valid `did:key` per §8.5. |
| 401    | `unauthorized` | `bad_signature`        | DID-JWT signature does not verify. |
| 401    | `unauthorized` | `bad_audience`         | `aud` claim does not match the deploy's canonical URL. |
| 401    | `unauthorized` | `unknown_challenge`    | `nonce` is not a live challenge for this DID (expired, already consumed, or never issued). |
| 401    | `unauthorized` | `bad_lifetime`         | `exp - iat > 300s` or `iat` in the future / `exp` in the past. |
| 401    | `unauthorized` | `missing_token`        | `Authorization: Bearer` absent from a sync call. |
| 401    | `unauthorized` | `bad_token`            | Bearer JWT signature/audience invalid. |
| 401    | `unauthorized` | `token_expired`        | Bearer JWT past `exp`. |
| 403    | `forbidden`    | `did_mismatch`         | Bearer JWT `sub` does not match the request's `accountDid`. |

All `401` responses include `WWW-Authenticate: Bearer realm="cornertasks"`.

### 8.7 Client behavior

- A client SHOULD acquire a token lazily on the first sync call after enabling cloud sync, and cache it (in memory only) until 60 seconds before `expiresAt`.
- On any `401 token_expired` or `401 bad_token`, the client MUST drop the cached token and re-run the challenge / token flow once before retrying the original request. Repeated failures within a sync tick do NOT mark queue rows as sent — they retry on the next tick.
- Tokens are per-process. The mnemonic and Ed25519 private key never leave the device; only the bearer JWT crosses the wire on sync calls.

### 8.8 Threat model

- **An attacker who learns your `did:key` cannot read, write, or delete events.** Listing the challenge endpoint with someone else's DID returns a challenge but is useless without the private key.
- **An attacker who steals a live Bearer token has full account access until `exp` (default 1 hour).** The token never touches disk on either client; it is held in memory and dropped on app exit. Rotate it by signing out (clears local cache) and signing in again.
- **An attacker who learns your mnemonic owns your account fully**: they can produce DID-JWTs, decrypt past data, and impersonate you. Treat the mnemonic as the only secret that matters.
- **The DID is still semi-secret**: it is the directory entry an attacker would target. Don't post it publicly. But losing it alone does not by itself compromise data.

### 8.9 Worked DID-JWT example

```text
header                    {"alg":"EdDSA","typ":"JWT","kid":"did:key:z6Mk...#z6Mk..."}
header (base64url)        eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCIsImtpZCI6ImRpZDprZXk6ejZNay4uLiN6Nk1rLi4uIn0
payload                   {"iss":"did:key:z6Mk...","sub":"did:key:z6Mk...","aud":"https://abc123.execute-api.us-east-1.amazonaws.com/prod","nonce":"5Yp...","iat":1746466931,"exp":1746467231}
payload (base64url)       eyJpc3MiOiJkaWQ6a2V5O...
signing input             <header_b64> + "." + <payload_b64>
signature                 base64url(Ed25519_sign(privKey, signingInput))
didJwt                    <header_b64>.<payload_b64>.<signature_b64>
```

The client posts that string to `/v1/auth/token` and receives the bearer JWT it then attaches to every sync call.

## 9. Worked examples

First, acquire a bearer token (see §8 for the full flow):

```bash
# Step 1 — challenge
CHALLENGE_RESP=$(curl -s -X POST "$ApiUrl/v1/auth/challenge" \
  -H "Content-Type: application/json" \
  -d '{"accountDid":"did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSdiCnPMkF4eRpwFNGGq"}')

# Step 2 — sign a DID-JWT and exchange it for an access token. The repo ships
# backend/aws/scripts/sign-did-jwt.ts (added in iteration 5) to produce $DID_JWT.
TOKEN_RESP=$(curl -s -X POST "$ApiUrl/v1/auth/token" \
  -H "Content-Type: application/json" \
  -d "{\"accountDid\":\"did:key:z6Mk...\",\"didJwt\":\"$DID_JWT\"}")

ACCESS_TOKEN=$(echo "$TOKEN_RESP" | jq -r .accessToken)
```

### 9.1 Upsert (curl-able)

```bash
curl -X POST "$ApiUrl/v1/sync/push" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "accountDid": "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSdiCnPMkF4eRpwFNGGq",
    "events": [
      {
        "accountDid": "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSdiCnPMkF4eRpwFNGGq",
        "deviceId":  "9f1c7c2e-7b8b-4f2e-9b21-2d2a5a0b9a31",
        "eventId":   "5d9e8d1d-5a83-4c1d-9c1f-2a8c4c6e7f01",
        "taskId":    "a4b2c1d0-1111-2222-3333-444455556666",
        "updatedAt": "2026-05-05T17:42:11.000Z",
        "op":        "upsert",
        "nonce":      "vN3p4Lq2RkX9aZbC",
        "ciphertext": "k7Hn...base64url-of-AES-GCM-output...=="
      }
    ]
  }'
```

Successful response:

```json
{
  "accepted": ["5d9e8d1d-5a83-4c1d-9c1f-2a8c4c6e7f01"],
  "rejected": []
}
```

### 9.2 Delete (curl-able)

```bash
curl -X POST "$ApiUrl/v1/sync/push" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "accountDid": "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSdiCnPMkF4eRpwFNGGq",
    "events": [
      {
        "accountDid": "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSdiCnPMkF4eRpwFNGGq",
        "deviceId":  "9f1c7c2e-7b8b-4f2e-9b21-2d2a5a0b9a31",
        "eventId":   "7e2aab10-9c1d-4f0a-8e4c-aaaabbbbcccc",
        "taskId":    "a4b2c1d0-1111-2222-3333-444455556666",
        "updatedAt": "2026-05-05T17:50:00.000Z",
        "op":        "delete",
        "nonce":      "Q1w2E3r4T5y6U7i8",
        "ciphertext": "Z9...base64url-of-AES-GCM-output-of-{}...=="
      }
    ]
  }'
```

### 9.3 Pull

```bash
curl -G "$ApiUrl/v1/sync/pull" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  --data-urlencode "accountDid=did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSdiCnPMkF4eRpwFNGGq" \
  --data-urlencode "since=2026-05-05T17:00:00.000Z"
```

The bearer token in `$ACCESS_TOKEN` carries the authenticated DID in its `sub` claim — the server cross-checks it against the `accountDid` query parameter and against every event's `accountDid` in a push body, rejecting mismatches with `403 did_mismatch`.

Response:

```json
{
  "events": [
    {
      "accountDid": "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSdiCnPMkF4eRpwFNGGq",
      "deviceId":  "9f1c7c2e-7b8b-4f2e-9b21-2d2a5a0b9a31",
      "eventId":   "5d9e8d1d-5a83-4c1d-9c1f-2a8c4c6e7f01",
      "taskId":    "a4b2c1d0-1111-2222-3333-444455556666",
      "updatedAt": "2026-05-05T17:42:11.000Z",
      "op":        "upsert",
      "nonce":      "vN3p4Lq2RkX9aZbC",
      "ciphertext": "k7Hn...=="
    }
  ],
  "serverTime": "2026-05-05T17:55:02.314Z"
}
```
