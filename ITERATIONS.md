# Iterations

This file tracks ordered work plans, one section per minor release. v0.3.0 starts at the bottom; v0.2.0 history is kept above for reference.

## Quick locate (agents read this first)

This block lives at the top of the file at a stable location so `PROMPT.md` can reference it without naming any iteration. Update the line numbers below whenever the v0.3.0 section moves — never put them in `PROMPT.md`.

- **Active release**: **v0.3.0**.
- **Active status checklist** (the `[ ]`/`[x]` list to scan): **lines 558–570**. Read these to pick the lowest-numbered unchecked iteration **N** (range: 15..27).
- **Active iteration bodies start at**: **line 574**. Each iteration is delimited by a `## Iteration N — <title>` heading; the next `## Iteration ...` heading (or `## Open questions` for the last one) ends it. Use `sed` to extract exactly one — see the recipe in `PROMPT.md`.
- **Active open-questions section**: search marker `## Open questions` (currently line **1047**).
- **Frozen v0.2.0 reference**: lines 18–491. Do not modify unless explicitly asked.

If the line numbers above look wrong, re-anchor with `grep -n "^## Status\|^## Iteration\|^## Open questions\|^# v" ITERATIONS.md` and fix this block in the same PR that caused the drift. `PROMPT.md` itself must keep working.

# v0.2.0 Iterations

Ordered work plan to take CornerTasks from v0.1.0 (single-file macOS app) to v0.2.0 (multi-platform with optional, end-to-end-encrypted, decentralized AWS sync).

## How to use this file

- One PR per iteration, in order. Don't bundle two.
- Re-read [`AGENTS.md`](AGENTS.md) before starting; it defines repository conventions.
- Each iteration lists **Goal**, **Deliverables**, **Acceptance criteria**, **Out of scope**. If scope must grow, edit this file first and flag it in the PR.
- Tick the iteration's checkbox below when its PR is merged. Update affected docs (README, AGENTS.md) in the same PR.
- Tests:
  - Iteration 1 adds **integration tests** for current behavior — no source code changes.
  - Iteration 2 restructures source files. Iteration 1's integration tests must still pass unchanged. Iteration 2 also adds **unit tests** for the new modules.
  - Every later iteration that adds non-UI logic must add unit tests for that logic.

## Status

- [x] **1.** Integration tests for the current v0.1.0 macOS app (no source changes)
- [x] **2.** Repo restructure + split the Swift file + add unit tests (integration tests still pass)
- [x] **3.** AWS backend skeleton + S3 static-site bucket + "bring your own AWS" docs + standalone-mode default in app config
- [x] **4.** Shared sync protocol spec (`docs/sync-protocol.md`)
- [x] **5.** Backend impl: DynamoDB schema, push/pull handlers
- [x] **6.** Web app skeleton (Vite + React, mobile-first), local-only, S3 deploy script
- [x] **7.** Crypto on macOS: mnemonic → Ed25519 → `did:key` + AES-256-GCM data encryption
- [x] **8.** Crypto on web: same scheme, cross-implementation test vectors
- [x] **9.** Account UI on macOS (standalone-by-default; enable/disable cloud sync; show DID; merge warning)
- [x] **10.** Account UI on web (same flows + camera-based QR scan)
- [x] **11.** Sync engine on macOS (push every 10 min, pull every 1 min, archive cutoff, only when cloud sync enabled)
- [x] **12.** Sync engine on web
- [x] **13.** End-to-end verification across one macOS + one web device
- [x] **14.** Release v0.2.0

---

## Iteration 1 — Integration tests for v0.1.0 (no source changes)

**Goal:** Pin down current behavior with end-to-end tests **before** restructuring. The product source must not change in this iteration.

**Deliverables:**
- Add a `Tests/CornerTasksTests/` target to `Package.swift`. Adding the target counts as Swift Package Manager configuration, not a product code change.
- Integration tests that exercise the **real** `TaskStore` against a temp-directory SQLite file (each test gets its own temp dir, deleted on teardown):
  - Create store → `add("a")` → `activeTasks.count == 1` and round-trips via re-opening a new store on the same path.
  - `complete` moves a task into `archivedTasks`.
  - `setDueDate` round-trips a date.
  - `updateTitle` persists.
  - `deleteArchived` removes the row.
  - `moveActive` reorders persistently.
  - JSON migration: write a synthetic `tasks.json` into the temp dir, open the store, assert rows imported and the JSON file renamed to `tasks.json.migrated`.
  - Schema upgrade: pre-create a tasks table without `due_date`, open the store, assert the column is added (proves `columnExists` + `ALTER TABLE` path).
- These tests need to construct `TaskStore` against an arbitrary directory. v0.1.0's `TaskStore.init` hardcodes `~/Library/Application Support`. **Workaround for this iteration:** override the home directory in the test process before constructing the store. The original plan was `setenv("HOME", tmp.path, 1)`, but on macOS `FileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)` resolves the user's home via `getpwuid()` and ignores `$HOME` — so we set `CFFIXED_USER_HOME` instead (CoreFoundation honors it). Still no source change required.

**Acceptance criteria:**
- `swift test` passes.
- `swift build -c release` and `./build.sh` still produce an identical app bundle (same `CornerTasksApp.swift`).
- No file under `Sources/CornerTasks/` is modified.

**Out of scope:** restructuring, unit tests, any new feature.

---

## Iteration 2 — Restructure macOS source + add unit tests

**Goal:** Move the macOS app under `apps/macos/`, split `CornerTasksApp.swift` into small files by responsibility, and make `TaskStore` injectable enough for unit tests, without changing observable behavior.

**Deliverables:**
- Move the macOS app under `apps/macos/` (`Package.swift`, `AppBundle/`, `Sources/`, `build.sh`, `icon.png`, `release/`). Update `.github/workflows/release.yml` to set `working-directory: apps/macos` (or equivalent). Update `.gitignore` paths. Update README run/build commands.
- Split `apps/macos/Sources/CornerTasks/` into:
  - `App/` — `CornerTasksApp.swift` (the `@main`), `AppDelegate.swift`
  - `Storage/` — `TaskStore.swift`, `Schema.swift`
  - `Models/` — `TaskItem.swift`, `DueStatus.swift`, `Prefs.swift`
  - `UI/` — `ContentView.swift`, `ActiveTaskRow.swift`, `ArchivedTaskRow.swift`, `DueDateButton.swift`, `DueBadge.swift`
- Add a `TaskStore.init(directory: URL)` overload so tests no longer need the `HOME` override. Keep the default-init for the app.
- Update iteration 1's integration tests to use the new init. **The integration assertions themselves must remain identical** — only the constructor call changes.
- Add unit tests for purely-logical types:
  - `DueStatus.of(...)` covers all five branches against a fixed `now`.
  - `Prefs` defaults match documentation (`showInDock` defaults to `true`; cloud-sync prefs added in iteration 3 will have their defaults asserted there too).

**Acceptance criteria:**
- `swift test` passes.
- `swift build -c release` and `./build.sh` succeed from `apps/macos/`.
- App behavior is unchanged from v0.1.0.

**Out of scope:** sync, crypto, any new UI.

---

## Iteration 3 — Backend skeleton + S3 hosting bucket + BYO-AWS docs + standalone default

**Goal:** Stand up `backend/aws/` with empty handlers, define the S3 static-site bucket that will host the web app, and make it crystal clear that **the released app does not phone home**. Users who want sync deploy their own copy.

**Decision:** SAM (YAML) over CDK. Reason: smaller surface, no synth step, direct mapping from template to deployed resources. Document in `backend/aws/README.md`.

**Deliverables:**

### Infra (`backend/aws/template.yaml`)
- One DynamoDB table (placeholder; finalized in iteration 5).
- API Gateway HTTP API with `POST /v1/sync/push` and `GET /v1/sync/pull` routes.
- Two TypeScript Lambda functions returning `{ ok: true, todo: "iteration 5" }`.
- One S3 bucket configured for the web app — **private** bucket fronted by CloudFront with Origin Access Control (we do not enable public S3 website hosting; CloudFront is the only path in). HTTPS-only. SPA fallback: `403/404 → /index.html`.
- Stack outputs: `ApiUrl` and `WebUrl`. The deploy script prints both at the end.

### Tooling (`backend/aws/`)
- `package.json`, `tsconfig.json`, ESLint config.
- Scripts:
  - `npm run build`
  - `npm run deploy:dev` / `npm run deploy:prod` (`sam deploy` with stage param)
  - `npm run deploy:web` — `aws s3 sync` of `apps/web/dist/` into the bucket from the deployed stack, then `aws cloudfront create-invalidation`. Reads bucket name + distribution ID from `aws cloudformation describe-stacks`.
- Unit tests for handler skeletons.

### Documentation: "Bring your own AWS"
Add `backend/aws/README.md` with:
- **Why:** the maintainer does not host a shared backend. Each user runs their own. Cloud sync is fully optional.
- **Required env vars (locally for `sam deploy`):**
  - `AWS_REGION`
  - one of: `AWS_PROFILE`, OR `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` (+ optional `AWS_SESSION_TOKEN`)
  - `STAGE` (e.g. `prod`, `dev`)
