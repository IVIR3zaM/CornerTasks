#!/usr/bin/env node
// Prints the v0.3.0 build-graph state: per-node status and readiness.
// Readiness = status `todo` and every dependency `done`.
//
// Deliberately dependency-free (no yaml package) — the executor runs this on a
// clean clone before any npm install has happened.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GRAPH = join(ROOT, 'plan/v0.3.0/graph.yaml');

/** Minimal parser for the fixed shape this file uses: a `nodes:` list of
 *  `- id:` blocks with scalar `key: value` fields and a `deps: [A, B]` inline
 *  array. Anything else is out of contract on purpose. */
function parseGraph(text) {
  const nodes = [];
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const start = line.match(/^\s*-\s+id:\s*(\S+)/);
    if (start) {
      cur = { id: start[1], deps: [] };
      nodes.push(cur);
      continue;
    }
    if (!cur) continue;

    const kv = line.match(/^\s+(\w+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, rawVal] = kv;
    const val = rawVal.trim().replace(/^["']|["']$/g, '');
    if (key === 'deps') {
      cur.deps = val.replace(/^\[|\]$/g, '').split(',').map(s => s.trim()).filter(Boolean);
    } else {
      cur[key] = val;
    }
  }
  return nodes;
}

const nodes = parseGraph(readFileSync(GRAPH, 'utf8'));
const byId = new Map(nodes.map(n => [n.id, n]));

const missing = nodes.flatMap(n => n.deps.filter(d => !byId.has(d)).map(d => `${n.id} -> ${d}`));
if (missing.length) {
  console.error(`graph.yaml references unknown nodes: ${missing.join(', ')}`);
  process.exit(2);
}

const isDone = n => n.status === 'done';
const ready = n => n.status === 'todo' && n.deps.every(d => isDone(byId.get(d)));

const MARK = { done: '✓', in_progress: '·', blocked: '✗', todo: ' ' };
const width = Math.max(...nodes.map(n => n.title.length));

console.log(`\nCornerTasks v0.3.0 — build graph\n`);
for (const n of nodes) {
  const gate = n.gate === 'human' ? ' [human gate]' : '';
  const state = ready(n) ? 'READY' : n.status === 'todo' ? `waits on ${n.deps.filter(d => !isDone(byId.get(d))).join(',')}` : n.status;
  console.log(
    `  ${MARK[n.status] ?? '?'} ${n.id}  ${n.title.padEnd(width)}  ${(n.model ?? '').padEnd(6)}  ${state}${gate}`
  );
}

const readyNodes = nodes.filter(ready);
const auto = readyNodes.filter(n => n.gate !== 'human');
const done = nodes.filter(isDone).length;

console.log(`\n  ${done}/${nodes.length} done · ${readyNodes.length} ready (${auto.length} unattended, ${readyNodes.length - auto.length} gated)`);
if (nodes.some(n => n.status === 'blocked')) {
  console.log(`  blocked: ${nodes.filter(n => n.status === 'blocked').map(n => n.id).join(', ')} — see plan/v0.3.0/decisions.md`);
}
console.log();

// Machine-readable tail for the executor.
console.log(`READY_UNATTENDED=${auto.map(n => n.id).join(',')}`);
console.log(`READY_GATED=${readyNodes.filter(n => n.gate === 'human').map(n => n.id).join(',')}`);
