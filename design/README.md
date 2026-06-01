# CornerTasks — Design as Code

A declarative, platform-agnostic description of every screen in CornerTasks.
Think Terraform for UI: pure JSON for tokens, components, screens, and
per-platform overlays; a small validator confirms it all hangs together;
a static HTML previewer renders the merged output of every platform side
by side.

```
design/
├── tokens/                primitives.json + semantic.{light,dark}.json
├── components/            one JSON file per component (the catalog)
├── screens/               one JSON file per screen, tree of component nodes
├── text/                  externalized strings (i18n-ready)
├── actions.json           registry of every action id + value binding
├── fixtures/              preview-only sample data (populated + empty)
├── platforms/<name>/      platform.json + bindings.json + overlays/<screen>.json
├── schema/                strict JSON Schemas — unknown props fail
├── tools/
│   ├── validate/          node validate.mjs  → schemas + parity + impl cross-check
│   └── preview/           node generate.mjs  → preview/index.html
└── preview/               generated; open index.html directly
```

## Running it

```
make design-validate     # validates everything, prints a parity report
make design-preview      # regenerates design/preview/index.html
make design              # both
```

Both are plain `node` invocations (zero deps) wired into a top-level `Makefile`
because the repo has no monorepo task runner. Equivalent direct commands:
`node design/tools/validate/validate.mjs`, `node design/tools/preview/generate.mjs`.

## How it works

### Tokens

Two layers, both W3C DTCG-style:

- **Primitives** (`tokens/primitives.json`) — raw values: `color.blue.500`, `spacing.4`, `font.size.15`.
- **Semantic** (`tokens/semantic.light.json`, `semantic.dark.json`) — role-named tokens
  that *alias* primitives: `color.surface` → `{color.black-alpha.04}` in light,
  `{color.white-alpha.06}` in dark. Aliases use `{dot.path}` syntax. The validator
  resolves them and flags broken references.

Seed values are lifted directly from `apps/web/src/ui/styles.css` so existing
visuals don't change when a platform adopts the schema.

### Components

Each component declares its `props` (with `type`, `enum values`, `slot`, `default`,
`required`), whether it accepts children, and basic a11y metadata. Screens may
only reference components declared in this catalog — the validator rejects
unknown component names.

Prop `type`s:

| type      | meaning                                                          |
|-----------|------------------------------------------------------------------|
| `string`  | free-form string                                                 |
| `number`  | number                                                           |
| `boolean` | true/false                                                       |
| `enum`    | one-of (`values: [...]`)                                         |
| `token`   | must reference a token via `{dot.path}` — `slot` names the kind  |
| `textKey` | must reference a key in `text/en.json`                           |
| `array`   | array of objects (see `Select.options`)                          |

### Screens

A screen is a tree of nodes. Every node has:

- `id` — stable, dot-namespaced, unique within the merged tree (e.g. `settings.account.did.label`)
- `component` — name from the catalog
- `props` — validated against the component's `props` definition
- `children` — array of nodes (when the component allows it)

No raw colors, spacings, or strings appear anywhere in a screen — only token
refs (`"{color.surface}"`) and text keys (`"settings.cloud.enable"`).

### Per-platform overlays

A platform lives under `platforms/<name>/` with a `platform.json` manifest and
overlay files in `overlays/`. An overlay names the screen it modifies and a
list of ops. Three op kinds:

```json
{ "op": "hide",     "target": "<node-id>" }
{ "op": "insert",   "target": { "parent": "<id>", "position": "prepend"|"append", "before": "<id>", "after": "<id>" }, "node": { /* full node */ } }
{ "op": "override", "target": "<node-id>", "props": { /* props to merge */ } }
```

**Merge order is deterministic:** all `hide`s apply first, then all `insert`s
(in source order), then all `override`s. The validator and previewer share the
same merge function so what you see in the preview is what the validator
checked.

### Text

`text/en.json` is the only place strings live. Screens and components reference
keys; the previewer resolves them at render time. Adding another locale means
adding `text/<locale>.json` and the schema validates it the same way.

### Responsive hints

Components carry layout props (`axis`, `alignment`, `padding`, etc.) and may
expose explicit responsive props in the future (e.g. `breakpoint`). Native
platforms can ignore anything they don't need.

### Actions & bindings registry — schema ↔ implementation cross-check

`design/actions.json` is the single registry of:

- **Actions** — handler ids that `Button.action` references (`tasks.add`, `cloud.ping`, `debug.forceCrash`, …).
- **Bindings** — reactive state ids that `valueBinding`, `openBinding`, and `dataBinding` reference (`prefs.backendURL`, `account.did`, `tasks.active`, …). Each carries a `type` (`string`/`number`/`boolean`/`enum`/`image`/`list`) and a one-line description.

