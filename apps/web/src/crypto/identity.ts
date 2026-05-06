// Ed25519 identity, sign/verify, and DID-JWT (compact JWS) per docs/sync-protocol.md §8.2.

import * as ed from '@noble/ed25519';
import { didFromPublicKey, methodSpecificId, publicKeyFromDid } from './did';
import { identitySeed } from './keys';

export interface Identity {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  accountDid: string;
  methodSpecificId: string;
  sign(message: Uint8Array): Promise<Uint8Array>;
  makeDidJwt(args: { audience: string; nonce: string; iat?: number }): Promise<string>;
}

export const fromIdentitySeed = async (seed: Uint8Array): Promise<Identity> => {
  if (seed.length !== 32) throw new Error('identity seed must be 32 bytes');
  const privateKey = new Uint8Array(seed);
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  const accountDid = didFromPublicKey(publicKey);
  const msi = methodSpecificId(accountDid);
  return {
    privateKey,
    publicKey,
    accountDid,
    methodSpecificId: msi,
    sign: (message) => ed.signAsync(message, privateKey),
    makeDidJwt: ({ audience, nonce, iat }) =>
      makeDidJwt({ accountDid, methodSpecificId: msi, privateKey }, { audience, nonce, iat }),
  };
};

export const fromBip39Seed = async (bip39Seed: Uint8Array): Promise<Identity> => {
  const seed = await identitySeed(bip39Seed);
  return fromIdentitySeed(seed);
};

export const verify = async (signature: Uint8Array, message: Uint8Array, did: string): Promise<boolean> => {
  const pub = publicKeyFromDid(did);
  return ed.verifyAsync(signature, message, pub);
};

const b64url = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

const b64urlString = (text: string): string => b64url(new TextEncoder().encode(text));

export const makeDidJwt = async (
  id: { accountDid: string; methodSpecificId: string; privateKey: Uint8Array },
  args: { audience: string; nonce: string; iat?: number }
): Promise<string> => {
  const iat = args.iat ?? Math.floor(Date.now() / 1000);
  const exp = iat + 300;
  const kid = `${id.accountDid}#${id.methodSpecificId}`;
  // Field order matches the macOS Identity.makeDidJwt(...) implementation so the
  // base64url-encoded segments are byte-identical.
  const header = `{"alg":"EdDSA","typ":"JWT","kid":"${kid}"}`;
  const payload = `{"iss":"${id.accountDid}","sub":"${id.accountDid}","aud":"${args.audience}","nonce":"${args.nonce}","iat":${iat},"exp":${exp}}`;
  const signingInput = `${b64urlString(header)}.${b64urlString(payload)}`;
  const sig = await ed.signAsync(new TextEncoder().encode(signingInput), id.privateKey);
  return `${signingInput}.${b64url(sig)}`;
};
