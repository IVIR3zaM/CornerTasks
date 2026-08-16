// Supertest-style pass over all six routes N07 wires up, against a real
// running server (adapter + router + SQLite store). Business-logic
// correctness (auth rules, LWW, archive cutoff, …) is backend/core's job and
// already covered there — these tests are about the server actually routing
// each endpoint to the right handler end to end.

import { startTestServer, type Harness } from './helpers/harness';
import { generateKeyPair, signDidJwt, type KeyPair } from './helpers/did-jwt';
import { randomUUID } from 'node:crypto';

let harness: Harness;

beforeEach(async () => {
  harness = await startTestServer();
});

afterEach(async () => {
  await harness.close();
});

async function authenticate(kp: KeyPair): Promise<string> {
  const chRes = await fetch(`${harness.baseUrl}/v1/auth/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountDid: kp.did })
  });
  expect(chRes.status).toBe(200);
  const { challenge, audience } = (await chRes.json()) as { challenge: string; audience: string };
  expect(audience).toBe(harness.audience);

  const didJwt = await signDidJwt({ kp, audience, challenge });
  const tkRes = await fetch(`${harness.baseUrl}/v1/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountDid: kp.did, didJwt })
  });
  expect(tkRes.status).toBe(200);
  const { accessToken } = (await tkRes.json()) as { accessToken: string };
  return accessToken;
}

function makeSyncEvent(accountDid: string, overrides: Partial<Record<string, string>> = {}) {
  return {
    accountDid,
    deviceId: randomUUID(),
    eventId: overrides.eventId ?? randomUUID(),
    taskId: overrides.taskId ?? randomUUID(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
    op: 'upsert' as const,
    ciphertext: Buffer.from('hello').toString('base64url'),
    nonce: Buffer.from('123456789012').toString('base64url')
  };
}

test('GET /v1/meta — unauthenticated, advertises rest transport and the configured audience', async () => {
  const res = await fetch(`${harness.baseUrl}/v1/meta`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { protocolVersions: number[]; transports: string[]; audience: string; wsUrl?: string };
  expect(body.protocolVersions).toEqual(expect.arrayContaining([2, 3]));
  expect(body.transports).toEqual(['rest']);
  expect(body.wsUrl).toBeUndefined();
  expect(body.audience).toBe(harness.audience);
});

test('GET /v1/health — unauthenticated, reports store health without leaking data', async () => {
  const res = await fetch(`${harness.baseUrl}/v1/health`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({ status: 'ok' });
});

test('POST /v1/auth/challenge — issues a challenge', async () => {
  const kp = await generateKeyPair(101);
  const res = await fetch(`${harness.baseUrl}/v1/auth/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountDid: kp.did })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { challenge: string; audience: string; expiresAt: string };
  expect(body.audience).toBe(harness.audience);
});

test('POST /v1/auth/token — exchanges a signed DID-JWT for a bearer token', async () => {
  const kp = await generateKeyPair(102);
  const accessToken = await authenticate(kp);
  expect(accessToken.split('.')).toHaveLength(3);
});

test('POST /v1/sync/push — accepts an authenticated upsert', async () => {
  const kp = await generateKeyPair(103);
  const accessToken = await authenticate(kp);
  const ev = makeSyncEvent(kp.did);
  const res = await fetch(`${harness.baseUrl}/v1/sync/push`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ accountDid: kp.did, events: [ev] })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { accepted: string[]; rejected: unknown[] };
  expect(body.accepted).toEqual([ev.eventId]);
  expect(body.rejected).toEqual([]);
});

test('GET /v1/sync/pull — returns a pushed event and a numeric nextCursor', async () => {
  const kp = await generateKeyPair(104);
  const accessToken = await authenticate(kp);
  const ev = makeSyncEvent(kp.did);
  await fetch(`${harness.baseUrl}/v1/sync/push`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ accountDid: kp.did, events: [ev] })
  });

  const res = await fetch(
    `${harness.baseUrl}/v1/sync/pull?accountDid=${encodeURIComponent(kp.did)}&cursor=0`,
    { headers: { authorization: `Bearer ${accessToken}` } }
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { events: { eventId: string }[]; nextCursor: string };
  expect(body.events.map((e) => e.eventId)).toEqual([ev.eventId]);
  expect(/^[0-9]+$/.test(body.nextCursor)).toBe(true);
});

test('GET /v1/sync/pull — 401 without a bearer token', async () => {
  const kp = await generateKeyPair(105);
  const res = await fetch(`${harness.baseUrl}/v1/sync/pull?accountDid=${encodeURIComponent(kp.did)}&cursor=0`);
  expect(res.status).toBe(401);
  const body = (await res.json()) as { reason: string };
  expect(body.reason).toBe('missing_token');
});

test('unknown route → 404', async () => {
  const res = await fetch(`${harness.baseUrl}/v1/nope`);
  expect(res.status).toBe(404);
});

test('POST /v1/sync/push with a body over 1 MB → 413', async () => {
  const oversized = 'x'.repeat(1024 * 1024 + 10);
  const res = await fetch(`${harness.baseUrl}/v1/sync/push`, { method: 'POST', body: oversized });
  expect(res.status).toBe(413);
});
