// AES-256-GCM seal/open. Matches macOS SymmetricBox: 12-byte nonce, 128-bit tag,
// ciphertext returned as ciphertext||tag combined.

const subtle = (): SubtleCrypto => {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error('WebCrypto SubtleCrypto unavailable');
  return c.subtle;
};

const importKey = (raw: Uint8Array): Promise<CryptoKey> =>
  subtle().importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

export interface SealResult {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

export const seal = async (
  plaintext: Uint8Array,
  keyBytes: Uint8Array,
  aad: Uint8Array,
  nonce?: Uint8Array
): Promise<SealResult> => {
  const iv = nonce ?? globalThis.crypto.getRandomValues(new Uint8Array(12));
  if (iv.length !== 12) throw new Error('AES-GCM nonce must be 12 bytes');
  const key = await importKey(keyBytes);
  const ct = await subtle().encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad as BufferSource, tagLength: 128 },
    key,
    plaintext as BufferSource
  );
  return { ciphertext: new Uint8Array(ct), nonce: iv };
};

export const open = async (
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  keyBytes: Uint8Array,
  aad: Uint8Array
): Promise<Uint8Array> => {
  if (nonce.length !== 12) throw new Error('AES-GCM nonce must be 12 bytes');
  const key = await importKey(keyBytes);
  const pt = await subtle().decrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource, additionalData: aad as BufferSource, tagLength: 128 },
    key,
    ciphertext as BufferSource
  );
  return new Uint8Array(pt);
};
