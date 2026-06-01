#!/usr/bin/env node
// Design-as-code validator. Zero deps. Run with:  node design/tools/validate/validate.mjs
//
// Validates: tokens / components / screens / overlays / platform manifests against
// their JSON Schemas (using a tiny built-in validator that supports the subset we
// use), then resolves each platform's overlays onto base screens, walks the merged
// tree to confirm every component & token reference resolves, and prints a parity
// report comparing what each platform actually renders.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// ---------- tiny JSON Schema validator (subset: type / required / properties /
// additionalProperties: false / patternProperties / enum / oneOf / const /
// $ref to #/definitions/... / items / pattern) ----------
function loadSchema(file) {
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { schema: s, defs: s.definitions || {} };
}
function resolveRef(ref, defs) {
  const m = /^#\/definitions\/(.+)$/.exec(ref);
  if (!m) throw new Error('Unsupported $ref: ' + ref);
  return defs[m[1]];
}
function validate(data, schema, defs, errors, dataPath = '') {
  if (!schema) return;
  if (schema.$ref) return validate(data, resolveRef(schema.$ref, defs), defs, errors, dataPath);
  if (schema.oneOf) {
    const passing = schema.oneOf.filter((sub) => {
      const sub_errs = [];
      validate(data, sub, defs, sub_errs, dataPath);
      return sub_errs.length === 0;
    });
    if (passing.length !== 1) errors.push(`${dataPath}: must match exactly one of oneOf (${passing.length} matched)`);
    return;
  }
  if (schema.const !== undefined && data !== schema.const)
    errors.push(`${dataPath}: must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(data))
    errors.push(`${dataPath}: must be one of ${schema.enum.join(', ')} (got ${JSON.stringify(data)})`);

  const t = schema.type;
  if (t) {
    const types = Array.isArray(t) ? t : [t];
    const actual = Array.isArray(data) ? 'array' : data === null ? 'null' : typeof data;
    if (!types.includes(actual)) {
      errors.push(`${dataPath}: expected ${types.join('|')}, got ${actual}`);
      return;
    }
  }
  if (schema.pattern && typeof data === 'string') {
    if (!new RegExp(schema.pattern).test(data))
      errors.push(`${dataPath}: does not match /${schema.pattern}/`);
  }
  if (schema.type === 'array' && schema.items)
    data.forEach((it, i) => validate(it, schema.items, defs, errors, `${dataPath}[${i}]`));
  if (schema.type === 'object' || schema.properties || schema.additionalProperties === false || schema.patternProperties) {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return;
    for (const r of schema.required || []) {
      if (!(r in data)) errors.push(`${dataPath}: missing required '${r}'`);
    }
    for (const [k, v] of Object.entries(data)) {
      const sub = (schema.properties || {})[k];
      if (sub) { validate(v, sub, defs, errors, `${dataPath}.${k}`); continue; }
      let matched = false;
      for (const [pat, psch] of Object.entries(schema.patternProperties || {})) {
        if (new RegExp(pat).test(k)) {
          validate(v, psch, defs, errors, `${dataPath}.${k}`);
          matched = true;
          break;
        }
      }
      if (!matched && schema.additionalProperties === false) {
        errors.push(`${dataPath}: unknown property '${k}'`);
      } else if (!matched && typeof schema.additionalProperties === 'object') {
        validate(v, schema.additionalProperties, defs, errors, `${dataPath}.${k}`);
      }
    }
  }
}

// ---------- helpers ----------
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const listJSON = (dir) =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, f)) : [];

function flattenTokens(obj, prefix = '', out = {}) {
  if (obj && typeof obj === 'object' && '$value' in obj) {
    out[prefix] = obj.$value;
    return out;
  }
  for (const [k, v] of Object.entries(obj || {})) {
    if (k.startsWith('$') || k === 'theme' || k === 'locale') continue;
    if (v && typeof v === 'object') flattenTokens(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}
function tokenRefs(s) {
  if (typeof s !== 'string') return [];
  return [...s.matchAll(/\{([a-zA-Z0-9._-]+)\}/g)].map((m) => m[1]);
}

// ---------- load schemas ----------
const schemas = {
  tokens:    loadSchema(path.join(ROOT, 'schema', 'tokens.schema.json')),
  component: loadSchema(path.join(ROOT, 'schema', 'component.schema.json')),
  screen:    loadSchema(path.join(ROOT, 'schema', 'screen.schema.json')),
  overlay:   loadSchema(path.join(ROOT, 'schema', 'overlay.schema.json')),
  platform:  loadSchema(path.join(ROOT, 'schema', 'platform.schema.json')),
  text:      loadSchema(path.join(ROOT, 'schema', 'text.schema.json')),
  actions:   loadSchema(path.join(ROOT, 'schema', 'actions.schema.json')),
  bindings:  loadSchema(path.join(ROOT, 'schema', 'bindings.schema.json')),
  fixtures:  loadSchema(path.join(ROOT, 'schema', 'fixtures.schema.json')),
};

const isItemRef = (s) => typeof s === 'string' && /^\{item\.[a-zA-Z0-9._-]+\}$/.test(s);

const errors = [];
const report = { tokens: [], components: [], screens: [], platforms: [], parity: {} };

// ---------- tokens ----------
const tokenFiles = listJSON(path.join(ROOT, 'tokens'));
const tokenMap = {};
for (const f of tokenFiles) {
  const data = readJSON(f);
  const e = [];
  validate(data, schemas.tokens.schema, schemas.tokens.defs, e, path.basename(f));
  errors.push(...e);
  Object.assign(tokenMap, flattenTokens(data));
  report.tokens.push(path.basename(f));
}
// resolve aliases
function resolveToken(name, seen = new Set()) {
  if (seen.has(name)) return null;
  seen.add(name);
  const v = tokenMap[name];
  if (typeof v !== 'string') return v;
  const ref = tokenRefs(v);
  if (ref.length === 0) return v;
  return resolveToken(ref[0], seen);
}
const allTokenNames = new Set(Object.keys(tokenMap));
for (const [k, v] of Object.entries(tokenMap)) {
  for (const ref of tokenRefs(v)) {
    if (!allTokenNames.has(ref)) errors.push(`tokens: ${k} references missing token {${ref}}`);
  }
}

// ---------- components ----------
const components = {};
for (const f of listJSON(path.join(ROOT, 'components'))) {
  const data = readJSON(f);
  const e = [];
  validate(data, schemas.component.schema, schemas.component.defs, e, path.basename(f));
  errors.push(...e);
  if (data.name) components[data.name] = data;
  report.components.push(data.name || path.basename(f));
}

// ---------- text ----------
const textFiles = listJSON(path.join(ROOT, 'text'));
const textKeys = new Set();
for (const f of textFiles) {
  const data = readJSON(f);
  const e = [];
  validate(data, schemas.text.schema, schemas.text.defs, e, path.basename(f));
  errors.push(...e);
  for (const k of Object.keys(data.strings || {})) textKeys.add(k);
}

// ---------- actions + bindings registry ----------
let registry = { actions: {}, bindings: {} };
const regPath = path.join(ROOT, 'actions.json');
if (fs.existsSync(regPath)) {
  const data = readJSON(regPath);
  const e = [];
  validate(data, schemas.actions.schema, schemas.actions.defs, e, 'actions.json');
  errors.push(...e);
  registry = { actions: data.actions || {}, bindings: data.bindings || {} };
} else {
  errors.push('actions.json: missing registry file');
}
const knownActions  = new Set(Object.keys(registry.actions));
const knownBindings = new Set(Object.keys(registry.bindings));

// ---------- fixtures ----------
const fixtures = {};
for (const f of listJSON(path.join(ROOT, 'fixtures'))) {
  const data = readJSON(f);
  const e = [];
  validate(data, schemas.fixtures.schema, schemas.fixtures.defs, e, 'fixtures/' + path.basename(f));
  errors.push(...e);
  if (data.name) fixtures[data.name] = data;
  // Each key in fixture.data must be a known binding.
  for (const k of Object.keys(data.data || {})) {
    if (!knownBindings.has(k)) errors.push(`fixtures/${path.basename(f)}: '${k}' is not a registered binding`);
  }
}

// ---------- screens ----------
const screens = {};
for (const f of listJSON(path.join(ROOT, 'screens'))) {
  const data = readJSON(f);
  const e = [];
  validate(data, schemas.screen.schema, schemas.screen.defs, e, path.basename(f));
  errors.push(...e);
  if (data.id) screens[data.id] = data;
  report.screens.push(data.id || path.basename(f));
}

// ---------- platforms + overlays ----------
const platformsDir = path.join(ROOT, 'platforms');
const platforms = {};
if (fs.existsSync(platformsDir)) {
  for (const name of fs.readdirSync(platformsDir)) {
    const mfPath = path.join(platformsDir, name, 'platform.json');
    if (!fs.existsSync(mfPath)) continue;
    const mf = readJSON(mfPath);
    const e = [];
    validate(mf, schemas.platform.schema, schemas.platform.defs, e, `${name}/platform.json`);
    errors.push(...e);
    const overlays = {};
    for (const of of listJSON(path.join(platformsDir, name, 'overlays'))) {
      const od = readJSON(of);
      const oe = [];
      validate(od, schemas.overlay.schema, schemas.overlay.defs, oe, `${name}/overlays/${path.basename(of)}`);
      errors.push(...oe);
      overlays[od.screen] = od;
    }
    let bindings = null;
    const bpath = path.join(platformsDir, name, 'bindings.json');
    if (fs.existsSync(bpath)) {
      const bd = readJSON(bpath);
      const be = [];
      validate(bd, schemas.bindings.schema, schemas.bindings.defs, be, `${name}/bindings.json`);
      errors.push(...be);
      for (const a of bd.implements?.actions  || []) if (!knownActions.has(a))  errors.push(`${name}/bindings.json: implements unknown action '${a}'`);
      for (const b of bd.implements?.bindings || []) if (!knownBindings.has(b)) errors.push(`${name}/bindings.json: implements unknown binding '${b}'`);
      bindings = bd;
    } else {
      errors.push(`${name}: missing bindings.json (declare which actions/bindings this platform implements)`);
    }
    platforms[name] = { manifest: mf, overlays, bindings };
    report.platforms.push(name);
  }
}

// ---------- overlay application (deterministic) ----------
function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
function findNode(root, id) {
  if (root.id === id) return { node: root, parent: null, index: -1 };
  for (const ch of root.children || []) {
    if (ch.id === id) return { node: ch, parent: root, index: root.children.indexOf(ch) };
    const hit = findNode(ch, id);
    if (hit) return hit;
  }
  return null;
}
function applyOverlay(screen, overlay) {
  const out = deepClone(screen);
  // Order: hide → insert → override. Within a phase, source order.
  const phases = [['hide'], ['insert'], ['override']];
  for (const phase of phases) {
    for (const op of overlay.ops.filter((o) => phase.includes(o.op))) {
      if (op.op === 'hide') {
        const hit = findNode(out.root, op.target);
        if (!hit) { errors.push(`overlay ${overlay.screen}: hide target '${op.target}' not found`); continue; }
        if (!hit.parent) { errors.push(`overlay ${overlay.screen}: cannot hide root '${op.target}'`); continue; }
        hit.parent.children.splice(hit.index, 1);
      } else if (op.op === 'insert') {
        const hit = findNode(out.root, op.target.parent);
        if (!hit) { errors.push(`overlay ${overlay.screen}: insert parent '${op.target.parent}' not found`); continue; }
        hit.node.children = hit.node.children || [];
        if (op.target.position === 'prepend')      hit.node.children.unshift(op.node);
        else if (op.target.position === 'append')  hit.node.children.push(op.node);
        else if (op.target.before) {
          const i = hit.node.children.findIndex((c) => c.id === op.target.before);
          if (i < 0) { errors.push(`overlay ${overlay.screen}: insert before '${op.target.before}' not found`); continue; }
          hit.node.children.splice(i, 0, op.node);
        } else if (op.target.after) {
          const i = hit.node.children.findIndex((c) => c.id === op.target.after);
          if (i < 0) { errors.push(`overlay ${overlay.screen}: insert after '${op.target.after}' not found`); continue; }
          hit.node.children.splice(i + 1, 0, op.node);
        } else hit.node.children.push(op.node);
      } else if (op.op === 'override') {
        const hit = findNode(out.root, op.target);
        if (!hit) { errors.push(`overlay ${overlay.screen}: override target '${op.target}' not found`); continue; }
        hit.node.props = { ...hit.node.props, ...op.props };
      }
    }
  }
  return out;
}

// ---------- walk merged trees: component types, token refs, text keys ----------
function walk(node, ctx) {
  ctx.ids.push(node.id);
  const cdef = components[node.component];
  if (!cdef) { errors.push(`${ctx.where}: unknown component '${node.component}' on '${node.id}'`); return; }
  for (const [pk, pv] of Object.entries(node.props || {})) {
    const def = cdef.props?.[pk];
    if (!def) { errors.push(`${ctx.where}: '${node.id}' has unknown prop '${pk}' for ${cdef.name}`); continue; }
    // Inside a Repeat, child props may be item-bindings like "{item.title}".
    // These are bound at render time from the parent's dataBinding; skip the
    // strict type check for them.
    if (isItemRef(pv)) continue;
    if (def.type === 'textKey' && typeof pv === 'string' && !textKeys.has(pv))
      errors.push(`${ctx.where}: '${node.id}'.${pk} references unknown text key '${pv}'`);
    if (def.type === 'token' && typeof pv === 'string') {
      for (const r of tokenRefs(pv)) {
        if (!allTokenNames.has(r)) errors.push(`${ctx.where}: '${node.id}'.${pk} references unknown token {${r}}`);
      }
    }
    if (def.type === 'enum' && !def.values.includes(pv))
      errors.push(`${ctx.where}: '${node.id}'.${pk}=${JSON.stringify(pv)} not in ${def.values.join(',')}`);

    // Track action / binding usage.
    if (pk === 'action' && typeof pv === 'string') {
      ctx.actions.add(pv);
      if (!knownActions.has(pv)) errors.push(`${ctx.where}: '${node.id}'.action references unknown action '${pv}' (add to actions.json)`);
    }
    if ((pk === 'valueBinding' || pk === 'openBinding' || pk === 'dataBinding') && typeof pv === 'string') {
      ctx.bindings.add(pv);
      if (!knownBindings.has(pv)) errors.push(`${ctx.where}: '${node.id}'.${pk} references unknown binding '${pv}' (add to actions.json)`);
    }
  }
  for (const ch of node.children || []) walk(ch, ctx);
}

const baseIds = {};
for (const [sid, screen] of Object.entries(screens)) {
  const ctx = { where: `screen ${sid} (base)`, ids: [], actions: new Set(), bindings: new Set() };
  walk(screen.root, ctx);
  baseIds[sid] = new Set(ctx.ids);
}

// parity report + per-platform usage capture
const platformUsage = {};
for (const [pname, p] of Object.entries(platforms)) {
  report.parity[pname] = {};
  platformUsage[pname] = { actions: new Set(), bindings: new Set() };
  for (const [sid, screen] of Object.entries(screens)) {
    const overlay = p.overlays[sid];
    const merged = overlay ? applyOverlay(screen, overlay) : deepClone(screen);
    const ctx = { where: `screen ${sid} (${pname})`, ids: [], actions: new Set(), bindings: new Set() };
    walk(merged.root, ctx);
    for (const a of ctx.actions)  platformUsage[pname].actions.add(a);
    for (const b of ctx.bindings) platformUsage[pname].bindings.add(b);
    const mergedIds = new Set(ctx.ids);
    const hidden = [...baseIds[sid]].filter((i) => !mergedIds.has(i));
    const added  = [...mergedIds].filter((i) => !baseIds[sid].has(i));
    const overridden = (overlay?.ops || []).filter((o) => o.op === 'override').map((o) => o.target);
    report.parity[pname][sid] = { hidden, added, overridden };
  }
}

// ---------- Level-1 cross-check: schema ↔ platform implementation ----------
const impl = {};
report.implementation = {};
for (const [pname, p] of Object.entries(platforms)) {
  if (!p.bindings) continue;
  const claimedA = new Set(p.bindings.implements?.actions  || []);
  const claimedB = new Set(p.bindings.implements?.bindings || []);
  const usedA = platformUsage[pname].actions;
  const usedB = platformUsage[pname].bindings;
  const missingA = [...usedA].filter((a) => !claimedA.has(a));
  const missingB = [...usedB].filter((b) => !claimedB.has(b));
  const orphanA  = [...claimedA].filter((a) => !usedA.has(a));
  const orphanB  = [...claimedB].filter((b) => !usedB.has(b));
  for (const a of missingA) errors.push(`platform ${pname}: schema uses action '${a}' but ${pname}/bindings.json does not implement it`);
  for (const b of missingB) errors.push(`platform ${pname}: schema uses binding '${b}' but ${pname}/bindings.json does not implement it`);
  report.implementation[pname] = {
    actions: { used: usedA.size, claimed: claimedA.size, missing: missingA, orphan: orphanA },
    bindings:{ used: usedB.size, claimed: claimedB.size, missing: missingB, orphan: orphanB },
  };
  impl[pname] = { missingA, missingB, orphanA, orphanB };
}

// orphan actions / bindings (registered but not used by any platform)
const allUsedActions  = new Set(Object.values(platformUsage).flatMap((u) => [...u.actions]));
const allUsedBindings = new Set(Object.values(platformUsage).flatMap((u) => [...u.bindings]));
report.unusedActions  = [...knownActions].filter((a) => !allUsedActions.has(a));
report.unusedBindings = [...knownBindings].filter((b) => !allUsedBindings.has(b));

// ---------- output ----------
console.log('design-as-code validator');
console.log('========================');
console.log(`tokens:     ${report.tokens.length} file(s)  (${Object.keys(tokenMap).length} leaves)`);
console.log(`components: ${report.components.length} (${report.components.join(', ')})`);
console.log(`text keys:  ${textKeys.size}`);
console.log(`screens:    ${report.screens.length} (${report.screens.join(', ')})`);
console.log(`platforms:  ${report.platforms.length} (${report.platforms.join(', ')})`);
console.log(`actions:    ${Object.keys(registry.actions).length} registered`);
console.log(`bindings:   ${Object.keys(registry.bindings).length} registered`);
console.log('');
console.log('parity report');
console.log('-------------');
for (const [pname, screens] of Object.entries(report.parity)) {
  console.log(`[${pname}]`);
  for (const [sid, diff] of Object.entries(screens)) {
    const parts = [];
    if (diff.hidden.length)     parts.push(`hidden=${diff.hidden.length} (${diff.hidden.join(',')})`);
    if (diff.added.length)      parts.push(`added=${diff.added.length} (${diff.added.join(',')})`);
    if (diff.overridden.length) parts.push(`override=${diff.overridden.length}`);
    console.log(`  ${sid}: ${parts.length ? parts.join('  ') : '(identical to base)'}`);
  }
}

console.log('');
console.log('implementation cross-check');
console.log('--------------------------');
for (const [pname, r] of Object.entries(report.implementation || {})) {
  console.log(`[${pname}]`);
  console.log(`  actions:  used=${r.actions.used}  claimed=${r.actions.claimed}  missing=${r.actions.missing.length}  orphan=${r.actions.orphan.length}${r.actions.orphan.length ? ' (' + r.actions.orphan.join(',') + ')' : ''}`);
  console.log(`  bindings: used=${r.bindings.used} claimed=${r.bindings.claimed} missing=${r.bindings.missing.length}  orphan=${r.bindings.orphan.length}${r.bindings.orphan.length ? ' (' + r.bindings.orphan.join(',') + ')' : ''}`);
}
if (report.unusedActions?.length)  console.log(`  registry orphans (actions never used by any platform):  ${report.unusedActions.join(', ')}`);
if (report.unusedBindings?.length) console.log(`  registry orphans (bindings never used by any platform): ${report.unusedBindings.join(', ')}`);

console.log('');
if (errors.length === 0) {
  console.log('OK — 0 errors');
  process.exit(0);
}
console.log(`FAIL — ${errors.length} error(s):`);
for (const e of errors) console.log('  - ' + e);
process.exit(1);
