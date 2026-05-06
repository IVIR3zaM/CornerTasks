import { base58 } from '@scure/base';

const ED25519_MULTICODEC = new Uint8Array([0xed, 0x01]);

export class InvalidDidError extends Error {
  constructor(public reason = 'invalid_did') {
    super(reason);
  }
}

export function publicKeyFromDid(did: string): Uint8Array {
  if (!did.startsWith('did:key:z')) throw new InvalidDidError();
  const body = did.slice('did:key:z'.length);
  let decoded: Uint8Array;
  try {
    decoded = base58.decode(body);
  } catch {
    throw new InvalidDidError();
  }
  if (decoded.length !== 2 + 32) throw new InvalidDidError();
  if (decoded[0] !== ED25519_MULTICODEC[0] || decoded[1] !== ED25519_MULTICODEC[1]) {
    throw new InvalidDidError();
  }
  return decoded.slice(2);
}

export function didFromPublicKey(pub: Uint8Array): string {
  if (pub.length !== 32) throw new Error('expected 32-byte Ed25519 public key');
  const buf = new Uint8Array(2 + 32);
  buf.set(ED25519_MULTICODEC, 0);
  buf.set(pub, 2);
  return 'did:key:z' + base58.encode(buf);
}

export function methodSpecificId(did: string): string {
  if (!did.startsWith('did:key:')) throw new InvalidDidError();
  return did.slice('did:key:'.length);
}
