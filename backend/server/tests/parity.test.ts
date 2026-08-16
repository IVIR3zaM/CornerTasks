// Parity test (N07 acceptance): the same request, run once through the real
// adapter (a live socket → node:http → buildEvent → router) and once as a
// hand-built `HttpEvent` fed directly to the same core handler Lambda would
// call, must produce an identical status and body. This is what proves the
// hand-rolled adapter doesn't silently diverge from what API Gateway would
// hand the handler.
//
// Read-only endpoints (meta, health, pull) are compared byte-for-byte: two
// calls against the same store state must be identical. `push` mutates
// state, so a literal replay would (correctly) reject the second copy as
// stale — instead we assert the two paths produce the same *shape* of
// response for equivalent input, which is what "the adapter doesn't diverge
// from a direct handler call" actually means for a write.

import type { HttpEvent } from '../../core/src/types/http';
import { handler as metaHandler } from '../src/handlers/meta';
import { handler as healthHandler } from '../src/handlers/health';
import { handler as pullHandler } from '../../core/src/handlers/pull';
import { handler as pushHandler } from '../../core/src/handlers/push';
import { startTestServer, type Harness } from './helpers/harness';
import { generateKeyPair, signDidJwt } from './helpers/did-jwt';
import { randomUUID } from 'node:crypto';

let harness: Harness;

beforeEach(async () => {
  harness = await startTestServer();
});

afterEach(async () => {
  await harness.close();
});

/** Hand-builds the `HttpEvent` a Lambda caller would construct for this
 *  request — independent of `src/adapter.ts` — so comparing against the
 *  adapter's real output is a meaningful cross-check, not a tautology. */
function handBuiltEvent(opts: {
  method: string;
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string;
}): HttpEvent {
  return {
    headers: { ...(opts.headers ?? {}) },
    queryStringParameters: { ...(opts.query ?? {}) },
    body: opts.body,
    requestContext: {
      domainName: harness.domain.domainName,
      stage: harness.domain.stage,
      http: { method: opts.method, path: opts.path }
    }
  };
}

test('parity: GET /v1/meta — adapter and direct handler call agree byte-for-byte', async () => {
  const viaAdapter = await fetch(`${harness.baseUrl}/v1/meta`);
  const adapterBody = await viaAdapter.text();

  const direct = await metaHandler(handBuiltEvent({ method: 'GET', path: '/v1/meta' }));

  expect(viaAdapter.status).toBe(direct.statusCode);
  expect(adapterBody).toBe(direct.body);
});

test('parity: GET /v1/health — adapter and direct handler call agree byte-for-byte', async () => {
  const viaAdapter = await fetch(`${harness.baseUrl}/v1/health`);
  const adapterBody = await viaAdapter.text();

  const direct = await healthHandler(handBuiltEvent({ method: 'GET', path: '/v1/health' }));

  expect(viaAdapter.status).toBe(direct.statusCode);
  expect(adapterBody).toBe(direct.body);
});

test('parity: GET /v1/sync/pull (authed, read-only) — adapter and direct handler call agree byte-for-byte', async () => {
  const kp = await generateKeyPair(201);

  // Authenticate and push one event, both via the real adapter path, so the
  // store has deterministic, known content before the parity comparison.
  const chRes = await fetch(`${harness.baseUrl}/v1/auth/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountDid: kp.did })
  });
  const { challenge, audience } = (await chRes.json()) as { challenge: string; audience: string };
  const didJwt = await signDidJwt({ kp, audience, challenge });
  const tkRes = await fetch(`${harness.baseUrl}/v1/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountDid: kp.did, didJwt })
  });
  const { accessToken } = (await tkRes.json()) as { accessToken: string };

  const ev = {
    accountDid: kp.did,
    deviceId: randomUUID(),
    eventId: randomUUID(),
    taskId: randomUUID(),
    updatedAt: new Date().toISOString(),
    op: 'upsert' as const,
    ciphertext: Buffer.from('hello').toString('base64url'),
    nonce: Buffer.from('123456789012').toString('base64url')
  };
  await fetch(`${harness.baseUrl}/v1/sync/push`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ accountDid: kp.did, events: [ev] })
  });

  // Now compare: the same pull, once through the real socket (adapter),
  // once as a hand-built event fed straight to the core handler. Pull is
  // read-only, so nothing changes between the two calls.
  const query = { accountDid: kp.did, cursor: '0' };
  const qs = new URLSearchParams(query).toString();

  const viaAdapter = await fetch(`${harness.baseUrl}/v1/sync/pull?${qs}`, {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  const adapterBody = await viaAdapter.text();

  const direct = await pullHandler(
    handBuiltEvent({
      method: 'GET',
      path: '/v1/sync/pull',
      query,
      headers: { authorization: `Bearer ${accessToken}` }
    })
  );

  expect(viaAdapter.status).toBe(200);
  expect(direct.statusCode).toBe(200);
  expect(viaAdapter.status).toBe(direct.statusCode);
  expect(adapterBody).toBe(direct.body);
  expect(JSON.parse(adapterBody).events).toHaveLength(1);
});

test('parity: POST /v1/sync/push — adapter and direct handler call agree on response shape', async () => {
  const kp = await generateKeyPair(202);
  const chRes = await fetch(`${harness.baseUrl}/v1/auth/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountDid: kp.did })
  });
  const { challenge, audience } = (await chRes.json()) as { challenge: string; audience: string };
  const didJwt = await signDidJwt({ kp, audience, challenge });
  const tkRes = await fetch(`${harness.baseUrl}/v1/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountDid: kp.did, didJwt })
  });
  const { accessToken } = (await tkRes.json()) as { accessToken: string };

  function eventPayload(eventId: string, taskId: string) {
    return {
      accountDid: kp.did,
      deviceId: randomUUID(),
      eventId,
      taskId,
      updatedAt: new Date().toISOString(),
      op: 'upsert' as const,
      ciphertext: Buffer.from('hello').toString('base64url'),
      nonce: Buffer.from('123456789012').toString('base64url')
    };
  }

  // Two structurally-identical but distinct events (a literal replay would
  // correctly be rejected as stale — see file header) — one pushed through
  // each path.
  const evA = eventPayload(randomUUID(), randomUUID());
  const evB = eventPayload(randomUUID(), randomUUID());

  const viaAdapter = await fetch(`${harness.baseUrl}/v1/sync/push`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ accountDid: kp.did, events: [evA] })
  });
  const adapterBody = (await viaAdapter.json()) as { accepted: string[]; rejected: unknown[] };

  const direct = await pushHandler(
    handBuiltEvent({
      method: 'POST',
      path: '/v1/sync/push',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ accountDid: kp.did, events: [evB] })
    })
  );
  const directBody = JSON.parse(direct.body!) as { accepted: string[]; rejected: unknown[] };

  expect(viaAdapter.status).toBe(direct.statusCode);
  expect(adapterBody.rejected).toEqual(directBody.rejected);
  expect(adapterBody.accepted).toEqual([evA.eventId]);
  expect(directBody.accepted).toEqual([evB.eventId]);
});
