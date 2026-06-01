# Iterations

This file tracks ordered work plans, one section per minor release. v0.3.0 starts at the bottom; v0.2.0 history is kept above for reference.

## Quick locate (agents read this first)

This block lives at the top of the file at a stable location so `PROMPT.md` can reference it without naming any iteration. Update the line numbers below whenever the v0.3.0 section moves — never put them in `PROMPT.md`.

- **Active release**: **v0.3.0**.
- **Active status checklist** (the `[ ]`/`[x]` list to scan): **lines 519–533**. Read these to pick the lowest-numbered unchecked iteration **N** (range: 15..27).
- **Active iteration bodies start at**: **line 537**. Each iteration is delimited by a `## Iteration N — <title>` heading; the next `## Iteration ...` heading (or `## Open questions` for the last one) ends it. Use `sed` to extract exactly one — see the recipe in `PROMPT.md`.
- **Active open-questions section**: search marker `## Open questions` (currently line **1322**).
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

Ordered work plan to take CornerTasks from v0.2.0 (REST pull/push sync against AWS) to v0.3.0 (push-based WebSocket sync, a second self-hostable backend on Docker Compose + Postgres, consistent connection-status UI across macOS and web).

## Goals (v0.3.0)

1. **Replace pull/REST sync with WebSocket sync** against an AWS API Gateway WebSocket API, designed for minimum AWS spend (pay-per-message, ARM Lambda, on-demand DynamoDB, connection TTL).
2. **Both apps** (macOS + web) sync over WebSocket using the **same DID-Auth → bearer-JWT** flow that v0.2.0 introduced. No second auth scheme.
3. **API versioning** so REST (`/v1/*`) and WebSocket (`/v2/*`) can coexist behind one `ApiUrl`. **Release CI defaults to removing the v1/REST resources**; an env var (`INCLUDE_REST_V1=true`) opts the deploy back into the parallel-deploy mode.
4. **Capability test**: clients keep using the existing `ApiUrl` setting; the Settings "Test" button now probes whether the endpoint advertises WebSocket sync. If not, the client falls back to pull/REST and the UI surfaces a visible alert.
5. **Connection-status indicator** in both apps: one small colored circle + short phrase, the same color/text vocabulary on both platforms, covering disabled, connecting, authenticating, healthy, fetching, pushing, waiting-for-next-pull (fallback), and failing.
6. **Second backend**: `backend/docker/` — `docker-compose` (Postgres + a small Node service) that exposes the **identical** wire protocol as the AWS backend. The shared logic lives in a new headless package; AWS and Docker are thin concretions. The release pipeline does **not** publish a Docker image; the repo carries enough documentation for a developer to run it locally or adapt it for k8s.

## How to use this file (v0.3.0)

Same rules as v0.2.0:

- One PR per iteration, in order. Don't bundle two.
- Re-read [`AGENTS.md`](AGENTS.md) before starting; v0.3.0 adds new conventions to it (see iteration 15).
- Each iteration lists **Goal**, **Deliverables**, **Acceptance criteria**, **Out of scope**. If scope must grow, edit this file first and flag it in the PR.
- Tick the iteration's checkbox below when its PR is merged. Update affected docs (README, AGENTS.md, `docs/sync-protocol.md`) in the same PR.
- Every iteration that adds non-UI logic must add unit tests for that logic. UI iterations include at least manual smoke notes.
- Don't introduce new dependencies unless a deliverable names them.

## Status

- [ ] **15.** Extract headless backend core (`backend/core/`); refactor `backend/aws/` to consume it. Pure refactor.
- [ ] **16.** WebSocket sync protocol spec — `docs/sync-protocol.md` §10 + API path versioning rules.
- [ ] **17.** Capabilities endpoint + path versioning skeleton + release CI toggle (`INCLUDE_REST_V1`).
- [ ] **18.** AWS WebSocket implementation (`/v2/ws`) — API Gateway WebSocket API + connections table + push/broadcast.
- [ ] **19.** Smoke test (`sync-doctor`) exercises the full WS path; CI runs it on every backend deploy.
- [ ] **20.** macOS sync engine v2 — WS client, capability detection, pull/REST fallback.
- [ ] **21.** Web sync engine v2 — WS client, capability detection, pull/REST fallback.
- [ ] **22.** Shared connection-status indicator — design doc + macOS + web implementations.
- [ ] **23.** Settings UI v2 — consistent panel on macOS + web, fallback alert, capability "Test" wired to iteration 17's endpoint.
- [ ] **24.** Docker Compose backend (`backend/docker/`, Postgres + Node) consuming `backend/core/`.
- [ ] **25.** Self-hosting docs — `backend/docker/README.md` covers Compose, k8s adaptation, and AWS cost-tuning notes.
- [ ] **26.** End-to-end verification across the matrix (AWS+WS, AWS+REST-fallback, Docker+WS, two clients on one mnemonic).
- [ ] **27.** Release v0.3.0.

---

## Iteration 15 — Extract headless backend core

**Goal:** Move the protocol logic that is **independent of AWS** out of `backend/aws/` into a new package `backend/core/`, so iteration 24's Docker backend can reuse it. Pure refactor; no behavior change on the wire and no client changes.

**Decision:** monorepo via npm workspaces (root `package.json` adds `"workspaces": ["backend/core", "backend/aws", "backend/docker", "apps/web"]`). No new build tool. Document in `backend/core/README.md`.

**Deliverables:**

### Package layout

```
backend/
├── core/                               (new — headless, no AWS or pg imports)
│   ├── package.json                    name: "@cornertasks/core"
│   ├── tsconfig.json
│   ├── src/
│   │   ├── protocol/                   pure types + zod schemas
│   │   │   ├── event.ts                Event, EventPlaintext, Op
│   │   │   ├── auth.ts                 ChallengeRequest/Response, TokenRequest/Response
│   │   │   ├── ws.ts                   (placeholder; populated in iter 16)
│   │   │   └── errors.ts               ErrorCode enum + HTTP status mapping
│   │   ├── auth/
│   │   │   ├── didKey.ts               moved from backend/aws/src/lib/did.ts
│   │   │   ├── didJwt.ts               DID-JWT verification (was inline in handlers/auth/token.ts)
│   │   │   ├── bearer.ts               bearer mint + verify (was lib/jwt.ts)
│   │   │   └── challenge.ts            challenge gen + replay-check policy (storage-agnostic)
│   │   ├── sync/
│   │   │   ├── validate.ts             validateEvent(event): "ok" | "invalid"
│   │   │   ├── conflict.ts             isStale(stored, incoming) — LWW + eventId tiebreak
│   │   │   └── archiveCutoff.ts        moved from lib/archive-retention.ts
│   │   └── ports/                      interfaces a concretion must implement
│   │       ├── EventStore.ts           putEvent, listEventsSince, getCurrentTaskRow
│   │       ├── ChallengeStore.ts       putChallenge, consumeChallenge (atomic), expireBatch
│   │       ├── ConnectionRegistry.ts   (populated in iter 16 — leave the file with a TODO type)
│   │       ├── SigningKeyProvider.ts   getPrivateKey(), getPublicKey()
│   │       └── Clock.ts                now(): number (epoch ms) — for testability
│   └── tests/                          vitest, runs against fakes
│       ├── didKey.test.ts
│       ├── didJwt.test.ts
│       ├── bearer.test.ts
│       ├── conflict.test.ts
│       ├── archiveCutoff.test.ts
│       └── fakes/                      InMemoryEventStore, InMemoryChallengeStore, FakeClock
│
└── aws/
    ├── package.json                    depends on "@cornertasks/core": "*"
    └── src/
        ├── lib/
        │   ├── dynamoEventStore.ts     implements ports/EventStore against DynamoDB (was dynamo-store.ts)
        │   ├── dynamoChallengeStore.ts implements ports/ChallengeStore (split from db.ts)
        │   ├── ssmSigningKey.ts        implements ports/SigningKeyProvider (was signing-key.ts)
        │   ├── apiUrl.ts               unchanged
        │   └── response.ts             unchanged
        └── handlers/                   handlers become orchestration only — they wire ports to core
            ├── push.ts                 imports core.validate, core.isStale, dynamoEventStore
            ├── pull.ts                 imports core archiveCutoff filter
            └── auth/
                ├── challenge.ts        imports core.challenge.create, dynamoChallengeStore
                └── token.ts            imports core.auth.didJwt.verify, core.auth.bearer.mint
```

