# Prompt: implement the next CornerTasks iteration

Copy the block below into any AI coding agent. It is self-contained and minimizes context reads.

---

You are implementing exactly **one** iteration of CornerTasks v0.2.0. Do not bundle two. Do not skip ahead.

## Step 1 — Find the next iteration

Read **only the first 31 lines** of `ITERATIONS.md`. The status checklist starts around line 17. Pick the **lowest-numbered** item whose checkbox is `[ ]` (not `[x]`). Call it iteration **N**.

If every item is `[x]`, stop and reply: "All iterations complete."

## Step 2 — Load only what you need

Read **only**:
1. `AGENTS.md` (top to bottom — repo conventions, mandatory).
2. The section of `ITERATIONS.md` titled `## Iteration N — ...` plus the "Open questions" section at the end of that file.
3. Files the iteration's **Deliverables** explicitly name. Use targeted reads (offset/limit) when a file is large.

Do not read other iterations. Do not read `README.md` unless the iteration's deliverables modify user-facing docs.

## Step 3 — Implement

- Follow the iteration's **Goal**, **Deliverables**, **Acceptance criteria**, and **Out of scope** literally. If scope must grow, stop and update `ITERATIONS.md` first with a short note explaining why, then proceed.
- Honor the conventions in `AGENTS.md`: split by responsibility, no over-engineering, no dependencies beyond what's already approved, add tests for non-UI logic.
- Run the iteration's acceptance commands (e.g. `swift test`, `npm test`, `./build.sh`, `sam deploy`) and confirm they pass before declaring done. If you cannot run a command in this environment, say so explicitly — do not claim success.
- Update affected docs (`README.md`, `AGENTS.md`) **only if the iteration's deliverables call for it**.

## Step 4 — Mark done

In `ITERATIONS.md`, change the iteration N line in the Status checklist from `- [ ] **N.** ...` to `- [x] **N.** ...`. Edit only that single line. Do not touch other iterations.

## Step 5 — Report

Reply with at most:
- One line stating which iteration you completed.
- A bulleted list of files created/modified.
- Output of the acceptance commands (or an explicit note that they could not be run here).
- Any deviations from the plan, with one-line reasons.
- A commit message for these changes

Then stop. Do not start iteration N+1.
