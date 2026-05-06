// HKDF-SHA256 derivations from the BIP-39 seed.
// Matches macOS DataKey.swift: empty salt, identity vs encryption info strings, 32-byte output.

const enc = new TextEncoder();
export const IDENTITY_INFO = enc.encode('cornertasks-identity-ed25519');
export const ENCRYPTION_INFO = enc.encode('cornertasks-encryption-aesgcm');

const subtle = (): SubtleCrypto => {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error('WebCrypto SubtleCrypto unavailable');
  return c.subtle;
};

const hkdf = async (seed: Uint8Array, info: Uint8Array, length = 32): Promise<Uint8Array> => {
  const ikm = await subtle().importKey('raw', seed as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await subtle().deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array() as BufferSource, info: info as BufferSource },
    ikm,
    length * 8
  );
  return new Uint8Array(bits);
};

export const identitySeed = (bip39Seed: Uint8Array): Promise<Uint8Array> =>
  hkdf(bip39Seed, IDENTITY_INFO);

export const encryptionKeyBytes = (bip39Seed: Uint8Array): Promise<Uint8Array> =>
  hkdf(bip39Seed, ENCRYPTION_INFO);