### Conventions for `backend/core/`

- **Zero AWS, Postgres, or HTTP imports.** Anything platform-specific is behind a port. CI verifies this by grepping the compiled `core/dist/` for the strings `@aws-sdk`, `aws-lambda`, `pg`, `express`, `ws` — fails if any appear.
- **No I/O in the public API.** Functions take inputs and ports; they don't open sockets, hit databases, or read env vars.
- **Vitest, not Jest.** The Docker backend (iteration 24) will use vitest; standardize core on it so the same test fixtures run in both concretions. The AWS handler tests keep using jest — they live in `backend/aws/tests/` and are unchanged.
- **One package, no submodule exports.** Importers do `import { validateEvent, isStale, mintBearer } from "@cornertasks/core"`. Avoid `@cornertasks/core/sync/conflict` deep imports — barrel in `src/index.ts`.

### Refactor steps (target order inside the PR)

1. Add the root `package.json` workspaces field; `cd backend/aws && npm install` should still work afterward.
2. Scaffold `backend/core/` with `package.json`, `tsconfig.json`, `vitest.config.ts`, empty `src/index.ts`.
3. Move `lib/did.ts`, `lib/jwt.ts`, `lib/archive-retention.ts`, the type-only pieces of `types/api.ts`, and the validation helpers from `handlers/push.ts` into `backend/core/src/`. Adjust imports in the AWS handlers to use `@cornertasks/core`.
4. Extract the storage code in `lib/dynamo-store.ts` and `lib/db.ts` behind the `EventStore` and `ChallengeStore` ports. Concrete implementations stay in `backend/aws/src/lib/`.
5. Run `backend/aws/`'s existing jest suite and `npm run smoke-test` against a dev stack — both must remain green without source changes to the tests.

### Documentation

- Add `backend/core/README.md` (≤ 150 lines) explaining: this is the headless protocol package, the port interfaces a concretion must implement, the no-platform-imports rule, and a note pointing at `backend/aws/` and (future) `backend/docker/` as concrete consumers.
- Update `AGENTS.md` repository layout section to show `backend/core/` and the new `backend/docker/` placeholder (with a forward-pointer to iteration 24).

**Acceptance criteria:**

- `npm install` from repo root resolves all three workspaces.
- `npm run build -w @cornertasks/core` and `npm test -w @cornertasks/core` both pass.
- `cd backend/aws && npm run lint && npm test && npm run build` all pass.
- `sam deploy` against a dev stack succeeds; existing `sync-doctor` smoke test stays green.
- `git grep -E "(@aws-sdk|aws-lambda|^import pg|express|^import { WebSocket )" backend/core/src` returns nothing.
- No change to the wire protocol or to any client (web/macOS) code.

**Out of scope:** WebSocket support, capabilities endpoint, Docker backend, client changes.

---

## Iteration 16 — WebSocket sync protocol spec

**Goal:** Specify the v2 (WebSocket) wire protocol **before** anyone implements it. Extends `docs/sync-protocol.md`. v1 (pull/push REST) text stays in place and is marked legacy.

**Decision:** API Gateway WebSocket-style (one URL per stage, frames JSON, no MQTT or GraphQL subscriptions). One persistent connection per client. Bearer JWT obtained over HTTPS (existing `/auth/*` endpoints) and presented in the connection URL's query string. Server pushes events as they arrive; no polling.

**Deliverables — add to `docs/sync-protocol.md`:**

### §10 API versioning and coexistence

- **Authentication endpoints** (challenge + token) are **un-versioned** because they survive across sync-protocol revisions:
  - `POST /auth/challenge`
  - `POST /auth/token`
  - The existing `POST /v1/auth/challenge` and `/v1/auth/token` paths are retained as **aliases** for one minor version (until v0.4.0) so existing v0.2.x clients keep working. Document this in the deprecation table.
- **Sync endpoints** are versioned by the `/vN/` prefix:
  - `v1` = REST pull/push (the existing `POST /v1/sync/push` and `GET /v1/sync/pull`).
  - `v2` = WebSocket (`GET wss://<host>/v2/ws?token=<bearer>`).
- **Capability discovery**: `GET /capabilities` → `{ version, protocols, recommended }`. Defined in iteration 17.
- **Coexistence rule**: a deploy MAY expose v1 + v2 simultaneously. Clients always prefer the highest version listed in `protocols`.

### §11 WebSocket sync (v2)

#### §11.1 Connection lifecycle

- Client opens `wss://<host>/v2/ws?token=<bearer>`. Bearer JWT is acquired exactly as in §8 (DID-JWT → token). Tokens older than 60s of `exp` MUST be refreshed before opening the socket.
- API Gateway calls a **Lambda authorizer** on `$connect` that verifies the bearer (same code path as the REST middleware). On success the authorizer returns a policy + a context containing `accountDid` and the bearer's `jti`/`exp`.
- After `$connect` the server is free to push messages immediately. The server sends `{ "type": "ready", "serverTime": <iso8601>, "sessionId": "<uuid>" }` as the first frame.
- Client sends `{ "type": "subscribe", "since": "<iso8601 | null>" }` to start receiving events newer than `since`. Server replies with a stream of `event` frames followed by `{ "type": "subscribed", "throughTime": "<iso8601>" }`. `since` may be null on first sync (full backlog up to the 60-day archive cutoff).
- After `subscribed`, the server pushes `event` frames in real time whenever any device on the account publishes (see §11.3).
- **Token expiry**: when the bearer's `exp` is within 60s, the server sends `{ "type": "token_expiring", "in": <seconds> }`. The client refreshes the bearer over HTTPS and sends `{ "type": "reauth", "bearer": "<token>" }`. If the client does nothing, the server closes the socket with WebSocket close code **4401** and reason `token_expired`. Clients reconnect with the new bearer.
- **Idle disconnect**: API Gateway closes idle WS connections after 10 minutes. Server-side keepalive: `{ "type": "ping" }` every 4 minutes; client replies with `{ "type": "pong" }`. If the client misses two pings, the server closes with **1011** `idle`.

