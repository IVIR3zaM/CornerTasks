// Bearer-token helpers for the WebSocket tests.
//
// `mintBearer` runs the real §8 flow over HTTP so at least one path in the
// suite proves that the token a client actually holds is the token the socket
// accepts — the WS handshake reuses `verifyBearerToken`, and if that ever
// drifted from what `/v1/auth/token` issues, every other test here would still
// pass while real clients could not connect.
//
// `forgeBearer` signs directly with the harness key so a test can produce a
// token that is expired / wrong-audience / wrong-key, which the real flow
// cannot be persuaded to emit.

import { signHs256 } from '../../../core/src/lib/jwt';
import { BEARER_AUDIENCE } from '../../../core/src/lib/auth';
import { generateKeyPair, signDidJwt, type KeyPair } from './did-jwt';
import { TEST_SIGNING_KEY, type Harness } from './harness';

export { generateKeyPair };
export type { KeyPair };

/** Full challenge → DID-JWT → bearer exchange against a running harness. */
export async function mintBearer(harness: Harness, kp: KeyPair): Promise<string> {
  const challengeResp = await fetch(`${harness.baseUrl}/v1/auth/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountDid: kp.did })
  });
  const { challenge, audience } = (await challengeResp.json()) as { challenge: string; audience: string };
  const didJwt = await signDidJwt({ kp, audience, challenge });
  const tokenResp = await fetch(`${harness.baseUrl}/v1/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountDid: kp.did, didJwt })
  });
  const { accessToken } = (await tokenResp.json()) as { accessToken: string };
  return accessToken;
}

export function forgeBearer(opts: {
  sub: string;
  /** Seconds from now; negative for an already-expired token. */
  expInS?: number;
  aud?: string;
  secret?: Uint8Array;
}): string {
  const now = Math.floor(Date.now() / 1000);
  return signHs256(
    { alg: 'HS256', typ: 'JWT', kid: TEST_SIGNING_KEY.kid },
    {
      iss: 'test',
      sub: opts.sub,
      aud: opts.aud ?? BEARER_AUDIENCE,
      iat: now - 10,
      exp: now + (opts.expInS ?? 3600)
    },
    opts.secret ?? TEST_SIGNING_KEY.privateKey
  );
}
