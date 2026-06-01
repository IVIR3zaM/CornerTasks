# Prompt: implement the next CornerTasks iteration

Copy the block below into any AI coding agent. It is self-contained and minimizes context reads. **Nothing in this file names a specific iteration or hardcodes the line of any iteration body** — that information lives in `ITERATIONS.md` and is discovered at runtime.

---

You are implementing exactly **one** iteration of the active CornerTasks release. Do not bundle two. Do not skip ahead.

## Hard rules (read once, apply throughout)

- **No new git branch.** Work on the current branch.
- **No pull request.** Do not run `gh pr create` or push to a remote.
- **No commit until the user says so.** At the end you will *suggest* a commit message; the user decides whether to commit.
- **Pause for user review after each numbered step below.** Output what you did, then stop and wait for explicit approval ("ok", "continue", "looks good", or fixes) before moving on. If the user requests changes, apply them and re-show — do not advance.
- **Token discipline.** Read only what each step tells you to read. Do not skim the whole repo. Do not re-read files already in context.

## Step 1 — Locate the active release and active checklist (then pause)

Read **only the first 20 lines** of `ITERATIONS.md`. They contain a `## Quick locate` helper block that names:

- the active release (e.g. `v0.3.0`),
- the line range of the active **Status** checklist,
- the line where the active iteration bodies start,
- the line of the active **Open questions** section.

That helper is the single source of truth for line numbers — this prompt deliberately does not hardcode them. If the helper's numbers look stale, re-anchor with `grep -n "^## Status\|^## Iteration\|^## Open questions" ITERATIONS.md`, fix the helper, then continue.

Report: the active release tag and the three line numbers from the helper. Pause for user review.

## Step 2 — Pick the next iteration (then pause)

Read **only the Status checklist line range** the helper gave you. Pick the **lowest-numbered** item whose checkbox is `[ ]`. Call it iteration **N**.

If every active item is `[x]`, stop and reply: "All iterations for `<release>` complete."

Report: "Picked iteration N — `<title>`." Pause for user review.

## Step 3 — Extract iteration N's body with two commands (then pause)

Run these **two shell commands** to get exactly the body of iteration N — nothing more:

```bash
# 1) Find the start line of iteration N and the start line of the next section.
grep -nE "^## (Iteration |Open questions)" ITERATIONS.md
# 2) Read only that range (replace START with the line of "## Iteration N — ...",
#    and END with the line *just before* the next "## Iteration" or "## Open questions").
sed -n "<START>,<END>p" ITERATIONS.md
```

Then read, in this order:

1. `AGENTS.md` (top to bottom — repo conventions, mandatory).
2. The iteration body you just `sed`-extracted.
3. The active **Open questions** section (line given by the helper) — but only entries that name iteration N or a file iteration N touches.
4. Files that the iteration's **Deliverables** explicitly name. Use `sed -n 'A,Bp'` or `Read` with `offset`/`limit` for large files.
5. `docs/sync-protocol.md` only if the iteration's deliverables reference a specific section of it.

Do **not** read other iterations. Do **not** read `README.md` unless the iteration modifies user-facing docs.

Report: a short bulleted list of files read and why. Pause for user review.

## Step 4 — Plan (then pause)

Write a ≤10-bullet plan: the files you will create/modify, the tests you will add, and the acceptance commands you intend to run. Quote the iteration's **Acceptance criteria** verbatim.

If the iteration's plan in `ITERATIONS.md` turns out to be wrong, **stop and propose an edit to `ITERATIONS.md` first** with a one-line rationale. Do not proceed until the user accepts the edit.

Pause for user review.

## Step 5 — Implement (then pause for code review)

Apply the plan. Honor `AGENTS.md` conventions: split by responsibility, no over-engineering, no new dependencies unless the iteration names them, add unit tests for non-UI logic, no comments unless the *why* is non-obvious.

When done, report:
- Files created/modified (paths only, no diffs unless asked).
- One sentence per file explaining the change.

Pause for user code review. If the user requests changes, apply them and re-show; do not move on until approved.

## Step 6 — Run acceptance commands (then pause)

Run the acceptance commands the iteration names (`swift test`, `npm test -w <pkg>`, `npm run build -w <pkg>`, `sam validate`, etc.). Do **not** run deploys (`sam deploy`, `npm run deploy:*`) unless the user explicitly asks — they cost money and require credentials.

Report: each command + its exit status. If a command cannot run in this environment, say so explicitly — do not claim success.

Pause for user review.

## Step 7 — Mark iteration done (then pause)

In `ITERATIONS.md`, change the iteration N line in the active **Status** checklist from `- [ ] **N.** ...` to `- [x] **N.** ...`. Edit only that single line. Do not touch other iterations and do not modify any frozen-release block.

If your edits to deliverables caused the helper's line numbers to drift (you can confirm with the `grep -n` re-anchor command from Step 1), update the Quick-locate block in the same pass.

Report the one-line diff. Pause for user review.

## Step 8 — Suggest a commit message (final step)

Output a commit message in this exact shape (do **not** run `git commit`):

```
<imperative subject, ≤72 chars, no trailing period>

<optional body: 1–3 short paragraphs explaining the why,
wrapped at ~72 chars. Reference iteration N.>
```

Tone matches recent history (`git log --oneline -10`). No "Co-Authored-By" line, no emojis. Then stop.

Reply: "Iteration N ready for commit. Suggested message above." Wait for the user.
