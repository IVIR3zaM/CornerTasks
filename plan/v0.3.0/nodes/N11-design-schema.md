---
id: N11
title: Design schema for the connection-status indicator
model: sonnet
deps: [N03]
---

## Goal

Express the N03 state contract in `design/` **before** any app code exists, per
the design-as-code workflow in `AGENTS.md`. Use the `ct-design-change` skill —
it encodes the hard rules and the required order.

## Deliverables

- **Tokens** — `color.conn.<state>` in both `design/tokens/semantic.light.json`
  and `semantic.dark.json`, one per state in the N03 table. Hard rule 7: a
  state-driven visual prop must have a token per enum value, and the validator
  fails otherwise. Reference existing primitives; don't add new raw colours.
- **Component** — `design/components/ConnectionStatus.json`: props `state`
  (enum matching N03 exactly), `pending` (number, for `queued`), `detail`
  (string, for the failure reason). Model the pulse as a boolean prop derived
  from state, not as per-state duplication.
- **Text** — one key per phrase in `design/text/en.json`, with `{n}`
  placeholders for the queued count and retry seconds. Hard rule 2: no literal
  strings anywhere else.
- **Screen node** — insert into `design/screens/settings.json` at the head of
  the `settings.cloud` section, id `settings.cloud.status`. Ids are how
  overlays target nodes; pick it deliberately, renaming later is breaking.
- **Bindings** — register the state `dataBinding` in `design/actions.json` and
  list it in both `design/platforms/{macos,web}/bindings.json`. Hard rule 6 is
  what catches "added to the schema, never wired in code".
- **Overlays** — only if the platforms genuinely differ. Prefer no divergence.

## Acceptance

- `make design-validate` exits 0.
- `make design-preview` renders every state in both platform previews —
  step through them.
- The parity report lists no unintended divergence.
- No literal colour, size, or string introduced anywhere under `design/`.

## Out of scope

SwiftUI (N13), React (N15). This node ships JSON only, and that is deliberate:
it is the shared contract both implementations are checked against.
