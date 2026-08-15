// The JWT signing key contract. This module defines the shape and the
// get/set injection seam only — no key material is sourced here. Each
// runtime supplies its own provider and calls `setSigningKey()` before
// serving requests: backend/aws reads it from SSM, a future self-hosted
// runtime from env vars or a file. Tests inject a fixed key directly.

import type { JwtAlg } from './jwt';

export interface SigningKey {
  alg: JwtAlg;
  kid: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

let cached: SigningKey | null = null;

export function setSigningKey(k: SigningKey | null): void {
  cached = k;
}

export async function getSigningKey(): Promise<SigningKey> {
  if (cached) return cached;
  throw new Error('no signing key configured; the runtime must call setSigningKey() before handling requests');
}