#### §11.2 Frame catalog

Server → client:
- `ready`, `subscribed`, `event`, `pushAck`, `token_expiring`, `ping`, `error`.

Client → server:
- `subscribe`, `push`, `reauth`, `pong`.

Every frame is `{ type: "<name>", ...payload }`. Unknown frames are answered with `error { code: "unknown_frame" }` and the socket stays open.

#### §11.3 Push semantics

- Client sends `{ "type": "push", "events": Event[] }`. Same `Event` shape as §4.
- Server validates each event (auth context's `accountDid` MUST equal the event's `accountDid` — close with **4403** `did_mismatch` otherwise), runs the same conflict rule as v1 push (newer `updatedAt` wins; tie-break by `eventId`), and persists.
- Server replies with `{ "type": "pushAck", "acceptedIds": string[], "rejected": { eventId, reason }[] }`. Reasons: `"stale"` | `"invalid"`.
- After persistence, the server **broadcasts** each accepted event to all currently-connected sockets for the same `accountDid` **except the originating socket** (the originator already has it locally; saves bandwidth + cost). Broadcast frame: `{ "type": "event", "event": Event, "source": "push" }`.

#### §11.4 Server-initiated event delivery

- Source = `"push"` when forwarded from another device's push.
- Source = `"backfill"` when delivered as part of the initial `subscribe` catch-up.
- Clients dedupe by `eventId` (they may receive the same event over WS and over a later REST fallback — the engine MUST be idempotent).

#### §11.5 Errors

| close code | meaning              | client action            |
|------------|----------------------|--------------------------|
| 4401       | `token_expired`      | refresh bearer, reconnect|
| 4401       | `bad_token`          | refresh bearer, reconnect|
| 4403       | `did_mismatch`       | log + bug, do not retry  |
| 4400       | `invalid_frame`      | log + bug                |
| 1011       | `idle`               | reconnect immediately    |
| 1013       | `try_again_later`    | exponential backoff      |

Non-fatal error frames keep the socket open:

```json
{ "type": "error", "code": "unknown_frame" | "rate_limited", "message": "<human readable>" }
```

#### §11.6 Backpressure and rate limiting

- Server-side soft cap: 100 events per `push` frame, 10 `push` frames per second per connection. Excess returns `error { code: "rate_limited" }` and **drops** the offending frame (clients resend on next tick).
- Client-side: events are still queued in `sync_queue` (macOS) / `syncQueue` (web). The WS engine drains the queue exactly like the REST engine drained it — only the transport differs.

#### §11.7 Reconnect strategy (normative, both clients)

- Initial backoff 1 s, doubling to a cap of 30 s, with ±25 % jitter.
- On a clean close (1000) for any reason, reset backoff.
- On 4401, refresh the bearer *first*, then reconnect with no backoff (treat as a clean re-handshake).
- On three consecutive failures, the client SHOULD probe `/capabilities` once before continuing — the server may have rolled back to REST-only.

#### §11.8 Cost contract (informative, AWS)

- API Gateway WebSocket charges per million **messages** and per million **connection-minutes**. The design above keeps both small:
  - One persistent socket per device (vs. one HTTP request per pull every 60s in v1 = 1,440/day/device).
  - Only event-bearing frames are billed; ping/pong are billed but small.
  - Idle disconnect at 10 min is allowed to fire and the client reconnects (10-min connections are cheaper than 1-h depending on usage patterns; this is a contributor-visible choice documented here).

### §12 Deprecation table

| Path / behavior              | Introduced | Status in v0.3.0     | Removed in |
|------------------------------|------------|----------------------|------------|
| `POST /v1/sync/push`         | v0.2.0     | optional, default off| v0.4.0     |
| `GET /v1/sync/pull`          | v0.2.0     | optional, default off| v0.4.0     |
| `POST /v1/auth/challenge`    | v0.2.0     | alias of `/auth/...` | v0.4.0     |
| `POST /v1/auth/token`        | v0.2.0     | alias of `/auth/...` | v0.4.0     |
| `GET /v2/ws`                 | v0.3.0     | required             | —          |
| `GET /capabilities`          | v0.3.0     | required             | —          |

### §13 Worked examples

Add curl + `wscat` examples for: (a) acquiring a bearer; (b) opening the socket; (c) `subscribe`; (d) `push`; (e) receiving a broadcast from another simulated device; (f) `token_expiring` → `reauth`.

### Cross-references

- Update `AGENTS.md` "Sync model (v0.2.0)" section to "Sync model (v0.3.0)" and replace the pull-cursor description with §11.
- Update `README.md` privacy section: clarify that the bearer JWT, not the mnemonic, is what authenticates the socket.

**Acceptance criteria:** the spec is complete, internally consistent, references back to §4 (Event shape) and §8 (auth), and is reviewable. Iteration 18 implements §11 byte-for-byte.

**Out of scope:** code.

---

## Iteration 17 — Capabilities endpoint + path versioning skeleton + release CI toggle

**Goal:** Land the **structural** pieces both clients need from the backend before WebSocket support is implemented: the capabilities advertisement, the new un-versioned auth aliases, and the SAM template conditional that lets the deploy include or omit the v1 REST resources.

This iteration is implementation-only on the backend. Clients still hit `/v1/*` exactly as today.

**Deliverables:**

### `GET /capabilities`

- New Lambda `backend/aws/src/handlers/capabilities.ts`. Returns:

```json
{
  "version": "0.3.0",
  "protocols": ["rest-v1", "ws-v2"],
  "recommended": "ws-v2",
  "endpoints": {
    "auth": {
      "challenge": "/auth/challenge",
      "token": "/auth/token"
    },
    "rest": {
      "push": "/v1/sync/push",
      "pull": "/v1/sync/pull"
    },
    "websocket": "wss://<host>/v2/ws"
  },
  "serverTime": "<iso8601>"
}
```

- If the deploy was built with `INCLUDE_REST_V1=false`, `protocols` MUST NOT contain `"rest-v1"` and `endpoints.rest` MUST be absent. Same for `ws-v2` until iteration 18 lands (iteration 17 ships `["rest-v1"]` only and adds `"ws-v2"` in iteration 18).
- No auth required. Clients call this before signing in.
- Cache: `Cache-Control: max-age=60`. CloudFront/CDN at the gateway will bill less for repeated probes.

### Un-versioned auth aliases

- Add `POST /auth/challenge` and `POST /auth/token` to `template.yaml`, both pointing at the same Lambdas as `/v1/auth/...`. Existing `/v1/auth/...` routes remain (we never break in-flight v0.2.x clients).
- No code change to the handlers themselves — same handler ARN serves both paths.

### SAM template conditional `INCLUDE_REST_V1`

- Parameter:

```yaml
Parameters:
  IncludeRestV1:
    Type: String
    AllowedValues: [true, false]
    Default: false
    Description: |
      When true, deploys POST /v1/sync/push and GET /v1/sync/pull alongside the v2 WebSocket API.
      When false (default for v0.3.0+), only auth + capabilities + v2/ws are exposed.

Conditions:
  WithRestV1: !Equals [!Ref IncludeRestV1, "true"]
```

