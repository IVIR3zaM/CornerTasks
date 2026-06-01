#!/usr/bin/env node
// Generates design/preview/index.html — a single static file that renders every
// screen against every platform overlay, with side-by-side comparison, theme
// toggle, and node inspection. Re-uses the validator's overlay+walk logic by
// importing the same data shapes directly.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const OUT  = path.join(ROOT, 'preview', 'index.html');

const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const listJSON = (dir) =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, f)) : [];

// flatten tokens
function flat(obj, prefix = '', out = {}) {
  if (obj && typeof obj === 'object' && '$value' in obj) { out[prefix] = obj.$value; return out; }
  for (const [k, v] of Object.entries(obj || {})) {
    if (k.startsWith('$') || k === 'theme' || k === 'locale') continue;
    if (v && typeof v === 'object') flat(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}
function resolve(map, name, seen = new Set()) {
  if (seen.has(name)) return null;
  seen.add(name);
  const v = map[name];
  if (typeof v !== 'string') return v;
  const m = /^\{([^}]+)\}$/.exec(v);
  return m ? resolve(map, m[1], seen) : v;
}
function resolveTokenString(map, s) {
  if (typeof s !== 'string') return s;
  return s.replace(/\{([^}]+)\}/g, (_, ref) => resolve(map, ref) ?? `{${ref}}`);
}

const tokensAll = {};
for (const f of listJSON(path.join(ROOT, 'tokens'))) {
  const data = readJSON(f);
  const theme = data.theme || 'primitives';
  tokensAll[theme] = Object.assign(flat(data), tokensAll[theme] || {});
}
// primitives baseline shared between themes
const primitives = tokensAll.primitives || {};
const themes = {};
for (const [name, map] of Object.entries(tokensAll)) {
  if (name === 'primitives') continue;
  themes[name] = { ...primitives, ...map };
}

const components = {};
for (const f of listJSON(path.join(ROOT, 'components'))) {
  const c = readJSON(f); components[c.name] = c;
}
const screens = {};
for (const f of listJSON(path.join(ROOT, 'screens'))) {
  const s = readJSON(f); screens[s.id] = s;
}
const texts = {};
for (const f of listJSON(path.join(ROOT, 'text'))) {
  const t = readJSON(f); Object.assign(texts, t.strings);
}
// fixtures
const fixtures = {};
for (const f of listJSON(path.join(ROOT, 'fixtures'))) {
  const d = readJSON(f);
  if (d.name) fixtures[d.name] = d;
}

// icon registry (single source of truth for glyphs; macOS reads sfSymbol, web + preview read paths)
const iconsFile = path.join(ROOT, 'icons.json');
const iconsRegistry = fs.existsSync(iconsFile) ? readJSON(iconsFile) : { icons: {}, defaults: {}, viewBox: '0 0 24 24' };

const platforms = {};
const platformsDir = path.join(ROOT, 'platforms');
if (fs.existsSync(platformsDir)) {
  for (const name of fs.readdirSync(platformsDir)) {
    const mfPath = path.join(platformsDir, name, 'platform.json');
    if (!fs.existsSync(mfPath)) continue;
    const overlays = {};
    for (const of of listJSON(path.join(platformsDir, name, 'overlays'))) {
      const od = readJSON(of); overlays[od.screen] = od;
    }
    platforms[name] = { manifest: readJSON(mfPath), overlays };
  }
}

// overlay application (mirrors validator)
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function find(root, id) {
  if (root.id === id) return { node: root, parent: null, index: -1 };
  for (const ch of root.children || []) {
    if (ch.id === id) return { node: ch, parent: root, index: root.children.indexOf(ch) };
    const hit = find(ch, id);
    if (hit) return hit;
  }
  return null;
}
function applyOverlay(screen, overlay) {
  const out = clone(screen);
  const sources = new Map();
  const tag = (node, source) => {
    sources.set(node.id, source);
    for (const ch of node.children || []) tag(ch, source);
  };
  tag(out.root, 'base');
  for (const phase of [['hide'], ['insert'], ['override']]) {
    for (const op of overlay.ops.filter((o) => phase.includes(o.op))) {
      if (op.op === 'hide') {
        const h = find(out.root, op.target);
        if (h?.parent) h.parent.children.splice(h.index, 1);
      } else if (op.op === 'insert') {
        const h = find(out.root, op.target.parent);
        if (!h) continue;
        h.node.children = h.node.children || [];
        if (op.target.position === 'prepend')      h.node.children.unshift(op.node);
        else if (op.target.position === 'append')  h.node.children.push(op.node);
        else if (op.target.before) {
          const i = h.node.children.findIndex((c) => c.id === op.target.before);
          if (i >= 0) h.node.children.splice(i, 0, op.node);
        } else if (op.target.after) {
          const i = h.node.children.findIndex((c) => c.id === op.target.after);
          if (i >= 0) h.node.children.splice(i + 1, 0, op.node);
        } else h.node.children.push(op.node);
        tag(op.node, 'overlay');
      } else if (op.op === 'override') {
        const h = find(out.root, op.target);
        if (h) {
          h.node.props = { ...h.node.props, ...op.props };
          sources.set(h.node.id, 'override');
        }
      }
    }
  }
  return { tree: out, sources };
}

