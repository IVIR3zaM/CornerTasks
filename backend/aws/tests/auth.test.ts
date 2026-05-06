import { handler as challenge } from '../src/handlers/auth/challenge';
import { handler as token } from '../src/handlers/auth/token';
import { setStore, resetStoreForTests } from '../src/lib/db';
import { setSigningKey } from '../src/lib/signing-key';
import { memoryStore } from './helpers/memory-store';
import { generateKeyPair } from './helpers/keys';
import { fakeEvent, asStructured, parseJson } from './helpers/event';
import { signEdDsa } from '../src/lib/jwt';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { methodSpecificId } from '../src/lib/did';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const AUDIENCE = 'https://test.execute-api.local/test';

beforeEach(() => {
  process.env.JWT_ALG = 'HS256';
  resetStoreForTests();
  setStore(memoryStore());
  setSigningKey({
    alg: 'HS256',
    kid: 'ct-server-test',
    privateKey: Buffer.from('test-secret-32-bytes-padding-padd'),
    publicKey: Buffer.from('test-secret-32-bytes-padding-padd')
  });
});

afterEach(() => {
  setSigningKey(null);
});

async function getChallenge(accountDid: string): Promise<string> {
  const r = asStructured(await challenge(fakeEvent({ method: 'POST', path: '/v1/auth/challenge', body: { accountDid } })));
  expect(r.statusCode).toBe(200);
  return (parseJson(r) as { challenge: string }).challenge;
}

async function makeDidJwt(opts: {
  privateKey: Uint8Array;
  did: string;
  audience?: string;
  nonce: string;
  iat?: number;
  exp?: number;
  kidOverride?: string;
}): Promise<string> {
  const iat = opts.iat ?? Math.floor(Date.now() / 1000);
  const exp = opts.exp ?? iat + 120;
  const header = {
    alg: 'EdDSA' as const,
    typ: 'JWT' as const,
    kid: opts.kidOverride ?? `${opts.did}#${methodSpecificId(opts.did)}`
  };
  const claims = {
    iss: opts.did,
    sub: opts.did,
    aud: opts.audience ?? AUDIENCE,
    nonce: opts.nonce,
    iat,
    exp
  };
  return signEdDsa(header, claims, opts.privateKey);
}

describe('POST /v1/auth/challenge', () => {
  test('issues a 32-byte base64url challenge with audience and TTL', async () => {
    const kp = await generateKeyPair();
    const r = asStructured(await challenge(fakeEvent({ method: 'POST', path: '/v1/auth/challenge', body: { accountDid: kp.did } })));
    expect(r.statusCode).toBe(200);
    const body = parseJson(r) as { challenge: string; audience: string; expiresAt: string };
    expect(body.audience).toBe(AUDIENCE);
    expect(Buffer.from(body.challenge, 'base64url').length).toBe(32);
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
  });

  test('rejects malformed accountDid', async () => {
    const r = asStructured(await challenge(fakeEvent({ method: 'POST', path: '/v1/auth/challenge', body: { accountDid: 'not-a-did' } })));
    expect(r.statusCode).toBe(400);
  });
});

describe('POST /v1/auth/token', () => {
  test('valid DID-JWT yields an access token; replay rejected as unknown_challenge', async () => {
    const kp = await generateKeyPair(2);
    const c = await getChallenge(kp.did);
    const didJwt = await makeDidJwt({ privateKey: kp.privateKey, did: kp.did, nonce: c });
    const r1 = asStructured(await token(fakeEvent({ method: 'POST', path: '/v1/auth/token', body: { accountDid: kp.did, didJwt } })));
    expect(r1.statusCode).toBe(200);
    const body = parseJson(r1) as { accessToken: string; tokenType: string };
    expect(body.tokenType).toBe('Bearer');
    expect(body.accessToken.split('.').length).toBe(3);

    const r2 = asStructured(await token(fakeEvent({ method: 'POST', path: '/v1/auth/token', body: { accountDid: kp.did, didJwt } })));
    expect(r2.statusCode).toBe(401);
    expect(parseJson(r2)).toMatchObject({ reason: 'unknown_challenge' });
  });

  test('wrong-key signature → bad_signature', async () => {
    const kp = await generateKeyPair(3);
    const other = await generateKeyPair(4);
    const c = await getChallenge(kp.did);
    const didJwt = await makeDidJwt({ privateKey: other.privateKey, did: kp.did, nonce: c });
    const r = asStructured(await token(fakeEvent({ method: 'POST', path: '/v1/auth/token', body: { accountDid: kp.did, didJwt } })));
    expect(r.statusCode).toBe(401);
    expect(parseJson(r)).toMatchObject({ reason: 'bad_signature' });
  });

  test('swapped audience → bad_audience', async () => {
    const kp = await generateKeyPair(5);
    const c = await getChallenge(kp.did);
    const didJwt = await makeDidJwt({ privateKey: kp.privateKey, did: kp.did, nonce: c, audience: 'https://wrong/' });
    const r = asStructured(await token(fakeEvent({ method: 'POST', path: '/v1/auth/token', body: { accountDid: kp.did, didJwt } })));
    expect(r.statusCode).toBe(401);
    expect(parseJson(r)).toMatchObject({ reason: 'bad_audience' });
  });

  test('exp - iat > 300s → bad_lifetime', async () => {
    const kp = await generateKeyPair(6);
    const c = await getChallenge(kp.did);
    const iat = Math.floor(Date.now() / 1000);
    const didJwt = await makeDidJwt({ privateKey: kp.privateKey, did: kp.did, nonce: c, iat, exp: iat + 1000 });
    const r = asStructured(await token(fakeEvent({ method: 'POST', path: '/v1/auth/token', body: { accountDid: kp.did, didJwt } })));
    expect(r.statusCode).toBe(401);
    expect(parseJson(r)).toMatchObject({ reason: 'bad_lifetime' });
  });

  test('malformed JWS → 400 invalid_did_jwt', async () => {
    const kp = await generateKeyPair(7);
    const r = asStructured(await token(fakeEvent({ method: 'POST', path: '/v1/auth/token', body: { accountDid: kp.did, didJwt: 'not.a.jwt' } })));
    expect(r.statusCode).toBe(400);
    expect(parseJson(r)).toMatchObject({ reason: 'invalid_did_jwt' });
  });

  test('401 responses include WWW-Authenticate header', async () => {
    const kp = await generateKeyPair(8);
    const r = asStructured(await token(fakeEvent({ method: 'POST', path: '/v1/auth/token', body: { accountDid: kp.did, didJwt: await makeDidJwt({ privateKey: (await generateKeyPair(9)).privateKey, did: kp.did, nonce: await getChallenge(kp.did) }) } })));
    expect(r.statusCode).toBe(401);
    expect(r.headers?.['WWW-Authenticate']).toContain('Bearer');
  });
});
