// Reproduces docs/sync-protocol.md §9 end to end (challenge → token → push
// upsert → push delete → pull) against a running instance of this server,
// with only the base URL changed from the doc's `$ApiUrl` placeholder — the
// N07 acceptance bullet asks for exactly this.

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

test('§9 worked example: challenge → token → push (upsert + delete) → pull', async () => {
  const ApiUrl = harness.baseUrl;
  const kp = await generateKeyPair(301);

  // Step 1 — challenge
  const challengeResp = await fetch(`${ApiUrl}/v1/auth/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountDid: kp.did })
  });
  expect(challengeResp.status).toBe(200);
  const { challenge, audience, expiresAt } = (await challengeResp.json()) as {
    challenge: string;
    audience: string;
    expiresAt: string;
  };
  expect(Buffer.from(challenge, 'base64url').length).toBe(32);
  expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());

  // Step 2 — sign a DID-JWT and exchange it for an access token (in the repo
  // this is backend/aws/scripts/sign-did-jwt.ts; here, the equivalent
  // in-process helper).
  const didJwt = await signDidJwt({ kp, audience, challenge });
  const tokenResp = await fetch(`${ApiUrl}/v1/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountDid: kp.did, didJwt })
  });
  expect(tokenResp.status).toBe(200);
  const { accessToken, tokenType } = (await tokenResp.json()) as { accessToken: string; tokenType: string };
  expect(tokenType).toBe('Bearer');

  // §9.1 — Upsert
  const taskId = randomUUID();
  const upsertEventId = randomUUID();
  const upsertEvent = {
    accountDid: kp.did,
    deviceId: randomUUID(),
    eventId: upsertEventId,
    taskId,
    updatedAt: '2026-05-05T17:42:11.000Z',
    op: 'upsert' as const,
    nonce: 'vN3p4Lq2RkX9aZbC1234',
    ciphertext: Buffer.from('encrypted-task-payload').toString('base64url')
  };
  const upsertResp = await fetch(`${ApiUrl}/v1/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ accountDid: kp.did, events: [upsertEvent] })
  });
  expect(upsertResp.status).toBe(200);
  const upsertBody = (await upsertResp.json()) as { accepted: string[]; rejected: unknown[] };
  expect(upsertBody).toEqual({ accepted: [upsertEventId], rejected: [] });

  // §9.2 — Delete
  const deleteEventId = randomUUID();
  const deleteEvent = {
    accountDid: kp.did,
    deviceId: upsertEvent.deviceId,
    eventId: deleteEventId,
    taskId,
    updatedAt: '2026-05-05T17:50:00.000Z',
    op: 'delete' as const,
    nonce: 'Q1w2E3r4T5y6U7i8ABCD',
    ciphertext: Buffer.from('{}').toString('base64url')
  };
  const deleteResp = await fetch(`${ApiUrl}/v1/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ accountDid: kp.did, events: [deleteEvent] })
  });
  expect(deleteResp.status).toBe(200);
  const deleteBody = (await deleteResp.json()) as { accepted: string[]; rejected: unknown[] };
  expect(deleteBody).toEqual({ accepted: [deleteEventId], rejected: [] });

  // §9.3 — Pull
  const pullResp = await fetch(
    `${ApiUrl}/v1/sync/pull?accountDid=${encodeURIComponent(kp.did)}&cursor=0`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  expect(pullResp.status).toBe(200);
  const pullBody = (await pullResp.json()) as {
    events: { eventId: string; op: string; taskId: string }[];
    nextCursor: string;
  };
  // Last-writer-wins by updatedAt: the delete (later) is the current
  // snapshot for this taskId, so pull returns exactly one event, the delete.
  expect(pullBody.events).toHaveLength(1);
  expect(pullBody.events[0]).toMatchObject({ eventId: deleteEventId, op: 'delete', taskId });
  expect(/^[0-9]+$/.test(pullBody.nextCursor)).toBe(true);
});