// Serialize everything needed for the browser. The HTML page does the actual
// rendering — that way theme switching and click-to-inspect happen client-side
// without us having to pre-render every combination.
const bundle = {
  themes,
  components,
  screens,
  texts,
  fixtures,
  icons: iconsRegistry,
  platforms: Object.fromEntries(
    Object.entries(platforms).map(([n, p]) => [n, { manifest: p.manifest }])
  ),
  merged: {}
};
for (const [pname, p] of Object.entries(platforms)) {
  bundle.merged[pname] = {};
  for (const [sid, screen] of Object.entries(screens)) {
    const overlay = p.overlays[sid];
    if (overlay) {
      const { tree, sources } = applyOverlay(screen, overlay);
      bundle.merged[pname][sid] = { tree, sources: Object.fromEntries(sources) };
    } else {
      const sources = {};
      (function tag(n) { sources[n.id] = 'base'; (n.children||[]).forEach(tag); })(screen.root);
      bundle.merged[pname][sid] = { tree: clone(screen), sources };
    }
  }
}

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>CornerTasks — design preview</title>
  <style>
    :root { color-scheme: light dark; --pg-bg: #1c1c1e; --pg-panel: #2c2c2e; --pg-text: #f2f2f7; --pg-muted: #8e8e93; }
    html, body { margin: 0; height: 100%; font-family: -apple-system, system-ui, sans-serif; background: var(--pg-bg); color: var(--pg-text); }
    header { display: flex; align-items: center; gap: 16px; padding: 12px 20px; border-bottom: 1px solid #333; background: #111; position: sticky; top: 0; z-index: 10; }
    header h1 { margin: 0; font-size: 16px; font-weight: 600; }
    header .grow { flex: 1; }
    header label { font-size: 12px; color: var(--pg-muted); display: flex; align-items: center; gap: 6px; }
    header select { font: inherit; padding: 4px 8px; border-radius: 6px; border: 1px solid #444; background: #222; color: var(--pg-text); }
    main { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding: 20px; }
    @media (max-width: 980px) { main { grid-template-columns: 1fr; } }
    .frame { background: var(--pg-panel); border-radius: 14px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.3); display: flex; flex-direction: column; }
    .frame-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: #1a1a1c; border-bottom: 1px solid #000; }
    .frame-head .name { font-weight: 600; }
    .frame-head .meta { font-size: 11px; color: var(--pg-muted); }
    .stage { padding: 16px; min-height: 480px; }
    .inspector { position: fixed; right: 16px; bottom: 16px; width: 360px; max-height: 60vh; overflow: auto; background: #111; border: 1px solid #333; border-radius: 10px; padding: 12px 14px; font-size: 12px; display: none; box-shadow: 0 6px 24px rgba(0,0,0,0.5); }
    .inspector.open { display: block; }
    .inspector h3 { margin: 0 0 6px; font-size: 13px; }
    .inspector code { background: #222; padding: 1px 4px; border-radius: 3px; }
    .inspector .src-base { color: #8ad; }
    .inspector .src-overlay { color: #fa6; }
    .inspector .src-override { color: #f88; }
    .inspector pre { white-space: pre-wrap; word-break: break-all; background: #000; padding: 6px; border-radius: 6px; max-height: 240px; overflow: auto; }

    /* node renderer styles. Every visual value is a token reference set per-stage
       in render(). Hex/px literals in this block are forbidden by the validator. */
    .dac-stage { background: var(--color\\.bg); color: var(--color\\.text); border-radius: var(--radius\\.xl); padding: var(--spacing\\.8); min-height: 440px; font-family: var(--font\\.family\\.system); }
    .dac-node { position: relative; cursor: pointer; }
    .dac-node:hover { outline: 1px dashed var(--color\\.accent); }
    .dac-node[data-src="overlay"]  { outline: 1px solid color-mix(in srgb, var(--color\\.due\\.tomorrow) 60%, transparent); }
    .dac-node[data-src="override"] { outline: 1px solid color-mix(in srgb, var(--color\\.danger) 60%, transparent); }
    .dac-stack-vertical   { display: flex; flex-direction: column; }
    .dac-stack-horizontal { display: flex; flex-direction: row; align-items: center; }
    .dac-section { background: var(--color\\.surface); border-radius: var(--radius\\.lg); padding: var(--spacing\\.6); }
    .dac-section h4 { margin: 0 0 var(--spacing\\.4); font-size: var(--font\\.size\\.13); font-weight: var(--font\\.weight\\.semibold); color: var(--color\\.text); }
    .dac-text     { line-height: 1.4; }
    .dac-text-title   { font-size: var(--font\\.size\\.22); font-weight: var(--font\\.weight\\.bold); }
    .dac-text-subtitle{ font-size: var(--font\\.size\\.12); color: var(--color\\.text-muted); }
    .dac-text-label   { font-size: var(--font\\.size\\.12); color: var(--color\\.text-muted); font-weight: var(--font\\.weight\\.medium); margin-top: var(--spacing\\.2); }
    .dac-text-caption { font-size: var(--font\\.size\\.10); color: var(--color\\.text-muted); text-align: center; }
    .dac-text-muted   { color: var(--color\\.text-muted); font-size: var(--font\\.size\\.12); }
    .dac-text-warn    { color: var(--color\\.danger); font-size: var(--font\\.size\\.12); }
    .dac-text-body    { font-size: var(--font\\.size\\.13); }
    .dac-button { font: inherit; border: 0; padding: var(--spacing\\.3) var(--spacing\\.6); border-radius: var(--radius\\.md); cursor: pointer; display: inline-flex; align-items: center; gap: var(--spacing\\.2); }
    .dac-button-primary    { background: var(--color\\.accent); color: var(--color\\.text-on-accent); }
    .dac-button-text       { background: transparent; color: var(--color\\.accent); }
    .dac-button-destructive{ background: transparent; color: var(--color\\.danger); }
    .dac-button-icon       { background: transparent; color: var(--color\\.text-muted); padding: var(--spacing\\.2) var(--spacing\\.3); }
    .dac-textfield { display: block; width: 100%; box-sizing: border-box; padding: var(--spacing\\.3) var(--spacing\\.4); font: inherit; background: var(--color\\.surface-strong); color: var(--color\\.text); border: 1px solid var(--color\\.border); border-radius: var(--radius\\.sm); }
    .dac-toggle  { display: flex; align-items: center; gap: var(--spacing\\.4); padding: var(--spacing\\.2) 0; font-size: var(--font\\.size\\.13); }
    .dac-toggle small { color: var(--color\\.text-muted); font-size: var(--font\\.size\\.10); display: block; margin-top: var(--spacing\\.1); }
    .dac-select  { font: inherit; padding: var(--spacing\\.2) var(--spacing\\.3); border-radius: var(--radius\\.sm); background: var(--color\\.surface-strong); color: var(--color\\.text); border: 1px solid var(--color\\.border); }
    .dac-codeblock { font-family: var(--font\\.family\\.mono); font-size: var(--font\\.size\\.10); background: var(--color\\.surface-strong); border-radius: var(--radius\\.sm); padding: var(--spacing\\.3) var(--spacing\\.4); word-break: break-all; }
    .dac-divider { height: 1px; background: var(--color\\.border); margin: var(--spacing\\.3) 0; }
    .dac-segmented { display: flex; background: var(--color\\.surface); padding: var(--spacing\\.1); border-radius: var(--radius\\.md); }
    .dac-segmented button { flex: 1; border: 0; padding: var(--spacing\\.2) var(--spacing\\.5); font: inherit; border-radius: var(--radius\\.sm); cursor: pointer; background: transparent; color: var(--color\\.text); }
    .dac-segmented button.active { background: var(--color\\.surface-strong); }
    .dac-disclosure summary { cursor: pointer; font-size: var(--font\\.size\\.13); padding: var(--spacing\\.2) 0; color: var(--color\\.accent); }
    .dac-icon { display: inline-flex; align-items: center; justify-content: center; width: 1.2em; height: 1.2em; color: var(--color\\.text-muted); }
    .dac-icon svg { width: 100%; height: 100%; }
    .dac-image { display: inline-block; border: 1px dashed var(--color\\.border); padding: var(--spacing\\.4); font-size: var(--font\\.size\\.10); color: var(--color\\.text-muted); border-radius: var(--radius\\.sm); }
    .dac-sheet { border: 1px solid var(--color\\.border); border-radius: var(--radius\\.lg); padding: var(--spacing\\.4); background: var(--color\\.surface); }
    .dac-spacer { flex: 1; }
    .dac-navbar { display: flex; align-items: flex-start; gap: var(--spacing\\.4); }
    .dac-navbar .titles { flex: 1; }
    .dac-debug-tag { background: var(--color\\.surface-strong); color: var(--color\\.text-muted); font-size: var(--font\\.size\\.10); padding: 1px var(--spacing\\.2); border-radius: var(--radius\\.sm); margin-left: var(--spacing\\.2); }

    .dac-task { background: var(--color\\.surface); border: 1px solid transparent; border-radius: var(--radius\\.xl); padding: var(--spacing\\.5) var(--spacing\\.6); margin-bottom: var(--spacing\\.4); }
    .dac-task.tint-overdue  { background: color-mix(in srgb, var(--color\\.due\\.overdue)  16%, transparent); border-color: color-mix(in srgb, var(--color\\.due\\.overdue)  50%, transparent); }
    .dac-task.tint-today    { background: color-mix(in srgb, var(--color\\.due\\.today)    16%, transparent); border-color: color-mix(in srgb, var(--color\\.due\\.today)    50%, transparent); }
    .dac-task.tint-tomorrow { background: color-mix(in srgb, var(--color\\.due\\.tomorrow) 14%, transparent); border-color: color-mix(in srgb, var(--color\\.due\\.tomorrow) 50%, transparent); }
    .dac-task-main { display: flex; align-items: center; gap: var(--spacing\\.5); }
    .dac-check { width: var(--spacing\\.10); height: var(--spacing\\.10); border-radius: 50%; border: 2px solid var(--color\\.text-muted); flex-shrink: 0; box-sizing: border-box; }
    .dac-check-done { width: var(--spacing\\.10); height: var(--spacing\\.10); border-radius: 50%; color: var(--color\\.text-muted); display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .dac-task-title { flex: 1; min-width: 0; font-weight: var(--font\\.weight\\.semibold); font-size: var(--font\\.size\\.15); word-break: break-word; }
    .dac-icon-slot { color: var(--color\\.text-muted); font-size: var(--font\\.size\\.13); opacity: 0.8; display: inline-flex; align-items: center; }
    .dac-icon-slot svg { width: 1em; height: 1em; }
    .dac-icon-slot.due-overdue  { color: var(--color\\.due\\.overdue);  opacity: 1; }
    .dac-icon-slot.due-today    { color: var(--color\\.due\\.today);    opacity: 1; }
    .dac-icon-slot.due-tomorrow { color: var(--color\\.due\\.tomorrow); opacity: 1; }
    .dac-icon-slot.due-future   { color: var(--color\\.due\\.future);   opacity: 1; }
    .dac-task-meta { display: flex; align-items: center; gap: var(--spacing\\.4); margin-top: var(--spacing\\.3); padding-left: var(--spacing\\.12); font-size: var(--font\\.size\\.12); color: var(--color\\.text-muted); }
    .dac-meta-chip { display: inline-flex; align-items: center; gap: var(--spacing\\.2); }
    .dac-meta-chip svg { width: 1em; height: 1em; }
    .dac-due-badge { font-size: var(--font\\.size\\.12); font-weight: var(--font\\.weight\\.semibold); padding: var(--spacing\\.1) var(--spacing\\.4); border-radius: var(--radius\\.pill); white-space: nowrap; margin-left: auto; color: var(--color\\.text-muted); background: var(--color\\.surface-strong); }
    .dac-due-badge.due-overdue  { color: var(--color\\.due\\.overdue);  background: color-mix(in srgb, var(--color\\.due\\.overdue)  20%, transparent); }
    .dac-due-badge.due-today    { color: var(--color\\.due\\.today);    background: color-mix(in srgb, var(--color\\.due\\.today)    20%, transparent); }
    .dac-due-badge.due-tomorrow { color: var(--color\\.due\\.tomorrow); background: color-mix(in srgb, var(--color\\.due\\.tomorrow) 20%, transparent); }
    .dac-due-badge.due-future   { color: var(--color\\.due\\.future);   background: color-mix(in srgb, var(--color\\.due\\.future)   20%, transparent); }
    .dac-debug-id { padding-left: var(--spacing\\.12); font-family: var(--font\\.family\\.mono); font-size: var(--font\\.size\\.10); color: var(--color\\.text-muted); opacity: 0.55; margin-top: var(--spacing\\.2); word-break: break-all; }
    .dac-archive-meta { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; margin-top: var(--spacing\\.3); padding-left: var(--spacing\\.12); font-size: var(--font\\.size\\.12); color: var(--color\\.text-muted); }
    .dac-archive-due { display: inline-flex; align-items: center; gap: var(--spacing\\.3); }
    .dac-archive-due .dac-due-badge { margin-left: 0; }
    .dac-empty { text-align: center; padding: var(--spacing\\.12) var(--spacing\\.8); color: var(--color\\.text-muted); font-size: var(--font\\.size\\.13); }
  </style>
</head>
<body>
  <header>
    <h1>CornerTasks design preview</h1>
    <label>screen <select id="screen-sel"></select></label>
    <label>theme  <select id="theme-sel"></select></label>
    <label>data   <select id="fixture-sel"></select></label>
    <span class="grow"></span>
    <span style="font-size:11px;color:var(--pg-muted)">click any node to inspect</span>
  </header>
  <main id="main"></main>
  <div id="inspector" class="inspector"></div>

  <script>
    const BUNDLE = ${JSON.stringify(bundle)};

    const $ = (id) => document.getElementById(id);
    const text = (k) => BUNDLE.texts[k] ?? '⟨' + k + '⟩';
    const tokenSlug = (s) => 'color.' + s.split('.').slice(1).join('.');

    // turn { axis: ..., spacing: ..., padding: ... } into inline style
    function styleFromProps(node) {
      const p = node.props || {}, s = {};
      if (p.spacing) s.gap = resolveDim(p.spacing);
      if (p.padding) s.padding = resolveDim(p.padding);
      if (p.background) s.background = resolveColor(p.background);
      if (p.radius)  s.borderRadius = resolveDim(p.radius);
      if (p.alignment) {
        const map = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch', baseline: 'baseline' };
        s.alignItems = map[p.alignment] || p.alignment;
      }
      if (p.justify) {
        const map = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between', around: 'space-around' };
        s.justifyContent = map[p.justify] || p.justify;
      }
      return s;
    }
    function resolveDim(v) {
      if (!v) return '';
      const m = /^\\{([^}]+)\\}$/.exec(v);
      if (m) return currentTheme[m[1]] ?? v;
      return v;
    }
    function resolveColor(v) {
      if (!v) return '';
      const m = /^\\{([^}]+)\\}$/.exec(v);
      if (m) return currentTheme[m[1]] ?? v;
      return v;
    }

    let currentTheme = {};
    let currentSources = {};
    let currentFixture = {};
    let currentItem = null;

    function resolveItemRef(v) {
      if (typeof v !== 'string') return v;
      const m = /^\\{item\\.([a-zA-Z0-9._-]+)\\}$/.exec(v);
      if (!m) return v;
      if (currentItem == null) return '';
      let cur = currentItem;
      for (const seg of m[1].split('.')) cur = cur?.[seg];
      return cur;
    }
    function rprops(node) {
      const out = {};
      for (const [k, v] of Object.entries(node.props || {})) out[k] = resolveItemRef(v);
      return out;
    }

    // Real apps render due badges as solid-color text on a 20%-alpha tint of the
    // same color. Match that by referencing the token via CSS color-mix() — no
    // resolved hex values appear in the renderer.
    function dueBadge(state, label) {
      const cls = 'dac-due-badge' + (state && state !== 'none' ? ' due-' + state : '');
      return el('span', { class: cls }, [label || state]);
    }

    // Build an inline SVG element from the icon registry. macOS resolves the same
    // entry to its sfSymbol; web resolves the same paths in its own component.
    function iconSvg(name, sizeEm = 1) {
      const def = (BUNDLE.icons.icons || {})[name];
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', BUNDLE.icons.viewBox || '0 0 24 24');
      svg.setAttribute('width', sizeEm + 'em');
      svg.setAttribute('height', sizeEm + 'em');
      svg.setAttribute('aria-hidden', 'true');
      const d = BUNDLE.icons.defaults || {};
      if (d.fill)            svg.setAttribute('fill', d.fill);
      if (d.stroke)          svg.setAttribute('stroke', d.stroke);
      if (d.strokeWidth)     svg.setAttribute('stroke-width', String(d.strokeWidth));
      if (d.strokeLinecap)   svg.setAttribute('stroke-linecap', d.strokeLinecap);
      if (d.strokeLinejoin)  svg.setAttribute('stroke-linejoin', d.strokeLinejoin);
      if (!def) {
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('x', '4'); t.setAttribute('y', '18'); t.setAttribute('font-size', '14');
        t.textContent = '?';
        svg.appendChild(t);
        return svg;
      }
      for (const p of def.paths || []) {
        const pe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pe.setAttribute('d', p.d);
        if (p.fill)        pe.setAttribute('fill', p.fill);
        if (p.stroke)      pe.setAttribute('stroke', p.stroke);
        if (p.strokeWidth) pe.setAttribute('stroke-width', String(p.strokeWidth));
        svg.appendChild(pe);
      }
      return svg;
    }
    function iconSpan(name, extraClass) {
      const s = el('span', { class: 'dac-icon-slot' + (extraClass ? ' ' + extraClass : ''), title: name });
      s.appendChild(iconSvg(name));
      return s;
    }

    function el(tag, attrs = {}, kids = []) {
      const e = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
        else if (k === 'class') e.className = v;
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else if (v === true) e.setAttribute(k, '');
        else if (v !== false && v != null) e.setAttribute(k, v);
      }
      for (const k of kids) if (k != null) e.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
      return e;
    }

    function renderNode(node) {
      const c = node.component;
      const p = node.props || {};
      const src = currentSources[node.id] || 'base';
      const wrap = (inner) => {
        inner.dataset.id = node.id;
        inner.dataset.src = src;
        inner.classList.add('dac-node');
        inner.addEventListener('click', (e) => { e.stopPropagation(); openInspector(node); });
        return inner;
      };
      const kids = (node.children || []).map(renderNode);

      switch (c) {
        case 'Stack': {
          const axis = p.axis || 'vertical';
          return wrap(el('div', { class: 'dac-stack-' + axis, style: styleFromProps(node) }, kids));
        }
        case 'Section': {
          const inner = [];
          if (p.titleKey) inner.push(el('h4', {}, [text(p.titleKey)]));
          inner.push(...kids);
          return wrap(el('div', { class: 'dac-section', style: styleFromProps(node) }, inner));
        }
        case 'Text': {
          const variant = p.variant || 'body';
          return wrap(el('div', { class: 'dac-text dac-text-' + variant, style: { textAlign: p.align || 'left' } }, [text(p.textKey)]));
        }
        case 'Button': {
          const variant = p.variant || 'text';
          return wrap(el('button', { class: 'dac-button dac-button-' + variant, disabled: !!p.disabled }, [text(p.labelKey)]));
        }
        case 'TextField': {
          const fv = currentFixture[p.valueBinding];
          return wrap(el('input', {
            class: 'dac-textfield',
            type: p.kind || 'text',
            value: fv != null ? String(fv) : '',
            placeholder: p.placeholderKey ? text(p.placeholderKey) : ''
          }));
        }
        case 'Toggle': {
          const inner = el('div', {}, [
            el('label', {}, [
              el('input', { type: 'checkbox' }),
              ' ' + text(p.labelKey)
            ])
          ]);
          if (p.helpKey) inner.appendChild(el('small', {}, [text(p.helpKey)]));
          return wrap(el('div', { class: 'dac-toggle' }, [inner]));
        }
        case 'Select': {
          const sel = el('select', { class: 'dac-select' },
            (p.options || []).map(o => el('option', { value: o.value }, [text(o.labelKey)]))
          );
          const label = p.labelKey ? el('label', {}, [text(p.labelKey), ' ', sel]) : sel;
          return wrap(el('div', {}, [label]));
        }
        case 'ListRow': {
          return wrap(el('div', { class: 'dac-section' }, [
            p.labelKey ? el('div', {}, [text(p.labelKey)]) : null,
            p.subtitleKey ? el('small', { class: 'dac-text-muted' }, [text(p.subtitleKey)]) : null,
            ...kids
          ]));
        }
        case 'Icon': {
          const wrapper = el('span', { class: 'dac-icon', title: p.name || '' });
          wrapper.appendChild(iconSvg(p.name));
          return wrap(wrapper);
        }
        case 'Divider': {
          return wrap(el('div', { class: 'dac-divider' }));
        }
        case 'ScrollView': {
          return wrap(el('div', { class: 'dac-stack-vertical', style: { overflow: 'auto', maxHeight: '600px', ...styleFromProps(node) } }, kids));
        }
        case 'NavBar': {
          return wrap(el('div', { class: 'dac-navbar' }, [
            el('div', { class: 'titles' }, [
              p.titleKey ? el('div', { class: 'dac-text-title' }, [text(p.titleKey)]) : null,
              p.subtitleKey ? el('div', { class: 'dac-text-subtitle' }, [text(p.subtitleKey)]) : null,
            ]),
            ...kids
          ]));
        }
        case 'SegmentedControl': {
          const btns = (p.options || []).map((o, i) => el('button', { class: i === 0 ? 'active' : '' }, [text(o.labelKey)]));
          return wrap(el('div', { class: 'dac-segmented' }, btns));
        }
        case 'CodeBlock': {
          const fv = p.valueBinding ? currentFixture[p.valueBinding] : null;
          const content = fv != null ? String(fv) : (p.valueBinding ? '⟨' + p.valueBinding + '⟩' : (p.textKey ? text(p.textKey) : ''));
          return wrap(el('div', { class: 'dac-codeblock' }, [content]));
        }
        case 'Disclosure': {
          const det = el('details', { class: 'dac-disclosure' }, [
            el('summary', {}, [text(p.summaryKey)]),
            ...kids
          ]);
          return wrap(det);
        }
        case 'Sheet': {
          return wrap(el('div', { class: 'dac-sheet' }, [
            el('div', { class: 'dac-text-label' }, ['Sheet: ' + text(p.titleKey)]),
            ...kids
          ]));
        }
        case 'Image': {
          return wrap(el('div', { class: 'dac-image' }, [p.valueBinding ? '⟨' + p.valueBinding + '⟩' : (p.src || 'image')]));
        }
        case 'Spacer': {
          return wrap(el('div', { class: 'dac-spacer' }));
        }
        case 'Repeat': {
          const items = (currentFixture[p.dataBinding] || []);
          if (items.length === 0) {
            const msg = p.emptyTextKey ? text(p.emptyTextKey) : '(empty)';
            return wrap(el('div', { class: 'dac-empty' }, [msg]));
          }
          const childTpl = (node.children || [])[0];
          if (!childTpl) return wrap(el('div', { class: 'dac-empty' }, ['(no row template)']));
          const out = el('div', {});
          for (let i = 0; i < items.length; i++) {
            const prev = currentItem;
            currentItem = items[i];
            const rendered = renderNode({ ...childTpl, id: childTpl.id + '#' + i });
            currentItem = prev;
            out.appendChild(rendered);
          }
          return wrap(out);
        }
        case 'TaskRow': {
          const rp = rprops(node);
          // Row tint applies only when due is concretely soon. Future falls
          // through to the neutral surface — matches real macOS rowFill.
          const tint = (rp.dueState && rp.dueState !== 'none' && rp.dueState !== 'future') ? ' tint-' + rp.dueState : '';
          // Due-date control icon takes on the dueState color (matches DueDateButton
          // on macOS: foregroundStyle(status.color)). 'none' falls through to muted.
          const dueIcon = iconSpan('calendar',
            (rp.dueState && rp.dueState !== 'none') ? 'due-' + rp.dueState : ''
          );
          const mainKids = [
            el('div', { class: 'dac-check', title: 'complete' }),
            el('div', { class: 'dac-task-title' }, [rp.title || '']),
            iconSpan('pencil'),
            dueIcon,
            iconSpan('drag'),
          ];
          const chip = el('span', { class: 'dac-meta-chip' });
          chip.appendChild(iconSvg('calendar'));
          chip.appendChild(document.createTextNode(' ' + (rp.createdAt || '')));
          const meta = [chip];
          if (rp.dueState && rp.dueState !== 'none') meta.push(dueBadge(rp.dueState, rp.dueLabel));
          const kids = [
            el('div', { class: 'dac-task-main' }, mainKids),
            el('div', { class: 'dac-task-meta' }, meta),
          ];
          if (rp.taskId) kids.push(el('div', { class: 'dac-debug-id', title: 'Task ID (debug)' }, [rp.taskId]));
          return wrap(el('div', { class: 'dac-task' + tint }, kids));
        }
        case 'ArchiveRow': {
          const rp = rprops(node);
          const done = el('span', { class: 'dac-check-done', title: 'archived' });
          done.appendChild(iconSvg('check-circle-fill'));
          const mainKids = [
            done,
            el('div', { class: 'dac-task-title' }, [rp.title || '']),
            iconSpan('trash'),
          ];
          const metaKids = [
            el('div', {}, ['Added: ' + (rp.createdAt || '')]),
            el('div', {}, ['Done: ' + (rp.completedAt || '—')]),
          ];
          if (rp.dueLabel) {
            metaKids.push(el('div', { class: 'dac-archive-due' }, [
              el('span', {}, ['Due:']),
              dueBadge(rp.dueState || 'future', rp.dueLabel)
            ]));
          }
          if (rp.taskId) metaKids.push(el('div', { class: 'dac-debug-id', style: { paddingLeft: '0' } }, [rp.taskId]));
          return wrap(el('div', { class: 'dac-task' }, [
            el('div', { class: 'dac-task-main' }, mainKids),
            el('div', { class: 'dac-archive-meta' }, metaKids)
          ]));
        }
        default:
          return wrap(el('div', { style: { border: '1px dashed red', padding: '4px' } }, ['unknown: ' + c]));
      }
    }

    function openInspector(node) {
      const ins = $('inspector');
      const src = currentSources[node.id] || 'base';
      ins.innerHTML = '';
      ins.appendChild(el('h3', {}, [node.id]));
      ins.appendChild(el('div', {}, [
        'component: ', el('code', {}, [node.component]),
        ' • source: ', el('span', { class: 'src-' + src }, [src])
      ]));
      ins.appendChild(el('pre', {}, [JSON.stringify(node.props || {}, null, 2)]));
      ins.classList.add('open');
    }
    document.body.addEventListener('click', (e) => {
      if (!e.target.closest('.dac-node') && !e.target.closest('#inspector')) $('inspector').classList.remove('open');
    });

    // populate selects
    const screenSel = $('screen-sel'); const themeSel = $('theme-sel'); const fixSel = $('fixture-sel');
    Object.keys(BUNDLE.merged[Object.keys(BUNDLE.merged)[0]] || {}).forEach(sid => {
      screenSel.appendChild(el('option', { value: sid }, [sid]));
    });
    Object.keys(BUNDLE.themes).forEach(t => {
      themeSel.appendChild(el('option', { value: t }, [t]));
    });
    Object.keys(BUNDLE.fixtures).forEach(n => {
      fixSel.appendChild(el('option', { value: n }, [n]));
    });

    function render() {
      const sid = screenSel.value;
      const theme = themeSel.value;
      const fix = fixSel.value;
      currentTheme = BUNDLE.themes[theme];
      currentFixture = (BUNDLE.fixtures[fix] && BUNDLE.fixtures[fix].data) || {};
      const main = $('main');
      main.innerHTML = '';
      for (const [pname, p] of Object.entries(BUNDLE.merged)) {
        const merged = p[sid];
        if (!merged) continue;
        const frame = el('div', { class: 'frame' });
        frame.appendChild(el('div', { class: 'frame-head' }, [
          el('span', { class: 'name' }, [BUNDLE.platforms[pname].manifest.displayName || pname]),
          el('span', { class: 'meta' }, [BUNDLE.platforms[pname].manifest.framework + ' • ' + sid])
        ]));
        const stage = el('div', { class: 'stage dac-stage' });
        // set CSS vars for the current theme on this stage
        for (const [k, v] of Object.entries(currentTheme)) {
          if (typeof v !== 'string') continue;
          let resolved = v;
          let guard = 0;
          while (/^\\{([^}]+)\\}$/.test(resolved) && guard++ < 8) {
            const m = /^\\{([^}]+)\\}$/.exec(resolved);
            resolved = currentTheme[m[1]] ?? resolved;
          }
          stage.style.setProperty('--' + k, resolved);
        }
        currentSources = merged.sources;
        stage.appendChild(renderNode(merged.tree.root));
        frame.appendChild(stage);
        main.appendChild(frame);
      }
    }
    screenSel.addEventListener('change', render);
    themeSel.addEventListener('change', render);
    fixSel.addEventListener('change', render);
    screenSel.value = 'tasks';
    themeSel.value = Object.keys(BUNDLE.themes).includes('dark') ? 'dark' : Object.keys(BUNDLE.themes)[0];
    fixSel.value   = Object.keys(BUNDLE.fixtures).includes('sample') ? 'sample' : Object.keys(BUNDLE.fixtures)[0];
    render();
  </script>
</body>
</html>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log('wrote ' + path.relative(process.cwd(), OUT));
