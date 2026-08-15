---
id: N06
title: Env/file signing-key provider (drop SSM requirement)
model: haiku
deps: [N04]
---

## Goal

Let the self-hosted runtime get its JWT signing key without AWS SSM.

## Why this is a haiku node

Single file, exact spec, existing seam, fast oracle. `getSigningKey()` in
`lib/signing-key.ts` already caches behind a `setSigningKey()` setter and
already branches on `JWT_ALG`. Add one more branch on the *source* of the key
material; the `SigningKey` shape (`alg`, `kid`, `privateKey`, `publicKey`) does
not change.

## Spec

Select the provider with `CT_KEY_SOURCE`:

- `env` — read base64 from `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY`
  (or `JWT_SECRET` when `JWT_ALG=HS256`).
- `file` — read base64 from the paths in `JWT_PRIVATE_KEY_FILE` /
  `JWT_PUBLIC_KEY_FILE`. Preferred in Docker (works with secrets mounts).
- `ssm` — the existing AWS path; **stays the default when unset**, so no
  existing deployment changes behaviour.

Move the SSM branch to `backend/aws/src/lib/ssm-key.ts` and have core call it
through a registered provider, keeping `@aws-sdk/client-ssm` out of core.

Fail loudly on a missing or malformed key — a clear startup error naming the
missing variable, never a silently generated ephemeral key. A key that
regenerates on restart would invalidate every client's bearer token with no
diagnosable symptom.

## Acceptance

- `cd backend/core && npm test -- signing-key` passes, covering all three
  sources plus both failure modes (absent, malformed base64).
- `grep -rn "@aws-sdk" backend/core/src/` returns nothing.
- Existing AWS tests unchanged and green.

## Out of scope

Key generation tooling (N09 ships a one-liner in the Docker docs), key rotation.
