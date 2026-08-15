---
id: N15
title: Web connection-status indicator
model: sonnet
deps: [N11, N14]
---

## Goal

The N13 component in React, from the same N11 schema, so the two apps read as
one product.

## Deliverables

- `apps/web/src/ui/ConnectionStatus.tsx` — bound to the engine state from N14.
  CSS custom properties from the design tokens; no literal colours. Strings
  from the text keys.
- Mounted at the head of the cloud section in `SettingsPanel.tsx`, at the node
  id N11 declares.
- Pulse via CSS animation; honour `prefers-reduced-motion`.
- Failure detail on tap (touch has no hover — this is a real divergence from
  macOS; if it changes the node tree, it must be an overlay op per hard rule 5,
  not a silent code difference).
- `?connState=` URL parameter to force each state, for the N17 comparison.

## Acceptance

- `cd apps/web && npm test` — Testing Library matrix over every state,
  precedence, and dwell time.
- Every state reachable via the URL parameter; screenshot each for N17.
- `make design-validate` green, and the parity report shows only the
  hover-vs-tap divergence, declared as an overlay.

## Out of scope

Settings restructuring beyond inserting the indicator.