Each platform under `design/platforms/<name>/bindings.json` declares the actions and bindings *it implements*. The validator cross-checks:

- Every `action:`/`valueBinding:`/etc. in a merged tree must exist in `actions.json` (or the build fails).
- Every action/binding the merged tree uses on platform X must appear in X's `bindings.json` (or the build fails — this catches "added in schema, not wired in code").
- Anything declared in `bindings.json` but never used in any merged tree is reported as an `orphan` (warn, not fail — useful for spotting dead handlers after a screen is deleted).

This is the *contract* between the schema and the platform code: an agent or engineer cannot quietly let the two drift apart.

### Dynamic lists and fixtures

Lists are modeled by the `Repeat` component:

```json
{ "id": "tasks.list.items", "component": "Repeat",
  "props": { "dataBinding": "tasks.active", "emptyTextKey": "tasks.empty" },
  "children": [
    { "id": "tasks.list.row", "component": "TaskRow",
      "props": { "title": "{item.title}", "dueState": "{item.dueState}", ... } }
  ] }
```

Real apps map `Repeat` to their native list mechanism (`ForEach` / `.map()`). The previewer fills the list from a **fixture** — JSON files in `design/fixtures/` that provide preview-only sample data for list bindings (and scalar ones like `account.did`).

Two fixtures ship by default:

- **`sample.json`** — populated screens with rows that exercise every visual state (overdue, due today, due tomorrow, due future, no due date, completed). Pick this to verify what each variant looks like.
- **`empty.json`** — empty lists so the `emptyTextKey` empty-state renders.

The preview header has a `data` dropdown that switches between them live.

**When you add a new visual state to a row, extend `sample.json` with an item that exercises it.** Otherwise the previewer silently won't show what it looks like.

## Project adaptations

The spec calls out a few assumptions; here's how this repo's layout shaped
the result:

- **No top-level `package.json`.** Validator and previewer are pure-Node scripts
  with zero deps; a root `Makefile` exposes `make design-validate` /
  `make design-preview` so they're one command from anywhere.
- **`enable-cloud-sync` is modeled as a Sheet screen**, not a top-level page,
  because both apps render it as a modal dialog rather than navigating to it.
- **Tasks and Archive screens** are scaffolded with realistic structure
  (header / segmented control / add row / list) so future iterations can fill
  in the per-row component without restructuring. Per-task row components are
  not modeled yet — they require data binding semantics this version doesn't
  formalize.

## First deliverable: Settings vertical slice

`settings.json` is the complete base. The two overlays:

| platform | hides                | inserts                          | reason                                  |
|----------|----------------------|----------------------------------|-----------------------------------------|
| macos    | `settings.account.qr`| `settings.appearance` (Show in Dock toggle), `settings.debug` (log level, copy diagnostics, reset state, force crash) | privacy: macOS has no scanner/QR display; dock + debug are macOS-only capabilities |
| web      | —                    | `settings.account.qrScan` (QR-scan disclosure inside Account) | web has camera; can import an account from another device |

Run `make design-validate` for the live parity report.

## Adding a new platform (iOS, Android, Linux, ...)

1. **Create the directory:** `design/platforms/<name>/` with `overlays/`.
2. **Write the manifest:** `design/platforms/<name>/platform.json` — follow
   `platforms/macos/platform.json` for shape. Declare `capabilities` honestly
   (camera, dock, menuBar, ...); these are documentation today, but future
   tools can gate behavior on them.
3. **Decide which screens diverge.** If everything is identical to base, you
   can skip overlays entirely — the platform inherits the base tree as-is.
4. **Write overlays** for each divergent screen as `overlays/<screen-id>.json`.
   - Start from a `hide` for anything the platform shouldn't render.
   - Use `insert` with `position: prepend|append` or `before|after` to add
     platform-only nodes (each must have a unique `id`).
   - Use `override` to tweak a node's props in place — handy for swapping an
     `icon` or changing a `variant`.
5. **Run `make design-validate`.** Fix any unknown component / token / text-key
   reports. The parity report lists every change you just introduced.
6. **Run `make design-preview`.** A new frame appears in the preview for your
   platform; click around to confirm the structure is right.
7. **Wire the app side.** In your platform's source tree, read the merged tree
   (use the validator's merge logic as reference) and map each `component`
   name to a native view. The catalog's a11y metadata tells you the role to
   apply.

That's the full loop — schema first, validator green, preview confirms,
platform code consumes.
