---
name: ct-design-change
description: The design-as-code workflow for CornerTasks — required for any change that touches something visible (a screen, component, string, colour, or per-platform difference). Encodes the hard rules enforced by `make design-validate` and the mandatory JSON-before-code order. Use before editing SwiftUI or React for any UI change.
---

# Design-as-code workflow

`design/` is the single source of truth for UI **structure**. App code
implements it; it never leads. A UI change that starts in SwiftUI or React is
being done backwards and the validator will reject it.

Full detail lives in `AGENTS.md` (§ Design schema). This skill is the operating
procedure.

## Order — not negotiable

1. **JSON first.** Add the text key, the token, the component, the node, the
   binding, the overlay — whatever the change needs, under `design/`.
2. **`make design-validate`** until it exits 0. Read the parity report; it is
   the complete list of per-platform divergences.
3. **`make design-preview`**, open `design/preview/index.html`, click through
   the affected screens on **both** platforms.
4. **Then** implement in `apps/macos/` (SwiftUI) and `apps/web/` (React). Both
   must match the merged tree.
5. **One PR.** Never merge a schema-only or code-only half of a UI change.

## The rules that actually catch people

- **No literal colours, spacings, or font sizes in a screen.** Token refs only:
  `"{color.surface}"`, `"{spacing.6}"`.
- **No literal user-facing strings.** Key in `design/text/en.json`, referenced.
- **No component that isn't in `design/components/`.** Define it first.
- **Every node needs a stable, unique, dot-namespaced `id`.** Overlays target
  ids — renaming one is a breaking change. Choose deliberately.
- **Every platform difference is an overlay op.** Never model a divergence by
  writing different code on each platform. If macOS hovers and web taps, that
  is an overlay, declared.
- **Every action and binding must be registered** in `design/actions.json` and
  listed in each `design/platforms/<name>/bindings.json`. This is what catches
  "added a control in the schema, forgot to wire it".
- **Every enum value on a state-driven visual prop needs a token mapping.**
  Adding a state without its `color.<group>.<value>` token fails validation.
  Relevant to `ConnectionStatus.state` and `TaskRow.dueState`.
- **No literal colours or px inside `.dac-*` CSS** in
  `design/tools/preview/generate.mjs` — the previewer consumes `var(--…)`.

## Adding a state-driven component

The order that avoids rework:

1. Semantic tokens for every enum value, in **both** light and dark files.
2. Component JSON with the enum prop.
3. Text keys for every phrase, with `{placeholders}`.
4. Screen node with its final id.
5. Bindings registered per platform.
6. Validate, preview, then code.

## Before you finish

`make design-validate` green, previewed on both platforms, and the parity
report contains only divergences you intended.
