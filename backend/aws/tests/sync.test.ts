import { randomUUID } from 'crypto';
import { handler as push } from '../src/handlers/push';
import { handler as pull } from '../src/handlers/pull';
import { handler as challenge } from '../src/handlers/auth/challenge';
import { handler as token } from '../src/handlers/auth/token';
import { setStore, resetStoreForTests, type Store } from '../src/lib/db';
import { setSigningKey } from '../src/lib/signing-key';
import { memoryStore } from './helpers/memory-store';
import { generateKeyPair, type KeyPair } from './helpers/keys';
import { fakeEvent, asStructured, parseJson } from './helpers/event';
import { signEdDsa, signHs256 } from '../src/lib/jwt';
import { methodSpecificId } from '../src/lib/did';
import { BEARER_AUDIENCE } from '../src/lib/auth';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const AUDIENCE = 'https://test.execute-api.local/test';
const SECRET = Buffer.from('test-secret-32-bytes-padding-padd');

let store: ReturnType<typeof memoryStore>;

beforeEach(() => {
  process.env.JWT_ALG = 'HS256';
  resetStoreForTests();
  store = memoryStore();
  setStore(store as unknown as Store);
  setSigningKey({ alg: 'HS256', kid: 'ct-server-test', privateKey: SECRET, publicKey: SECRET });
});

afterEach(() => setSigningKey(null));

async function authenticate(kp: KeyPair): Promise<string> {
  const ch = asStructured(await challenge(fakeEvent({ method: 'POST', path: '/v1/auth/challenge', body: { accountDid: kp.did } })));
  const c = (parseJson(ch) as { challenge: string }).challenge;
  const iat = Math.floor(Date.now() / 1000);
  const didJwt = await signEdDsa(
    { alg: 'EdDSA', typ: 'JWT', kid: `${kp.did}#${methodSpecificId(kp.did)}` },
    { iss: kp.did, sub: kp.did, aud: AUDIENCE, nonce: c, iat, exp: iat + 120 },
    kp.privateKey
  );
  const tk = asStructured(await token(fakeEvent({ method: 'POST', path: '/v1/auth/token', body: { accountDid: kp.did, didJwt } })));
  expect(tk.statusCode).toBe(200);
  return (parseJson(tk) as { accessToken: string }).accessToken;
}

