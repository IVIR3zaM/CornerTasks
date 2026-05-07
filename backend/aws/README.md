# Bring your own AWS

CornerTasks does not ship with a hosted backend. **The maintainer does not host a shared backend, and the released app does not phone home.** If you want cross-device sync, deploy this stack to your own AWS account and point the app at the URL it prints.

This directory is the BYO-AWS backend: a small AWS SAM application (TypeScript Lambdas, API Gateway HTTP API, DynamoDB, and an S3 + CloudFront origin for the web app).

## Why SAM (and not CDK)

We picked AWS SAM (YAML CloudFormation with the Serverless transform) over CDK because:

- The whole stack fits in one readable `template.yaml` — what you read is what gets deployed (no synth step).
- No extra runtime dependency tree. CDK pulls in `aws-cdk-lib` and constructs; SAM uses the `sam` CLI you install once.
- Fewer moving parts for downstream forks who are mostly running, not editing.

If you fork and prefer CDK, the resources to recreate are obvious from `template.yaml`.

## What gets deployed

| Resource | Purpose |
| --- | --- |
| `HttpApi` (API Gateway HTTP API) | Single API with `POST /v1/sync/push`, `GET /v1/sync/pull`, `POST /v1/auth/challenge`, and `POST /v1/auth/token`. CORS open. |
| `PushFunction`, `PullFunction` (Lambda, Node 20, arm64) | Sync handlers per `docs/sync-protocol.md` §7. Both are protected by `requireBearer` middleware (§8). |
| `AuthChallengeFunction`, `AuthTokenFunction` (Lambda, Node 20, arm64) | DID-Auth → Bearer JWT flow per `docs/sync-protocol.md` §8. Issues 32-byte single-use challenges (5 min TTL) and 1 h bearer JWTs. |
| `EventsTable` (DynamoDB, on-demand, PITR on) | Single-table: `pk = ACCOUNT#<accountDid>`, `sk = TASK#<taskId>`. GSI `ByUpdatedAt` keyed by `(pk, updatedAt)` powers `pull?since=...`. |
| `AuthChallengesTable` (DynamoDB, on-demand, native TTL) | `pk = AUTHCHAL#<accountDid>`, `sk = <challenge>`. Server-side TTL on `ttl` evicts unused challenges; consumed challenges are deleted atomically. |
| `JwtSigningReadPolicy` + SSM Parameter Store | Per-deploy bearer-JWT signing key. Default `JwtAlg=EdDSA` stores private key as `SecureString` at `/cornertasks/<stage>/jwt-signing-key` and the public part at `/cornertasks/<stage>/jwt-signing-key-public`. `JwtAlg=HS256` switches to a single shared `SecureString` at `/cornertasks/<stage>/jwt-hs256-secret`. |
| `WebBucket` (S3, private, SSE-S3) | Holds the built web app. **Public access fully blocked** — the bucket is reachable only via CloudFront. |
| `WebOriginAccessControl` + `WebDistribution` (CloudFront) | HTTPS-only, SPA fallback (`403/404 → /index.html`). Default `PriceClass_100` (US/EU edges) — change in `template.yaml` if you want a wider footprint. |

Stack outputs: `ApiUrl`, `WebUrl`, `WebBucketName`, `WebDistributionId`, `EventsTableName`. The deploy script prints `ApiUrl` and `WebUrl` at the end.

## Required env vars (deploying locally)

Before running `sam deploy`, set:

- `AWS_REGION` — e.g. `us-east-1`.
- One of:
  - `AWS_PROFILE` — uses a profile from `~/.aws/credentials`, OR
  - `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` (and optionally `AWS_SESSION_TOKEN` for short-lived creds).
- `STAGE` — typically `prod` or `dev`. Used as a suffix on stack-owned resources so you can run multiple copies in the same account.

## Required IAM permissions for the deploying principal

