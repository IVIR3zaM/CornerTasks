---
id: N05
title: SQLite Store implementation
model: sonnet
deps: [N04]
---

## Goal

A persistent `Store` for the self-hosted runtime, so the container survives
restarts without DynamoDB.

## Why this is small

`backend/core/src/lib/db.ts` already defines the whole contract — five methods
(`putEvent`, `queryEventsAfter`, `pruneExpiredArchives`, `putChallenge`,
`consumeChallenge`) behind `setStore()`/`getStore()` injection. And
`tests/helpers/memory-store.ts` is a complete working implementation of it.
Port that file to SQLite; the semantics are already pinned by the existing
tests.

## Requirements

- **Per-account monotonic `seq`.** `memoryStore` uses an in-process counter.
  In SQLite, allocate inside the same transaction as the write —
  `INSERT … SELECT COALESCE(MAX(seq),0)+1 FROM events WHERE account_did = ?` —
  so concurrent pushes cannot collide. This is the one place a naive port
  breaks.
- **Stale rejection still consumes a seq** (gap in the log). Readers query
  `seq > cursor`, so gaps are already handled — preserve the behaviour.
- Schema: `events(account_did, task_id, seq, payload, archived_completed_at)`
  with `PRIMARY KEY (account_did, task_id)` and an index on
  `(account_did, seq)`; `challenges(account_did, challenge, expires_at)`.
- Driver: see D5 — default `node:sqlite`.
- `CT_STORE=sqlite|memory|dynamo` env selects the implementation.
- DB path from `CT_DB_PATH`, defaulting inside the container volume.

## Acceptance

- `cd backend/core && CT_STORE=sqlite npm test` — the same suites that pass
  against `memoryStore` pass against SQLite, unmodified.
- A concurrency test: 50 parallel `putEvent` calls on one account yield 50
  distinct sequential `seq` values.
- Restart test: write, close, reopen, `queryEventsAfter` returns the data.

## Out of scope

The HTTP server (N07), migrations tooling, any schema change to the wire event.
