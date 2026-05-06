import { describe, expect, it } from 'vitest';

import { didFromPublicKey, publicKeyFromDid } from '../src/crypto/did';
import { fromBip39Seed, makeDidJwt, verify } from '../src/crypto/identity';
import { encryptionKeyBytes, identitySeed } from '../src/crypto/keys';
import * as mnemonic from '../src/crypto/mnemonic';
import { open, seal } from '../src/crypto/box';
import vectors from '../../../docs/crypto-vectors.json';

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('crypto cross-implementation vectors', () => {
  it('matches BIP-39 seed', async () => {
    const seed = await mnemonic.toSeed(vectors.mnemonic);
    expect(hex(seed)).toBe(vectors.bip39SeedHex);
    expect(mnemonic.validate(vectors.mnemonic)).toBe(true);
  });

  it('derives identity seed and encryption key via HKDF-SHA256', async () => {
    const seed = await mnemonic.toSeed(vectors.mnemonic);
    expect(hex(await identitySeed(seed))).toBe(vectors.identitySeedHex);
    expect(hex(await encryptionKeyBytes(seed))).toBe(vectors.encryptionKeyHex);
  });

  it('produces the expected did:key and Ed25519 public key', async () => {
    const seed = await mnemonic.toSeed(vectors.mnemonic);
    const id = await fromBip39Seed(seed);
    expect(id.accountDid).toBe(vectors.accountDid);
    expect(hex(id.publicKey)).toBe(vectors.publicKeyHex);
  });

  it('round-trips the did:key encoder/decoder', () => {
    const pub = publicKeyFromDid(vectors.accountDid);
    expect(hex(pub)).toBe(vectors.publicKeyHex);
    expect(didFromPublicKey(pub)).toBe(vectors.accountDid);
  });

  it('reproduces the AES-GCM ciphertext for the fixed-nonce vector', async () => {
    const seed = await mnemonic.toSeed(vectors.mnemonic);
    const key = await encryptionKeyBytes(seed);
    const v = vectors.aesGcm;
    const { ciphertext, nonce } = await seal(utf8(v.plaintext), key, utf8(v.aad), fromHex(v.nonceHex));
    expect(hex(nonce)).toBe(v.nonceHex);
    expect(hex(ciphertext)).toBe(v.ciphertextHex);
    const recovered = await open(ciphertext, nonce, key, utf8(v.aad));
    expect(new TextDecoder().decode(recovered)).toBe(v.plaintext);
  });

  it('produces the expected DID-JWT header and payload (and the signature verifies)', async () => {
    const seed = await mnemonic.toSeed(vectors.mnemonic);
    const id = await fromBip39Seed(seed);
    const v = vectors.didJwt;
    const jwt = await id.makeDidJwt({ audience: v.audience, nonce: v.nonce, iat: v.iat });
    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe(v.headerB64Url);
    expect(parts[1]).toBe(v.payloadB64Url);

    const sig = b64urlDecode(parts[2]);
    const ok = await verify(sig, utf8(`${parts[0]}.${parts[1]}`), id.accountDid);
    expect(ok).toBe(true);
  });
});

describe('crypto round-trips', () => {
  it('encrypts and decrypts with a random nonce', async () => {
    const seed = await mnemonic.toSeed(vectors.mnemonic);
    const key = await encryptionKeyBytes(seed);
    const pt = utf8('hello world');
    const aad = utf8('aad-test');
    const { ciphertext, nonce } = await seal(pt, key, aad);
    expect(nonce.length).toBe(12);
    const back = await open(ciphertext, nonce, key, aad);
    expect(new TextDecoder().decode(back)).toBe('hello world');
  });

  it('rejects ciphertext under a different AAD', async () => {
    const seed = await mnemonic.toSeed(vectors.mnemonic);
    const key = await encryptionKeyBytes(seed);
    const { ciphertext, nonce } = await seal(utf8('x'), key, utf8('aad-1'));
    await expect(open(ciphertext, nonce, key, utf8('aad-2'))).rejects.toBeDefined();
  });

  it('signs and verifies with a freshly-generated mnemonic', async () => {
    const m = mnemonic.generate();
    expect(mnemonic.validate(m)).toBe(true);
    const seed = await mnemonic.toSeed(m);
    const id = await fromBip39Seed(seed);
    const sig = await id.sign(utf8('msg'));
    expect(await verify(sig, utf8('msg'), id.accountDid)).toBe(true);
    expect(await verify(sig, utf8('tampered'), id.accountDid)).toBe(false);
  });

  it('makeDidJwt helper agrees with Identity.makeDidJwt', async () => {
    const seed = await mnemonic.toSeed(vectors.mnemonic);
    const id = await fromBip39Seed(seed);
    const v = vectors.didJwt;
    const a = await id.makeDidJwt({ audience: v.audience, nonce: v.nonce, iat: v.iat });
    const b = await makeDidJwt(
      { accountDid: id.accountDid, methodSpecificId: id.methodSpecificId, privateKey: id.privateKey },
      { audience: v.audience, nonce: v.nonce, iat: v.iat }
    );
    // Header & payload segments must match; @noble/ed25519 is RFC-8032 deterministic
    // so the signature segment is reproducible too.
    expect(a).toBe(b);
  });
});

const b64urlDecode = (s: string): Uint8Array => {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const std = s.replaceAll('-', '+').replaceAll('_', '/') + pad;
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