function makeEvent(accountDid: string, overrides: Partial<{ updatedAt: string; eventId: string; taskId: string; op: 'upsert' | 'delete' }> = {}) {
  return {
    accountDid,
    deviceId: randomUUID(),
    eventId: overrides.eventId ?? randomUUID(),
    taskId: overrides.taskId ?? randomUUID(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
    op: overrides.op ?? 'upsert',
    ciphertext: Buffer.from('hello').toString('base64url'),
    nonce: Buffer.from('123456789012').toString('base64url')
  };
}

describe('push handler', () => {
  test('accepts new events, dedups duplicate eventId in same batch', async () => {
    const kp = await generateKeyPair(11);
    const accessToken = await authenticate(kp);
    const ev = makeEvent(kp.did);
    const r = asStructured(
      await push(
        fakeEvent({
          method: 'POST',
          path: '/v1/sync/push',
          headers: { authorization: `Bearer ${accessToken}` },
          body: { accountDid: kp.did, events: [ev, ev] }
        })
      )
    );
    expect(r.statusCode).toBe(200);
    const body = parseJson(r) as { accepted: string[]; rejected: unknown[] };
    expect(body.accepted).toEqual([ev.eventId, ev.eventId]);
    expect(body.rejected).toEqual([]);
  });

  test('rejects stale events (older updatedAt than stored)', async () => {
    const kp = await generateKeyPair(12);
    const accessToken = await authenticate(kp);
    const taskId = randomUUID();
    const newer = makeEvent(kp.did, { taskId, updatedAt: '2026-05-05T10:00:00.000Z' });
    const older = makeEvent(kp.did, { taskId, updatedAt: '2026-05-04T10:00:00.000Z' });
    await push(fakeEvent({ method: 'POST', path: '/v1/sync/push', headers: { authorization: `Bearer ${accessToken}` }, body: { accountDid: kp.did, events: [newer] } }));
    const r = asStructured(
      await push(
        fakeEvent({
          method: 'POST',
          path: '/v1/sync/push',
          headers: { authorization: `Bearer ${accessToken}` },
          body: { accountDid: kp.did, events: [older] }
        })
      )
    );
    const body = parseJson(r) as { accepted: string[]; rejected: { eventId: string; reason: string }[] };
    expect(body.accepted).toEqual([]);
    expect(body.rejected).toEqual([{ eventId: older.eventId, reason: 'stale' }]);
  });

  test('rejects malformed events as 400 invalid', async () => {
    const kp = await generateKeyPair(13);
    const accessToken = await authenticate(kp);
    const r = asStructured(
      await push(
        fakeEvent({
          method: 'POST',
          path: '/v1/sync/push',
          headers: { authorization: `Bearer ${accessToken}` },
          body: { accountDid: kp.did, events: [{ taskId: 'nope' }] }
        })
      )
    );
    expect(r.statusCode).toBe(400);
    expect(parseJson(r)).toMatchObject({ reason: 'invalid' });
  });

  test('rejects events whose accountDid does not match top-level', async () => {
    const kp = await generateKeyPair(14);
    const other = await generateKeyPair(15);
    const accessToken = await authenticate(kp);
    const r = asStructured(
      await push(
        fakeEvent({
          method: 'POST',
          path: '/v1/sync/push',
          headers: { authorization: `Bearer ${accessToken}` },
          body: { accountDid: kp.did, events: [makeEvent(other.did)] }
        })
      )
    );
    expect(r.statusCode).toBe(403);
    expect(parseJson(r)).toMatchObject({ reason: 'did_mismatch' });
  });
});

describe('pull handler', () => {
  test('returns events with updatedAt >= since, ordered ascending', async () => {
    const kp = await generateKeyPair(16);
    const accessToken = await authenticate(kp);
    const e1 = makeEvent(kp.did, { updatedAt: '2026-05-05T10:00:00.000Z', eventId: '11111111-1111-1111-1111-111111111111' });
    const e2 = makeEvent(kp.did, { updatedAt: '2026-05-05T11:00:00.000Z', eventId: '22222222-2222-2222-2222-222222222222' });
    const old = makeEvent(kp.did, { updatedAt: '2026-05-01T00:00:00.000Z', eventId: '33333333-3333-3333-3333-333333333333' });
    for (const ev of [e1, e2, old]) {
      await push(
        fakeEvent({
          method: 'POST',
          path: '/v1/sync/push',
          headers: { authorization: `Bearer ${accessToken}` },
          body: { accountDid: kp.did, events: [ev] }
        })
      );
    }
    const r = asStructured(
      await pull(
        fakeEvent({
          method: 'GET',
          path: '/v1/sync/pull',
          headers: { authorization: `Bearer ${accessToken}` },
          query: { accountDid: kp.did, since: '2026-05-05T00:00:00.000Z' }
        })
      )
    );
    expect(r.statusCode).toBe(200);
    const body = parseJson(r) as { events: { eventId: string }[]; serverTime: string };
    expect(body.events.map((e) => e.eventId)).toEqual([e1.eventId, e2.eventId]);
    expect(Date.parse(body.serverTime)).toBeGreaterThan(0);
  });

  test('archive cutoff: events with archivedCompletedAt > 60 days are filtered', async () => {
    const kp = await generateKeyPair(17);
    const accessToken = await authenticate(kp);
    // Inject directly via store to set archivedCompletedAt.
    const oldArchived = makeEvent(kp.did, { updatedAt: new Date(Date.now() - 1000).toISOString() });
    await store.putEvent({
      ...oldArchived,
      archivedCompletedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    });
    const fresh = makeEvent(kp.did);
    await push(
      fakeEvent({
        method: 'POST',
        path: '/v1/sync/push',
        headers: { authorization: `Bearer ${accessToken}` },
        body: { accountDid: kp.did, events: [fresh] }
      })
    );
    const r = asStructured(
      await pull(
        fakeEvent({
          method: 'GET',
          path: '/v1/sync/pull',
          headers: { authorization: `Bearer ${accessToken}` },
          query: { accountDid: kp.did, since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }
        })
      )
    );
    const body = parseJson(r) as { events: { eventId: string }[] };
    expect(body.events.map((e) => e.eventId)).toEqual([fresh.eventId]);
  });
});

describe('Bearer middleware', () => {
  test('valid token → 200', async () => {
    const kp = await generateKeyPair(20);
    const accessToken = await authenticate(kp);
    const r = asStructured(
      await pull(
        fakeEvent({
          method: 'GET',
          path: '/v1/sync/pull',
          headers: { authorization: `Bearer ${accessToken}` },
          query: { accountDid: kp.did, since: '2026-01-01T00:00:00.000Z' }
        })
      )
    );
    expect(r.statusCode).toBe(200);
  });

  test('missing Authorization → 401 missing_token', async () => {
    const kp = await generateKeyPair(21);
    const r = asStructured(
      await pull(
        fakeEvent({
          method: 'GET',
          path: '/v1/sync/pull',
          query: { accountDid: kp.did, since: '2026-01-01T00:00:00.000Z' }
        })
      )
    );
    expect(r.statusCode).toBe(401);
    expect(parseJson(r)).toMatchObject({ reason: 'missing_token' });
    expect(r.headers?.['WWW-Authenticate']).toContain('Bearer');
  });

  test('tampered signature → 401 bad_token', async () => {
    const kp = await generateKeyPair(22);
    const accessToken = await authenticate(kp);
    const tampered = accessToken.slice(0, -2) + (accessToken.endsWith('A') ? 'BB' : 'AA');
    const r = asStructured(
      await pull(
        fakeEvent({
          method: 'GET',
          path: '/v1/sync/pull',
          headers: { authorization: `Bearer ${tampered}` },
          query: { accountDid: kp.did, since: '2026-01-01T00:00:00.000Z' }
        })
      )
    );
    expect(r.statusCode).toBe(401);
    expect(parseJson(r)).toMatchObject({ reason: 'bad_token' });
  });

  test('expired token → 401 token_expired', async () => {
    const kp = await generateKeyPair(23);
    const past = Math.floor(Date.now() / 1000) - 7200;
    const expired = signHs256(
      { alg: 'HS256', typ: 'JWT', kid: 'ct-server-test' },
      { iss: AUDIENCE, sub: kp.did, aud: BEARER_AUDIENCE, iat: past - 3600, exp: past, jti: randomUUID() },
      SECRET
    );
    const r = asStructured(
      await pull(
        fakeEvent({
          method: 'GET',
          path: '/v1/sync/pull',
          headers: { authorization: `Bearer ${expired}` },
          query: { accountDid: kp.did, since: '2026-01-01T00:00:00.000Z' }
        })
      )
    );
    expect(r.statusCode).toBe(401);
    expect(parseJson(r)).toMatchObject({ reason: 'token_expired' });
  });

  test('sub != accountDid → 403 did_mismatch', async () => {
    const kp = await generateKeyPair(24);
    const other = await generateKeyPair(25);
    const accessToken = await authenticate(kp);
    const r = asStructured(
      await pull(
        fakeEvent({
          method: 'GET',
          path: '/v1/sync/pull',
          headers: { authorization: `Bearer ${accessToken}` },
          query: { accountDid: other.did, since: '2026-01-01T00:00:00.000Z' }
        })
      )
    );
    expect(r.statusCode).toBe(403);
    expect(parseJson(r)).toMatchObject({ reason: 'did_mismatch' });
  });
});

describe('round-trip integration (challenge → token → push → pull)', () => {
  test('end-to-end against in-memory store', async () => {
    const kp = await generateKeyPair(30);
    const accessToken = await authenticate(kp);
    const ev = makeEvent(kp.did, { updatedAt: '2026-05-05T12:00:00.000Z' });
    await push(
      fakeEvent({
        method: 'POST',
        path: '/v1/sync/push',
        headers: { authorization: `Bearer ${accessToken}` },
        body: { accountDid: kp.did, events: [ev] }
      })
    );
    const r = asStructured(
      await pull(
        fakeEvent({
          method: 'GET',
          path: '/v1/sync/pull',
          headers: { authorization: `Bearer ${accessToken}` },
          query: { accountDid: kp.did, since: '2026-05-01T00:00:00.000Z' }
        })
      )
    );
    const body = parseJson(r) as { events: { eventId: string; ciphertext: string }[] };
    expect(body.events).toHaveLength(1);
    expect(body.events[0]!.eventId).toBe(ev.eventId);
    expect(body.events[0]!.ciphertext).toBe(ev.ciphertext);
  });
});
