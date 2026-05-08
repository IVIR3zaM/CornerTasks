# CornerTasks v0.2.0 — End-to-end verification

This script confirms one BIP-39 mnemonic works across one macOS device and one web device on a clean BYO-AWS deployment. Run it before tagging v0.2.0 (iteration 14) and any time the wire format in [`sync-protocol.md`](sync-protocol.md) changes in a way the smoke test cannot fully cover.

The smoke test (`backend/aws/scripts/sync-doctor.ts`) covers the wire protocol from a single synthetic client. This script is the human-in-the-loop counterpart: real macOS app + real web app + real CloudFront, so we catch UI- and platform-level regressions the doctor cannot see.

## Prerequisites

- A clean AWS account (or stage) with no prior CornerTasks data — see [`backend/aws/README.md`](../backend/aws/README.md) for required permissions and env vars.
- `backend/aws/` deployed via `npm run deploy:dev` (or `:prod`). Note the stack outputs `ApiUrl`, `WebBucketName`, and `CloudFrontDomain`.
- Web app deployed: `cd apps/web && npm run build && cd ../../backend/aws && npm run deploy:web`.
- A signed macOS build from `apps/macos/build.sh` (the DMG, not a debug build — we want to verify the released artefact).
- One Mac and one phone (or second browser profile) with camera access for the QR scan step.
- A network monitor for step 8: Little Snitch (preferred) or `sudo tcpdump -i any -nn host not 127.0.0.1`.

A failure at any step blocks the release. File a regression test against iteration 11 (macOS) or iteration 12 (web) as appropriate, fix it, and re-run from step 1 on a fresh stack.

## Steps

### 1. Enable sync on macOS, generate mnemonic

1. Install the DMG on a Mac with no prior CornerTasks data (`rm -rf ~/Library/Application\ Support/CornerTasks` and clear the Keychain item `com.ivir3zam.cornertasks.mnemonic` if reusing a machine).
2. Launch the app. Confirm cloud sync is **off** by default — Settings should show "Cloud sync: disabled" and the strip should function locally.
3. In Settings, choose **Enable cloud sync → Generate new key**, paste the deployed `ApiUrl`, complete the Touch ID / device-password prompt from `RevealGate`, and confirm.
4. Record the displayed DID: `did:key:z6Mk…` — call this `DID_A`.

**Pass:** DID is shown, sync status flips to "enabled", no errors in Console.app filtered to `CornerTasks`.

### 2. Enable sync on web, scan QR, DID matches

1. Open the CloudFront URL in a fresh browser profile (or incognito with IndexedDB cleared).
2. Confirm cloud sync is **off** by default.
3. Choose **Enable cloud sync → Import via QR**, grant camera permission, and scan the QR code shown by macOS Settings → "Show QR for web".
4. Paste the same `ApiUrl`. Confirm.
5. Read the DID shown on web — must equal `DID_A` byte-for-byte.

**Pass:** identical DID on both devices.

### 3. Add on macOS → appears on web within ~1 minute

1. On macOS, quick-add a task `e2e-step3 <timestamp>`.
2. Wait. The web app polls every 1 minute (iteration 12).

**Pass:** task appears on web within 90 s with the same title and order. Title is decrypted client-side; verify by inspecting the web app, not by hitting the API directly.

### 4. Edit on web → appears on macOS within ~1 minute

1. On web, double-tap the task from step 3 and rename it to `e2e-step4 <timestamp>`. Save.
2. Wait up to 90 s.

**Pass:** macOS row text updates to match.

### 5. Old archived task does NOT propagate

1. On macOS, add a task and immediately archive it. Then directly edit the SQLite row to backdate `completed_at` to 70 days ago: `sqlite3 ~/Library/Application\ Support/CornerTasks/tasks.sqlite3 "UPDATE tasks SET completed_at = strftime('%s','now','-70 days') * 1000 WHERE title = 'e2e-step5';"`.
2. Trigger a push (toggle sync off/on, or restart the app).
3. Wait 90 s.

**Pass:** the task does NOT appear on web. The archive cutoff in [`sync-protocol.md`](sync-protocol.md) §6 is enforced.

### 6. Delete on one → tombstones the other

1. On macOS, delete a live task (right-click → Delete, or whatever the UI exposes).
2. Wait 90 s.

**Pass:** the row disappears from web. Repeat in reverse: delete on web, confirm it disappears on macOS.

### 7. Disable cloud sync on web; re-enable; catches up

1. On web, Settings → Disable cloud sync. Confirm timers stop (no requests in DevTools → Network for the next 90 s).
2. On macOS, add a task `e2e-step7 <timestamp>` and edit an existing one.
3. Wait 90 s. Confirm the changes have NOT reached web.
4. On web, Settings → Re-enable cloud sync (mnemonic and `ApiUrl` should already be remembered; if not, re-import).
5. Wait 90 s.

**Pass:** web catches up — both the new task and the edit appear, in the right order.

### 8. Standalone-mode regression: zero outbound calls

This guards the released-binary contract: a default install must make zero network calls.

1. On a different Mac (or after fully wiping `~/Library/Application Support/CornerTasks` **and** the Keychain mnemonic item), install the DMG.
2. Start network monitoring before launching:
   - Little Snitch: filter to the `CornerTasks` process.
   - Or terminal: `sudo tcpdump -i any -nn 'host not 127.0.0.1 and host not ::1' | grep -i cornertasks` — and separately `lsof -i -P | grep CornerTasks` while the app runs.
3. Launch the app. Confirm cloud sync is **off** (this is the default).
4. Use the app for 5 minutes — add, archive, edit tasks. Open and close the panel.
5. Open Settings briefly but DO NOT enable cloud sync.

**Pass:** zero outbound packets attributable to CornerTasks. Any DNS lookup, any TCP SYN to a non-loopback host, fails this step and blocks the release. Also confirm the DMG contains no hard-coded `backendURL`: `strings /Volumes/CornerTasks/CornerTasks.app/Contents/MacOS/CornerTasks | grep -E 'execute-api|cloudfront|amazonaws'` should return nothing CornerTasks-specific.

## Reporting

Record date, stack `ApiUrl`, macOS build commit SHA, web build commit SHA, and pass/fail per step. Attach to the v0.2.0 release PR. A failed step blocks tagging.
