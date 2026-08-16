# CornerTasks Connection Status

This document is the contract for the **connection-status indicator** shown in
both clients. It is normative: the macOS app and the web app are implemented
against it independently, and they must agree — same states, same phrases, same
precedence, same timing — because v0.3.0 ships a cross-platform screenshot
comparison (`plan/v0.3.0/nodes/N17-release.md`) that fails on any divergence.

Scope:

- **§1–§4** define the vocabulary and the exact function that produces it.
- **§5–§7** define the rendered strings, tokens, and timing.
- **§8** names the race conditions and pins their resolutions.
- **§9** gives worked traces.
- **§10** is the conformance checklist for the implementing nodes.

Related: `docs/sync-protocol.md` §10–§13 (transport negotiation, WebSocket
framing, reconnect and fallback), `docs/ARCHITECTURE.md` ("Connection status").
Where this document cites `§n.n` without qualification it means a section of
*this* file; sync-protocol sections are written as "sync-protocol §11.2".

Consumers: `plan/v0.3.0/nodes/N11-design-schema.md` (design JSON),
`N12`/`N14` (the engine state that feeds it), `N13`/`N15` (the two renderers).

---

## 1. The states

Seven states. The set is closed: a client MUST NOT render anything else, and
MUST NOT render "no state" while cloud sync is enabled.

| State | Circle | Motion | Phrase (en) | Holds when |
|---|---|---|---|---|
| `disabled` | gray | solid | `Sync off` | No sync engine instance exists (§2.1) |
| `checking` | gray | pulsing | `Connecting…` | Enabled, but no network attempt has completed yet this engine lifetime — or the user is running an explicit reachability test |
| `live` | green | solid | `Connected` | A WebSocket has received `live` (sync-protocol §11.2) and nothing is in flight |
| `polling` | green | solid | `Connected (polling)` | No live socket; the most recent completed REST attempt succeeded |
| `syncing` | green | pulsing | `Syncing…` | A push, pull, token exchange, or WebSocket backlog drain is in flight |
| `queued` | blue | solid | `{n} changes waiting` | The outbound queue is non-empty **and** the last push attempt failed |
| `failed` | red | pulsing | `Disconnected — retrying in {delay}` | The most recent completed attempt failed, or the deployment is misconfigured |

`live` and `polling` are deliberately two states with the same colour and
different text. **The user must be able to tell that real-time delivery is
degraded even though sync still works.** Collapsing them would hide the entire
reason WebSocket exists in v0.3.0; keeping them as one colour keeps "green means
your data is moving" true.

`disabled` is a *visible* gray dot, not an absent one. An absent indicator is
indistinguishable from a broken indicator; a gray dot labelled "Sync off"
affirms the standalone-by-default contract in `AGENTS.md` rather than leaving
the user to guess.

---

## 2. Inputs — everything comes from state the clients already have

No new persisted state, no new wire fields, no new network calls. Every signal
below is either already present or is a flag set at a branch point that already
exists in the engine. The table names that branch point on both platforms so the
two implementations capture the *same* moment.

### 2.1 Configuration

| Signal | Type | macOS | web |
|---|---|---|---|
| `enabled` | bool | A `SyncEngine` instance exists. `AppDelegate.startSyncIfEnabled()` constructs one only when `Prefs.cloudSyncEnabled`, `Prefs.backendURL != nil`, and `AccountManager` yields an identity + mnemonic. | Same shape in `App.tsx`: `Prefs.cloudSyncEnabled()`, a non-empty `Prefs.backendURL()`, and an `AccountManager.open()` that yields `identity` + `mnemonic`. |

**`enabled` is "an engine exists", never "let me go and check".** In particular
the indicator MUST NOT call `AccountManager.loadIfPresent()`, read the Keychain,
or otherwise probe for a key in order to decide what to draw.

> *Failure this prevents:* macOS Keychain access is on-demand by contract
> (`AGENTS.md`, "Identity & encryption"). An indicator that answered "is there a
> key?" for itself would fire a Keychain authorisation prompt on every render —
> on a fresh install with sync off, which is precisely the case the on-demand
> rule exists to protect.

Consequences of folding three conditions into one flag:

- Sync off, no backend URL, and "enabled but the key is missing" all render
  `disabled`. That is deliberate: in all three cases the app makes **zero**
  network calls, so `Sync off` is the true statement. *Why* it is off belongs in
  the Settings body copy, which already distinguishes these cases; putting it in
  a seven-pixel dot would not.
- `enabled` flips synchronously with the user's action, because engine
  construction and teardown are synchronous with
  `cornerTasksCloudSyncChanged` / `CLOUD_SYNC_CHANGED_EVENT`.

> **Drift note for N12/N14.** `Prefs.backendURL` on macOS trims whitespace and
> maps an empty result to `nil`; `Prefs.backendURL()` on web returns
> `localStorage.getItem(...)` unnormalised. A value of `"   "` is therefore
> "absent" on macOS and "present" on web, which would render `disabled` on one
> platform and `checking`→`failed` on the other from the same user input. The
> contract is: **`backendURL` is absent when it trims to empty.** Fixing the web
> getter is a one-line change that belongs to N14, not to this documentation
> node.