- Wrap the v1 sync routes, integrations, and their Lambda functions in `!If [WithRestV1, <resource>, !Ref AWS::NoValue]`. The handlers themselves remain in `src/handlers/push.ts` and `pull.ts` (they're cheap to ship; we just don't expose them).
- Surfaced through `npm run deploy:dev` / `npm run deploy:prod` via SAM `--parameter-overrides IncludeRestV1=$INCLUDE_REST_V1`. The deploy scripts read the env var and default to `false`.

### Release CI

- `.github/workflows/release.yml` (the maintainer-side workflow, even if it only builds the DMG today) is unchanged. The deploy template in `.github/workflows/deploy.yml.template` (added per iteration 3 BYO-AWS docs) gains an `inputs.include_rest_v1` boolean (default `false`) that forwards into the deploy command.
- `backend/aws/README.md` gets a new section "Running v1 (REST) and v2 (WebSocket) in parallel": one paragraph explaining when you'd want this (rolling old clients off; debugging) and the exact `INCLUDE_REST_V1=true npm run deploy:prod` invocation.

### Capabilities client helper (`backend/core/`)

- `backend/core/src/protocol/capabilities.ts` — zod schema for the response + a `pickPreferred(caps)` helper that returns `"ws-v2" | "rest-v1" | null`. Reused by both clients in iterations 20–21.

### Tests

- Handler unit tests for `capabilities` covering both `INCLUDE_REST_V1=true` and `=false` (drive via env var; the handler reads it once at cold start).
- SAM template sanity: `sam validate` passes for both parameter values.
- Manual: `INCLUDE_REST_V1=false npm run deploy:dev` produces a stack where `curl https://<host>/v1/sync/pull` returns `404` (no route) while `/capabilities` is healthy. `INCLUDE_REST_V1=true npm run deploy:dev` brings both back.

**Acceptance criteria:** unit tests pass; both deploy modes succeed; capabilities response shape matches the spec from iteration 16; existing `sync-doctor` smoke test (still v1-based at this point) passes only when `INCLUDE_REST_V1=true` and is skipped otherwise via a `CT_PROTOCOL=rest-v1` flag that iteration 19 will generalize.

**Out of scope:** WebSocket handlers, client capability detection, removing v1 handler code from the repo.

---

## Iteration 18 — AWS WebSocket implementation

**Goal:** Implement §11 of the protocol on AWS. After this iteration, a hand-crafted `wscat` session can open `wss://<host>/v2/ws?token=...`, subscribe, push, and observe a broadcast from a second simulated connection.

**Decision:** API Gateway WebSocket API (not AppSync, not IoT Core). One DynamoDB table for connections (`ws_connections`) with TTL. Lambda authorizer reuses the bearer-verify code in `backend/core/`. **No DynamoDB Streams** — broadcast happens inside the `push` handler by querying the connections table directly. Keeps the architecture small and the per-message cost predictable.

**Deliverables:**

### Infra (`backend/aws/template.yaml`)

- `AWS::ApiGatewayV2::Api` of type `WEBSOCKET` named `CornerTasksWS`, route selection expression `$request.body.type`.
- Routes:
  - `$connect` → authorizer Lambda + integration Lambda (`onConnect`).
  - `$disconnect` → `onDisconnect`.
  - `$default` → `onMessage` (routes by `type` in JS, simpler than route-per-frame).
- Authorizer: `AWS::ApiGatewayV2::Authorizer` of type `REQUEST`, `IdentitySource: "route.request.querystring.token"`, attached only to `$connect`.
- New `ws_connections` DynamoDB table:
  - `PK = ACCOUNT#<accountDid>`, `SK = CONN#<connectionId>`.
  - Attributes: `connectedAt`, `bearerExp`, `sessionId`, `lastPingAt`, optional `ttl` (epoch seconds; set to `bearerExp + 300` to clean up if `$disconnect` is missed).
  - GSI on `(PK, connectedAt)` for fan-out queries.
  - On-demand billing (we expect ≤ a few connections per account; provisioned capacity would waste money).
- The new API Gateway stage publishes `WsUrl` as a stack output. Capabilities endpoint reads it from env (`WS_ENDPOINT`).
- Existing HTTP API for `/auth/*`, `/capabilities`, and (conditionally) `/v1/*` is unchanged.

### Handlers (`backend/aws/src/handlers/ws/`)

```
ws/
├── authorizer.ts   # verifies bearer JWT via @cornertasks/core, returns IAM Allow + context
├── onConnect.ts    # persists row to ws_connections, posts "ready" frame back
├── onDisconnect.ts # deletes row from ws_connections
└── onMessage.ts    # routes by msg.type → subscribe / push / reauth / pong
```

- `onMessage` uses the `ApiGatewayManagementApi` client to send frames back to the originating connection. Endpoint URL is `https://<api-id>.execute-api.<region>.amazonaws.com/<stage>` and is provided to the Lambda via env var.
- `push` flow:
  1. Validate every event via `@cornertasks/core/validateEvent`.
  2. Check `accountDid` against the authorizer's context (`event.requestContext.authorizer.accountDid`). Mismatch → close with 4403.
  3. Run conflict resolution via `@cornertasks/core/isStale`. Persist accepted events through the existing `dynamoEventStore`.
  4. Send `pushAck` to the originator.
  5. Query `ws_connections` for `PK = ACCOUNT#<did>`, exclude the originator's `connectionId`, and `PostToConnection` each accepted event as a `{ type: "event", event, source: "push" }` frame. Each failure with `GoneException` (410) triggers a `DeleteItem` cleanup of that connection row.
- `subscribe` flow:
  1. Read `since` (nullable).
  2. Stream events from `dynamoEventStore.listEventsSince(accountDid, since)` in pages of ≤ 100, sending each as `{ type: "event", event, source: "backfill" }`.
  3. Conclude with `{ type: "subscribed", throughTime: <serverTime> }`.
- `reauth` flow: re-verify the new bearer (uses authorizer code path directly), update `bearerExp` on the connection row. Reject and close 4401 if invalid.
- Keepalive: a CloudWatch Events rule every 4 minutes invokes a small `pinger.ts` Lambda that scans `ws_connections`, sends `ping` to each, and deletes any with `lastPingAt` older than 9 minutes (two missed cycles).

### Permissions

- The Lambda execution role gains:
  - `execute-api:ManageConnections` on the new WS API ARN.
  - `dynamodb:Query/PutItem/DeleteItem` on `ws_connections` and its GSI.
- No new wildcard grants.

### Capabilities endpoint

- Once this iteration lands, `protocols` becomes `["ws-v2"]` by default (and `["ws-v2", "rest-v1"]` when `INCLUDE_REST_V1=true`). `recommended` stays `"ws-v2"`.

### Tests

- Unit tests against the `@aws-sdk/client-apigatewaymanagementapi` mock for `onMessage.push` covering: accepted-only, stale-rejected, did-mismatch, broadcast-skips-originator, broadcast-cleans-up-gone-connections.
- Integration test against `dynamodb-local` + a tiny in-process WebSocket harness (the handlers are pure — call them with synthetic `event` objects) covering subscribe → push → broadcast.
- Cost smoke test: count `ApiGatewayManagementApi.postToConnection` invocations in a unit test that simulates a 3-device account pushing 100 events — assert each event triggers exactly 2 broadcasts (= devices − 1).

