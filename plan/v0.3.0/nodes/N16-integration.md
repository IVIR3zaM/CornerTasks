---
id: N16
title: Docker-backed integration harness (both transports)
model: sonnet
deps: [N09, N12, N14]
---

## Goal

Run the client sync engines against a **real container** instead of mocks, over
both transports. This is the node that catches what unit tests structurally
cannot: adapter/Lambda divergence, real socket lifecycle, actual SQLite
concurrency.

## Deliverables

- `scripts/test-integration.sh` — bring up the compose stack on an ephemeral
  port with a scratch volume, wait for `/v1/health`, run the suites, tear down
  and delete the volume even on failure (`trap`).
- A conformance suite parameterised by `(transport, backend)` so the same
  assertions run over WS and REST — and, once N10 lands, against AWS too. One
  suite, every combination.
- Scenarios: full round-trip push→pull between two clients; **WS on client A,
  REST on client B, converging**; offline queue drains on reconnect; forced
  mid-session socket drop with no loss or duplication; LWW conflict resolution
  unchanged from v0.2.0; archive cutoff honoured.
- Wire into `scripts/test-all.sh` as a new `integration` scope, skipped
  automatically when Docker isn't available (matching how `SKIP_MACOS` and the
  optional-tool probes already work) so CI without Docker still passes.

## Acceptance

- `bash scripts/test-integration.sh` green from a clean clone.
- Every scenario runs in all available `(transport, backend)` combinations.
- Deterministic: 10 consecutive runs, no flakes. A flaky integration suite gets
  ignored within a week, which is worse than not having one.

## Out of scope

Real-device testing over ngrok (N17), performance benchmarking.