### 2.2 In-flight flags

Each is set immediately before the call that opens the window and cleared in a
`defer` / `finally` so a thrown error cannot strand it set.

| Signal | Window opens | Window closes |
|---|---|---|
| `inFlight.meta` | before `GET /v1/meta` (sync-protocol §10.1) | response, error, or the §3.4 timeout |
| `inFlight.ping` | before `BackendPing.ping(...)` — **user-initiated "Test connection" only** | that call returns or throws |
| `inFlight.push` | before `pushWithAuth(...)` (REST) or before emitting a `push` frame (WS) | the call returns/throws, or `push_ack` arrives, or the socket closes |
| `inFlight.pull` | before `pullWithAuth(...)` | the call returns or throws |
| `inFlight.auth` | before a *standalone* `AuthSession.refresh()` | it returns or throws |

`inFlight.push` and `inFlight.pull` **span the token exchange**, because
`pushWithAuth` / `pullWithAuth` call `AuthSession.bearer()` inside the window
they own. `inFlight.auth` therefore only ever covers a refresh that some future
code path performs outside a push or pull; today there is none.

> *Failure this prevents:* if the token exchange were reported separately, every
> bearer expiry — hourly, by design (sync-protocol §8.3) — would flash
> `Connecting…` on a perfectly healthy connection. Users learn to ignore an
> indicator that blinks for no reason they can perceive.

### 2.3 Attempt outcomes

Three records, each `{ outcome: "none" | "ok" | "failed", at: ISO-8601, error: string|null }`.
They are **per engine instance**: constructing an engine initialises all three
to `outcome: "none"`, and a torn-down engine's late callbacks are discarded.

| Record | Written at | `ok` means | `failed` means |
|---|---|---|---|
| `lastPush` | the end of every push that reached the network — REST `flushPushes()` after `pushWithAuth`, or WS on `push_ack` / socket close | a `PushResponse` / `push_ack` was received (accepted **and** stale-rejected both count — sync-protocol §7.1) | any thrown `SyncTransportError`, or a socket close with the push unacked |
| `lastPull` | the end of every `pullSince()` / `pullForResync()` that reached the network, and on the WS `live` frame | a `PullResponse` decoded, or `live` received | any thrown `SyncTransportError` |
| `lastProbe` | the end of every `/v1/meta` fetch and every `BackendPing.ping` | see below | see below |

Two rules on this table are load-bearing:

**(a) An early return is not an outcome.** `flushPushes()` returns before any
network call when the queue is empty — literally
`guard !rows.isEmpty else { return }` on macOS and `if (rows.length === 0) return;`
on web. That path MUST NOT write `lastPush`.

> *Failure this prevents:* treating "didn't push" as "push failed" pins an idle
> client at `failed` forever; treating it as "push succeeded" masks a real
> outage behind a green dot until the user happens to edit a task.

**(b) A `/v1/meta` 404 is `ok`, not `failed`.** `lastProbe.outcome` is `ok` when
the HTTP exchange *completed*, whatever the status code — 200, 404, 500. It is
`failed` only when the request never completed: DNS failure, TLS failure,
connection refused, or the §3.4 timeout.

> *Failure this prevents:* sync-protocol §13 promises a v0.3.0 client works
> unchanged against a v0.2.0 backend, which has no `/v1/meta` and answers 404.
> Scoring that 404 as a connectivity failure would paint every such deployment
> permanently red while sync worked perfectly — a UI-layer breach of a
> wire-level compatibility promise.

`BackendPing` is stricter because it checks an endpoint that must exist: a
non-2xx from `/v1/auth/challenge`, or `BackendPingError.transport`, is `failed`.
`BackendPingError.audienceMismatch` is neither — it sets the latch in §2.5.

### 2.4 WebSocket state

From the sync-protocol §11/§12 state machine that N12/N14 implement.

| Signal | Values / meaning |
|---|---|
| `ws.phase` | `idle` (no attempt yet, or WS not advertised) · `connecting` (socket opening) · `authenticating` (`auth` sent, no `auth_ok`) · `draining` (`subscribe` sent, `live` not yet received) · `live` (`live` frame received) · `closed` |
| `ws.consecutiveFailures` | attempts that did not reach `live`, per sync-protocol §12.3 (cap 3, then stop retrying) |
| `ws.retryAt` | the deadline produced by the sync-protocol §12.1 backoff, or `null` when no retry is scheduled |

**`ws.phase` becomes `live` on the `live` frame and on nothing else** — not on
socket open, not on `auth_ok`, not on the first `events` frame. This is the same
flag that stands the pull timer down (sync-protocol §12.2); implementations MUST
drive both from it rather than keeping two booleans.

> *Failure this prevents:* two flags drift. Either the indicator says
> `Connected` while the client is still draining a backlog it hasn't applied —
> so a user sees green, closes the lid, and loses the window — or the pull timer
> stands down while the indicator still says `Syncing…`, and a dropped socket
> leaves neither transport running.

### 2.5 The misconfiguration latch

`misconfigured` is a per-engine-instance boolean, initially `false`. It is set by
any of:

- a WebSocket close with code `4403` (sync-protocol §11.6),
- an `auth_err` with `reason: "bad_audience"` (sync-protocol §11.1),
- a REST `401` whose `reason` is `bad_audience` (sync-protocol §8.6),
- `BackendPingError.audienceMismatch`.

Once set it is **latched**: nothing clears it except constructing a new engine,
which happens when the user changes the backend URL, the key, or toggles sync.

> *Failure this prevents:* an audience mismatch is a configuration error the
> user must fix; it will not heal on its own. sync-protocol §11.6 already says
> `4403` must "not retry; surface `failed`". Without the latch, a client that
> keeps polling REST — and keeps getting `bad_audience` — would oscillate
> between `failed` and whatever the last attempt happened to be, and the
> countdown in the `failed` phrase would promise a recovery that cannot happen.

### 2.6 Queue depth and the retry deadline

| Signal | Definition |
|---|---|
| `pending` | the number of rows `pendingQueueRows()` would return — outbound queue rows not yet marked sent. This counts **events, not tasks**: three edits to one task before a flush are three pending changes. |
| `nextPollAt` | the wall-clock instant the pull timer next fires. macOS: `Timer.fireDate`. web: `setInterval` does not expose it, so the engine records the instant it (re)armed the timer and adds `intervalMs()`. |

`nextPollAt` is `null` while the pull timer is not armed — on web that is exactly
the `document.hidden` window, during which the indicator is not on screen
anyway; on `visibilitychange → visible` the engine reschedules and runs both
immediately.

---

## 3. Resolution

### 3.1 Derived predicates

```
settled      := lastPush.outcome  ≠ "none"
             ∨  lastPull.outcome  ≠ "none"
             ∨  lastProbe.outcome ≠ "none"
             ∨  ws.phase == "live"

transferring := inFlight.push ∨ inFlight.pull ∨ inFlight.auth ∨ ws.phase == "draining"

lastAttempt  := among { lastPush, lastPull, lastProbe }, the record whose
                outcome ≠ "none" and whose `at` is greatest; "none" if all three
                are "none"

retryAt      := the earliest non-null value among { ws.retryAt, nextPollAt }
retrySeconds := clamp(ceil((retryAt − now) / 1000), 0, 86400)
```

`inFlight.meta` is deliberately **not** in `transferring`. A `/v1/meta` probe
moves no task data, and sync-protocol §12.3 re-probes every 15 minutes after the
client has given up on WebSocket.

> *Failure this prevents:* "Syncing…" pulsing for a second every quarter hour on
> a client that is not syncing anything, with no user-visible cause. At startup
> `inFlight.meta` needs no special case because `¬settled` already yields
> `checking`.

`lastAttempt` deliberately merges push, pull, and probe rather than reading pull
alone, because **the two clients do not attempt the same things in the same
order at startup**: `SyncEngine.start()` on macOS runs `flushPushes()` immediately
and leaves the first pull to the timer, while web's `start()` runs both.

### 3.2 The function

Precedence is total and evaluated top to bottom. First match wins.

```
function connectionState(s, now):
    if not s.enabled:                        return "disabled"      # 1
    if s.misconfigured:                      return "failed"        # 2  (latched)
    if not settled(s) or s.inFlight.ping:    return "checking"      # 3
    if transferring(s):                      return "syncing"       # 4
    if s.pending > 0
       and s.lastPush.outcome == "failed":   return "queued"        # 5
    if s.ws.phase == "live":                 return "live"          # 6
    if lastAttempt(s).outcome == "ok":       return "polling"       # 7
    return "failed"                                                 # 8
```

The function is **total**: every reachable input maps to exactly one state, and
it is pure — same snapshot in, same state out, no reads of the clock except for
`retrySeconds` (§4). That is what lets N13 and N15 share test vectors.

### 3.3 Why this order

| Rank | Rule | Reason |
|---|---|---|
| 1 | `disabled` outranks everything | It is the user's own action and the promise that no network call is happening. Anything drawn over it would suggest the app is still talking to a server after the user said stop. |
| 2 | the latch outranks `queued` | `queued` means "waiting, will send when the network returns". Under an audience mismatch that is false — nothing will ever send until the user edits the URL. Showing blue "3 changes waiting" would tell the user to wait for a recovery that cannot occur. This is the one deliberate exception to "`queued` outranks `failed`". |
| 3 | `checking` outranks `syncing` | `¬settled` is exactly the bootstrap window, where "Connecting…" is the more honest description of a first request that may not reach anything. `inFlight.ping` is a deliberate user action ("Test connection") that owes the user immediate feedback. |
| 4 | `syncing` outranks `queued` | An attempt in flight is the newest truth. If it fails, §5 puts the state straight back to `queued` — so nothing is hidden, and the user sees that the app is trying rather than sitting on their changes. Required by the node contract for `live`/`polling` too. |
| 5 | `queued` outranks `live` and `polling` | "Your changes are not out yet" matters more than "the connection is up". This is what closes the case where a socket stays `live` but `push_ack` never arrives: without it, the indicator sits green while the outbound queue grows silently. |
| 6 | `live` outranks `polling` and `failed` | A live socket means delivery is working *now*. A stale REST failure recorded before the socket came up must not paint a working client red. |
| 7 | `polling` before the `failed` fallthrough | REST is not a degraded mode (sync-protocol §10.2). A WebSocket failure on its own never produces `failed`; it produces `polling`, because the pull timer is still carrying sync. |

