# v0.3.0 — build graph

This directory is the machine-readable plan for v0.3.0. It replaces the
FPP/DIDComm plan that previously lived in `ITERATIONS.md` (iterations 15–27),
which is **abandoned** — no mediator, no VTA, no `did:webvh`, no MCP agents.

## What v0.3.0 is

1. **Backend choice, not backend lock-in.** The same server core runs as AWS
   Lambda *or* as a Docker container. The user picks at deploy time.
2. **Local-first hosting option.** The Docker image is meant to run on the
   user's own Mac so task data never leaves the machine, with an ngrok tunnel
   letting their other devices (iPhone, second laptop) reach it. Outbound-only:
   nothing listens on the LAN, nothing needs inbound firewall rules.
3. **WebSocket sync, with REST polling as a fallback.** Both backends implement
   both transports. Clients negotiate, prefer WS, and fall back on failure.
4. **Connection-status indicator** in both apps — one state vocabulary, shared
   across platforms, driven by the real transport state.
5. **Local Docker is also the test harness.** Integration tests run against a
   real container rather than mocks.

Carried over unchanged from v0.2.0: `did:key`/mnemonic identity, AES-256-GCM
event encryption, LWW conflict resolution, the 60-day archive cutoff.

**New here?** [`HOW-IT-WORKS.md`](HOW-IT-WORKS.md) explains the method itself —
what an oracle and a gate are, how the agents and skills fit together, diagrams
of the execution pass and of this graph, and how to apply the same approach to
other work.

## Why a graph and not an iteration list

`ITERATIONS.md` is a linear list — it assumes each step starts when the one
before it finished. Most of v0.3.0 isn't actually linear: the SQLite store and
the signing-key provider don't depend on each other, and neither client
depends on the other. A graph records the *real* dependency edges, so:

- an executor can pick any node whose dependencies are all `done`;
- independent nodes can run in parallel, in separate worktrees;
- a node that fails or gets blocked doesn't stall unrelated work;
- work stopped halfway (rate limit, overnight cutoff) resumes exactly where it
  left off, because readiness is computed from `graph.yaml`, not from memory.

Each node also declares an **oracle** — the command that proves it's done. That
is what makes unattended execution safe: the agent isn't judging its own work,
a compiler or a test suite is.

## Layout

```
plan/v0.3.0/
  README.md      ← you are here
  graph.yaml     ← the DAG: nodes, deps, model tier, oracle, status
  decisions.md   ← open questions that need a human; blocks specific nodes
  nodes/NNN-*.md ← one file per node: goal, files, acceptance, out-of-scope
```

Node files are deliberately small and separate. An executor reads one node plus
`graph.yaml` — not a 70 KB planning document — which keeps per-node context
cost roughly flat as the plan grows.

## Running it

```bash
make v030-status
```

To execute the next ready node, invoke the `v030-build` skill in Claude Code.
It selects a node, dispatches it to the cheapest model tier that can do the
work, verifies against the node's oracle, commits, and marks it `done`.

Nodes marked `gate: human` stop and wait for you — they involve protocol or
product decisions that shouldn't be made unattended.

## Status conventions

`todo` → `in_progress` → `done`, or `blocked` (see `decisions.md`).
The executor is the only writer of `status:`; edit it by hand only to unblock.