- **Required IAM permissions** for the deploying principal: CloudFormation, Lambda, API Gateway, DynamoDB, S3, CloudFront, IAM (for Lambda execution role). List the minimal action set in the README.
- **Step-by-step:**
  1. Fork or clone this repo.
  2. `aws configure` (or set env vars).
  3. `cd backend/aws && npm install && npm run deploy:prod`.
  4. Note the `ApiUrl` and `WebUrl` printed at the end.
  5. In the macOS app or web app: open Settings → Cloud Sync → paste `ApiUrl` and Enable. Generate or import your DID key (iterations 9/10).
  6. To deploy the web app: `cd apps/web && npm run build && cd ../../backend/aws && npm run deploy:web`.

### GitHub Actions secrets — what is and isn't needed
Document this in `backend/aws/README.md`:
- The repo's existing `release.yml` (DMG builder) needs **no AWS secrets**. It does not deploy anything.
- For users who want CI deploys of their own stack from their fork, add a separate `.github/workflows/deploy.yml` template (committed but disabled by default — `workflow_dispatch` only) that uses **GitHub OIDC → AWS IAM role** (no long-lived keys). Required GitHub Action secrets/vars in their fork:
  - `AWS_ROLE_TO_ASSUME` — full ARN of an IAM role they create with a trust policy for `token.actions.githubusercontent.com`.
  - `AWS_REGION`.
  - Optional `STAGE`.
- Explicitly state: this repo's `main` branch GitHub Actions does **not** carry the maintainer's AWS credentials. The maintainer's personal dev stack (if any) is deployed manually from a laptop, never from this repo's CI. The released DMG does not embed an `ApiUrl`.

### App-side default (macOS only — web is iteration 6)
- Add `Prefs.cloudSyncEnabled` (default `false`) and `Prefs.backendURL` (default `nil`).
- Surface in settings (placeholder UI now, real flows in iteration 9): a section labelled "Cloud Sync — Off". No background task is started while disabled. The released app cannot connect anywhere by default.
- Unit-test the default values.

### README.md (root) — privacy section
Add a "How private is cloud sync?" section explaining:
- **Default state: cloud sync is OFF.** The released app makes zero network calls. It is a standalone tool unless you change that.
- **When you enable it:** data is encrypted on-device with a key derived from a private key only you control. The server stores ciphertext + an opaque task ID + a timestamp. **The maintainer of this project cannot read your tasks. Neither can anyone running the backend code, including yourself.**
- **Evidence — the wire payload:** the only cleartext fields are `accountDid`, `deviceId`, `eventId`, `taskId`, `updatedAt`, `op`. Every meaningful field (title, dates, completion state, order) lives inside an AES-256-GCM ciphertext blob. See `docs/sync-protocol.md` (iteration 4) for the exact format and `apps/macos/Sources/CornerTasks/Crypto/` (iteration 7) for the implementation. Both are auditable.
- **Evidence — code paths:** the encryption key is derived in `Crypto/DataKey.swift` from the BIP-39 seed and never leaves the device. There is no key-escrow code anywhere in this repo; the AWS account owner has no decryption material.
- **Decentralized identity:** your account ID is a `did:key` derived from an Ed25519 public key whose private half lives only on your devices. Two devices with the same mnemonic share the same DID and therefore the same account.
- **The backend lives in your AWS account, not anyone else's.** Link to the BYO-AWS guide in `backend/aws/README.md`.

**Acceptance criteria:**
- `npm test` passes.
- `npm run deploy:dev` against a dev AWS account succeeds; both API routes respond `200`; the `WebUrl` returns a 404 (empty bucket — expected until iteration 6).
- README's privacy section + `backend/aws/README.md` BYO-AWS steps are reviewable and complete.

**Out of scope:** real handler logic (iteration 5), web app code (iteration 6), real crypto (iteration 7).

---

## Iteration 4 — Sync protocol spec

**Goal:** Write the wire format **before** anyone implements clients or real handlers.

**Deliverables:** `docs/sync-protocol.md` covering:

- **Account identity = `did:key`** derived from an Ed25519 public key (see iteration 7). The DID is the only on-server identifier for an account. Example: `did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSdiCnPMkF4eRpwFNGGq`.
- **Event:** `{ accountDid, deviceId, eventId, taskId, updatedAt, op, ciphertext, nonce }`.
  - Cleartext: `accountDid`, `deviceId` (random per-device UUID), `eventId` (random UUID), `taskId` (random UUID — leaks no info), `updatedAt` (ISO 8601), `op ∈ {"upsert","delete"}`.
  - Encrypted (inside `ciphertext`): everything else — title, createdAt, completedAt, dueDate, order.
  - Cipher: AES-256-GCM. 12-byte random `nonce`. Auth tag included in `ciphertext`. Key derived per iteration 7.
- **Endpoints:**
  - `POST /v1/sync/push` body `{ accountDid, events: Event[] }` → `{ accepted: string[], rejected: { eventId, reason }[] }`.
  - `GET /v1/sync/pull?accountDid=...&since=<ISO8601>` → `{ events: Event[], serverTime }`.
- **Conflict resolution:** server keeps the latest event per `taskId` keyed by max `updatedAt`. Tie-break: lexicographic `eventId`.
- **Archive cutoff:** clients MUST NOT push events for archived tasks where `completedAt < now - 60 days`. Server filters such events out on pull (defense-in-depth).
- **Auth:** standards-aligned **DID-Auth → Bearer JWT** flow. The user's `did:key` is the credential; possession is proven by signing a server-issued challenge as a **DID-JWT** (compact JWS, `alg: "EdDSA"`, conforming to the SIOPv2 / DID-JWT shape). On success the server returns a short-lived bearer JWT used as `Authorization: Bearer <token>` for every sync call. Spec must cover:
  - **`POST /v1/auth/challenge`** body `{ accountDid }` → `{ challenge, audience, expiresAt }`. Challenge is 32 random bytes (base64url), single-use, scoped to the DID, 5-minute server-side TTL. `audience` is the deploy's canonical API base URL.
  - **`POST /v1/auth/token`** body `{ accountDid, didJwt }`. `didJwt` is a compact JWS with header `{ alg: "EdDSA", typ: "JWT", kid: "<did>#<methodSpecificId>" }` and claims `{ iss, sub, aud, nonce, iat, exp }`. Server verifies signature against the Ed25519 public key recovered from the DID, checks `iss == sub == accountDid`, `aud == audience`, `nonce` matches a live challenge (atomically consumed), and `exp - iat ≤ 300s`. Returns `{ accessToken, tokenType: "Bearer", expiresIn, expiresAt }`.
  - **Bearer JWT** (server-issued): `alg: "EdDSA"` by default with the deploy's signing key (stored in SSM Parameter Store as a `SecureString`); `HS256` with a per-deploy secret is a documented alternative. Claims `{ iss, sub: accountDid, aud: "cornertasks-sync-v1", iat, exp, jti }`. Default `exp` is 1 hour, configurable per deploy. No refresh token in v0.2.0 — clients re-run challenge/token on expiry or `401 token_expired`.
  - **Sync calls** require `Authorization: Bearer <token>`. The server checks signature, `aud`, `exp`, and binds the JWT's `sub` to the request's `accountDid` and to every event's `accountDid` (mismatch → `403 did_mismatch`).
  - **Public-key recovery from `did:key`:** strip the `did:key:z` prefix, base58btc-multibase decode, verify the `0xed 0x01` multicodec prefix, take the next 32 bytes as the Ed25519 public key. Same routine used by the macOS app, the web app, and the backend (cross-tested via `docs/crypto-vectors.json`).
  - **Failure responses:** `400 invalid_did_jwt | invalid_did`; `401 bad_signature | bad_audience | unknown_challenge | bad_lifetime | missing_token | bad_token | token_expired`; `403 did_mismatch`. All `401`s carry `WWW-Authenticate: Bearer realm="cornertasks"`.
  - **Threat note:** "Knowing someone's `did:key` lets an attacker request a challenge but does not let them read, write, or delete events — they cannot produce a valid DID-JWT without the private key. A stolen bearer JWT grants full access until `exp` (default 1 hour); tokens are held in memory only, never on disk. The mnemonic is the only secret that fully compromises the account."
- **Worked examples:** include curl-able JSON for an upsert and a delete.

**Acceptance criteria:** doc exists, is complete, is referenced from `AGENTS.md` and the root `README.md`'s privacy section.

**Out of scope:** code.

---

## Iteration 5 — Backend impl

**Goal:** Implement push/pull per iteration 4.

**Deliverables:**
- DynamoDB single-table:
  - `PK = ACCOUNT#<accountDid>`, `SK = TASK#<taskId>`.
  - Attributes: `updatedAt`, `eventId`, `op`, `ciphertext`, `nonce`, optional `archivedCompletedAt`.
  - GSI on `(PK, updatedAt)` for `pull?since=...`.
