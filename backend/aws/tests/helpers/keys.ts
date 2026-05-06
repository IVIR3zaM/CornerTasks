import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { didFromPublicKey } from '../../src/lib/did';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

export interface KeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  did: string;
}

export async function generateKeyPair(seedByte = 1): Promise<KeyPair> {
  const privateKey = new Uint8Array(32).fill(seedByte);
  const publicKey = await ed.getPublicKey(privateKey);
  return { privateKey, publicKey, did: didFromPublicKey(publicKey) };
}