Rank 7 is worth restating as a rule, because it is the one an implementer is
most likely to get backwards: **a WebSocket that will not connect is not a
disconnection.** `failed` requires the *REST* path to have failed too (or the
latch). A user on a REST-only deployment, or one whose socket just dropped, must
never see red while their tasks are still syncing.

### 3.4 Leaving `checking`

`checking` ends when the first attempt of any kind completes. Two requirements
make that bounded:

1. **The engine MUST perform a reachability attempt at start, independent of
   queue contents.** sync-protocol §10.2 step 1 already requires `GET /v1/meta`
   as the first thing a v0.3.0 client does, so this adds no work — it just pins
   `/v1/meta` as the thing that clears `checking`.

   > *Failure this prevents:* without it, a macOS client with an empty outbound
   > queue shows `Connecting…` until the first pull-timer tick, because
   > `flushPushes()` returns before touching the network and `pullSince()` does
   > not run at `start()`. With `Prefs.syncIntervalSeconds` at its maximum that
   > is **24 hours** of "Connecting…" on a perfectly healthy connection.

2. **The `/v1/meta` probe MUST time out after 10 seconds**, and the timeout
   counts as `lastProbe.outcome = "failed"`.

   > *Failure this prevents:* sync-protocol §10.2 already says a timeout means
   > "assume REST-only", but does not give a number. `URLSession`'s default is
   > 60 s and `fetch`'s is unbounded — so against a black-holed host, macOS
   > would leave `checking` after a minute and web would never leave it at all.
   > Ten seconds is short enough that the indicator settles within a screenful
   > of user attention and long enough for a cold Lambda behind a tunnel.

---

## 4. Parameters

Three values accompany the state. They are **not** part of the state, which
matters for §7: changing a parameter is not a state transition.

| Parameter | Type | Present for | Value |
|---|---|---|---|
| `pending` | integer ≥ 0 | `queued` | §2.6. Updated live as the queue changes. |
| `retrySeconds` | integer, `0…86400` | `failed` | §3.1. Recomputed at 1 Hz while `failed` is displayed. |
| `detail` | string, may be empty | `failed`, `queued` | The `error` field of the record that produced the state — `lastAttempt.error` for `failed`, `lastPush.error` for `queued`. Surfaced on hover (macOS) / tap (web), never inline. |

`detail` carries a developer-facing description — `SyncTransportError.http(503, reason: nil)`,
a WebSocket close code, `audienceMismatch(expected:got:)`. It is not localised
and not in `design/text/en.json`, because it is a verbatim diagnostic. It MUST
NOT contain a bearer token, a DID-JWT, ciphertext, or a mnemonic; the redaction
rules in `URLSessionSyncTransport.redactedBodySummary` are the reference.

### 4.1 Formatting `retrySeconds`

`{delay}` in the `failed` phrase is a formatted duration, not a raw seconds
count, and both platforms MUST produce byte-identical output from this function:

```
formatRetryDelay(seconds):
    s = clamp(seconds, 0, 86400)
    if s < 60:    return decimal(s)      + "s"     #     0s …    59s
    if s < 3600:  return decimal(s / 60) + "m"     #     1m …    59m   (integer division)
    return             decimal(s / 3600) + "h"     #     1h …    24h   (integer division)
```

ASCII only, no locale separators, no plural forms, integer division truncating
toward zero.

> *Why not raw seconds:* `Prefs.syncIntervalSeconds` is user-configurable up to
> 24 hours, so `retrySeconds` legitimately reaches 86 400. "Disconnected —
> retrying in 86400s" is not a sentence anyone can read. This refines the
> `{n}`-for-retry-seconds sketch in `plan/v0.3.0/nodes/N11-design-schema.md`;
> N11 should use one `{delay}` placeholder rather than three duration keys, so
> the two renderers cannot pick different thresholds.

Worked values:

| `retrySeconds` | `{delay}` |
|---|---|
| 0 | `0s` |
| 12 | `12s` |
| 59 | `59s` |
| 60 | `1m` |
| 119 | `1m` |
| 3599 | `59m` |
| 3600 | `1h` |
| 86400 | `24h` |

---

## 5. Strings

Seven states, eight keys — `queued` needs a singular and a plural form. Keys are
namespaced under the screen node id N11 declares (`settings.cloud.status`), so
they sort next to the rest of the cloud-sync copy in `design/text/en.json`.

| Key | Value |
|---|---|
| `settings.cloud.status.disabled` | `Sync off` |
| `settings.cloud.status.checking` | `Connecting…` |
| `settings.cloud.status.live` | `Connected` |
| `settings.cloud.status.polling` | `Connected (polling)` |
| `settings.cloud.status.syncing` | `Syncing…` |
| `settings.cloud.status.queued.one` | `1 change waiting` |
| `settings.cloud.status.queued.other` | `{n} changes waiting` |
| `settings.cloud.status.failed` | `Disconnected — retrying in {delay}` |
| `settings.cloud.status.a11yLabel` | `Sync status: {phrase}` |