### Documentation

- `backend/aws/README.md` gains a "WebSocket sync" section pointing at `docs/sync-protocol.md` §11 and noting the cost-shape.
- `AGENTS.md` "Sync model" section is updated to point at v2.

**Acceptance criteria:**

- `npm test` passes.
- Deploy to dev, then `wscat -c "wss://<host>/v2/ws?token=$BEARER"` followed by manual `subscribe` and `push` frames: server emits `ready`, streams events, broadcasts to a second `wscat` session, and closes with 4401 when the bearer expires.
- `aws dynamodb scan --table-name ws_connections` shows rows created on `$connect` and deleted on `$disconnect`.

**Out of scope:** client implementations, smoke-test automation, fallback handling.

---

## Iteration 19 — Smoke-test automation for WebSocket

**Goal:** Bring `backend/aws/scripts/sync-doctor.ts` up to v0.3.0. After this, CI red/green tracks the real wire protocol on a deployed stack.

**Deliverables:**

- Rename `scripts/sync-doctor.ts` → `scripts/sync-doctor.ts` (same file, additive change). Add a CLI flag `--protocol <auto|ws-v2|rest-v1>`. `auto` (default) probes `/capabilities` and uses `recommended`.
- Add a `ws-v2` codepath that uses the `ws` npm package: connect, subscribe, push a synthetic encrypted event from `CT_MNEMONIC`, wait for `pushAck`, open a *second* socket on the same account, observe the broadcast, close cleanly.
- Add an explicit timeout (default 30 s) so a hung connection fails CI rather than stalling.
- Update `.github/workflows/smoke-test.yml` to run sync-doctor in both modes when `INCLUDE_REST_V1=true` (loops over `--protocol ws-v2` and `--protocol rest-v1`) and only `ws-v2` otherwise.
- The doctor MUST be the same script the developer runs locally; don't fork CI-only logic.

**Acceptance criteria:** the workflow turns red if any of (a) `/capabilities` lies about the deployed protocols, (b) push/broadcast diverges from §11, or (c) auth headers regress. Manual `CT_API_URL=... CT_MNEMONIC='...' npm run smoke-test --workspace backend/aws` produces a green run against a fresh dev deploy.

**Out of scope:** client changes; advanced multi-account tests.

---

## Iteration 20 — macOS sync engine v2

**Goal:** macOS uses WebSockets when the server advertises `ws-v2`, falls back to REST polling when only `rest-v1` is advertised (or when the WS dial fails persistently), and surfaces both states cleanly to the UI through the connection-status indicator (iteration 22) and the settings panel (iteration 23).

**Decision:** Use `URLSessionWebSocketTask` (built-in, no dep). Keep the existing `Sync/` files; add `Sync/Transport/` with one protocol and two concretions.

**Deliverables (`apps/macos/Sources/CornerTasks/Sync/`):**

### New types

- `Sync/Transport/SyncTransport.swift` — protocol:

```swift
protocol SyncTransport {
    func start() async throws
    func stop() async
    func push(_ events: [SyncEvent]) async throws -> PushResult
    /// Server-pushed events or — in REST mode — events fetched by the next pull.
    var inbound: AsyncStream<SyncEvent> { get }
    /// Stream of opaque status updates the UI subscribes to.
    var status: AsyncStream<ConnectionStatus> { get }
}
```

- `Sync/Transport/WebSocketTransport.swift` — opens `wss://<host>/v2/ws?token=<bearer>`, sends `subscribe`, routes inbound frames, handles `token_expiring` → `reauth`, implements §11.7 reconnect strategy. Pulls bearers from the existing `AuthSession`.
- `Sync/Transport/RestTransport.swift` — wraps the existing 10 min / 1 min push/pull engine and exposes it through the new protocol. Renamed from the current implementation, no logic change.
- `Sync/Transport/TransportSelector.swift` — calls `GET /capabilities` on engine start and whenever the user hits the "Test" button. Returns `WebSocketTransport` if `protocols` contains `"ws-v2"`, otherwise `RestTransport`. Emits a `ConnectionStatus.fallback(reason:)` event so the UI can show the alert.

### Engine wiring

- `SyncEngine` becomes a thin coordinator: it owns whichever transport `TransportSelector` returned, drains its `inbound` into the local store via `applyRemoteUpsert/Delete`, and forwards `status` to a published `@MainActor` observable that the UI subscribes to.
- On transport-level reconnect failure (3 consecutive), `SyncEngine` calls `TransportSelector.reprobe()` once and may swap from WS to REST or vice versa.

### Connection status enum (mirrors iteration 22 schema)

```swift
enum ConnectionStatus: Equatable {
    case disabled
    case connecting
    case authenticating
    case connected
    case fetching
    case pushing
    case waitingForNextPull(secondsUntil: Int) // REST mode only
    case fallback(reason: FallbackReason)      // server didn't advertise ws-v2
    case failed(reason: String, retryIn: Int)
}
```

The exact state vocabulary, transitions, and rendering rules are defined once in `docs/connection-status.md` (iteration 22). Both transports emit only those states.

### Tests

- `WebSocketTransport` unit tests against an in-process `URLSessionWebSocketTask` fake: dial → subscribe → push → broadcast received → token_expiring → reauth → close-4401 → reconnect.
- `RestTransport` tests carry over from iteration 11; ensure they still pass through the new protocol surface.
- `TransportSelector`: probes `/capabilities`, returns the right transport for each combo of `protocols`, and emits `fallback(.serverDoesNotSupportWebSocket)` when only `rest-v1` is advertised.
- Status-stream snapshot tests: a scripted scenario (connect → push → idle → disconnect → reconnect) produces a known sequence of `ConnectionStatus` values.

### Backwards compatibility

- If a user is on v0.2.x and upgrades to v0.3.0 while their deploy is still v0.2.0, capabilities returns `["rest-v1"]` and the engine transparently uses `RestTransport`. The fallback alert is shown so the user knows to upgrade their backend.
- The `Prefs.backendURL` schema is unchanged. No migration prompt.

**Acceptance criteria:** `swift test` passes. Manual: against an iteration-18 dev stack, two macOS instances on one mnemonic converge in under 2 seconds (vs. ~60s in v0.2.0). Against a forced-REST stack (`INCLUDE_REST_V1=true` and no v2), the engine falls back, status indicator shows the alert state, and convergence matches v0.2.0 behavior.

**Out of scope:** UI of the indicator and settings panel (iterations 22–23); web-side changes.

---

## Iteration 21 — Web sync engine v2

**Goal:** Same as iteration 20, on web. The two engines stay structurally aligned so `sync-doctor` and the connection-status taxonomy are load-bearing across both clients.

**Decision:** Use the platform `WebSocket` global (no dep). Mirror the file layout from `apps/macos/Sources/CornerTasks/Sync/Transport/`.

**Deliverables (`apps/web/src/sync/transport/`):**

