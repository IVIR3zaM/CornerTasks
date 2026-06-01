# CornerTasks

**Version: v0.2.0**

A tiny task widget. CornerTasks ships as a macOS app (a vertical strip pinned to the right edge of your screen) and a mobile-first web app. Cloud sync between devices is opt-in and end-to-end encrypted; if you don't want sync you don't get any network calls.

UI structure is declared as data under [`design/`](design/README.md) — JSON tokens, components, screens, and per-platform overlays. Run `make design-validate` for the parity report and `make design-preview` for a side-by-side HTML preview.

The latest `main` is published to GitHub Pages: **<https://ivir3zam.github.io/CornerTasks/>** — open it directly, no download.

For pull-request previews (which Pages doesn't serve) the HTML is regenerated on every CI run and uploaded as a build artifact: open the latest run on the [**CI (design/) workflow**](../../actions/workflows/ci-design.yml), scroll to **Artifacts** at the bottom of the run summary, and download `design-preview` — unzip and open `index.html` in any browser.

## Features

**Both apps**

- Add tasks quickly, double-click (or tap) to edit
- Created date shown on every active task
- Optional due date per task, with color-coded states:
  - **Red** — overdue
  - **Orange** — due today
  - **Yellow** — due tomorrow
  - **Blue** — due later
- Tick a task to move it to Archive (records added / completed / due dates)
- Reorder active tasks by drag and drop
- Optional opt-in cloud sync (see below) — same protocol on both sides

**macOS**

- Always-on-top side panel running the full height of the screen
- Local SQLite storage (existing JSON data is migrated automatically)
- Dock icon shown by default; in-app setting to hide it (menu bar icon stays)
- Menu bar icon to show / hide the panel

**Web (mobile-first)**

- IndexedDB storage, fully offline-capable
- Same color-coded due-date logic as macOS
- Camera-based QR scan for importing a key from another device

## Cloud sync (opt-in, v0.2.0+)

- **Web app** (mobile-first) hosted on S3 + CloudFront, with the same feature set as the macOS app.
- **AWS serverless backend** (TypeScript SAM + DynamoDB) for optional cross-device sync.
- **Cloud sync is opt-in.** The released app is fully standalone by default and makes no network calls. If you don't want sync, you never see a network feature. If you do, you deploy your own backend to your own AWS account — see "Bring your own AWS" below.
- **Decentralized identity:** your account ID is a `did:key` derived from an Ed25519 keypair you control. The DID is visible in both the macOS and web Account screens.
- **End-to-end encryption** with AES-256-GCM. The key is derived on-device from a BIP-39 mnemonic. The maintainer of this project cannot read your tasks. Neither can the AWS account owner — including you.
- **Sync** (when enabled): every local change is queued and pushed every 10 minutes; the app polls every minute for remote updates. Last-writer-wins by timestamp. Archived tasks older than 2 months are not synced.
- **Enable flow**: *Generate new key* (new account) or *Import existing key* via mnemonic (macOS + web) or by scanning a QR from another CornerTasks device (web only — macOS shows the QR). A prominent red warning makes clear that importing merges the local tasks into the imported account.
- **DID and mnemonic export**: view the DID and the mnemonic in both apps; show a QR of the mnemonic on macOS for the web app to scan.

Full version history is in [`CHANGELOG.md`](CHANGELOG.md). The v0.2.0 work plan that built this is in [`ITERATIONS.md`](ITERATIONS.md).

## How private is cloud sync?

- **Default state: OFF.** A freshly-installed CornerTasks makes zero outbound network calls. It is a standalone tool unless you change that.
- **When you enable it:** task fields are encrypted on-device with AES-256-GCM using a key derived from a private key only you control (BIP-39 mnemonic → Ed25519 → HKDF). The wire payload contains only `accountDid`, `deviceId`, `eventId`, `taskId`, `updatedAt`, and `op` in the clear; everything meaningful (title, dates, completion state, order) is inside an opaque ciphertext blob. **The maintainer of this project cannot read your tasks. Neither can anyone running the backend code, including yourself.**
- **API authentication is your DID.** Sign-in uses a standards-aligned DID-Auth flow: the app requests a one-time challenge, signs it with your Ed25519 private key as a DID-JWT (the same envelope used by SIOPv2 / DID-JWT), and exchanges it for a short-lived `Authorization: Bearer <token>`. The bearer token is held in memory only — never written to disk — and re-issued automatically when it expires. There is no API key, password, or shared secret to leak; only the holder of your mnemonic can produce a valid DID-JWT.
- **Auditable evidence:**
  - Wire format: [`docs/sync-protocol.md`](docs/sync-protocol.md) (added in iteration 4).
  - Encryption code: `apps/macos/Sources/CornerTasks/Crypto/` (Swift, iteration 7) and `apps/web/src/crypto/` (TypeScript, iteration 8). Cross-implementation test vectors in `docs/crypto-vectors.json` prove the two implementations produce identical ciphertext for the same input.
  - **End-to-end smoke test:** `backend/aws/scripts/sync-doctor.ts` walks the full challenge → DID-JWT → bearer → push → pull → decrypt round-trip against a deployed `ApiUrl`. Run locally with `CT_API_URL=… CT_MNEMONIC='…' npm run smoke-test --prefix backend/aws`, or let `.github/workflows/smoke-test.yml` run it after every backend deploy / on every PR that touches `apps/`, `backend/`, or `docs/sync-protocol.md`.
  - There is no key-escrow code anywhere in this repo. The encryption key never leaves the device.
- **Keychain access is on demand.** The macOS app does **not** read the Keychain at launch. The mnemonic is loaded only when you open Settings, expand "Show mnemonic" or "Show QR code", or the sync engine starts because cloud sync is on — so a user who never enables sync never sees a Keychain authorisation prompt.
- **Decentralized identity:** your account ID is a `did:key` whose private half lives only on your devices. Two devices with the same mnemonic share the same DID and join the same account.
- **The backend lives in your AWS account, not anyone else's.** See "Bring your own AWS" below. The released DMG never embeds a backend URL.

## Bring your own AWS

CornerTasks does not ship with a hosted backend. To use cloud sync you deploy `backend/aws/` to your own AWS account, then point the app at the URL it prints.

```bash
# Prerequisites: AWS CLI configured (`aws configure` or env vars), Node 22+, SAM CLI.
git clone https://github.com/IVIR3zaM/CornerTasks
cd CornerTasks/backend/aws
npm install
AWS_REGION=us-east-1 STAGE=prod npm run deploy:prod
# → prints ApiUrl and WebUrl
```

Then in the app: **Settings → Cloud Sync → Enable** → paste the `ApiUrl` → generate or import your key. To publish the web app to your own CloudFront distribution: `cd apps/web && npm run build && cd ../../backend/aws && npm run deploy:web`.

Full IAM/permissions list and the optional GitHub Actions OIDC deploy template live in `backend/aws/README.md` (added in iteration 3). The maintainer's GitHub repo carries no AWS secrets; downstream forks wire up their own.

## Repository layout (target for v0.2.0)

```
.
├── apps/
│   ├── macos/    — Swift app (currently still at the repo root in v0.1.0)
│   └── web/      — mobile-first web app (added in v0.2.0)
├── backend/
│   └── aws/      — TypeScript serverless (DynamoDB)
├── docs/         — protocol / encryption / sync notes
├── AGENTS.md
├── README.md
└── ITERATIONS.md — ordered v0.2.0 work plan
```

In v0.1.0 the macOS app lived at the repo root; v0.2.0 moved it under `apps/macos/` alongside the new `apps/web/` and `backend/aws/` trees.

## Requirements

- macOS 13+
- Swift 5.9 / Xcode 15+
- Node 22+ (for `apps/web` and `backend/aws`, once those land)

## Install (from a release DMG)

The DMG is **ad-hoc signed but not notarized** (notarization needs a paid Apple Developer account). On first launch macOS will show *"CornerTasks Not Opened — Apple could not verify…"* with only **Done** / **Move to Bin** buttons. That's normal. Pick one of:

**Easiest — Terminal:** drag the app to `/Applications`, then run

```bash
xattr -dr com.apple.quarantine /Applications/CornerTasks.app
```

and launch it. You only need to do this once per install.

**No Terminal:** drag the app to `/Applications`, double-click it once and dismiss the warning, then open **System Settings → Privacy & Security**, scroll to the bottom, and click **Open Anyway** next to the CornerTasks entry.

## Run from source

```bash
# macOS app — sources live under apps/macos/ as of v0.2.0.
cd apps/macos
swift run -c release

# Or open in Xcode
open apps/macos/Package.swift
```

## Build a distributable .app + .dmg

```bash
cd apps/macos
./build.sh                           # host arch only — fast local dev
UNIVERSAL=1 ./build.sh               # universal arm64 + x86_64 (needs full Xcode)
VERSION=0.2.0 UNIVERSAL=1 ./build.sh # also stamp Info.plist with a version
```

This generates the `.icns` from `icon.png`, builds the release binary, assembles `CornerTasks.app`, ad-hoc signs it, and writes the DMG to `release/`. `build.sh` runs `lipo -info` at the end so you can confirm both slices are present.

### CI and releases via GitHub Actions

The three components — `apps/macos`, `apps/web`, `backend/aws` — version and release **independently**, so you can hotfix any one of them without touching the others. New components (e.g. an iOS app, a Docker backend variant) plug into the same shape: one CI workflow, one release workflow with a tag trigger + `workflow_call` interface, one enable flag.

#### CI on pull requests (path-filtered)

| Workflow | Trigger | What it does |
| --- | --- | --- |
| [`ci-macos.yml`](.github/workflows/ci-macos.yml)     | PR / push to main touching `apps/macos/**`   | `swift build` + `swift test` on `macos-14` |
| [`ci-web.yml`](.github/workflows/ci-web.yml)         | PR / push to main touching `apps/web/**`     | `npm ci && lint && test && build` |
| [`ci-backend.yml`](.github/workflows/ci-backend.yml) | PR / push to main touching `backend/aws/**`  | `npm ci && lint && test && build` |
| [`smoke-test.yml`](.github/workflows/smoke-test.yml) | PR touching the sync wire format             | Runs `sync-doctor.ts` against `vars.CT_API_URL`; **skips cleanly** if that variable is not set |

#### Release: how tags map to deploys

Releases are **fully automated and tag-driven** — there is no manual workflow_dispatch step in the happy path. You push a tag, the matching workflow runs, deploys, smoke-tests, and publishes the GitHub release.

| Tag you push | Workflow that runs | What it ships |
| --- | --- | --- |
| `v0.3.0` (no prefix) | [`release-all.yml`](.github/workflows/release-all.yml) — **umbrella** | Coordinated release of every *enabled* component at the same version. Use this for normal major/minor bumps. |
| `backend-v0.2.1`     | [`release-backend.yml`](.github/workflows/release-backend.yml) | Hotfix backend only. Calls `smoke-test.yml` against the freshly-deployed `ApiUrl`. |
| `web-v0.2.1`         | [`release-web.yml`](.github/workflows/release-web.yml)         | Hotfix web only. Smoke = HTTP GET against `WebUrl`. |
| `macos-v0.2.1`       | [`release.yml`](.github/workflows/release.yml)                 | Hotfix macOS DMG only. No AWS credentials touched. |

The umbrella workflow runs each enabled component in the order: **backend → web → macOS** (so the backend's `ApiUrl` is fresh before anything that wants to smoke against it). Backend always smoke-tests itself with `sync-doctor.ts`; if backend fails, web and macOS still skip (they only run when backend succeeds *or* is disabled).

Cutting a release:

```bash
# Major/minor — bump versions in all three components, then:
git tag v0.3.0
git push origin v0.3.0

# Hotfix a single component — bump only that component's version, then:
git tag macos-v0.2.1   # or backend-v0.2.1 / web-v0.2.1
git push origin macos-v0.2.1
```

Versions live in `apps/macos/AppBundle/Info.plist` (`CFBundleShortVersionString` + `CFBundleVersion`), `apps/web/package.json`, and `backend/aws/package.json`. Bump them in a PR; tag after the PR merges to `main`.

#### Selectively disabling a component (or swapping it later)

Each release workflow has a per-component enable flag (a repo *variable* under Settings → Variables and secrets → Actions → Variables). Default behaviour is **enabled** — the flag only matters when you want to skip a component.

| Variable | Default | Effect when set to `false` |
| --- | --- | --- |
| `RELEASE_BACKEND_AWS_ENABLED` | enabled | The umbrella skips the backend job; `backend-v*` tag pushes still run unless you want to ignore those too (set the same variable). |
| `RELEASE_WEB_ENABLED`         | enabled | Same, for web. |
| `RELEASE_MACOS_ENABLED`       | enabled | Same, for macOS. |

If you later add a Docker backend release and want to drop AWS, set `RELEASE_BACKEND_AWS_ENABLED=false`, add a new workflow (`release-backend-docker.yml`) following the same shape, add a `backend-docker` job to `release-all.yml` gated on `RELEASE_BACKEND_DOCKER_ENABLED`, and you're done.

#### Forks: required GitHub repo configuration

The macOS release path needs nothing from AWS — it's pure Xcode on a hosted runner. The web and backend release paths use **GitHub OIDC → AWS IAM role** (no long-lived AWS keys). Smoke uses a throwaway BIP-39 mnemonic.

| Name | Kind | Required? | Used by | Notes |
| --- | --- | --- | --- | --- |
| `AWS_ROLE_TO_ASSUME` | secret   | yes (for backend/web releases) | `release-backend.yml`, `release-web.yml` | Full ARN of an IAM role with a GitHub-OIDC trust policy scoped to your fork. See *Setting `AWS_ROLE_TO_ASSUME`* below. |
| `AWS_REGION`         | variable | yes (for backend/web releases) | `release-backend.yml`, `release-web.yml` | The region your stack lives in, e.g. `us-east-1`. |
| `STAGE`              | variable | no  | `release-backend.yml`, `release-web.yml` | Deploy stage name; defaults to `prod`. Override per-run via the workflow input. |
| `CT_MNEMONIC`        | secret   | no  | `smoke-test.yml` (via release-backend) | Throwaway 12-word BIP-39 mnemonic used by `sync-doctor.ts`. **Defaults** to the standard BIP-39 *abandon × 11 + about* vector if unset, so a fresh fork's first deploy already smoke-tests. Override it once you have a long-lived test account. |
| `CT_API_URL`         | variable | no  | `smoke-test.yml` (PR-time only)        | `ApiUrl` of a long-lived dev stack to smoke-test on PRs. If unset, PR smoke skips cleanly. The release-driven smoke pass uses the freshly-deployed `ApiUrl` instead — never this variable. |
| `REPO_VAR_TOKEN`     | secret   | no  | `release-backend.yml`                  | Fine-grained PAT with **Variables: read & write** on this repo. Lets the backend release write `BACKEND_API_URL_<STAGE>` / `BACKEND_WEB_URL_<STAGE>` repo variables so the maintainer can read the URLs without opening AWS. If unset, that one step is skipped with a notice and the deploy still succeeds. See *Setting `REPO_VAR_TOKEN`* below. |
| `RELEASE_BACKEND_AWS_ENABLED` | variable | no  | `release-backend.yml`, `release-all.yml` | Set to `false` to disable. |
| `RELEASE_WEB_ENABLED`         | variable | no  | `release-web.yml`,     `release-all.yml` | Set to `false` to disable. |
| `RELEASE_MACOS_ENABLED`       | variable | no  | `release.yml`,         `release-all.yml` | Set to `false` to disable. |

##### Setting `AWS_ROLE_TO_ASSUME`

You need an IAM role in **your** AWS account that GitHub's OIDC token can assume — no AWS access keys leave AWS.

1. **Add GitHub Actions as an OIDC identity provider** (one-time per AWS account):
   - AWS Console → IAM → **Identity providers** → **Add provider**.
   - Provider type: *OpenID Connect*.
   - Provider URL: `https://token.actions.githubusercontent.com`. Click *Get thumbprint*.
   - Audience: `sts.amazonaws.com`.
   - Save.
2. **Create the role**:
   - IAM → Roles → **Create role**.
   - Trusted entity type: *Web identity*.
   - Identity provider: the `token.actions.githubusercontent.com` you just added.
   - Audience: `sts.amazonaws.com`.
   - GitHub organization: your username / org (e.g. `YOURNAME`).
   - GitHub repository: your fork's name (e.g. `CornerTasks`).
   - (Optional but recommended) restrict the trust policy to tags only — edit the role's trust JSON and set the subject claim to `repo:YOURNAME/CornerTasks:ref:refs/tags/*`. That way only tag-push workflows can assume the role.
3. **Attach permissions**: the policy needed to deploy SAM + upload to S3 + invalidate CloudFront is documented in [`backend/aws/README.md`](backend/aws/README.md) under *IAM permissions for deploy*. Attach that as an inline or managed policy.
4. **Copy the role ARN** (looks like `arn:aws:iam::123456789012:role/cornertasks-github-deploy`).
5. **Paste it into your fork**: Settings → Secrets and variables → Actions → **Secrets** → New repository secret → name `AWS_ROLE_TO_ASSUME`, value the ARN.

After that, set `AWS_REGION` under **Variables** (same screen, *Variables* tab) and you're ready — the next `v*` or `*-v*` tag push runs end-to-end without any further configuration.

No part of this repo's CI carries the maintainer's credentials; every fork wires up its own role.

##### Setting `REPO_VAR_TOKEN` (optional — auto-record deployed URLs)

The backend release captures `ApiUrl` + `WebUrl` from the CloudFormation stack and (if `REPO_VAR_TOKEN` is set) stores them as repo Actions variables `BACKEND_API_URL_<STAGE>` / `BACKEND_WEB_URL_<STAGE>` so maintainers can read them at Settings → Variables without opening the AWS console. Repo variables are only visible to users with write access, which matches the BYO-AWS *"the endpoint is private"* model.

The default `GITHUB_TOKEN` cannot reach the Actions Variables API — that endpoint requires the explicit *Variables: read & write* permission, which only a PAT or a GitHub App token can carry. So this is opt-in via a dedicated fine-grained PAT:

1. GitHub → click your avatar → Settings → Developer settings → **Personal access tokens** → *Fine-grained tokens* → **Generate new token**.
2. **Token name**: anything (e.g. `cornertasks-repo-var-write`). **Expiration**: pick a rotation cadence you'll actually do (90 days is reasonable).
3. **Resource owner**: you / your org.
4. **Repository access**: *Only select repositories* → pick your fork (and *only* your fork).
5. **Repository permissions** → scroll to **Variables** → set to **Read and write**. Leave everything else *No access*.
6. **Generate token** → copy the `github_pat_…` value (shown once).
7. In your fork: Settings → Secrets and variables → Actions → **Secrets** tab → **New repository secret** → name `REPO_VAR_TOKEN`, value the PAT.

If you skip this, the release still succeeds — the workflow just logs a notice and the URLs are available via CloudFormation outputs (`backend/aws/scripts/print-outputs.mjs`).

### Architectures: do you need separate Intel / Apple Silicon builds?

No. The universal binary contains both slices in one `.app`; macOS picks the right one at launch. Ship one DMG.

## Where data is stored

```text
~/Library/Application Support/CornerTasks/tasks.sqlite3
```

If a `tasks.json` from an older version is present, it is migrated on first launch and renamed to `tasks.json.migrated`. The mnemonic (v0.2.0, only when cloud sync is enabled) is stored in the macOS Keychain, not in this folder.

## Showing / hiding

- The panel always floats above other windows. Use the close button on the panel, or the menu bar icon's "Show / Hide" item, to hide it. Reopening always restores the full-height right-edge layout.
- The Dock icon can be toggled from the in-app settings (gear icon in the header).

## License

Licensed under the [Apache License 2.0](LICENSE).

## Releases

See [`CHANGELOG.md`](CHANGELOG.md) for the full history.

| Version | Notes |
| --- | --- |
| v0.1.0 | First release. SQLite storage, due dates with color coding, full-height side panel, dock-icon toggle. |
| v0.2.0 | Multi-platform layout, mobile-first web app on S3+CloudFront, BYO-AWS serverless backend, opt-in end-to-end-encrypted sync, decentralized `did:key` identity. |
