# The loop driver

> Reference only — do not run. The live executor is
> `.claude/skills/v030-build/SKILL.md`.

One invocation = one iteration. The agent starts cold every time; `progress.md`
is the only memory carried across iterations, which is why writing it well is
the whole discipline.

---

## Iteration

**1. Orient.** Read, in this order and nothing more:

- `experiments/loop-engineering/goal.md` — the target and the constraints
- the last ~40 lines of `progress.md` — what has happened and what was next
- `AGENTS.md`

Then check reality rather than trusting the journal: `git log --oneline -10`
and `git status`. If the journal and the repo disagree, the repo is right —
say so in your entry.

**2. Decide the next step.** Pick the single most useful thing you can finish
and verify in one pass. Good candidates in rough priority order:

- something that unblocks the most other work
- something whose absence is currently causing failures
- the smallest slice of the goal not yet started

State your choice and the reason in one sentence before starting. If two
candidates are close, prefer the one with the faster verification signal.

**3. Do it.** Smallest change that fully achieves the step. Match surrounding
style. Add tests for any non-UI logic. Follow the design-as-code order for
anything visible.

**4. Verify with a real signal.** Not your own judgement — a command:
`swift test`, `npm test`, `make design-validate`, `scripts/test-all.sh`. Quote
the output.

If it fails and you cannot fix it inside this iteration, **revert your change**
and journal what you learned. A half-applied change is worse than none, because
the next iteration starts cold and cannot tell which parts were deliberate.

**5. Journal.** Append to `progress.md`:

```
## <ISO date> — <what you did>

Did: <one or two sentences>
Verified: <command> → <result>
Learned: <anything that changes what should happen next; "nothing" is fine>
Next: <your best guess, explicitly a guess>
Blocked: <a question only the user can answer, or "none">
```

`Learned` is the highest-value line — it is the only channel through which
discovery reaches the next iteration. `Next` is a hint, never an instruction:
the following iteration re-decides from current reality.

**6. Commit.** One commit, imperative subject, body explaining why.

**7. Stop.** One step per iteration. Do not continue into the next one, even if
it seems small — the value of the loop comes from re-orienting against reality
each time, and that only happens at a boundary.

## Stop and ask when

- a constraint in `goal.md` would have to be broken
- an existing test looks wrong
- the decision is about product behaviour rather than implementation
- you have failed the same step twice

Write it under `Blocked:` and stop. Do not guess at a product decision.