- `SyncTransport.ts` — same surface as the macOS protocol, expressed as a TypeScript interface returning `ReadableStream<SyncEvent>` for inbound and `ReadableStream<ConnectionStatus>` for status (or an `EventTarget`-based emitter — pick one and stick with it; document choice).
- `WebSocketTransport.ts` — `new WebSocket(url + "?token=" + bearer)`. Same frame contract as macOS. Reconnect / reauth identical to §11.7. Pause when `document.hidden`; resume + immediate `subscribe` on `visibilitychange → visible` (carrying the §11.6 dedupe rules — pulled events may overlap pushed events).
- `RestTransport.ts` — wraps the existing `SyncEngine` polling logic from iteration 12.
- `TransportSelector.ts` — same capabilities probing as macOS.
- `SyncEngine.ts` becomes a coordinator like its macOS sibling.
- Vitest tests covering the matrix: dial / subscribe / push / broadcast / token_expiring / reauth / close-4401 / reconnect / tab-hidden-pauses / tab-visible-resumes / capabilities-says-rest-only → fallback emitted.

**Acceptance criteria:** `npm test --workspace apps/web` passes. Manual: a macOS instance and a web instance on the same mnemonic against an iteration-18 dev stack each see the other's edits in under 2s. With the deploy switched to REST-only, both clients still converge (in ~60s) and both show the fallback alert.

**Out of scope:** the alert/indicator UI (iterations 22–23).

---

## Iteration 22 — Shared connection-status indicator

**Goal:** One visual + textual vocabulary for connection status, implemented identically on macOS and web. Adds `docs/connection-status.md` as the design contract.

**Deliverables — `docs/connection-status.md`:**

