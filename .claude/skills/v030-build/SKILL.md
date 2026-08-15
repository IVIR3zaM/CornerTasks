---
name: v030-build
description: Execute the next ready node(s) of the v0.3.0 build graph in plan/v0.3.0/. Selects nodes whose dependencies are satisfied, dispatches each to the cheapest model tier that can do the work, verifies against the node's oracle, commits, and updates status. Use when asked to "build v0.3.0", "run the next node", "continue the graph", or when a scheduled run fires.
---

# v0.3.0 graph executor

You are executing a dependency graph, not a task list. Do exactly one pass of
the loop below, then stop and report. A pass is resumable: all state lives in
`plan/v0.3.0/graph.yaml`, so a run cut short by a rate limit loses nothing.

## 1. Load state

```bash
node scripts/v030-status.mjs
```

This prints every node with its status and readiness. **Ready** = `status: todo`
and every dependency `done`.

If nothing is ready, report why (blocked, or everything done) and stop.

## 2. Select

From the ready set:

- **Skip any node with `gate: human`.** Do not execute it. Report that it needs
  the user, name the decision it turns on, and continue to the next ready node.
  If the only ready nodes are gated, stop and surface them.
- Check `plan/v0.3.0/decisions.md` for an unresolved decision that lists this
  node under **Blocks**. If found, set the node `blocked`, report it, move on.
- Prefer the node that unblocks the most downstream nodes; break ties by
  cheapest model tier.

Take one node per pass unless two ready nodes touch provably disjoint files —
then you may run them in parallel worktrees via the Agent tool's
`isolation: "worktree"`.

## 3. Scope check before dispatching (mandatory)

Judge whether the node fits one careful, token-cheap pass. It does **not** fit
if any of these hold:

- it touches more than ~10 files;
- it spans more than one platform or package (`apps/macos` *and* `apps/web`,
  or `backend/core` *and* `backend/aws`);
- it requires learning an unfamiliar API *and* building on it in the same pass;
- its Deliverables list has clearly separable halves.

If it doesn't fit, **split it before dispatching**:

1. Add sub-nodes to `graph.yaml` (`N07.1`, `N07.2`, …; 2–4 of them), each
   independently mergeable with its own oracle that must be green on its own.
2. Point the original node's dependents at the last sub-node, and give each
   sub-node its predecessor as a dependency.
3. Write one node file per sub-node, each referencing the original rather than
   restating it.
4. Set the original node `status: split` and execute only the first sub-node
   this pass.

Splitting is cheap and never wrong. Running out of context halfway through a
node is expensive and leaves a half-finished commit. When in doubt, split.

## 4. Dispatch by tier

The `model:` field in the node file is the credit budget. Honour it — this is
the whole point of the tiering.

| Tier | Agent | Use |
|---|---|---|
| `haiku` | `ct-scribe` | exact spec, single file, fast oracle |
| `sonnet` | `ct-implementer` | code against tests/compiler/validator |
| `opus` | `ct-architect` | protocol, contracts, cross-cutting prose |

Spawn with the Agent tool, passing `model` explicitly. Give the subagent: the
node file path, the oracle command, and the instruction to read `AGENTS.md`
first. Do **not** paste the whole plan into the prompt — the node file is
self-contained, and keeping it that way is what holds per-node cost flat.

**Escalation:** if the oracle fails twice at the declared tier, retry once at
the next tier up and note the escalation in the commit body. Never escalate
past `opus`. Never silently downgrade.

## 5. Verify

Run the node's `oracle` yourself, in the main worktree, after the subagent
returns. Do not trust the subagent's own report — the oracle is the authority.

Also run `bash scripts/test-all.sh` if the node touched `design/`, `apps/`, or
`backend/`, to catch collateral breakage.

If the oracle fails after escalation: set the node `blocked`, append a short
diagnosis to `plan/v0.3.0/decisions.md`, leave the work uncommitted on a
branch, and stop. **Do not proceed to another node after a hard failure** — a
broken shared contract poisons everything downstream.

## 6. Commit and record

All nodes accumulate on **one integration branch: `v030/build`**. Nodes depend
on each other's code — N05 builds on N04 — so a branch per node would leave each
run unable to see the last one's work. Start every pass with:

```bash
git fetch origin && git checkout v030/build 2>/dev/null || git checkout -b v030/build origin/main
git pull --ff-only origin v030/build 2>/dev/null || true
```

One commit per node, on that branch:

```
<type>: <node title>

Node <id> of the v0.3.0 build graph. Oracle: <command> ✓
[Escalated haiku→sonnet: <reason>]

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

Then set `status: done` in `graph.yaml` and commit that separately, so the graph
state is recoverable even if the node commit is reverted.

**Push `v030/build` to `origin` before finishing.** A scheduled cloud run
executes in a disposable sandbox — unpushed work is lost when it ends, and the
next run would recompute readiness from a `graph.yaml` that never came back.
The push is what makes the loop resumable, so do it even if the pass ends early.

**Never push to `main` and never merge.** The user reviews `v030/build` and
merges it themselves. Open a PR only if the user asked.

## 7. Report

State: node executed, tier used, oracle result, what is ready next, and
anything needing the user. Be brief — this may be read as a morning summary of
a dozen runs.

## Hard rules

- Never modify `plan/v0.3.0/nodes/*.md` to make a node easier to pass.
- Never edit a node's `oracle` to make it green.
- Never mark `done` without the oracle passing in the main worktree.
- Never resolve a `decisions.md` question on the user's behalf.
- Never delete or rewrite existing tests to make a suite pass. If a test is
  genuinely wrong, stop and surface it — that's a human call.
