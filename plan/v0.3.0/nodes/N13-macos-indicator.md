---
id: N13
title: macOS connection-status indicator
model: sonnet
deps: [N11, N12]
---

## Goal

Render the N03 states in the macOS app, matching the N11 schema exactly.

## Deliverables

- `apps/macos/Sources/CornerTasks/UI/ConnectionStatusView.swift` — bound to
  `SyncEngine.connectionState` from N12. Colours come from the design tokens'
  Swift representation, never literals; strings come from the text keys.
- Mounted at the head of the cloud-sync section in `ContentView` /
  `CloudSyncSection.swift`, at the node id the N11 schema declares.
- Pulse animation for the pulsing states; respect Reduce Motion.
- Failure detail on hover.
- **Debug menu affordance to force each state** — this is how the N17
  cross-platform screenshot comparison gets done without staging real network
  failures.

## Acceptance

- `cd apps/macos && swift test` — state-transition tests over the mapping from
  engine state to rendered state, including precedence and minimum dwell time
  from N03.
- Every state reachable from the debug menu; screenshot each for N17.
- `make design-validate` still green (no schema drift introduced here).

## Out of scope

Web (N15). Settings restructuring beyond inserting the indicator.