| State                       | Circle color | Phrase (en)                                | When                                                                |
|----------------------------|--------------|--------------------------------------------|---------------------------------------------------------------------|
| `disabled`                  | gray (#9CA3AF) | "Cloud sync disabled"                    | `cloudSyncEnabled == false` OR no backend URL configured.           |
| `connecting`                | gray (#9CA3AF), pulsing | "Connecting…"                  | Socket opening / first capabilities probe.                          |
| `authenticating`            | yellow (#F59E0B), pulsing | "Authenticating…"            | Bearer being acquired or refreshed.                                 |
| `connected`                 | green (#10B981), solid | "Connected"                     | WS open, idle.                                                       |
| `fetching`                  | green (#10B981), pulsing | "Fetching updates…"           | Server is streaming events to us (WS) or a pull is in flight (REST).|
| `pushing`                   | green (#10B981), pulsing | "Sending changes…"            | A push frame / POST is in flight.                                    |
| `waitingForNextPull(secs)` | blue (#3B82F6), solid | "Next sync in {secs}s"          | REST mode only, between successful pulls.                            |
| `fallback`                  | orange (#F97316), solid | "Using polling — server doesn't support WebSocket"  | Capabilities advertised only `rest-v1`.       |
| `failed(retryIn)`           | red (#EF4444), pulsing | "Disconnected — retrying in {n}s" | Reconnect backoff active. Click reveals last error.       |

- The circle is rendered as an 8-px (macOS) / `0.5rem` (web) dot to the left of the phrase. Hover/long-press shows the most recent error message + the underlying state machine name.
- Click opens the Settings → Cloud Sync panel.
- Position:
  - **macOS**: bottom of the floating panel, left-aligned in the existing footer row. Existing footer items (settings cog) move right.
  - **web**: bottom-left of the app shell, fixed-position on mobile (above the bottom safe-area inset), inline-block under the header on desktop.
- All strings live in one file per platform (`apps/macos/Sources/CornerTasks/UI/ConnectionStatusStrings.swift` and `apps/web/src/ui/connectionStatusStrings.ts`) for future localization.
- Accessibility: aria-live="polite" on web; `NSAccessibility` description on macOS reads the phrase. Don't rely on color alone.

**Deliverables (code):**

- `apps/macos/Sources/CornerTasks/UI/ConnectionStatusBadge.swift` — SwiftUI view bound to the engine's `status` publisher.
- `apps/web/src/ui/ConnectionStatusBadge.tsx` — equivalent React component.
- Storybook-equivalent: a `?status=<state>` URL param on the web app forces a particular state for manual visual regression; on macOS a hidden debug menu entry under "Debug ▸ Force connection state…" does the same.
- Tests:
  - Snapshot of every state on each platform.
  - State-transition tests: scripted sequence from iteration 20/21 produces the expected sequence of rendered badges.

**Acceptance criteria:** screenshots of all states match between macOS and web side by side; both pass their snapshot suites. `docs/connection-status.md` is referenced from `AGENTS.md`.

**Out of scope:** Settings panel reorganization (iteration 23).

---

## Iteration 23 — Settings UI v2 (consistent across macOS and web)

**Goal:** The Cloud Sync settings panel looks and behaves the same on macOS and web. The "Test" button probes capabilities and tells the user — clearly — whether they will get WebSocket sync or polling fallback.

**Deliverables:**

### Panel structure (both platforms, same order)

1. **Status header** — large copy of the connection-status indicator from iteration 22 + the current `accountDid` (monospace, copyable).
2. **Enable cloud sync** toggle. When off, sections 3–5 are visually de-emphasized and disabled.
3. **Backend URL** — text field, validated by:
   - URL syntactically valid (`https://` required; warn but allow `http://localhost`).
   - `GET /capabilities` returns 200 within 5 s.
4. **Test** button next to the URL. Click runs the capability probe and shows one of:
   - ✅ "WebSocket sync available — your edits will appear on other devices in under a second."
   - ⚠️ "This server only supports polling — your edits will appear on other devices within ~1 minute. Ask the operator to upgrade the backend to v0.3.0+."
   - ❌ "Couldn't reach this server: `<reason>`."
   The probe result is also stored so the connection-status indicator shows `fallback` immediately on engine start without re-probing.
5. **Identity** subsection — Show DID, Show mnemonic (gated by `RevealGate`), Show QR, Forget this device. Unchanged from v0.2.0.
6. **Advanced** subsection (collapsed by default) — push interval (REST mode only; greyed out in WS mode), archive cutoff days (read-only label "60 days, hard-coded by protocol"), debug toggles for forcing a transport.

### Cross-platform consistency rules

- Same section order, same labels, same copy. Translation file is a flat key→string map; macOS uses `String(localized:)`, web uses a tiny `t(key)` helper reading the same keys.
- Spacing: 12 px (macOS) / `0.75rem` (web) between sections. Buttons use the platform-native primary style (no custom theme).
- Validation: errors render inline under the field, not as modals.

### Implementation notes

- macOS: extend `apps/macos/Sources/CornerTasks/UI/SettingsView.swift`. Drop any one-off layout differences from v0.2.0.
- Web: extend `apps/web/src/ui/SettingsPanel.tsx`. Pull strings into `apps/web/src/ui/strings.ts`.
- Both wire the "Test" button to the `TransportSelector.probe()` helper from iterations 20/21.

### Tests

- macOS UI test: settings panel renders all six sections in order; "Test" with a stub transport returns each of the three outcomes and shows the correct copy.
- Web Vitest + Testing-Library: same matrix.
- Visual diff: side-by-side screenshot at 390×844 (iPhone 14) and at the macOS panel's native size, attached to the PR description.

**Acceptance criteria:** the two panels look like the same product. The "Test" button is unambiguous about whether the user is getting WS or polling.

**Out of scope:** changing the enable-cloud-sync chooser modal copy; QR scan UI changes; mnemonic-import flow changes.

---

## Iteration 24 — Docker Compose backend (Postgres + Node) consuming `@cornertasks/core`

**Goal:** A second concrete backend that exposes the **exact same wire protocol** as the AWS backend, runnable with one `docker compose up`. Reuses every protocol decision and every line of validation/conflict/auth logic via `@cornertasks/core`. Implementation-specific code is only adapters (Postgres storage + a `ws`-based WebSocket server).

**Decision:** Single Node service + single Postgres service. No Redis, no NATS. Broadcast within a single instance uses an in-process registry; for multi-instance fan-out the README points at Postgres `LISTEN/NOTIFY` as a follow-up — out of scope for v0.3.0.

**Deliverables (`backend/docker/`):**

### Layout

```
backend/docker/
├── docker-compose.yml
├── Dockerfile                            # multi-stage; final image is node:22-alpine
├── package.json                          # depends on @cornertasks/core, express, ws, pg, zod
├── tsconfig.json
├── .env.example                          # PG_*, JWT_SIGNING_KEY_PATH or JWT_SIGNING_SECRET, AUDIENCE
├── src/
│   ├── main.ts                           # boots HTTP server + WS server
│   ├── http/
│   │   ├── auth.ts                       # /auth/challenge, /auth/token via @cornertasks/core
│   │   ├── capabilities.ts               # mirrors backend/aws/src/handlers/capabilities.ts
│   │   └── restSync.ts                   # /v1/sync/push, /v1/sync/pull (gated by INCLUDE_REST_V1)
│   ├── ws/
│   │   ├── server.ts                     # ws.Server attached to the same HTTP port
│   │   ├── connectionRegistry.ts         # in-process Map<accountDid, Set<WebSocket>>
│   │   └── handlers.ts                   # subscribe / push / reauth / pong (mirrors AWS onMessage.ts)
│   └── adapters/
│       ├── postgresEventStore.ts         # implements @cornertasks/core EventStore
│       ├── postgresChallengeStore.ts     # implements ChallengeStore
│       └── envSigningKey.ts              # implements SigningKeyProvider (reads JWT_SIGNING_* env)
├── migrations/
│   └── 001_init.sql                      # events, challenges tables; indexes mirror DynamoDB access patterns
└── README.md                             # one-command run, env vars, k8s notes (iter 25)
```

### Postgres schema (`migrations/001_init.sql`)

```sql
CREATE TABLE events (
    account_did   text        NOT NULL,
    task_id       text        NOT NULL,
    event_id      text        NOT NULL,
    updated_at    timestamptz NOT NULL,
    op            text        NOT NULL CHECK (op IN ('upsert', 'delete')),
    ciphertext    bytea       NOT NULL,
    nonce         bytea       NOT NULL,
    completed_at  timestamptz NULL,
    PRIMARY KEY (account_did, task_id)
);
CREATE INDEX events_by_account_updated_at ON events (account_did, updated_at);

CREATE TABLE auth_challenges (
    account_did  text        NOT NULL,
    challenge    text        NOT NULL,
    expires_at   timestamptz NOT NULL,
    PRIMARY KEY (account_did, challenge)
);
CREATE INDEX auth_challenges_expires ON auth_challenges (expires_at);
```

A simple `expireBatch` loop in the Node service deletes expired challenges every minute (no DynamoDB TTL on this side).

### docker-compose.yml (sketch)

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: cornertasks
      POSTGRES_PASSWORD_FILE: /run/secrets/pgpw
    volumes:
      - pgdata:/var/lib/postgresql/data
    secrets: [pgpw]
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres"]
  api:
    build: .
    environment:
      PG_HOST: postgres
      PG_DB: cornertasks
      PG_USER: postgres
      AUDIENCE: http://localhost:8080
      INCLUDE_REST_V1: "false"
      # JWT_SIGNING_KEY_PATH=/run/secrets/jwtkey  (preferred)
      # JWT_SIGNING_SECRET=...                    (HS256 fallback)
    ports:
      - "8080:8080"
    depends_on:
      postgres: { condition: service_healthy }

volumes:
  pgdata:

secrets:
  pgpw: { file: ./.secrets/pgpw }
```

### Behavioural contracts

- `/capabilities` returns `protocols: ["ws-v2"]` by default. With `INCLUDE_REST_V1=true` env var, returns `["ws-v2", "rest-v1"]` and mounts the REST routes.
- The Postgres adapter uses ordinary `pg.Pool` — no ORM. Queries are written by hand and tested against `pg-mem` (in-process Postgres-compatible store) so unit tests don't need Docker.
- The WebSocket server attaches to the same HTTP port on path `/v2/ws`. Bearer JWT is read from the URL's `?token=` query param, verified via `@cornertasks/core/bearer.verify`, and the connection is rejected with a `401` HTTP upgrade response otherwise (clients see this as a WS close).
- Idle disconnect: 10 minutes, matching API Gateway (so client reconnect behaviour is identical on both backends).
- Keepalive: `ping` every 4 minutes, matching iteration 18.

### Tests

- Vitest unit tests for adapters via `pg-mem`.
- Integration test using `testcontainers` (postgres image) covering challenge → token → ws.subscribe → ws.push → broadcast → token_expiring → reauth.
- Run `sync-doctor` (from iteration 19) against `http://localhost:8080` — same script, same green/red. CI does NOT run this (avoids pulling Postgres in CI for now); document the manual run in the README.

### Documentation

- `backend/docker/README.md`:
  - One-command bring-up: `cp .env.example .env && docker compose up --build`.
  - Required env vars + IAM-equivalent notes (file permissions on `.secrets/jwtkey`).
  - "Point a client at it": Settings → Cloud Sync → URL = `http://localhost:8080` → Test button shows the WS capability.
  - "Running v1 (REST) and v2 (WebSocket) in parallel" — `INCLUDE_REST_V1=true`.
  - Backup notes: `pg_dump` the `events` table; it's the entire state.
  - "Why we don't publish a Docker image": the maintainer doesn't host one; users build locally and pin the commit they trust. (Same posture as the BYO-AWS doc.)
- Update `AGENTS.md` "Repository layout" + add a "Backends" section listing AWS and Docker as the two concretions of `backend/core/`.
- Update root `README.md` self-hosting section: now mentions both AWS and Docker as supported deployment targets.

**Acceptance criteria:**

- `docker compose up --build` from a clean checkout brings the stack up; `curl http://localhost:8080/capabilities` returns `protocols: ["ws-v2"]`.
- A macOS or web client pointed at `http://localhost:8080` completes the same end-to-end scenario as against AWS.
- `npm test --workspace backend/docker` passes (pg-mem-only, no Docker required in CI).
- `sync-doctor --protocol ws-v2 --api-url http://localhost:8080 --mnemonic '...'` passes locally.

**Out of scope:** publishing a prebuilt image, multi-instance horizontal scaling, k8s manifests (covered as docs in iteration 25).

---

## Iteration 25 — Self-hosting docs (Docker, k8s adaptation, AWS cost-tuning)

**Goal:** A developer who isn't deep in this codebase can pick the right backend, deploy it, and understand the AWS bill.

**Decision on k8s**: do NOT add a `backend/k8s/` package. The Docker Compose setup is the source of truth; running it on k8s is a matter of converting the compose file to a Deployment + StatefulSet, which we describe in prose + a minimal example manifest. This avoids a third concretion to keep in sync.

**Deliverables:**

### `backend/docker/README.md` — extend with these sections

- **Running on Kubernetes** (≤ 100 lines):
  - One `Deployment` for the Node `api` service (≥ 2 replicas only if you also add `pg_listen`-based fan-out, which is *out of scope for v0.3.0* — explicitly call this limitation out).
  - One `StatefulSet` for Postgres (single replica) with a `PersistentVolumeClaim`.
  - One `Service` (`ClusterIP`) + one `Ingress` with WS support (annotations vary per Ingress controller; show the nginx-ingress example: `nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"`, `nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"`).
  - Secrets: `JWT_SIGNING_KEY` and `PG_PASSWORD` as `Secret` resources.
  - Health/readiness probes pointing at `/capabilities` (200 = ready).
  - **What's intentionally missing**: a Helm chart, horizontal autoscaling beyond a single replica, multi-cluster fan-out. These are out of scope; contributors who need them should open a tracked issue.
- **Production checklist** (applies to both compose and k8s): TLS termination at the ingress (or `caddy` reverse-proxy for compose), `JWT_SIGNING_KEY` rotation note, `events` table backup, observation that the event store grows monotonically until the 60-day archive cutoff is applied (server-side filter on pull, but server keeps the rows — clients can read history; document the optional `VACUUM` job).

### `backend/aws/README.md` — extend with these sections

- **Cost-tuning** (≤ 80 lines, plain numbers, label every figure as "approximate, region us-east-1, 2026 prices — verify"):
  - DynamoDB on-demand vs. provisioned for the three tables (`events`, `auth_challenges`, `ws_connections`). Recommendation: on-demand for v0.3.0; revisit at >10k DAU.
  - API Gateway WebSocket pricing model (per-million messages + per-million connection-minutes). Worked example: a single user with one macOS + one web instance, both connected 8 hours/day, generating ~50 edits/day → ≈ $X/month. Show the math.
  - ARM Lambda (`Architectures: [arm64]`) on every function — done in iteration 18; this section is a reminder.
  - CloudWatch Logs retention: set to 7 days for the WS handlers (a chatty handler) and 30 days for `auth/*`.
  - SAM parameter `IncludeRestV1=false` cuts an entire API + 2 Lambdas — call out the savings.
  - Reserved-concurrency caps to keep a misbehaving client from running up a bill.

### Root `README.md`

- Add a "Choose a backend" subsection just above the privacy section: a 5-row table comparing AWS vs. Docker Compose on Setup effort / Operational effort / Cost / Scale / Best for.

**Acceptance criteria:** documents render correctly, are referenced from `AGENTS.md`, and a contributor unfamiliar with the project can stand up either backend in under an hour following only the README.

**Out of scope:** Helm charts, Terraform modules, hosted-service offerings.

---

## Iteration 26 — End-to-end verification

**Goal:** Confirm the full v0.3.0 surface across the deployment matrix.

**Deliverables — extend `docs/e2e-test.md`:**

For each backend (AWS with `INCLUDE_REST_V1=false`, AWS with `INCLUDE_REST_V1=true`, Docker Compose):

1. **Capability probe**: macOS Settings → Test → shows the right message for the deploy.
2. **WS happy path**: edit on macOS → web sees the change in under 2 s (`source: "push"` in the WS log). Connection-status badge shows `pushing` → `connected` on the sender and `fetching` → `connected` on the receiver.
3. **REST fallback**: temporarily set `--protocol rest-v1` on the client (or deploy AWS with `INCLUDE_REST_V1=true` and an artificial WS rejection); confirm convergence in ~60 s and `fallback` badge.
4. **Token expiry**: shorten the bearer `exp` to 90 s, wait for `token_expiring` → `reauth` → no reconnect visible. Connection-status badge shows `authenticating` briefly.
5. **Reconnect**: kill the Wi-Fi for 30 s; badge shows `failed(retryIn:…)` → `connecting` → `connected` on resume; no events lost.
6. **Archive cutoff**: insert an event with `completedAt = 70 days ago` on macOS; web does NOT receive it.
7. **Disabled state**: turn off cloud sync on web; badge shows `disabled`; no network traffic.
8. **Standalone-mode regression** (carry-over): a fresh macOS install with cloud sync off makes zero outbound network calls.
9. **Cross-backend identity**: same mnemonic against AWS and Docker concurrently — events do NOT merge across backends. Document that this is expected (each `ApiUrl` is its own universe).

Each bug found gets a regression test in iterations 20 / 21 / 24 as appropriate.

**Acceptance criteria:** the script passes end-to-end across all three deploy modes.

---

## Iteration 27 — Release v0.3.0

**Goal:** Cut the release.

**Deliverables:**

- Bump `apps/macos/AppBundle/Info.plist` `CFBundleVersion` and `CFBundleShortVersionString` to `0.3.0`.
- Bump `apps/web/package.json` and `backend/core/package.json`, `backend/aws/package.json`, `backend/docker/package.json` to `0.3.0`.
- Update root `README.md` "Version" line + changelog table.
- Confirm the released DMG starts with cloud sync **off** and no `backendURL` baked in.
- Confirm `INCLUDE_REST_V1` defaults to `false` in `backend/aws/template.yaml` (i.e., release CI does not need to set anything; default is already "WebSocket only").
- Update `CHANGELOG.md` with a v0.3.0 entry listing the protocol change, the new self-hosting option, the new connection-status indicator, and the deprecation of `/v1/sync/*` (removal scheduled for v0.4.0).
- Tag `v0.3.0`. Verify the GitHub Actions release workflow attaches the universal DMG. No AWS secrets involved; that contract must remain.

**Out of scope:** notarization, App Store submission, removing v1 REST endpoints from the code (deferred to v0.4.0 per the deprecation table in `docs/sync-protocol.md` §12).

---

## Open questions (resolve before the iteration that needs each)

- **Per-account connection cap on AWS**: should we cap `ws_connections.Query` to, say, 8 connections per account to prevent a runaway client from amplifying a single push into many broadcasts? Default position: yes, soft cap of 8, oldest connection evicted on a 9th. Resolve in iteration 18.
- **Postgres LISTEN/NOTIFY for multi-instance Docker fan-out**: out of scope for v0.3.0 but called out in `backend/docker/README.md`. If a contributor needs it before v0.4.0, they should file an issue with their scaling target.
- **Re-auth window**: §11.1 says `token_expiring` fires within 60 s of `exp`. Confirm this is enough headroom on slow mobile networks during iteration 21 testing; widen to 120 s if not.
- **Connection-status localization**: strings live in flat key→string maps from iteration 22 onward, but we don't add a second language in v0.3.0. Confirm that flat-map shape is enough when localization actually lands (probably v0.4.0).
