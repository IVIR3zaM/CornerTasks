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
| `HttpApi` (API Gateway HTTP API) | Single API with `POST /v1/sync/push` and `GET /v1/sync/pull`. CORS open. |
| `PushFunction`, `PullFunction` (Lambda, Node 20, arm64) | Placeholder skeletons returning `{ ok: true, todo: "iteration 5" }`. Real handlers land in iteration 5. |
| `EventsTable` (DynamoDB, on-demand, PITR on) | Placeholder schema (`pk` / `sk`). Finalized in iteration 5 once the sync protocol spec lands (iteration 4). |
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
    { "Effect": "Allow", "Action": [
        "iam:CreateRole", "iam:DeleteRole", "iam:GetRole",
        "iam:PassRole", "iam:AttachRolePolicy", "iam:DetachRolePolicy",
        "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:TagRole"
      ], "Resource": "*" },
    { "Effect": "Allow", "Action": ["logs:*"],                    "Resource": "*" }
  ]
}
```

Tighten this in production (scope `Resource` to the stack's resource ARNs, drop `*` actions you don't need).

## Step-by-step

1. **Fork or clone this repo.**
2. **Install prerequisites:** Node 20+, the [AWS CLI](https://docs.aws.amazon.com/cli/), and the [SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html). Configure credentials with `aws configure` or env vars.
3. **Deploy the backend:**
   ```bash
   cd backend/aws
   npm install
   AWS_REGION=us-east-1 STAGE=prod npm run deploy:prod
   ```
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