Select `queued.one` when `pending == 1`, `queued.other` otherwise (including
`pending == 0`, which §3.2 makes unreachable but which a forced-state debug
affordance can produce).

### 5.1 Exact bytes

Two of these phrases contain non-ASCII punctuation, and both are easy to get
subtly wrong — `...` instead of `…`, or a hyphen/en dash instead of an em dash —
which the N17 screenshot comparison would catch late and expensively. The
existing `design/text/en.json` already uses `…` (`tasks.add.placeholder`) and
`—` (`settings.cloud.title.on`); these match.

| Phrase | UTF-8 bytes |
|---|---|
| `Sync off` | `53 79 6E 63 20 6F 66 66` |
| `Connecting…` | `43 6F 6E 6E 65 63 74 69 6E 67 E2 80 A6` |
| `Connected` | `43 6F 6E 6E 65 63 74 65 64` |
| `Connected (polling)` | `43 6F 6E 6E 65 63 74 65 64 20 28 70 6F 6C 6C 69 6E 67 29` |
| `Syncing…` | `53 79 6E 63 69 6E 67 E2 80 A6` |
| `1 change waiting` | `31 20 63 68 61 6E 67 65 20 77 61 69 74 69 6E 67` |
| `{n} changes waiting` | `7B 6E 7D 20 63 68 61 6E 67 65 73 20 77 61 69 74 69 6E 67` |
| `Disconnected — retrying in {delay}` | `44 69 73 63 6F 6E 6E 65 63 74 65 64 20 E2 80 94 20 72 65 74 72 79 69 6E 67 20 69 6E 20 7B 64 65 6C 61 79 7D` |

- `E2 80 A6` is U+2026 HORIZONTAL ELLIPSIS — one character, not three periods.
- `E2 80 94` is U+2014 EM DASH, surrounded by ASCII spaces (`20 E2 80 94 20`).
  Not U+2013 EN DASH, not `-`.

Fully substituted, `Disconnected — retrying in 12s` is:

```
44 69 73 63 6F 6E 6E 65 63 74 65 64 20 E2 80 94 20 72 65 74 72 79 69 6E 67
20 69 6E 20 31 32 73
```

---

## 6. Design tokens

One semantic colour token per state, named `color.conn.<state>`:

```
color.conn.disabled
color.conn.checking
color.conn.live
color.conn.polling
color.conn.syncing
color.conn.queued
color.conn.failed
```

Seven tokens, defined in **both** `design/tokens/semantic.light.json` and
`design/tokens/semantic.dark.json`, nested under `color.conn` exactly as
`color.due` is today, each aliasing an existing primitive (`{color.green.500}`,
`{color.blue.500}`, …). No new raw colours.

This is design-schema hard rule 7 (`AGENTS.md`): every enum value on a
state-driven visual prop needs a token mapping, checked by `make design-validate`.
N11 registers `ConnectionStatus.state` in the validator's rule list with
`tokenPrefix: 'color.conn.'` and an **empty** `exempt` list — unlike
`TaskRow.dueState`, which exempts `none`, every one of these seven states draws
a visible dot.

**`color.conn.live` and `color.conn.polling` stay two tokens even while they
resolve to the same green.**

> *Failure this prevents:* aliasing `polling` to `live` in the schema means a
> later decision to tint the polling dot differently — the obvious next design
> move, since the whole point of the pair is legibility — requires editing a
> screen or a component instead of a token. That is exactly the class of change
> hard rule 7 exists to keep inside `design/`.

### 6.1 Motion

Pulse is derived from state, not stored per state, and not tokenised:

```
pulse(state) := state ∈ { checking, syncing, failed }
```

The three pulsing states are the three that mean "something is happening or
should be happening"; the four solid states are terminal-until-something-changes.

Under macOS Reduce Motion / CSS `prefers-reduced-motion: reduce`, pulsing states
render **solid**. They remain distinguishable because every state carries its
own phrase and its own token.

### 6.2 Accessibility

Colour never carries meaning alone: `live`, `polling`, and `syncing` share a
colour and are told apart by text, and `queued` (blue) vs `failed` (red) is a
red/green-adjacent distinction that some users cannot make. The phrase is always
rendered next to the dot — it is not a tooltip — and the accessible label is
`settings.cloud.status.a11yLabel` with `{phrase}` substituted.

---

## 7. Minimum dwell time

```
MIN_DWELL = 500 ms
```

A rendered state is held for at least `MIN_DWELL` before being replaced. The
mechanism is a **trailing-edge throttle**, not a queue:

1. When the computed state differs from the rendered state and at least
   `MIN_DWELL` has elapsed since the last render, render immediately and stamp
   the render time.
2. Otherwise store the computed state as *pending* — overwriting any previous
   pending value — and schedule a single re-evaluation at
   `lastRenderAt + MIN_DWELL`.
3. At that instant, render whatever the **currently computed** state is, not the
   value that was pending when the timer was set.