- `push` handler: conditional write; reject events with `updatedAt <= stored.updatedAt` as `"stale"`. Reject malformed events as `"invalid"` (server cannot decrypt; only checks shape and field types). Validate with zod.
- `pull` handler: query GSI ascending; page if needed; filter `archivedCompletedAt` older than 60 days.
- **Auth handlers + Bearer middleware** (`backend/aws/src/handlers/auth/` and `backend/aws/src/lib/auth.ts`) per `docs/sync-protocol.md` §8:
  - `POST /v1/auth/challenge` — generate 32 random bytes (base64url), store `(accountDid, challenge) → expiresAt` in a DynamoDB `auth_challenges` table with TTL of 5 minutes (DDB native TTL on a `ttl` attribute). Return `{ challenge, audience, expiresAt }`. `audience` is read from the deploy's `CanonicalApiUrl` env var (set by SAM from the API Gateway stage URL).
  - `POST /v1/auth/token` — parse the DID-JWT, recover the Ed25519 public key from `accountDid`, verify the JWS signature with `@noble/ed25519`, check `iss`/`sub`/`aud`/`nonce`/`iat`/`exp` per spec, atomically delete the challenge row (conditional `DeleteItem` — replay attempts get `unknown_challenge`), then mint a server-issued bearer JWT.
  - Bearer JWT signing: server EdDSA keypair generated on first deploy, public key in SSM Parameter Store as a `String`, private key as `SecureString` at `/cornertasks/<stage>/jwt-signing-key`. CDK/SAM template provisions both. Default `exp = iat + 3600`. `HS256` mode (single `SecureString` secret) is supported via a `JWT_ALG` env var and documented in `backend/aws/README.md`.
  - `requireBearer(event)` middleware wrapped around both sync handlers: parse `Authorization: Bearer ...`, verify signature + `aud == "cornertasks-sync-v1"` + `exp`, extract `sub`, and assert it matches the request's `accountDid` and every event's `accountDid` (`403 did_mismatch` on disagreement).
  - All `401` responses include `WWW-Authenticate: Bearer realm="cornertasks"`.
- DynamoDB additions:
  - `auth_challenges` table (or a single-table item type with `PK = AUTHCHAL#<accountDid>`, `SK = <challenge>`, `ttl` attribute).
- Tests: dedup, staleness, since-filter, archive cutoff, **plus** auth tests:
  - challenge issued, consumed once, replay rejected as `unknown_challenge`;
  - DID-JWT verification: valid → token; wrong-key signature → `bad_signature`; swapped `aud` → `bad_audience`; `exp - iat > 300s` → `bad_lifetime`; malformed JWS → `400 invalid_did_jwt`;
  - Bearer middleware: valid → 200; tampered signature → `bad_token`; expired → `token_expired`; `sub` ≠ body `accountDid` → `did_mismatch`;
  - Integration test against `dynamodb-local` running the full challenge → token → push → pull round-trip.
- `backend/aws/scripts/sign-did-jwt.ts` — small helper (uses `@noble/ed25519`) that takes a mnemonic + `--audience` + `--challenge` and prints a DID-JWT, used by `docs/sync-protocol.md` §9 hand-testing examples.

**Acceptance criteria:** `npm test` passes; deploy to dev and run the curl round-trip from `docs/sync-protocol.md` end-to-end (challenge → token → push → pull).

**Out of scope:** clients (they call this auth path in iterations 11 and 12).

---

## Iteration 6 — Web app skeleton (mobile-first, local-only)

**Goal:** `apps/web/` with v0.1.0 macOS feature parity, fully offline.

**Decision:** Vite + React + TypeScript. Document in `apps/web/README.md`.

**Deliverables:**
- Vite + React + TypeScript scaffold.
- IndexedDB-backed `TaskStore` mirroring the Swift surface (`add`, `complete`, `updateTitle`, `setDueDate`, `deleteArchived`, `moveActive`).
- `DueStatus` ported verbatim (same five states, same colors).
- Mobile-first UI: full-screen on phones, capped-width column on desktop. Tabs for Tasks / Archive. Tap-to-complete (swipe optional). Drag-to-reorder via `@dnd-kit/core` (small, well-scoped).
- Cloud-sync defaults: **off**, no `backendURL` set. Same standalone story as macOS.
- Unit tests: `TaskStore` (`fake-indexeddb`) and `DueStatus`.
- `npm run build` produces `apps/web/dist/`.
- Deployment path: from `apps/web/dist/`, the user runs `cd ../../backend/aws && npm run deploy:web` (script defined in iteration 3) which uploads to the S3 bucket and invalidates CloudFront.
- Confirm in `apps/web/README.md`: the app is served only over HTTPS via CloudFront. Camera + clipboard APIs depend on this.

**Acceptance criteria:**
- `npm test` passes.
- Manual smoke on Chrome desktop + iOS Safari mobile viewport: add/edit/complete/delete persists across reload.
- `npm run deploy:web` against the dev stack from iteration 3 serves the app on `WebUrl`.

**Out of scope:** sync, crypto, account UI, camera scan.

---

## Iteration 7 — Crypto on macOS (Ed25519 + did:key + AES-GCM)

**Goal:** Identity is a self-sovereign DID; data encryption is a symmetric key derived from the same secret. Mnemonic remains the human-readable backup. The whole scheme is platform-portable and auditable.

**Scheme:**
- 12-word BIP-39 mnemonic (English wordlist).
- BIP-39 seed (64 bytes; passphrase `""`).
- **Ed25519 keypair** seeded from `HKDF-SHA256(seed, info="cornertasks-identity-ed25519", length=32)`. Why Ed25519: small, fast, supported by `did:key` natively (multicodec `0xed01`), available via `CryptoKit.Curve25519.Signing` on macOS and `@noble/ed25519` on web — no native deps either side.
- **`accountDid`** = `did:key:z` + base58btc-multibase(multicodec(0xed01) + Ed25519 public key (32 bytes)).
- **Data-encryption key** = `HKDF-SHA256(seed, info="cornertasks-encryption-aesgcm", length=32)`. Used as the AES-256-GCM key for all encrypted task fields.
- **Why two derivations:** identity (signing) and confidentiality (encryption) get independent keys with domain-separated `info` strings. If we later add request signing or per-device subkeys, this lets them grow without retrofitting.
- **Decryption with someone else's DID is impossible** — decryption requires the seed, which never leaves a device. The DID alone is public.
- The mnemonic is the only thing the user needs to back up. Everything else is deterministically derived.

**Deliverables (`apps/macos/Sources/CornerTasks/Crypto/`):**
- `Mnemonic.swift` — generate, validate, BIP-39 seed.
- `Identity.swift` — Ed25519 keypair from seed; `accountDid` string; `sign(message:)` / `verify(signature:message:)`; plus `makeDidJwt(audience:nonce:)` that emits a compact JWS (`alg: "EdDSA"`, `kid: "<did>#<methodSpecificId>"`, claims `{ iss, sub, aud, nonce, iat, exp }` with `exp = iat + 300`) per `docs/sync-protocol.md` §8.2. Used by the sync engine to acquire bearer tokens (iteration 11).
- `DataKey.swift` — HKDF → 32-byte symmetric key.
- `SymmetricBox.swift` — AES-256-GCM encrypt/decrypt via `CryptoKit.AES.GCM`. Returns `(ciphertext, nonce)`.
- `MnemonicStore.swift` — Keychain (service `com.cornertasks.mnemonic`).
- Tests:
  - BIP-39 known-answer vector.
  - Mnemonic → DID is stable across runs.
  - Round-trip encrypt/decrypt; wrong key throws.
  - did:key encoding matches the W3C DID spec test vector for Ed25519.
  - DID-JWT structural vector: for a fixed mnemonic + audience + nonce + iat, the header and payload base64url-encodings in the compact JWS match `docs/crypto-vectors.json`, and the signature verifies against the account's public key. The signature itself is **not** byte-stable because Apple `CryptoKit`'s Ed25519 is randomized; this is acceptable per RFC 8032 §5.1.6 (any valid signature verifies). Iteration 8 (web, `@noble/ed25519`) asserts the same structural fields and verifies its own signature; both signatures are verifiable by either implementation.
  - Cross-impl fixtures (a known mnemonic → expected DID, expected HKDF key hex, expected ciphertext for fixed plaintext+nonce, expected DID-JWT header+payload for fixed audience+nonce+iat) emitted to `docs/crypto-vectors.json` for iteration 8 to consume.

**Acceptance criteria:** `swift test` passes. No UI changes. `docs/crypto-vectors.json` exists.

---

## Iteration 8 — Crypto on web (same scheme)

**Goal:** Byte-for-byte compatible with macOS.

