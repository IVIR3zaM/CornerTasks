#!/usr/bin/env node
// N02 oracle: docs/sync-protocol.md must fully specify the v3 WebSocket
// transport. Independent implementations (macOS N12, web N14, two backends
// N08/N10) are written from this document alone, so a gap here surfaces as an
// interop bug weeks later. Fail loudly on an incomplete spec.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const doc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../docs/sync-protocol.md'),
  'utf8'
);

const failures = [];
const need = (label, ok) => { if (!ok) failures.push(label); };

// Sections
for (const s of ['## 10.', '## 11.', '## 12.', '## 13.']) {
  need(`missing section ${s}`, doc.includes(s));
}

// Every frame type must be named AND appear inside a fenced JSON example.
const jsonBlocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map(m => m[1]);
const FRAMES = ['auth', 'auth_ok', 'auth_err', 'subscribe', 'events', 'live', 'push', 'push_ack', 'ping', 'pong'];
for (const f of FRAMES) {
  need(
    `frame "${f}" has no worked example`,
    jsonBlocks.some(b => new RegExp(`"type"\\s*:\\s*"${f}"`).test(b))
  );
}

// Negotiation endpoint and its required fields.
need('missing GET /v1/meta', doc.includes('/v1/meta'));
for (const k of ['protocolVersions', 'transports', 'wsUrl', 'audience']) {
  need(`/v1/meta field "${k}" not specified`, doc.includes(k));
}

// The rules most likely to be implemented wrongly. Each maps to a real defect:
// a dropped-event window, a sync gap on fallback, a thundering reconnect herd,
// and silent data loss on mobile Safari.
const RULES = [
  [/buffered and flushed\s*\n?\s*before `live`|buffered and flushed before `live`/i, 'drain-race rule (buffer events arriving mid-drain until `live`)'],
  [/stood down \*\*only\*\* on receipt of `live`|stood down\s+\*\*only\*\*/i, 'pull-timer rule (stand down only on `live`)'],
  [/full jitter/i, 'backoff jitter rule'],
  [/visibilitychange/i, 'tab-visibility handling'],
  [/never from a\s*\n?client-supplied field|never from a client-supplied field/i, 'account identity must come from the verified token'],
];
for (const [re, label] of RULES) need(`missing ${label}`, re.test(doc));

// Close codes must be enumerated with client actions.
for (const c of ['4401', '4403', '4408', '4429']) {
  need(`close code ${c} not documented`, doc.includes(c));
}

// Compatibility matrix — a v3 client against a v2 backend must be specified.
need('v3-client/v2-backend compatibility not stated', /v3\s*\|\s*v2/.test(doc));

if (failures.length) {
  console.error('FAIL — docs/sync-protocol.md is incomplete:');
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
console.log(`PASS — v3 transport fully specified (${FRAMES.length} frames, ${jsonBlocks.length} examples).`);