> *Failure this prevents:* a queue of intermediate states. A client that pushes
> and pulls in quick succession generates several transitions per second; a
> FIFO would render each for 500 ms and fall progressively further behind
> reality — an indicator that is confidently wrong is worse than one that
> flickers.

Consequences to implement deliberately:

- **Parameter changes are not state changes.** `pending`, `retrySeconds`, and
  `detail` update immediately and MUST NOT restart the dwell timer. The `failed`
  countdown ticks at 1 Hz; if a parameter update reset the dwell, the indicator
  would never be allowed to change state at all.
- **`disabled` bypasses the dwell entirely** and renders synchronously. It is
  the direct result of a user action, and there is no engine left to compute
  from; a half-second lag after toggling sync off reads as a broken toggle and,
  worse, as the app still being connected.
- **A sync that completes in under 500 ms never shows `Syncing…`.** That is the
  intended trade — `live` → `syncing` → `live` inside one dwell window collapses
  to no visible change. The alternative guarantees a strobe on every fast tick.
- **Forced states bypass the dwell.** The debug affordances N13 and N15 ship
  (macOS debug menu, web `?connState=`) set the rendered state directly, so the
  N17 screenshots are deterministic.

---

## 8. Races

Each is named with the resolution that both implementations must adopt.

### 8.1 The drain/live race

Between `subscribe` and `live` the socket is authenticated but the backlog has
not arrived, and sync-protocol §11.2 requires the server to buffer concurrent
writes and flush them *before* `live`.

**Resolution:** `ws.phase == "draining"` is part of `transferring`, so this
window renders `syncing`, never `live`. `ws.phase` becomes `live` only on the
`live` frame (§2.4), and the same flag stands the pull timer down.

> *Failure this prevents:* the indicator asserting real-time delivery before the
> client has caught up. A user who sees `Connected` and closes the lid loses the
> drain window; and if the pull timer were stood down on socket open instead,
> there would be an interval with no transport running at all.

### 8.2 Socket drop mid-session

The socket closes (heartbeat timeout, tunnel restart, laptop sleep). The pull
timer restarts immediately per sync-protocol §12.2.

**Resolution:** `ws.phase` leaves `live`; `lastPull.outcome` is still `ok` from
before, so §3.2 rank 7 renders `polling`. Then reconnect proceeds through
`connecting` → `authenticating` → `draining` (`syncing`) → `live`.

**No red at any point.** The state goes `live` → `polling` → `syncing` → `live`.

> *Failure this prevents:* a routine reconnect — which on a self-hosted backend
> behind a free-tier tunnel happens several times a day — flashing
> `Disconnected` and training the user to distrust the indicator.

### 8.3 A live socket whose pushes are not landing

The socket stays `live` and answers heartbeats, but `push_ack` never arrives
(server-side write failure, a runtime that fans out but does not ack). The
outbound queue grows.

**Resolution:** §3.2 rank 5 puts `queued` above `live`. `lastPush` is set to
`failed` when a push frame is still unacked at socket close, and — required of
N12/N14 — **a `push` frame with no `push_ack` within 30 seconds is treated as a
failed push**, matching the heartbeat dead-peer bound in sync-protocol §11.5.

> *Failure this prevents:* a green `Connected` dot over a silently growing queue.
> This is the worst possible failure for a task app: the user believes their
> edits are on their other device, and they are not.

### 8.4 Disable while work is in flight

The user toggles sync off — or changes the backend URL, or the key — while a
push or pull is outstanding.

**Resolution:** `enabled` is computed from the *existence* of an engine, and
engine teardown is synchronous with the change, so `disabled` renders
immediately (§7). The outstanding request may still complete; its outcome
belongs to a torn-down engine instance (§2.3) and MUST be discarded rather than
written to the indicator's inputs.

> *Failure this prevents:* the indicator flashing `syncing` or `failed` *after*
> the user turned sync off, which reads as "it is still talking to a server" and
> directly contradicts the standalone-by-default contract. Web already guards
> the symmetric bug with the `runId` generation counter in `App.tsx`; this is the
> same hazard on the status path.

### 8.5 Backend URL corrected

The user fixes a typo'd URL, or updates `PUBLIC_URL` after an ngrok restart
(`plan/v0.3.0/decisions.md` D1).

**Resolution:** a new engine is constructed, so `lastPush` / `lastPull` /
`lastProbe` all reset to `"none"`, `misconfigured` resets to `false`,
`ws.consecutiveFailures` resets to 0 — and §3.2 rank 3 renders `checking`.

> *Failure this prevents:* the indicator staying red after the user has already
> fixed the problem, because a latch or a stale outcome record survived the
> reconfiguration. Under D1's resolution this is the *expected* recovery path
> after every tunnel restart, so it has to be visibly clean.

### 8.6 Clock movement

`retrySeconds` is a difference between two local instants. A system sleep, a
wall-clock adjustment, or an NTP step can make it negative or enormous.

**Resolution:** clamp to `[0, 86400]` (§3.1) and never derive it from a server
timestamp. Server time is irrelevant here — the deadline being counted down is a
local timer.

### 8.7 What this indicator does *not* claim

