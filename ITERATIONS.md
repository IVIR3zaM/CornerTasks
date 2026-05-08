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
