# Goal — v0.3.0 (loop form)

> Reference only. The live plan is `plan/v0.3.0/`.

The entire "plan" in loop engineering is a goal plus constraints plus a
done-condition. No decomposition, no ordering, no estimates — those are
discovered.

## Goal

Ship CornerTasks v0.3.0: the backend becomes a **choice** (AWS Lambda or a
Docker container the user runs themselves, sharing one core), clients sync over
**WebSocket with REST polling retained as a fallback**, and both apps show a
**connection-status indicator**.

## Constraints

Non-negotiable. If satisfying the goal would break one of these, stop and ask.

1. **Do not change the data model or the cryptography.** `did:key` identity,
   AES-256-GCM event encryption, LWW by `updatedAt`, server-assigned `seq`, the
   60-day archive cutoff — all carry over untouched.
2. **REST is never deprecated.** A backend advertising only REST must remain
   fully supported, and clients must sync against it indefinitely.
3. **Existing AWS deployments keep working without redeployment.**
4. **Design-as-code order**: any visible change edits `design/` JSON first, then
   `make design-validate`, then app code. See `AGENTS.md`.
5. **Never weaken a test or an assertion to make a suite pass.** If a test looks
   wrong, stop and ask.
6. **Outbound-only networking.** Nothing listens on the LAN.

## Done when

- `bash scripts/test-all.sh` is green.
- A fresh clone reaches a synced macOS app and a synced web app against a local
  `docker compose up` backend, with the phone reaching it over a tunnel.
- The same conformance suite passes against both backends and both transports.
- Both apps render every connection state, and the two look like one product.
- README explains the backend choice and what it means for where data lives.

## Notes for the loop

- Prefer extending an existing seam over adding an abstraction. This codebase
  already has good ones — `Store`, `SyncTransport`, `setSigningKey`.
- When a step turns out to be bigger than one careful pass, do the smallest
  useful slice and journal the rest. Never carry a half-finished change across
  iterations without recording it.
