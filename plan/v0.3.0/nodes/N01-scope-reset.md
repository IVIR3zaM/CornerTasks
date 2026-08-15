---
id: N01
title: Scope reset — retire the FPP plan, restate v0.3.0
model: opus
gate: human
deps: []
---

## Goal

Every architectural document in the repo currently describes a release that is
no longer being built. Until they're corrected, any agent following the repo's
own instructions ("read `docs/ARCHITECTURE.md` before any iteration") builds
the wrong thing. This node makes the docs true.

## Why it is first

It has no dependencies and everything depends on it. `ITERATIONS.md` tells
agents to treat `docs/ARCHITECTURE.md` as the architectural contract; that file
currently specifies DIDComm, a mediator, a VTA and `did:webvh`. Leaving it in
place while other nodes run guarantees contradictory work.

## Files

- `docs/ARCHITECTURE.md` — **rewrite** for v0.3.0: two interchangeable backend
  runtimes (Lambda / container) behind one protocol; local-first hosting with
  outbound-only ngrok ingress; WS-preferred transport with REST fallback;
  unchanged `did:key` identity and E2E encryption. Remove the FPP concept
  mapping, topology, discovery, key-separation and upstream-pin sections
  entirely — do not soften them, delete them.
- `ITERATIONS.md` — replace the `# v0.3.0 Iterations` block (from line ~495 to
  the end) with a short pointer to `plan/v0.3.0/`. Keep the v0.2.0 history
  above it untouched.
- `AGENTS.md` — update "Cloud sync — opt-in only" and "Sync model (v0.2.0)" to
  describe transport negotiation; add a pointer to `plan/v0.3.0/README.md`.
- `CHANGELOG.md` — add an Unreleased entry recording the plan change.

## Acceptance

- `docs/ARCHITECTURE.md` contains no occurrence of `DIDComm`, `did:webvh`,
  `mediator`, `VTA`, or `First Person Project`.
- `ITERATIONS.md` no longer lists iterations 15–27.
- Nothing under `apps/` or `backend/` is modified by this node.

## Out of scope

Protocol details (N02), any code change at all.
