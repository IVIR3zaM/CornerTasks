import { didFromPublicKey, publicKeyFromDid, InvalidDidError } from '../src/lib/did';
import { generateKeyPair } from './helpers/keys';

describe('did:key encoding', () => {
  test('round-trips Ed25519 public key', async () => {
    const kp = await generateKeyPair(42);
    const did = didFromPublicKey(kp.publicKey);
    expect(did.startsWith('did:key:z')).toBe(true);
    const recovered = publicKeyFromDid(did);
    expect(Buffer.from(recovered).equals(Buffer.from(kp.publicKey))).toBe(true);
  });

  test('rejects malformed input', () => {
    expect(() => publicKeyFromDid('did:key:zNotBase58!!')).toThrow(InvalidDidError);
    expect(() => publicKeyFromDid('not-a-did')).toThrow(InvalidDidError);
  });
});
