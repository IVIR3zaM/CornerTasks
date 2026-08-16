// DID-JWT signing helper for tests, mirroring
// backend/aws/scripts/sign-did-jwt.ts (the same worked-example flow docs/
// sync-protocol.md §9 describes) but driven by an in-process keypair instead
// of a CLI. Reuses backend/core's own test keypair helper rather than
// depending on @noble/ed25519 directly.

import { generateKeyPair, type KeyPair } from '../../../core/tests/helpers/keys';
import { signEdDsa } from '../../../core/src/lib/jwt';
import { methodSpecificId } from '../../../core/src/lib/did';

export type { KeyPair };
export { generateKeyPair };

export async function signDidJwt(opts: {
  kp: KeyPair;
  audience: string;
  challenge: string;
  lifetimeS?: number;
}): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + (opts.lifetimeS ?? 120);
  const header = {
    alg: 'EdDSA' as const,
    typ: 'JWT' as const,
    kid: `${opts.kp.did}#${methodSpecificId(opts.kp.did)}`
  };
  const claims = { iss: opts.kp.did, sub: opts.kp.did, aud: opts.audience, nonce: opts.challenge, iat, exp };
  return signEdDsa(header, claims, opts.kp.privateKey);
}