**Deliverables (`apps/web/src/crypto/`):**
- `@scure/bip39` for mnemonic + seed.
- `@noble/ed25519` for Ed25519 (small, audited, no native deps).
- WebCrypto for HKDF + AES-GCM.
- did:key encoder/decoder using `@scure/base` for base58btc (decoder also used by the backend's auth middleware in iteration 5 — share the helper from `apps/web/src/crypto/` or copy verbatim with a vector test that asserts equivalence).
- `sign(message)` / `verify(signature, message, publicKey)` helpers used by the web sync engine (iteration 12) and reused in the backend auth middleware.
- `makeDidJwt({ audience, nonce })` mirroring the macOS helper from iteration 7 — emits a compact JWS (`alg: "EdDSA"`, `kid: "<did>#<methodSpecificId>"`, claims `{ iss, sub, aud, nonce, iat, exp }` with `exp = iat + 300`). Tested against the DID-JWT vector in `docs/crypto-vectors.json` so macOS and web produce byte-identical JWTs for the same inputs.
- Mnemonic stored in IndexedDB under one keyed entry, with `// SENSITIVE` comments and a clearly-marked accessor.
- TS unit tests:
  - Round-trip encrypt/decrypt.
  - Read `docs/crypto-vectors.json` from iteration 7 and assert that mnemonic → DID, → HKDF key, and → ciphertext match exactly. **This file is the contract that prevents drift.**

**Acceptance criteria:** `npm test` passes; vectors match.

---

## Iteration 9 — Account UI on macOS (standalone-first)

**Goal:** Cloud sync stays **off** by default. The Account/Cloud-sync section makes the trade-off explicit. The DID is always visible once a key exists.

**Deliverables:**
- Settings → "Cloud Sync" panel. While disabled it shows:
  - **"Cloud sync is off. Your tasks stay on this Mac."**
  - **Enable cloud sync** button → opens the chooser modal.
  - Explanatory copy: *"You can stay offline forever. If you decide to enable later, you can either generate a new key (a brand new account) or import an existing key from another device (this Mac will join that account and **merge** its tasks with the existing ones)."*
- Chooser modal — only shown when the user opts in (no forced first-run prompt):
  - **Generate new key** — creates mnemonic + DID. Shows the 12 words and the DID. Requires checkbox "I have backed up these words" before continuing.
  - **Import from mnemonic** — text field, 12 words, BIP-39 checksum-validated.
  - (QR scanning is web-only in iteration 10; macOS shows the QR for the web side to scan.)
  - **Big red merge warning** in the import branch: *"If this key already controls another account on the cloud, the tasks on this Mac will be merged with that account's tasks. This cannot be undone."* Same wording as web iteration 10.
- Backend URL field: paste the `ApiUrl` from your own deployment (iteration 3). Required to actually enable. Validated via `GET /v1/sync/pull?accountDid=…&since=2099-01-01T00:00:00Z` ping that should return `{ events: [], serverTime }`.
- Account section displays (whenever a key exists, even with cloud sync off):
  - The `did:key` (selectable, copyable, monospaced).
  - "Show mnemonic" — reveal-on-click, with caution.
  - "Show QR code" — renders QR of the mnemonic via `CIFilter.qrCodeGenerator()` (no dependency).
  - "Disable cloud sync" — flips the prefs; in-flight sync timers stop. Local data untouched.
  - "Forget this device" — wipes mnemonic from Keychain after double-confirm. Local SQLite stays. Cloud sync flips off.
- v0.1.0 users: existing tasks remain on disk untouched. They simply see "Cloud sync is off" in settings. No forced migration prompt.

**Acceptance criteria:** Manual: chooser flows produce a stable DID; QR generated here scans cleanly with iPhone camera; ping validates the `ApiUrl`; disabling cloud sync stops timers (verified once iteration 11 lands).

**Out of scope:** running the actual sync engine.

---

## Iteration 10 — Account UI on web (with QR scan)

**Goal:** Same flows as iteration 9 plus camera-based QR scan that lets a user join an account from a macOS device.

**Deliverables:**
- Same default: cloud sync **off** until the user enables it.
- Enable flow with three options:
  - **Generate new key** (new account; show mnemonic + DID + downloadable QR).
  - **Paste mnemonic.**
  - **Scan QR** via `getUserMedia` + `jsqr`.
- Same big red merge warning, same wording as macOS.
- Backend URL field with the same ping validation.
- DID always visible in Account view once a key exists.
- Tests for parse/validate paths.
- Note: camera + clipboard APIs require HTTPS, which is satisfied by the CloudFront/S3 setup from iteration 3 (the `http://` S3 website endpoint won't work for camera).

**Acceptance criteria:** Manual: scan the QR rendered by macOS iteration 9 → web unlocks the same `did:key`.

---

## Iteration 11 — Sync engine on macOS

**Goal:** Make sync actually work. Engine is started only while `Prefs.cloudSyncEnabled == true` and `Prefs.backendURL != nil`.

**Deliverables:**
- Schema change: `tasks` gains `updated_at REAL NOT NULL` and `deleted_at REAL` columns. Migrate existing rows: `updated_at = max(created_at, completed_at, due_date)` once.
- New `sync_queue` table: `(event_id TEXT PRIMARY KEY, task_id TEXT, op TEXT, payload BLOB, created_at REAL, sent_at REAL NULL)`.
- `Sync/SyncEngine.swift`:
  - On every `TaskStore` mutation, insert a queue row with the encrypted payload built from the task's current state.
  - `flushPushes()` every 10 minutes via `Timer.scheduledTimer` and on app launch. Sends rows where `sent_at IS NULL`. Marks accepted IDs and `"stale"`-rejected IDs as sent.
  - `pullSince()` every 1 minute. Decrypts and applies events with `updatedAt > local`. Advances `lastSyncedAt`.
- Archive cutoff: when building a push for a task with `completedAt < now - 60d`, skip it and mark the queue row sent.
- `SyncTransport` protocol → `URLSessionTransport` (real) and `FakeTransport` (tests).
- `Sync/AuthSession.swift` — owns the bearer-token lifecycle per `docs/sync-protocol.md` §8:
  - On first sync call (or whenever the cached token is within 60 s of `expiresAt`), runs the challenge flow: `POST /v1/auth/challenge` → `Identity.makeDidJwt(audience:nonce:)` → `POST /v1/auth/token` → cache `{ accessToken, expiresAt }` in memory only (never on disk).
  - Exposes `withBearer { token in ... }` that the transport uses to attach `Authorization: Bearer <token>`.
  - On `401 token_expired` or `401 bad_token`, drops the cached token and retries the *original* sync request once with a fresh token before giving up for this tick.
- Tests:
  - Round-trip via fake transport.
  - Stale-write rejection handled.
  - Archive cutoff respected on push.
  - Pull merges respect last-writer-wins.
  - Engine does nothing while cloud sync is disabled.
  - `AuthSession` unit tests: caches token until near-expiry; refreshes proactively; on `401 token_expired` drops cache and re-authenticates exactly once before failing the tick; never persists the token.
  - DID-JWT produced by the engine matches the spec vector from iteration 7.
  - 401 handling on sync calls: `bad_token`/`token_expired` triggers re-auth + single retry; `did_mismatch` is logged as a programming error and does not retry. Queue rows are NOT marked sent on auth failures — they retry on the next tick.

**Acceptance criteria:** `swift test` passes; manual: two macOS instances on the same mnemonic + same `ApiUrl` (different `~/Library/...` paths via the iteration-2 directory init) converge within ~1 minute.

---

## Iteration 12 — Sync engine on web

**Goal:** Mirror the macOS sync engine on the web client. Same wire format, same timer cadence, same conflict rules, same auth lifecycle. Only the persistence (IndexedDB) and the activation hooks (`visibilitychange`) differ.

**Reference:** the macOS engine lives under `apps/macos/Sources/CornerTasks/Sync/` (iteration 11). Mirror its structure and naming where possible — divergence makes the smoke test (`backend/aws/scripts/sync-doctor.ts`) less load-bearing.

**Deliverables:**
- IndexedDB schema gains the same fields as the macOS SQLite schema:
  - `tasks` object store: each row carries `updatedAt: number` (epoch ms) and optional `deletedAt: number`. Migrate existing rows once with `updatedAt = max(createdAt, completedAt, dueDate)`.
  - new `syncQueue` object store keyed by `eventId` with shape `{ eventId, taskId, op, payloadJSON: ArrayBuffer | string, createdAt, sentAt? }`.
- `apps/web/src/sync/syncEvent.ts` — typed `SyncEvent`, `EventPlaintext`, fixed-key-order JSON encoder (title, createdAt, completedAt, dueDate, order — same byte sequence as macOS, asserted by `docs/crypto-vectors.json`), AES-256-GCM seal/open with the §4 AAD.
- `apps/web/src/sync/syncTransport.ts` — protocol with `challenge`, `token`, `push`, `pull`. `FetchTransport` (real) + `FakeTransport` (tests). 401/403 mapping to typed errors (`tokenExpired`, `badToken`, `didMismatch`, `http`). The DID-JWT used at `/v1/auth/token` MUST be produced by the iteration 8 `makeDidJwt(audience, nonce, iat)` helper — no second implementation.
- `apps/web/src/sync/authSession.ts` — bearer-token lifecycle matching macOS `AuthSession`:
  - In-memory only. Token MUST NOT be written to IndexedDB or `localStorage`. A unit test creates a fresh `AuthSession` and asserts no token leaks across instances.
  - Caches until `expiresAt - 60s`, then refreshes proactively.
  - `withBearer` / `bearer()` accessor + `invalidate()`.
  - On `401 token_expired` / `401 bad_token`, drops cache and retries once; persistent failure leaves the call unauthorized (the engine retries on the next tick).
- `apps/web/src/sync/SyncEngine.ts`:
  - `start()` installs an `eventBuilder` on the local `TaskStore` that — exactly like the macOS `TaskStore.eventBuilder` — receives a `TaskMutationSnapshot` for every local mutation and returns the encrypted `SyncEvent` to insert into `syncQueue`. While cloud sync is disabled, no builder is installed → the queue stays empty → no network calls.
  - `flushPushes()` every 10 minutes (and on start). Reads `syncQueue` rows where `sentAt == undefined`, applies the 60-day archive cutoff at flush time (skip + mark sent for upserts whose task `completedAt < now - 60d`), POSTs the rest, marks `accepted` + `stale`-rejected as sent. Rows are NOT marked sent on auth failures.
  - `pullSince()` every 1 minute. Calls `/v1/sync/pull?since=<lastSyncedAt>`, decrypts and applies events with last-writer-wins (`updatedAt` strictly newer wins; equal `updatedAt` falls back to lexicographic `eventId`). Advances `lastSyncedAt` to `serverTime`.
  - `stop()` cancels timers, removes the `eventBuilder`, releases the `visibilitychange` listener.
  - Tab visibility: when `document.hidden`, the periodic timers pause (clear them — no busy ticking on a backgrounded tab). On `visibilitychange → visible` resume the timers AND immediately call `pullSince()` + `flushPushes()` so a freshly-foregrounded tab catches up.
- `apps/web/src/storage/TaskStore.ts` (or equivalent) gets the same surface that the macOS store gained in iteration 11: `eventBuilder`, `pendingQueueRows()`, `markQueueRowsSent(...)`, `taskCompletedAt(...)`, `applyRemoteUpsert(...)`, `applyRemoteDelete(...)`. The remote-application helpers are pure: no event re-enqueued from a pulled event.
- `lastSyncedAt` persisted in `localStorage` under `cornertasks.sync.lastSyncedAt`. `deviceId` persisted under `cornertasks.sync.deviceId` (random UUID, generated once).
- Notification / event hook so the settings UI can start/stop the engine without reload (mirrors the macOS `cornerTasksCloudSyncChanged` notification).
- **`apps/web/src/sync/BackendPing.ts` already aligned** (landed alongside iteration 11's macOS hotfix): the Test button in Settings hits `POST /v1/auth/challenge` — the only sync endpoint that does NOT require a bearer — and verifies the response's `audience` is byte-equal (modulo trailing slash + case) to the typed `ApiUrl`. The new typed error variant is `audienceMismatch { expected, got }`. While building iteration 12, do not regress this back to `/v1/sync/pull`; the sync engine itself uses `SyncTransport.pull` with a bearer token, the ping is intentionally a separate, unauthenticated reachability probe.
- **Reveal gate before showing the mnemonic / QR code.** Mirror the macOS `RevealGate` (LocalAuthentication, `LAPolicy.deviceOwnerAuthentication`, reuse duration 0). The web equivalent must also be a fresh, per-reveal user gesture that is **independent of how the mnemonic is stored** — IndexedDB has no "Always Allow" affordance, but a bystander on an unlocked browser session would otherwise be one click away from the secret.
  - `apps/web/src/crypto/RevealGate.ts` — async `require(reason: string): Promise<boolean>`. Returns `true` only on a fresh successful authentication.
  - Implementation (revised 2026-05-07): WebAuthn platform passkey, with the mnemonic-tail challenge as a fallback when WebAuthn is unavailable. Because WebAuthn `get()` requires an existing credential, the gate **registers a discoverable platform credential on the first reveal** (one Touch ID / Windows Hello / Android biometric prompt — that successful registration counts as the auth proof). The credential id is stored in `localStorage` under `cornertasks.reveal.credentialId`; subsequent reveals call `navigator.credentials.get` with `allowCredentials: [{id: <storedId>, transports: ["internal"]}]`, which scopes the prompt to that local passkey and avoids the OS cross-device picker. "Forget this device" clears the credential id so re-enabling later starts a fresh registration.
  - Wire it into `SettingsPanel.tsx`: the "Show mnemonic" and "Show QR code" `<details>` elements MUST NOT render the secret until `RevealGate.require(...)` resolves true. Failure or cancellation collapses the disclosure with no leak.
  - The `EnableCloudSyncSheet` `generated` step (which shows the mnemonic + QR right after generation) is exempt — the user just generated the key and is being told to back it up. Subsequent reveals from the Account section go through the gate.
  - Do NOT cache reveal-gate success across disclosure toggles. Each open-of-disclosure runs the prompt fresh.
- **IndexedDB equivalent of `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` is the database itself** — IndexedDB is per-origin, per-browser-profile, and never syncs across devices. Document this in code comments where the mnemonic is stored, and explicitly set `// SENSITIVE` markers on the read/write paths so future contributors don't move the mnemonic into `localStorage` (which can be read synchronously from any same-origin script and is more leak-prone).

**Tests** (Vitest, with a `FakeTransport`):
- Round-trip via `FakeTransport`: enqueue an upsert, `flushPushes()` posts the encrypted event, ciphertext decrypts back to the cleartext snapshot.
- Stale-write rejection (`{ eventId, reason: "stale" }`) marks the queue row sent — same outcome as `accepted`.
- Archive cutoff: an upsert for a task with `completedAt < now - 60d` is skipped at flush time and marked sent without a network call.
- Pull merges respect last-writer-wins (newer wins, older ignored, tie broken by `eventId`).
- Engine does nothing while cloud sync is disabled: a `TaskStore` mutation produces zero `syncQueue` rows when no `eventBuilder` is installed.
- Tab visibility: when `document.hidden`, no push/pull fires; on `visibilitychange → visible`, both fire immediately.
- `AuthSession`: caches until near-expiry; refreshes proactively; on `401 token_expired` drops cache and re-authenticates exactly once before failing the tick; never persists the token (parity test against the macOS suite).
- DID-JWT cross-implementation parity: extends `docs/crypto-vectors.json` with a fixed `(audience, nonce, iat)` → `didJwtHeaderB64Url + didJwtPayloadB64Url` entry, asserted by both apps. (The signature segment is checked for verification only — Apple's CryptoKit signs randomized.)
- 401 handling on sync calls: `bad_token`/`token_expired` triggers re-auth + single retry; `did_mismatch` is logged as a programming error and does not retry.
- `BackendPing` (web): unit tests assert it hits `/v1/auth/challenge`, surfaces `audienceMismatch` when the deploy advertises a different canonical URL than the user typed, and surfaces the server's `reason` field on non-2xx (parity with `apps/web/tests/BackendPing.test.ts` as it stands today — keep them green).
- `RevealGate` (web): unit tests via a test seam (`RevealGate.override = async () => true | false`). With `true`, the "Show mnemonic" disclosure expands and renders the secret; with `false`, the disclosure stays collapsed and `account.mnemonic` is never read. A second test asserts the gate writes nothing to `localStorage` or IndexedDB — its decision must not persist across reveals.

**Smoke-test parity:** every web change that touches the wire format (header order, encoder, DID-JWT shape, error mapping) MUST keep `npm run smoke-test --workspace backend/aws` green against a deployed dev stack. CI runs `sync-doctor` after every backend deploy and on PRs that touch `apps/`, `backend/`, or `docs/sync-protocol.md` — see `.github/workflows/smoke-test.yml`.

**Out of scope:**
- Service-Worker-backed background sync.
- Conflict resolution beyond last-writer-wins.

---

## Iteration 13 — End-to-end verification

**Goal:** Confirm one mnemonic works across one macOS device and one web device on a clean BYO-AWS deployment.

**Deliverables:** `docs/e2e-test.md`:
1. On macOS: enable cloud sync, generate mnemonic, paste your `ApiUrl`. Note the DID.
2. On web (served from your CloudFront): enable cloud sync, scan the QR. DID must match.
3. Add a task on macOS → appears on web within ~1 minute.
4. Edit on web → appears on macOS within ~1 minute.
5. Archive a task with `completedAt = 70 days ago` → does NOT propagate.
6. Delete on one → tombstones the other.
7. Disable cloud sync on web → further changes do not propagate. Re-enable → they catch up.
8. Standalone-mode regression: a fresh macOS install with cloud sync off makes zero outbound network calls (verify with Little Snitch or `tcpdump`).

Each bug found gets a regression test in iterations 11 or 12 as appropriate.

**Acceptance criteria:** the script passes end-to-end.

---

## Iteration 14 — Release v0.2.0

**Goal:** Cut the release.

**Deliverables:**
- Bump `apps/macos/AppBundle/Info.plist` `CFBundleVersion` and `CFBundleShortVersionString` to `0.2.0`.
- Bump `apps/web/package.json` version.
- Update README "Version" line and changelog table.
- Confirm released DMG starts with cloud sync **off** and no `backendURL` baked in.
- Tag `v0.2.0`. Verify the GitHub Actions release workflow attaches the universal DMG. (No AWS secrets are involved in this workflow; it must remain that way.)

**Out of scope:** notarization, App Store submission, public hosting of the web app on the maintainer's behalf.

---

## Open questions (resolve before the iteration that needs each)

- **Where to derive Ed25519 from BIP-39 seed:** simplest is `HKDF-SHA256(seed, info="cornertasks-identity-ed25519", 32)` → seed for Ed25519. Alternative: SLIP-0010 / BIP32-Ed25519. Going with HKDF for simplicity unless a contributor argues for SLIP-0010 with a concrete reason.
- **CloudFront price class** in iteration 3: default to `PriceClass_100` (US/EU) to keep BYO-AWS bills small; document that users can change it in `template.yaml`.
- ~~**Future request signing**~~ (resolved 2026-05-05): Ed25519 request signing is part of v0.2.0 — specified in iteration 4, enforced by the backend in iteration 5, and emitted by clients in iterations 11 and 12. See `docs/sync-protocol.md` §8.

---

# v0.3.0 Iterations

Ordered work plan to take CornerTasks from v0.2.x (REST pull/push sync against
a self-deployed AWS backend, mnemonic/`did:key` identity) to v0.3.0: a
**real-world example of the First Person Project (FPP)** — per-device
identities under a `did:webvh` account, DIDComm v2.1 sync through a blind
mediator, a personal VTA on a Raspberry Pi at home, and AI agents with their
own accountable DIDs.

**Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before any iteration.**
It is the architectural contract for this release: FPP concept mapping, the
discovery model (the account DID document is the *only* client configuration),
key separation, the outbound-only networking constraints, and the upstream
pins. When an iteration below and that document disagree, fix whichever is
wrong first, in its own commit.

## Goals (v0.3.0)

1. **FPP-native identity.** One `did:webvh` account hosted by a personal
   `vta-service` (VTI); each client device is a PNM with its own `did:peer`
   enrolled in a *CornerTasks context*; device revocation is per-device.
2. **Replace REST pull/push with DIDComm v2.1 sync** through the Affinidi
   mediator (fjall backend, no Redis): store-and-forward, offline pickup, no
   central task storage anywhere.
3. **Zero-URL client configuration.** Apps take exactly one setting — the
   account DID. Mediator and VTA endpoints are discovered from DID-document
   service entries. Moving infrastructure = rotating a service entry, never
   touching a client.
4. **Self-hosted on a Raspberry Pi behind Starlink CGNAT**, reachable via
   Cloudflare Tunnel; everything under `deploy/` is `.env`-driven so anyone
   can stand up the same stack on their own domain. VTA and mediator are
   separable services reusable beyond CornerTasks.
5. **Connection-status indicator** in both apps: one colored-circle + phrase
   vocabulary, identical across macOS and web, driven by the DIDComm session
   state machine.
6. **Local AI-agent access (MCP)** with per-agent DIDs and narrow ACLs:
   accountable, revocable delegation per White Paper Part 8. No cloud agent
   endpoints.
7. **Hard cut from AWS.** `backend/aws/` and the v1/v2 REST-era protocol are
   archived at release. Local task data survives; accounts re-onboard.

## How to use this file (v0.3.0)

Same rules as v0.2.0:

- One PR per iteration, in order. Don't bundle two.
- Re-read [`AGENTS.md`](AGENTS.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
  before starting.
- Each iteration lists **Goal**, **Deliverables**, **Acceptance criteria**,
  **Out of scope**. If scope must grow, edit this file first and flag it in
  the PR.
- Tick the iteration's checkbox below when its PR is merged. Update affected
  docs (README, AGENTS.md, `docs/sync-protocol.md`, `docs/ARCHITECTURE.md`)
  in the same PR.
- Every iteration that adds non-UI logic must add unit tests for that logic.
  UI iterations include at least manual smoke notes.
- Don't introduce new dependencies unless a deliverable names them.
- **Upstream code beats upstream docs.** VTI's READMEs can lag its code; when
  an iteration depends on VTI or Affinidi-messaging behavior, verify against
  the pinned source tree, not prose.

## Status

- [ ] **15.** FPP walking skeleton — pin VTI, run VTA + mediator locally, exchange one DIDComm message between two peers. Go/no-go on the release risks.
- [ ] **16.** Sync protocol v3 spec — sync events over DIDComm, enrollment, revocation (`docs/sync-protocol.md` §10).
- [ ] **17.** `deploy/` stack — systemd-run native binaries (vta-service + mediator + cloudflared, no Docker), `.env`-driven, aarch64 cross-build, Raspberry Pi runbook.
- [ ] **18.** Account bootstrap — account `did:webvh` with mediator service entry, CornerTasks context, device-enrollment (OOB/QR) tooling.
- [ ] **19.** macOS PNM core — `vta-mobile-core` via UniFFI → Swift; device `did:peer` in Keychain; DIDComm session to the mediator.
- [ ] **20.** Web PNM core — TypeScript DIDComm client with the same contract.
- [ ] **21.** macOS sync engine v3 — events over DIDComm, pickup on start, LWW unchanged.
- [ ] **22.** Web sync engine v3 — same, plus tab-visibility handling.
- [ ] **23.** Connection-status indicator — design/ schema first, then macOS + web.
- [ ] **24.** Settings v2 — account-DID-only configuration, device list + revoke, onboarding QR.
- [ ] **25.** Local MCP server — task tools + per-agent DID enrollment and ACLs.
- [ ] **26.** End-to-end on real hardware — full Pi runbook executed from scratch; two devices + one agent converge.
- [ ] **27.** Release v0.3.0 — archive `backend/aws/`, version bumps, migration notes.

---

## Iteration 15 — FPP walking skeleton (spike, timeboxed)

**Goal:** Prove the load-bearing assumptions on real code before anything else
is built, and pin the upstream we build on. This iteration produces running
scripts and recorded decisions, not app code.

**Deliverables:**

- `deploy/upstream.lock` (or equivalent recorded pin): the exact
  `OpenVTC/verifiable-trust-infrastructure` commit and the
  `affinidi-messaging-mediator` version it resolves, plus the Rust toolchain
  version that builds them.
- A `deploy/spike/` script (or Makefile target) that, on a dev machine:
  1. Builds and starts `vta-service` (webvh feature) and
     `affinidi-messaging-mediator` (**fjall backend — no Redis**) locally.
  2. Creates an account `did:webvh` whose DID document carries a
     `DIDCommMessaging` service entry referencing the mediator's DID
     (the flow in `vta-service/src/did_webvh.rs`), and verifies
     `curl …/did.jsonl` resolves.
  3. Enrolls two peer DIDs and sends one authcrypted DIDComm message from
     peer A, delivered to peer B via mediator **pickup** while B was offline
     at send time.
- Recorded go/no-go answers, appended to the **Open questions** section below:
  - **Web client stack**: which TypeScript DIDComm v2 library (or WASM build
    of the Rust core) will iteration 20 use? Name it, with a one-paragraph
    justification and a spike snippet proving connect + authcrypt against the
    local mediator.
  - **fjall feature gap**: confirm nothing v0.3.0 needs is redis-backend-only
    (check the mediator's `Cargo.toml` feature comments at the pinned
    version).
  - **aarch64**: confirm both services cross-compile for aarch64 (e.g. via
    `cross` or `cargo-zigbuild`; record the working method for iteration 17).
  - **Memory footprint**: measure idle + under-sync RSS of `vta-service` and
    the mediator on the dev machine. The hardware target is a Pi Zero 2 W
    (512 MB) running the binaries under systemd — no Docker — with a
    ≤ 400 MB total-stack budget (see `docs/ARCHITECTURE.md`); record the
    numbers and whether zram is needed.
- `docs/ARCHITECTURE.md` amended with anything the spike proved wrong.

**Acceptance criteria:** one command brings up the local skeleton and the
offline-pickup message round-trip passes; the three go/no-go answers are
written down; the pin is committed. If the web-client answer is "months of
work", stop and re-plan iterations 20/22 (macOS-first fallback) before
proceeding.

**Out of scope:** Raspberry Pi, Cloudflare, any app code, any protocol spec.

---

## Iteration 16 — Sync protocol v3 spec

**Goal:** Specify CornerTasks sync as DIDComm v2.1 messages, precisely enough
that iterations 19–22 implement from the spec without re-deciding anything.
Added as **§10** of `docs/sync-protocol.md`; §5–§8 (REST era) are marked
*superseded, removed at v0.3.0 release*.

**Deliverables — `docs/sync-protocol.md` §10:**

- **Message types** (DIDComm `type` URIs under a CornerTasks namespace):
  task sync event (create/update/archive/delete — reusing the v0.2.0 event
  payload shape and field names where they still fit), full-state offer +
  request (new-device bootstrap from a peer), device-enrolled and
  device-revoked notifications.
- **Addressing:** every event is authcrypted from the sending device DID to
  each enrolled peer DID individually, routed via the account's mediator.
  Define how a device learns the current peer-DID set (context membership via
  the VTA) and how often it refreshes it.
- **Ordering & conflicts:** last-writer-wins by event `updatedAt`, unchanged.
  Define the tie-breaker (device DID lexicographic) and idempotent re-delivery
  handling (mediator pickup may re-deliver; events carry the v0.2.0 `eventId`).
- **Archive cutoff:** 60 days, unchanged; applies to both send and apply.
- **Enrollment & revocation:** the out-of-band invitation flow (QR), approval
  by an existing device, the VTA context ACL update, and what a revoked device
  can still see (nothing new after revocation; define the crypto boundary
  honestly — messages already delivered are already readable).
- **Discovery:** normative statement that the account DID document is the only
  client input; resolution chain per `docs/ARCHITECTURE.md`.
- **Threat model table** updated for the new topology (mediator, VTA, ingress,
  device compromise).

**Acceptance criteria:** two independent readers (macOS and web implementers —
in practice, the agents executing iterations 19–22) can implement from §10
alone; every message type has a full JSON example; `docs/e2e-test.md` gains a
protocol-level walkthrough. Spec reviewed against the *pinned* VTI/mediator
code, not upstream docs.

**Out of scope:** implementation; backup formats; VTC/shared lists.

---

## Iteration 17 — `deploy/` stack (systemd binaries, .env, Raspberry Pi)

**Goal:** Anyone with a domain and a Raspberry Pi can stand up the VTA +
mediator + tunnel by copying cross-compiled binaries and running one install
script with a filled-in `.env`. **No Docker on the Pi** — the three services
run as native binaries under systemd (lowest RAM overhead on the 512 MB
target, one less moving part). This is the "buy a Pi and it works"
deliverable.

**Deliverables:**

- `deploy/systemd/` unit files for three services: `ct-vta` (vta-service,
  webvh feature), `ct-mediator` (affinidi-messaging-mediator, fjall backend),
  `cloudflared` (Cloudflare Tunnel; use the vendor's own unit if it fits).
  Units get `Restart=on-failure`, are `enabled` for boot, load their config
  from an `EnvironmentFile`, and run as a dedicated non-root user. VTA and
  mediator stay independent — separate units, separate data dirs, no hidden
  coupling — so either can later move to other hardware by editing DID
  service entries only.
- `deploy/.env.example` documenting every variable: domain, DID path layout
  (root vs pathful — default pathful, e.g. `/<name>/vta/did.jsonl`, so one
  domain hosts many identities), ports, data dirs, secrets backend, tunnel
  credentials, upstream pin. **No secrets, no personal domains committed.**
- `deploy/build.sh` — cross-compiles both Rust services for `aarch64` (and
  `x86_64` for CI/dev) from the pinned VTI commit, e.g. via `cross` or
  `cargo-zigbuild`; the method is recorded in the script. Rust is never
  compiled on the Pi.
- `deploy/install.sh` — idempotent: copies binaries + units onto the Pi,
  creates the service user and data dirs, renders `EnvironmentFile`s from
  `.env`, `systemctl enable --now`s the units.
- `deploy/dev.sh` — runs the same two binaries (x86_64/host build) in the
  foreground on a dev machine with throwaway data dirs; this **dev stack** is
  what iterations 18–22 and CI test against.
- `deploy/README.md` runbook, written to be executed by a person from zero:
  flash Raspberry Pi OS Lite (64-bit) → clone → fill `.env` → create the
  Cloudflare Tunnel (step-by-step incl. DNS record) → run `install.sh` →
  verify `https://<domain>/…/did.jsonl` from an external network. Include an
  "ingress alternatives" section (Tailscale Funnel / VPS+WireGuard / IPv6)
  noting only `deploy/` changes, clients never do.
- CI job that boots the dev stack (x86_64 binaries, no Docker) and curls the
  mediator health endpoint + a did.jsonl.

**Acceptance criteria:** fresh clone + valid `.env` on an x86_64 host passes
the CI checks locally; the runbook contains every command a Pi setup needs
(actual-hardware execution is iteration 26). `make design-validate` untouched.

**Out of scope:** account/context creation (iteration 18); TEE/Nitro; Redis;
Docker/compose packaging (fine to add later for non-Pi hosts, not in
v0.3.0); publishing prebuilt binaries (documented as "build your own").

---

## Iteration 18 — Account bootstrap: DID, context, enrollment tooling

**Goal:** Scripted, repeatable creation of the account identity and the
CornerTasks context on a running `deploy/` stack, plus the tooling that
enrolls and revokes device/agent DIDs. CLI-level only — apps come later.

**Deliverables:**

- `deploy/bootstrap/` scripts (wrapping `vta-service` setup flows and/or
  `pnm-cli` from the pinned VTI tree — verify against code, not READMEs):
  - `create-account`: creates the account `did:webvh` on the VTA with a
    `DIDCommMessaging` service entry pointing at the mediator's DID; prints
    the account DID. Idempotence: re-running against an initialized data dir
    is a hard error, not a wipe.
  - `create-context`: creates the *CornerTasks* context with a member-set ACL
    (device DIDs + agent DIDs with role labels).
  - `enroll-device` / `revoke-device`: issues a DIDComm out-of-band invitation
    (QR-encodable payload) for a new device; revocation removes the DID from
    the context and rotates the peer set. `list-members` prints the context
    membership.
- Unit/integration tests (against the dev stack (`deploy/dev.sh`) in CI): create → enroll
  two synthetic devices → exchange a §10 sync event → revoke one → verify the
  revoked DID stops receiving new events.
- `docs/sync-protocol.md` §10 corrections if the implementation contradicts
  the spec (spec first, then code — same rule as always).

**Acceptance criteria:** from a fresh dev stack, three commands produce a
resolvable account DID, a context, and a scannable enrollment QR payload; the
CI test above is green.

**Out of scope:** app UI for any of this (iteration 24); agent ACL specifics
beyond a role label (iteration 25).

---

## Iteration 19 — macOS PNM core

**Goal:** The macOS app gains an FPP identity/messaging core: a device
`did:peer` in the Keychain, DID resolution, and an authenticated DIDComm
session to the mediator discovered from the account DID. No sync-engine
changes yet.

**Deliverables:**

- `vta-mobile-core` (from the pinned VTI commit) built as an xcframework via
  UniFFI and vendored under `apps/macos/` (build scripted in `build.sh`;
  document the toolchain in `apps/macos/README` notes). If `vta-mobile-core`
  proves unusable for macOS targets, fall back to bridging the same Rust
  crates directly — record the decision in this file first.
- New `Sources/CornerTasks/FPP/` module: device-key creation (`did:peer`,
  private key as `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, on-demand
  Keychain access per the v0.2.0 rules), account-DID resolution
  (did.jsonl fetch + chain verification via the Rust core), mediator session
  (connect, authcrypt send, pickup receive), enrollment handshake
  (consume an iteration-18 OOB invitation).
- The old `Crypto/` mnemonic path stays untouched and functional in this
  iteration (removal is iteration 21/27).
- Unit tests: key lifecycle, resolution against fixture did.jsonl logs
  (valid, tampered, wrong-SCID), session state machine against a stubbed
  mediator; integration test against the dev stack where CI allows.

**Acceptance criteria:** `swift test` green; a debug harness in the app
connects to a local dev stack, enrolls via QR payload, and round-trips a
raw DIDComm message. `RevealGate` semantics preserved for any secret display.

**Out of scope:** sync events (iteration 21); Settings UI (24); removing the
mnemonic path.

---

## Iteration 20 — Web PNM core

**Goal:** The same identity/messaging contract as iteration 19 for the web
app, using the TypeScript DIDComm stack chosen in iteration 15.

**Deliverables:**

- `apps/web/src/fpp/`: device `did:peer` keys in IndexedDB (marked
  `// SENSITIVE`), account-DID resolution with webvh log verification,
  mediator session over WSS (connect / authcrypt / pickup), OOB-invitation
  consumption (camera QR scan reusing the v0.2.0 scan component).
- The dependency decision from iteration 15 recorded in the PR per AGENTS.md's
  external-library rule (which library, why, what native/browser gaps it
  covers).
- Vitest suites mirroring iteration 19's: key lifecycle, resolution fixtures
  (valid/tampered/wrong-SCID), session state machine against a mock mediator.

**Acceptance criteria:** `npm test --workspace apps/web` green; a debug page
connects to the local dev stack and round-trips a DIDComm message with a
iteration-19 macOS peer (manual smoke note with both attached).

**Out of scope:** sync engine (22), UI (24), removing the mnemonic path.

---

## Iteration 21 — macOS sync engine v3

**Goal:** Replace the REST queue/poller with §10 DIDComm sync. Local mutations
flow out as authcrypted events; remote events arrive live or via pickup on
launch; LWW conflict resolution and the 60-day archive cutoff are unchanged.

**Deliverables:**

- `Sync/` rework: outbound path serializes the existing `SyncEvent` into §10
  messages fanned out to the current peer set; inbound path applies events
  idempotently by `eventId`; pickup runs on session establish; peer-set
  refresh per §10. The `sync_queue` table remains the durable outbound buffer
  (offline-first: queue locally, drain when the mediator session is up).
- New-device bootstrap: full-state request/offer per §10 when a fresh device
  joins an account with history.
- The mnemonic-era sync client and DID-Auth/JWT code are deleted from the
  macOS target; `Crypto/` shrinks to what FPP needs. Update AGENTS.md sections
  in the same PR.
- Tests: LWW matrix (concurrent update/archive/delete, tie-breaker),
  re-delivery idempotence, queue-drain ordering, full-state bootstrap, revoked
  peer excluded from fan-out.

**Acceptance criteria:** two macOS instances (or macOS + iteration-18
synthetic peer) on a local dev stack converge in under 2 s while both
online, and converge after one was offline through the other's edits
(pickup path). `scripts/test-all.sh` green.

**Out of scope:** web (22); status indicator (23); Settings (24).

---

## Iteration 22 — Web sync engine v3

**Goal:** Same as iteration 21 for the web app, plus browser-lifecycle
handling.

**Deliverables:**

- `apps/web/src/sync/` rework mirroring iteration 21 (same §10 semantics,
  same test matrix in Vitest), IndexedDB-backed outbound queue.
- Tab visibility: hidden tab pauses the mediator session cleanly; visible
  resumes and runs pickup. Multi-tab: single-owner via Web Locks (or the
  v0.2.0 mechanism if one exists — reuse, don't reinvent).
- Legacy REST sync client deleted; version bumped in `apps/web/package.json`
  only at release (27).

**Acceptance criteria:** macOS + web on one account against the dev stack
converge under 2 s both-online and after offline pickup; the v0.2.0-era
"two clients on one account" e2e scenario in `docs/e2e-test.md` is rewritten
for FPP and passes manually.

**Out of scope:** status indicator (23), Settings (24).

---

## Iteration 23 — Connection-status indicator

**Goal:** One visual + textual vocabulary for the DIDComm session state,
identical on macOS and web. **Design schema first** per AGENTS.md: tokens,
component, overlay ops, text keys under `design/`, validated, then app code.

**Deliverables — `docs/connection-status.md` (design contract):**

| State | Circle | Phrase (en) | When |
|---|---|---|---|
| `disabled` | gray, solid | "Sync disabled" | No account DID configured / sync off. |
| `resolving` | gray, pulsing | "Finding your network…" | Resolving account/mediator DID documents. |
| `connecting` | gray, pulsing | "Connecting…" | WSS dial to the mediator. |
| `authenticating` | yellow, pulsing | "Authenticating…" | DIDComm session establishment. |
| `live` | green, solid | "Connected" | Session up, idle. |
| `receiving` | green, pulsing | "Receiving changes…" | Inbound events / pickup drain in flight. |
| `sending` | green, pulsing | "Sending changes…" | Outbound queue draining. |
| `queued(n)` | blue, solid | "{n} changes waiting to send" | Offline with a non-empty outbound queue. |
| `failed(retryIn)` | red, pulsing | "Disconnected — retrying in {n}s" | Backoff active; hover/long-press shows last error. |

Colors come from `design/` tokens (one token per state, rule 7 of the design
schema); the v0.2.0 REST-only states (`waitingForNextPull`, `fallback`) do not
exist in v0.3.0.

**Deliverables (code):** `design/` component + screen nodes + text keys +
per-platform overlays (validated); `ConnectionStatusBadge` in SwiftUI and
React bound to the engine state machines from 21/22; a debug affordance to
force each state (URL param on web, Debug menu on macOS); snapshot +
state-transition tests on both platforms.

**Acceptance criteria:** `make design-validate` green; side-by-side
screenshots of every state match across platforms; `docs/connection-status.md`
referenced from AGENTS.md.

**Out of scope:** Settings panel (24).

---

## Iteration 24 — Settings v2: one DID, a device list, and QR onboarding

**Goal:** Sync configuration collapses to a single input — the account
`did:webvh` — plus device management. The panels look and behave the same on
macOS and web. Design schema first, as always.

**Deliverables (both platforms, same order):**

1. **Status header** — iteration-23 indicator + the account DID (monospace,
   copyable).
2. **Enable sync** toggle (default off; enabling with no account starts
   onboarding).
3. **Account** — either *Create new account* (walks through pointing at a
   deployed stack: paste the account DID printed by `deploy/bootstrap/`, or
   scan it as QR) or *Join existing account* (scan/paste an enrollment
   invitation from another device or the CLI). **There is no mediator-URL or
   VTA-URL field anywhere** — discovery is DID-document-only; a "Test"
   button resolves the DID and reports each hop (did.jsonl ✓ → mediator DID ✓
   → mediator reachable ✓) with a clear failure message per hop.
4. **Devices** — list of enrolled device DIDs with labels and last-seen;
   *Invite device* (renders the OOB QR); *Revoke* with confirmation.
5. **This device** — its DID, key created-at, *Forget this device* (local
   wipe + best-effort self-revocation).
- Import-merge warning parity rule from v0.2.0 carries over: joining an
  account merges local tasks into it; prominent red warning, identical wording
  on both platforms (text key in `design/text/en.json`).
- Mnemonic UI, backend-URL field, and related strings removed from apps and
  `design/`.
- Tests: macOS UI test + web Testing-Library matrix over the panel structure
  and the three Test-button outcomes; design parity report reviewed.

**Acceptance criteria:** a new device goes from fresh install to synced with
only a QR scan; the two panels read as the same product; `make
design-validate` green.

**Out of scope:** agent management UI beyond listing (25 adds enrollment).

---

## Iteration 25 — Local MCP server + accountable agent DIDs

**Goal:** AI agents on the user's machine (Claude Desktop/Code, IDE
assistants) can create and manage tasks through a local MCP server, and every
agent acts under its **own enrolled DID** with a narrow ACL — FPP
authenticated delegation, locally, with no task data leaving the machine.

**Deliverables:**

- `apps/mcp/` (TypeScript, stdio MCP server): tools `create_task`,
  `update_task`, `complete_task`, `list_tasks`, `archive_task`. It talks to
  the local task store of the host device's app (define and document the
  local IPC: the macOS app exposes a localhost-only, loopback-bound socket
  with an allowlist — spec the mechanism in the PR; **no network exposure**).
- Agent enrollment: `enroll-agent` in `deploy/bootstrap/` (and a Settings
  list entry from 24 showing enrolled agents) — each agent gets a `did:peer`
  with an `agent` role in the context ACL; events it originates carry its DID
  as the author; revocation cuts it off like a device.
- Events created via MCP flow through the normal iteration-21 sync path.
- `docs/ARCHITECTURE.md` AI-agents section updated with the shipped reality;
  README gains a "Connect Claude/your IDE" section with copy-paste MCP config.
- Tests: tool-schema round-trips, ACL enforcement (a revoked agent's calls are
  rejected), author-DID attribution asserted on the produced events.

**Acceptance criteria:** from Claude Code, "create a task X due Friday"
appears in the macOS panel and syncs to web; the event's author is the
agent's DID; revoking the agent stops further writes. No listener reachable
from off-host.

**Out of scope:** any hosted/M365 endpoint (see ARCHITECTURE.md — requires
employer-sanctioned in-tenant hosting); agent access from devices other than
the one running the store.

---

## Iteration 26 — End-to-end on real hardware

**Goal:** Execute the whole story on the actual target: a Raspberry Pi behind
Starlink CGNAT, a managed (outbound-only) Mac, a phone browser, and an AI
agent — from unboxing to converged sync, following only committed docs.

**Deliverables:**

- The `deploy/README.md` runbook executed verbatim on the target hardware —
  **Raspberry Pi Zero 2 W (512 MB)**, headless, native binaries under systemd
  (no Docker; zram only if iteration 15's measurement said so) — with
  Cloudflare Tunnel on a real (sub)domain; every deviation found becomes a
  doc fix in this PR. If the Zero 2 W fails the sustained-load
  checks below, record the measurements, re-target the runbook to a Pi 5
  (2 GB), and note the Zero result honestly in `deploy/README.md`.
- Verification matrix, recorded in `docs/e2e-test.md`:
  1. macOS (corporate/MDM network) + iPhone Safari on one account — converge
     both-online and via offline pickup.
  2. Device revocation: revoked device stops receiving; re-enrollment works.
  3. Mediator restart mid-session: clients recover per the state machine
     (23's states observed correctly).
  4. Pi reboot: all three systemd units come back enabled on boot; DID
     resolution works from a cold start.
  5. MCP agent creates a task on the Mac; it appears on the phone.
  6. Starlink IP change (or simulated tunnel re-establish): no client action
     needed.
- A cost-and-resources note in `deploy/README.md`: measured RAM/CPU/disk on
  the Pi, so others can size hardware honestly.

**Acceptance criteria:** every matrix row passes on real hardware and is
recorded with dates/versions in `docs/e2e-test.md`; the runbook is
executable by someone who has never seen the repo.

**Out of scope:** performance tuning beyond "it fits the target hardware's memory budget".

---

## Iteration 27 — Release v0.3.0

**Goal:** Ship it, and finish the hard cut.

**Deliverables:**

- `backend/aws/` moved to `archive/backend-aws-v0.2/` (history preserved),
  its workflows removed from CI; `docs/sync-protocol.md` §5–§8 moved to an
  appendix marked *historical*. The v0.2.0 smoke-test workflow retired.
- Version bumps: `apps/macos/AppBundle/Info.plist`, `apps/web/package.json`,
  README version line, CHANGELOG entry. Tag `v0.3.0`.
- README rewritten around the FPP story (see the standing README/AGENTS
  reshape rules in this file's header): what it is, the one-DID setup, the
  Pi quickstart pointer, the AI-agents section, honest limits (no native
  iOS yet, no shared lists yet).
- Migration note (README + CHANGELOG): v0.2.x users keep local data
  automatically; cloud-synced v0.2.x accounts re-onboard by creating/joining
  an FPP account — the old AWS stack can be torn down with
  `sam delete` (link the old docs in the archive).
- macOS `build.sh` end-to-end, DMG verified to make zero network calls until
  sync is enabled (same released-binary contract as v0.2.0).

**Acceptance criteria:** tagged release; a fresh user with a Pi, a domain, and
the DMG reaches two-device sync using only released artifacts and committed
docs.

**Out of scope:** anything listed under "Future directions" in
`docs/ARCHITECTURE.md` (VTC/shared lists, native iOS, VTA backups, hosted
agent endpoints).

---

## Open questions (resolve before the iteration that needs each)

- **(15 → 20) Web DIDComm stack**: candidate TS libraries vs a WASM build of
  the pinned Rust core. Decide in iteration 15 with a working spike snippet;
  record the choice here.
- **(15 → 17) Mediator fjall backend**: confirm no redis-only feature is
  needed at the pinned version; record the checked feature list here.
- **(17) Cloudflare Tunnel account/tier specifics**: confirm the free tier
  covers a named tunnel + custom-domain DNS route; document exact setup steps
  in `deploy/README.md`.
- **(18) VTA multi-use**: the same VTA/mediator pair should later serve other
  family identities/apps (pathful DIDs). Nothing in `deploy/bootstrap/` may
  assume CornerTasks is the only context — verify when writing the scripts.
- **(21/22) Full-state bootstrap size limits**: mediator message-size caps at
  the pinned version; chunking strategy if a task history exceeds them.
- **(25) macOS local IPC for MCP**: exact loopback mechanism and its
  auth (peer-credential check vs token file). Spec in the iteration-25 PR.
- **(post-v0.3.0) VTC for shared lists; native iOS app (needs an Apple
  developer account); ciphertext-only VTA backups.**