The indicator reflects **this device's transport**. It says nothing about
whether another device of the same account is connected, and nothing about
server-side fan-out. sync-protocol §11.4 makes fan-out best-effort and scoped by
the `accountDid` from the verified token; a peer that misses a frame recovers
from its cursor. There is deliberately no "2 devices online" state.

> *Why:* a client cannot observe another device's connectivity without a new
> protocol frame and a new privacy question, and an indicator that guessed would
> be wrong exactly when it mattered.

---

## 9. Worked examples

Each trace is a sequence of `(t, event)` with the resulting input snapshot and
the state §3.2 computes. `t` is milliseconds from engine construction. The
snapshot format is the shared test-vector shape for N13/N15.

### 9.1 Cold start against a WebSocket backend

```
t=0      engine constructed; GET /v1/meta issued
```

```json
{
  "enabled": true, "misconfigured": false,
  "ws": { "phase": "idle", "consecutiveFailures": 0, "retryAt": null },
  "inFlight": { "meta": true, "ping": false, "push": false, "pull": false, "auth": false },
  "lastPush":  { "outcome": "none", "at": null, "error": null },
  "lastPull":  { "outcome": "none", "at": null, "error": null },
  "lastProbe": { "outcome": "none", "at": null, "error": null },
  "pending": 0, "nextPollAt": "2026-08-16T09:15:00.000Z"
}
```

→ rank 3 (`¬settled`) → **`checking`** · gray pulsing · `Connecting…`

```
t=180    /v1/meta 200 {"protocolVersions":[2,3],"transports":["ws","rest"],"wsUrl":"wss://…"}
         lastProbe = ok;  socket opened;  ws.phase = connecting
t=240    auth frame sent                              ws.phase = authenticating
t=310    auth_ok                                      subscribe {"cursor":"147"} sent
                                                      ws.phase = draining
```

→ `settled` now true; rank 4 (`transferring`, phase `draining`) → **`syncing`**

```
t=520    events {events:[…2 events…], nextCursor:"149"}   cursor persisted
t=545    live {"cursor":"149"}    ws.phase = live; lastPull = ok; pull timer stood down
```

→ rank 6 → **`live`** · green solid · `Connected`

Rendered sequence, after the §7 dwell: `checking` at t=0, held to t=500;
at t=500 the currently-computed state is still `syncing`, so `syncing` renders;
at t=1000 the computed state is `live`, which renders. The `syncing` window is
shown because it lasted longer than one dwell period.

### 9.2 Cold start against a v0.2.0 backend

```
t=0      engine constructed; GET /v1/meta issued
t=95     404 Not Found          ← the host answered
         lastProbe = { outcome: "ok", at: "…T09:14:00.095Z", error: null }
         §10.2: assume {"protocolVersions":[2],"transports":["rest"]}; ws.phase stays idle
t=100    pullSince() starts     inFlight.pull = true
```

→ `settled` (via `lastProbe`), `transferring` → **`syncing`**

```
t=610    PullResponse decoded; cursor persisted
         lastPull = { outcome: "ok", at: "…T09:14:00.610Z", error: null }
```

```json
{
  "enabled": true, "misconfigured": false,
  "ws": { "phase": "idle", "consecutiveFailures": 0, "retryAt": null },
  "inFlight": { "meta": false, "ping": false, "push": false, "pull": false, "auth": false },
  "lastPush":  { "outcome": "none", "at": null, "error": null },
  "lastPull":  { "outcome": "ok", "at": "2026-08-16T09:14:00.610Z", "error": null },
  "lastProbe": { "outcome": "ok", "at": "2026-08-16T09:14:00.095Z", "error": null },
  "pending": 0, "nextPollAt": "2026-08-16T09:15:00.100Z"
}
```

→ rank 7 → **`polling`** · green solid · `Connected (polling)`

The 404 scored `ok` (§2.3(b)). Had it scored `failed`, `lastAttempt` at t=95
would have been a failure and the indicator would have shown red for 515 ms
before the pull rescued it — and permanently red on any deployment where the
pull is slower than the probe.

### 9.3 Backend goes down with pending changes

Steady state: `polling`, `pending = 0`, interval 60 s, `nextPollAt = t+60000`.

```
t=0        user edits three tasks → three queue rows      pending = 3
```

→ rank 5 requires `lastPush.outcome == "failed"`; it is `ok`. → still **`polling`**

> This is the case that makes the `queued` condition two-part. `pending > 0`
> alone would turn the dot blue on every keystroke-driven edit, seconds before a
> perfectly successful flush.

```
t=1200     push timer fires; flushPushes() → pushWithAuth   inFlight.push = true
```

→ rank 4 → **`syncing`**

```
t=31200    URLSession times out
           lastPush = { outcome: "failed",
                        at: "2026-08-16T09:14:31.200Z",
                        error: "SyncTransportError.network(\"NSURLErrorTimedOut\")" }
```

```json
{
  "enabled": true, "misconfigured": false,
  "ws": { "phase": "closed", "consecutiveFailures": 3, "retryAt": null },
  "inFlight": { "meta": false, "ping": false, "push": false, "pull": false, "auth": false },
  "lastPush":  { "outcome": "failed", "at": "2026-08-16T09:14:31.200Z",
                 "error": "SyncTransportError.network(\"NSURLErrorTimedOut\")" },
  "lastPull":  { "outcome": "ok", "at": "2026-08-16T09:14:00.610Z", "error": null },
  "lastProbe": { "outcome": "ok", "at": "2026-08-16T09:14:00.095Z", "error": null },
  "pending": 3, "nextPollAt": "2026-08-16T09:15:00.610Z"
}
```

