---
id: N04
title: Extract runtime-neutral core from backend/aws
model: sonnet
deps: [N01]
---

## Goal

Move everything that isn't AWS-specific into `backend/core/`, so both the
Lambda entry points and the container server import the same handlers, auth,
JWT and storage interface.

## What the dependency scan found (verify before trusting)

Nine modules under `backend/aws/src/` reference AWS. Only **two** have runtime
dependencies:

| Module | Import | Disposition |
|---|---|---|
| `lib/dynamo-store.ts` | `@aws-sdk/client-dynamodb` | stays in `backend/aws/` |
| `lib/signing-key.ts` | `@aws-sdk/client-ssm` | split: interface to core, SSM branch to aws (N06) |
| `lib/api-url.ts` | `import type` only | → core |
| `lib/response.ts` | `import type` only | → core |
| `lib/auth.ts` | `import type` only | → core |
| `handlers/pull.ts` | `import type` only | → core |
| `handlers/push.ts` | `import type` only | → core |
| `handlers/auth/challenge.ts` | `import type` only | → core |
| `handlers/auth/token.ts` | `import type` only | → core |

The seven type-only modules need **no logic changes**. Replace the
`aws-lambda` type imports with locally-declared equivalents in
`core/src/types/http.ts` (`HttpEvent`, `HttpResult` — structurally identical to
`APIGatewayProxyEventV2` / `APIGatewayProxyResultV2` in the fields actually
used: `headers`, `queryStringParameters`, `body`, `requestContext.http`,
`statusCode`). Lambda then satisfies the types natively and the Node adapter
(N07) constructs them.

Re-run the scan first — this table is a snapshot, not a guarantee:

```bash
grep -rn "@aws-sdk\|aws-lambda" backend/aws/src/
```

## Files

- New `backend/core/` with `src/{handlers,lib,types}/`, `tests/`,
  `package.json`, `tsconfig.json`, and the existing eslint/jest config.
- Move `tests/{auth,sync,did}.test.ts` and `tests/helpers/` to core unmodified.
- `backend/aws/` keeps `dynamo-store.ts`, the SSM key branch, `template.yaml`,
  the deploy scripts, and thin `handlers/*.ts` re-exporting core handlers.
- Use `git mv` so history follows the files.

## Acceptance

- `cd backend/core && npm test` — the three existing suites pass **unmodified**.
- `cd backend/aws && npm test && npx tsc --noEmit`.
- `grep -rn "@aws-sdk\|aws-lambda" backend/core/src/` returns nothing.
- No behavioural change: this node is a pure move.

## Out of scope

SQLite (N05), the HTTP server (N07), any new endpoint. Do not fix unrelated
issues you notice in the moved code — file them, keep the diff a move.