The user/role you deploy as needs to manage the resources above plus the CloudFormation stack itself. A minimal inline policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["cloudformation:*"],          "Resource": "*" },
    { "Effect": "Allow", "Action": ["lambda:*"],                  "Resource": "*" },
    { "Effect": "Allow", "Action": ["apigateway:*"],              "Resource": "*" },
    { "Effect": "Allow", "Action": ["dynamodb:*"],                "Resource": "*" },
    { "Effect": "Allow", "Action": ["s3:*"],                      "Resource": "*" },
    { "Effect": "Allow", "Action": ["cloudfront:*"],              "Resource": "*" },
    { "Effect": "Allow", "Action": ["ssm:*"],                     "Resource": "*" },
    { "Effect": "Allow", "Action": [
        "iam:CreateRole", "iam:DeleteRole", "iam:GetRole",
        "iam:PassRole", "iam:AttachRolePolicy", "iam:DetachRolePolicy",
        "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:TagRole",
        "iam:CreatePolicy", "iam:DeletePolicy", "iam:GetPolicy",
        "iam:ListPolicyVersions", "iam:CreatePolicyVersion",
        "iam:DeletePolicyVersion"
      ], "Resource": "*" },
    { "Effect": "Allow", "Action": ["logs:*"],                    "Resource": "*" }
  ]
}
```

The `ssm:*` block is needed because iteration 5 provisions a managed policy that reads the per-deploy bearer-JWT signing key from SSM Parameter Store, and `init-signing-key` writes those parameters. The expanded `iam:*` actions cover the new `JwtSigningReadPolicy` managed policy attached to the auth and sync Lambdas.

Tighten this in production (scope `Resource` to the stack's resource ARNs, drop `*` actions you don't need).

## Step-by-step

1. **Fork or clone this repo.**
2. **Install prerequisites:** Node 20+, the [AWS CLI](https://docs.aws.amazon.com/cli/), and the [SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html). Configure credentials with `aws configure` or env vars.
3. **Deploy the backend:**
   ```bash
   cd backend/aws
   npm install
   AWS_REGION=us-east-1 STAGE=prod npm run deploy:prod
   AWS_REGION=us-east-1 STAGE=prod npm run init-signing-key  # one-shot per stage
   ```
   `init-signing-key` writes the per-deploy bearer-JWT signing key to SSM. Re-run only if you rotate the key or flip `JwtAlg` between `EdDSA` (default) and `HS256`. To switch to HS256, deploy with `--parameter-overrides JwtAlg=HS256` and re-run `JWT_ALG=HS256 npm run init-signing-key`.
4. **Note the outputs** — the script prints the `ApiUrl` and `WebUrl` at the end. You can re-print them later with:
   ```bash
   AWS_REGION=us-east-1 STAGE=prod npm run print-outputs
   ```
5. **Wire up the app:** open the macOS app (or web app, once iteration 6 ships) → **Settings → Cloud Sync** → paste the `ApiUrl` → **Enable**. Then generate a new key or import an existing one (iterations 9 / 10).
6. **Deploy the web app to your own CloudFront distribution:**
   ```bash
   cd apps/web && npm run build
   cd ../../backend/aws && AWS_REGION=us-east-1 STAGE=prod npm run deploy:web
   ```

## Local development

```bash
npm install
npm run build      # tsc into dist/
npm run lint
npm test           # jest — handler skeleton + future unit tests
npm run package    # tsc + sam build (no deploy)
```

## End-to-end smoke test (`sync-doctor`)

`scripts/sync-doctor.ts` is a Node TypeScript runner that walks the full wire protocol against a deployed `ApiUrl`: challenge → DID-JWT → bearer token → push 1 encrypted upsert → pull → assert ciphertext round-trip and AES-GCM decryption. It exits non-zero with the offending step + reason on failure, so a single `npm run smoke-test` call tells you whether the contract is intact.

```bash
# Local — point at any deploy you control. Use a throwaway test mnemonic.
export CT_API_URL=https://abc.execute-api.us-east-1.amazonaws.com/Prod
export CT_MNEMONIC="abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
npm run smoke-test
# → sync-doctor: round-trip OK ✓
```

The mnemonic should not control real data — every event the doctor pushes is visible to anyone holding it. The standard BIP-39 *abandon × 11 + about* vector is fine for dev.

In CI, [`.github/workflows/smoke-test.yml`](../../.github/workflows/smoke-test.yml) runs `sync-doctor` automatically:

- after every successful run of `Deploy backend (BYO-AWS)` (post-deploy verification);
- on every PR touching `apps/`, `backend/`, or `docs/sync-protocol.md` (regression guard before merge);
- on `workflow_dispatch` (manual).

To enable it on your fork, add:

- **Variable** `CT_API_URL` — the `ApiUrl` of a long-lived dev stack you don't mind exercising.
- **Secret** `CT_MNEMONIC` — a throwaway 12-word BIP-39 mnemonic. Anyone who reads workflow logs of a failed run could see DIDs derived from it; do not reuse it for anything you care about.

The smoke test does not need AWS credentials — it only makes HTTPS calls to the API URL.

## GitHub Actions secrets — what is and isn't needed

- The repo's existing [`release.yml`](../../.github/workflows/release.yml) builds the macOS DMG and **needs no AWS secrets**. It does not deploy anything to AWS.
- This repo's `main` branch GitHub Actions does **not** carry the maintainer's AWS credentials. Any personal dev stack the maintainer runs is deployed manually from a laptop — never from this repo's CI.
- The released DMG contains no embedded `ApiUrl`. The standalone-by-default contract is verified at release time (iteration 14) and as part of E2E (iteration 13).

### Optional CI deploys for your fork

If you want your fork to deploy this stack from CI rather than your laptop, see [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml). It is **committed but disabled by default** (`workflow_dispatch` only) and uses **GitHub OIDC → AWS IAM role** — no long-lived keys. To enable in your fork:

1. Create an IAM role in your AWS account with the deploy permissions above and a trust policy for `token.actions.githubusercontent.com` scoped to your fork's repository.
2. In your fork's repo settings, add:
   - **Secret** `AWS_ROLE_TO_ASSUME` — full ARN of that role.
   - **Variable** `AWS_REGION`.
   - **Variable** `STAGE` (optional; defaults to `prod`).
3. Trigger the workflow from the Actions tab (`workflow_dispatch`).