→ rank 5 → **`queued`** · blue solid · `3 changes waiting`
  · detail `SyncTransportError.network("NSURLErrorTimedOut")`

Note `queued` outranks the `failed` that rank 8 would otherwise produce, and that
`lastPull` being `ok` is irrelevant here — the user's changes are what is stuck.

```
t=60610    pull timer fires; pull also times out at t=90610
           lastPull = failed; retryAt = nextPollAt = t+120610
```

→ still **`queued`** (rank 5 before rank 8). Had the queue been empty:
→ rank 8 → **`failed`** · red pulsing · `Disconnected — retrying in 30s`,
counting down to `0s` at 1 Hz without restarting the dwell timer (§7).

```
t=120610   backend returns; push succeeds; three rows marked sent
           lastPush = ok;  pending = 0
t=120900   pull succeeds;  lastPull = ok
```

→ rank 7 → **`polling`**

### 9.4 Audience mismatch

```
t=0     engine constructed with backendURL "https://old-tunnel.ngrok.app"
t=140   /v1/meta 200; wsUrl advertised; socket opens
t=310   auth frame sent
t=380   auth_err {"type":"auth_err","reason":"bad_audience"}; server closes with 4403
        misconfigured = true;  ws disabled until the URL changes (§12.3)
```

→ rank 2 → **`failed`** · red pulsing
  · detail `ws close 4403 bad_audience (expected https://old-tunnel.ngrok.app)`

```
t=1400  REST pull → 401 { "reason": "bad_audience" }   lastPull = failed
```

→ still rank 2. The latch, not `lastPull`, is what holds the state — so even if a
cached response made a later REST call succeed, the indicator stays red. Three
pending changes would **not** promote this to `queued` (§3.3 rank 2): under a
misconfiguration "3 changes waiting" would promise a recovery that cannot happen
without the user editing `PUBLIC_URL` and the client URL (D1).

```
t=95000  user updates the backend URL → new engine constructed
```

→ all outcome records `"none"`, `misconfigured = false` → rank 3 → **`checking`**

### 9.5 Dwell throttle

Computed states, ms from the first render. `MIN_DWELL = 500`.

| t | computed | rendered | why |
|---|---|---|---|
| 0 | `polling` | `polling` | first render; `lastRenderAt = 0` |
| 120 | `syncing` | `polling` | inside the dwell window; pending := `syncing` |
| 260 | `polling` | `polling` | push finished; pending := `polling` (overwrites) |
| 340 | `syncing` | `polling` | pull started; pending := `syncing` |
| 500 | `syncing` | `syncing` | window elapsed; renders the value computed **now**, not the one pending at t=120 |
| 610 | `polling` | `syncing` | inside the new window; pending := `polling` |
| 1000 | `polling` | `polling` | window elapsed |

Two renders for six transitions, and the rendered state at every instant is
either current or at most 500 ms stale. A FIFO would instead have rendered
`syncing`(500) → `polling`(1000) → `syncing`(1500) → `polling`(2000), finishing
a full second after the activity ended.

---

## 10. Conformance checklist

For N11 (schema), N12/N14 (engine state), N13/N15 (renderers). Each item is
mechanically checkable.

- [ ] The state enum is exactly the seven names in §1, in that spelling.
- [ ] `connectionState` (§3.2) is implemented as a pure function of a snapshot,
      so the same test vectors run on both platforms.
- [ ] `disabled` is derived from the absence of an engine and never probes the
      Keychain or `localStorage` for a key (§2.1).
- [ ] An empty outbound queue does not record a push outcome (§2.3(a)).
- [ ] A `/v1/meta` 404 records `lastProbe = ok` (§2.3(b)).
- [ ] `ws.phase == live` is set by the `live` frame only, and is the same flag
      that stands the pull timer down (§2.4).
- [ ] `/v1/meta` runs at engine start regardless of queue contents, with a 10 s
      timeout (§3.4).
- [ ] A WebSocket-only failure renders `polling`, never `failed` (§3.3 rank 7).
- [ ] An unacked `push` frame after 30 s records `lastPush = failed` (§8.3).
- [ ] `{delay}` uses `formatRetryDelay` (§4.1); the eight worked values match.
- [ ] The two non-ASCII phrases match the bytes in §5.1.
- [ ] Seven `color.conn.<state>` tokens exist in both theme files, with no
      `exempt` entries in the hard-rule-7 registration (§6).
- [ ] `pulse` is derived, and solid under reduced motion (§6.1).
- [ ] `MIN_DWELL` is a trailing-edge throttle; parameter updates do not restart
      it; `disabled` bypasses it (§7).
- [ ] Late callbacks from a torn-down engine cannot write the indicator (§8.4).
- [ ] Every state is reachable from the platform's forced-state affordance, with
      the dwell bypassed (§7).
