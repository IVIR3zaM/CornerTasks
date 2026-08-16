# Loop engineering — a reference point

This folder is a **thought experiment, not a live plan**. It shows how the same
v0.3.0 release would be driven with loop engineering, so you can compare it
against the graph in `plan/v0.3.0/`. Nothing here is wired to a schedule and
nothing here should be executed.

Both approaches are represented at their best. A loop done well beats a graph
done badly, and most teams should start with the loop.

## The shape of the difference

**Graph**: you spend effort up front deriving structure — what depends on what,
what proves each piece done — and the executor's job is then mechanical:
compute the ready set, pick one, verify, record.

**Loop**: you spend no effort up front. You state the goal and the constraints,
and the agent discovers structure as it goes: look at the current state, decide
the next most useful thing, do it, check it against a real signal, write down
what happened, repeat.

The loop is not "no structure". It is **structure discovered lazily instead of
precomputed** — and lazily is often the right call, because precomputed
structure can be wrong.

## Files

| File | Role | Graph equivalent |
|---|---|---|
| `goal.md` | the one thing being converged on, with constraints and done-conditions | `plan/v0.3.0/README.md` + `graph.yaml` |
| `LOOP.md` | the driver prompt — one iteration of the loop | `.claude/skills/v030-build/SKILL.md` |
| `progress.md` | append-only journal; the only state carried between iterations | `graph.yaml` `status:` fields |

That's three files against a graph's twenty-one. The asymmetry is the point:
the loop's cost is per-iteration, the graph's is up front.

## Where the loop genuinely wins

- **Zero setup.** You can start in the next minute. The graph cost about 30
  minutes of dependency tracing before a line of code moved.
- **It cannot be wrong about the plan**, because there is no plan to be wrong.
  A graph edge that turns out to be false sends work down a dead path; a loop
  just sees reality and re-decides.
- **It adapts to discoveries.** When the agent found that `backend/aws`'s build
  was broken (D6 in the graph run), a loop would simply have folded the fix into
  the next iteration. The graph had to stop, log a decision, and wait for a
  human — correct, but slower.
- **Fewer artifacts to keep true.** Every node file in the graph is a document
  that can drift from the code. The journal only ever records the past, so it
  cannot go stale.
- **Strong oracles make it very hard to beat.** With a fast compiler and a good
  test suite, the loop's iterate-until-green behaviour is extremely effective,
  and no amount of graph structure improves on it.

## Where the loop costs you

- **No readiness computation, so no safe parallelism.** The loop knows what it
  just did, not what is independent of what. Two loops on one repo collide.
- **No completeness guarantee.** The loop stops when it believes it is done.
  The graph stops when the frontier is empty — a fact rather than a judgement.
- **Cold resume is lossy.** State lives in prose. A fresh session must re-read
  and re-interpret the journal; two readers can reach different conclusions
  about what is next. `make v030-status` cannot be misread.
- **Unbounded variance.** A loop iteration might take four tool calls or forty.
  Fine when you are watching; expensive when nine unattended runs fire overnight
  and you are asleep.
- **No natural place to force a human decision.** The graph's `gate: human` is
  declared before work starts. A loop has to notice it should stop and ask,
  which is exactly the judgement an unattended agent is worst at.
- **Model tiering is hard to apply.** The graph knows a node is mechanical
  before dispatching, so it can send it to Haiku. A loop discovers how hard a
  step is by attempting it, at whatever model it is already running.

## What the graph actually caught on this project

Worth being concrete, because these are the payoff and not much else was:

1. **The dependency scan** — only two of nine AWS-touching backend modules had
   real runtime dependencies, the rest were type-only imports. That turned "port
   the backend off Lambda" from a rewrite into an adapter over the existing
   handlers. A loop would very likely have found this too, but after starting to
   port a handler rather than before.
2. **`0 unattended, 1 gated`** — the graph reported that an overnight run had no
   executable work before a night was spent on it, because both contract nodes
   were human-gated and everything descended from them. A loop would have
   discovered this at 3am by improvising a protocol spec.
3. **A missing edge** — the overnight executor found that N12 and N14 depended
   on N03 and the graph did not say so, and fixed it (`f432bad`). This is a
   failure mode a loop cannot have, because it has no edges to get wrong; it is
   also a bug the graph surfaced and repaired cheaply.

Note that (1) is a *code-graph* win, not a plan-graph win — see the three kinds
of graph engineering below.

## Choosing

Use the **loop** when: the work is mostly sequential anyway, you have a fast
oracle, you are present to steer, and the task is under a day.

Use the **graph** when: work must run unattended, several independent tracks
could proceed in parallel, completeness matters (a rename, a deprecation, an
audit), or several contracts have to be settled before anyone can implement
against them.

Use **both**, which is what this repo does: the graph scopes and sequences, and
inside each node the subagent runs a plain loop against that node's oracle.
