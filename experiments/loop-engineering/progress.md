# Progress journal

> Reference only — illustrative entries, not a record of real work.

Append-only. Newest at the bottom. This is the loop's entire memory between
iterations: everything not written here is lost when the session ends.

The three entries below are written to show the texture — in particular what a
good `Learned:` line looks like, and how a loop handles a discovery that a graph
would have handled as a blocking decision.

---

## 2026-08-15 — extract a runtime-neutral core from backend/aws

Did: moved handlers, auth, JWT, DID and the `Store` interface to
`backend/core/`, replacing the `aws-lambda` type imports with locally-declared
`HttpEvent`/`HttpResult`. Left `dynamo-store.ts` and the SSM key branch behind.
Pure move, no behaviour change.

Verified: `cd backend/core && npm test` → 3 suites, 47 passing. `cd backend/aws
&& npm test` → green.

Learned: only two modules had real AWS runtime dependencies — the other seven
were `import type` only. The container port is therefore an adapter over the
existing handlers, not a rewrite. Also: `Store` already had a `setStore()`
injection seam and `tests/helpers/memory-store.ts` is a complete reference
implementation, so a SQLite store is a port rather than a design job.

Next: SQLite `Store`, using memory-store as the reference.

Blocked: none.

---

## 2026-08-15 — SQLite Store implementation

Did: implemented `Store` against `node:sqlite`, selected by `CT_STORE`. Schema
keyed `(account_did, task_id)` with an index on `(account_did, seq)`.

Verified: `CT_STORE=sqlite npm test` → same 47 tests green against the new
store.

Learned: allocating `seq` needs to happen inside the write transaction —
`INSERT … SELECT COALESCE(MAX(seq),0)+1` — or concurrent pushes collide. The
in-memory reference used a process-local counter and hid this entirely. Added a
50-way concurrency test; it failed on the naive port, which is how I found it.

Next: the HTTP adapter, so the core can serve without Lambda.

Blocked: none.

---

## 2026-08-16 — found backend/aws build broken; deferred

Did: nothing to the build. While running `scripts/test-all.sh` I found
`cd backend/aws && npm run build` fails — `backend/core` is never installed by
`test-all.sh` or by `.github/workflows/ci-backend.yml`, both of which predate
the core extraction. There is also apparent type drift in `dynamo-store.ts`
against the moved `Store` interface.

Verified: reproduced from a clean tree; confirmed pre-existing rather than
caused by this iteration.

Learned: the per-node test commands do not cover the build, so this could stay
invisible for several more iterations while looking green. Whatever fixes it —
npm workspace root, or `file:` dependencies per consumer — is a repo-structure
decision with CI consequences, not a code fix.

Next: I would normally just fix this, but see Blocked.

Blocked: **workspace root or `file:` deps per package?** The first also fixes
CI never running `backend/core`'s own lint/test/build, which is a separate gap.
Needs a call from the user.

---
