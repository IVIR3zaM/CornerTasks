import { writeFileSync } from 'fs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { getSigningKey, setSigningKey } from '../src/lib/signing-key';
import { generateKeyPair } from './helpers/keys';

describe('signing-key loader (CT_KEY_SOURCE)', () => {
  beforeEach(() => {
    // Reset cache before each test
    setSigningKey(null);
    // Clear CT_KEY_SOURCE and related env vars
    delete process.env.CT_KEY_SOURCE;
    delete process.env.JWT_ALG;
    delete process.env.JWT_KID;
    delete process.env.JWT_PRIVATE_KEY;
    delete process.env.JWT_PUBLIC_KEY;
    delete process.env.JWT_SECRET;
    delete process.env.JWT_PRIVATE_KEY_FILE;
    delete process.env.JWT_PUBLIC_KEY_FILE;
    delete process.env.JWT_SECRET_FILE;
  });

  describe('env source — EdDSA', () => {
    test('loads valid Ed25519 keys from base64 env vars', async () => {
      const kp = await generateKeyPair(42);
      process.env.CT_KEY_SOURCE = 'env';
      process.env.JWT_ALG = 'EdDSA';
      process.env.JWT_PRIVATE_KEY = Buffer.from(kp.privateKey).toString('base64');
      process.env.JWT_PUBLIC_KEY = Buffer.from(kp.publicKey).toString('base64');

      const key = await getSigningKey();
      expect(key.alg).toBe('EdDSA');
      expect(key.kid).toBe('ct-signing-key');
      expect(Buffer.from(key.privateKey).equals(Buffer.from(kp.privateKey))).toBe(true);
      expect(Buffer.from(key.publicKey).equals(Buffer.from(kp.publicKey))).toBe(true);
    });

    test('uses custom JWT_KID', async () => {
      const kp = await generateKeyPair(42);
      process.env.CT_KEY_SOURCE = 'env';
      process.env.JWT_ALG = 'EdDSA';
      process.env.JWT_KID = 'my-custom-kid';
      process.env.JWT_PRIVATE_KEY = Buffer.from(kp.privateKey).toString('base64');
      process.env.JWT_PUBLIC_KEY = Buffer.from(kp.publicKey).toString('base64');

      const key = await getSigningKey();
      expect(key.kid).toBe('my-custom-kid');
    });

    test('throws on missing JWT_PRIVATE_KEY', async () => {
      process.env.CT_KEY_SOURCE = 'env';
      process.env.JWT_ALG = 'EdDSA';
      process.env.JWT_PUBLIC_KEY = 'some-base64-here';

      await expect(getSigningKey()).rejects.toThrow(
        'CT_KEY_SOURCE=env with JWT_ALG=EdDSA requires JWT_PRIVATE_KEY environment variable'
      );
    });

    test('throws on missing JWT_PUBLIC_KEY', async () => {
      process.env.CT_KEY_SOURCE = 'env';
      process.env.JWT_ALG = 'EdDSA';
      process.env.JWT_PRIVATE_KEY = 'some-base64-here';

      await expect(getSigningKey()).rejects.toThrow(
        'CT_KEY_SOURCE=env with JWT_ALG=EdDSA requires JWT_PUBLIC_KEY environment variable'
      );
    });

    test('throws on malformed JWT_PRIVATE_KEY base64', async () => {
      const kp = await generateKeyPair(42);
      process.env.CT_KEY_SOURCE = 'env';
      process.env.JWT_ALG = 'EdDSA';
      process.env.JWT_PRIVATE_KEY = 'not-valid-base64!!!';
      process.env.JWT_PUBLIC_KEY = Buffer.from(kp.publicKey).toString('base64');

      await expect(getSigningKey()).rejects.toThrow('JWT_PRIVATE_KEY is not valid base64');
    });

    test('throws on malformed JWT_PUBLIC_KEY base64', async () => {
      const kp = await generateKeyPair(42);
      process.env.CT_KEY_SOURCE = 'env';
      process.env.JWT_ALG = 'EdDSA';
      process.env.JWT_PRIVATE_KEY = Buffer.from(kp.privateKey).toString('base64');
      process.env.JWT_PUBLIC_KEY = 'not-valid-base64!!!';

      await expect(getSigningKey()).rejects.toThrow('JWT_PUBLIC_KEY is not valid base64');
    });
  });

  describe('env source — HS256', () => {
    test('loads valid HS256 secret from base64 env var', async () => {
      const secret = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
      process.env.CT_KEY_SOURCE = 'env';
      process.env.JWT_ALG = 'HS256';
      process.env.JWT_SECRET = Buffer.from(secret).toString('base64');

      const key = await getSigningKey();
      expect(key.alg).toBe('HS256');
      expect(Buffer.from(key.privateKey).equals(Buffer.from(secret))).toBe(true);
      expect(Buffer.from(key.publicKey).equals(Buffer.from(secret))).toBe(true);
    });

    test('throws on missing JWT_SECRET for HS256', async () => {
      process.env.CT_KEY_SOURCE = 'env';
      process.env.JWT_ALG = 'HS256';

      await expect(getSigningKey()).rejects.toThrow(
        'CT_KEY_SOURCE=env with JWT_ALG=HS256 requires JWT_SECRET environment variable'
      );
    });

    test('throws on malformed JWT_SECRET base64', async () => {
      process.env.CT_KEY_SOURCE = 'env';
      process.env.JWT_ALG = 'HS256';
      process.env.JWT_SECRET = 'not-valid-base64!!!';

      await expect(getSigningKey()).rejects.toThrow('JWT_SECRET is not valid base64');
    });
  });

  describe('file source — EdDSA', () => {
    test('loads valid Ed25519 keys from base64 files', async () => {
      const kp = await generateKeyPair(42);
      const tmpDir = mkdtempSync(`${tmpdir()}/ct-signing-key-`);
      const privPath = `${tmpDir}/private.key`;
      const pubPath = `${tmpDir}/public.key`;

      writeFileSync(privPath, Buffer.from(kp.privateKey).toString('base64'));
      writeFileSync(pubPath, Buffer.from(kp.publicKey).toString('base64'));

      try {
        process.env.CT_KEY_SOURCE = 'file';
        process.env.JWT_ALG = 'EdDSA';
        process.env.JWT_PRIVATE_KEY_FILE = privPath;
        process.env.JWT_PUBLIC_KEY_FILE = pubPath;

        const key = await getSigningKey();
        expect(key.alg).toBe('EdDSA');
        expect(Buffer.from(key.privateKey).equals(Buffer.from(kp.privateKey))).toBe(true);
        expect(Buffer.from(key.publicKey).equals(Buffer.from(kp.publicKey))).toBe(true);
      } finally {
        rmSync(tmpDir, { recursive: true });
      }
    });

    test('throws on missing JWT_PRIVATE_KEY_FILE', async () => {
      process.env.CT_KEY_SOURCE = 'file';
      process.env.JWT_ALG = 'EdDSA';
      process.env.JWT_PUBLIC_KEY_FILE = '/some/path';

      await expect(getSigningKey()).rejects.toThrow(
        'CT_KEY_SOURCE=file with JWT_ALG=EdDSA requires JWT_PRIVATE_KEY_FILE environment variable'
      );
    });

    test('throws on missing JWT_PUBLIC_KEY_FILE', async () => {
      process.env.CT_KEY_SOURCE = 'file';
      process.env.JWT_ALG = 'EdDSA';
      process.env.JWT_PRIVATE_KEY_FILE = '/some/path';

      await expect(getSigningKey()).rejects.toThrow(
        'CT_KEY_SOURCE=file with JWT_ALG=EdDSA requires JWT_PUBLIC_KEY_FILE environment variable'
      );
    });

    test('throws on private key file not found', async () => {
      process.env.CT_KEY_SOURCE = 'file';
      process.env.JWT_ALG = 'EdDSA';
      process.env.JWT_PRIVATE_KEY_FILE = '/nonexistent/private.key';
      process.env.JWT_PUBLIC_KEY_FILE = '/nonexistent/public.key';

      await expect(getSigningKey()).rejects.toThrow('JWT_PRIVATE_KEY_FILE cannot be read from /nonexistent/private.key');
    });

    test('throws on public key file not found', async () => {
      const kp = await generateKeyPair(42);
      const tmpDir = mkdtempSync(`${tmpdir()}/ct-signing-key-`);
      const privPath = `${tmpDir}/private.key`;

      writeFileSync(privPath, Buffer.from(kp.privateKey).toString('base64'));

      try {
        process.env.CT_KEY_SOURCE = 'file';
        process.env.JWT_ALG = 'EdDSA';
        process.env.JWT_PRIVATE_KEY_FILE = privPath;
        process.env.JWT_PUBLIC_KEY_FILE = '/nonexistent/public.key';

        await expect(getSigningKey()).rejects.toThrow('JWT_PUBLIC_KEY_FILE cannot be read from /nonexistent/public.key');
      } finally {
        rmSync(tmpDir, { recursive: true });
      }
    });

    test('throws on malformed base64 in private key file', async () => {
      const kp = await generateKeyPair(42);
      const tmpDir = mkdtempSync(`${tmpdir()}/ct-signing-key-`);
      const privPath = `${tmpDir}/private.key`;
      const pubPath = `${tmpDir}/public.key`;

      writeFileSync(privPath, 'not-valid-base64!!!');
      writeFileSync(pubPath, Buffer.from(kp.publicKey).toString('base64'));

      try {
        process.env.CT_KEY_SOURCE = 'file';
        process.env.JWT_ALG = 'EdDSA';
        process.env.JWT_PRIVATE_KEY_FILE = privPath;
        process.env.JWT_PUBLIC_KEY_FILE = pubPath;

        await expect(getSigningKey()).rejects.toThrow('is not valid base64');
      } finally {
        rmSync(tmpDir, { recursive: true });
      }
    });

    test('throws on malformed base64 in public key file', async () => {
      const kp = await generateKeyPair(42);
      const tmpDir = mkdtempSync(`${tmpdir()}/ct-signing-key-`);
      const privPath = `${tmpDir}/private.key`;
      const pubPath = `${tmpDir}/public.key`;

      writeFileSync(privPath, Buffer.from(kp.privateKey).toString('base64'));
      writeFileSync(pubPath, 'not-valid-base64!!!');

      try {
        process.env.CT_KEY_SOURCE = 'file';
        process.env.JWT_ALG = 'EdDSA';
        process.env.JWT_PRIVATE_KEY_FILE = privPath;
        process.env.JWT_PUBLIC_KEY_FILE = pubPath;

        await expect(getSigningKey()).rejects.toThrow('is not valid base64');
      } finally {
        rmSync(tmpDir, { recursive: true });
      }
    });
  });

  describe('file source — HS256', () => {
    test('loads valid HS256 secret from base64 file', async () => {
      const secret = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
      const tmpDir = mkdtempSync(`${tmpdir()}/ct-signing-key-`);
      const secretPath = `${tmpDir}/secret.key`;

      writeFileSync(secretPath, Buffer.from(secret).toString('base64'));

      try {
        process.env.CT_KEY_SOURCE = 'file';
        process.env.JWT_ALG = 'HS256';
        process.env.JWT_SECRET_FILE = secretPath;

        const key = await getSigningKey();
        expect(key.alg).toBe('HS256');
        expect(Buffer.from(key.privateKey).equals(Buffer.from(secret))).toBe(true);
        expect(Buffer.from(key.publicKey).equals(Buffer.from(secret))).toBe(true);
      } finally {
        rmSync(tmpDir, { recursive: true });
      }
    });

    test('throws on missing JWT_SECRET_FILE for HS256', async () => {
      process.env.CT_KEY_SOURCE = 'file';
      process.env.JWT_ALG = 'HS256';

      await expect(getSigningKey()).rejects.toThrow(
        'CT_KEY_SOURCE=file with JWT_ALG=HS256 requires JWT_SECRET_FILE environment variable'
      );
    });

    test('throws on secret file not found', async () => {
      process.env.CT_KEY_SOURCE = 'file';
      process.env.JWT_ALG = 'HS256';
      process.env.JWT_SECRET_FILE = '/nonexistent/secret.key';

      await expect(getSigningKey()).rejects.toThrow('JWT_SECRET_FILE cannot be read from /nonexistent/secret.key');
    });

    test('throws on malformed base64 in secret file', async () => {
      const tmpDir = mkdtempSync(`${tmpdir()}/ct-signing-key-`);
      const secretPath = `${tmpDir}/secret.key`;

      writeFileSync(secretPath, 'not-valid-base64!!!');

      try {
        process.env.CT_KEY_SOURCE = 'file';
        process.env.JWT_ALG = 'HS256';
        process.env.JWT_SECRET_FILE = secretPath;

        await expect(getSigningKey()).rejects.toThrow('is not valid base64');
      } finally {
        rmSync(tmpDir, { recursive: true });
      }
    });
  });

  describe('ssm source (not available in core)', () => {
    test('throws when CT_KEY_SOURCE=ssm', async () => {
      process.env.CT_KEY_SOURCE = 'ssm';

      await expect(getSigningKey()).rejects.toThrow('SSM signing key source not available in backend/core');
    });

    test('throws when CT_KEY_SOURCE is unset (defaults to ssm)', async () => {
      delete process.env.CT_KEY_SOURCE;

      await expect(getSigningKey()).rejects.toThrow('SSM signing key source not available in backend/core');
    });

    test('throws on unknown CT_KEY_SOURCE value', async () => {
      process.env.CT_KEY_SOURCE = 'unknown-source';

      await expect(getSigningKey()).rejects.toThrow('unknown CT_KEY_SOURCE: unknown-source');
    });
  });

  describe('caching', () => {
    test('returns cached key on subsequent calls', async () => {
      const kp = await generateKeyPair(42);
      process.env.CT_KEY_SOURCE = 'env';
      process.env.JWT_ALG = 'EdDSA';
      process.env.JWT_PRIVATE_KEY = Buffer.from(kp.privateKey).toString('base64');
      process.env.JWT_PUBLIC_KEY = Buffer.from(kp.publicKey).toString('base64');

      const key1 = await getSigningKey();
      const key2 = await getSigningKey();

      expect(key1).toBe(key2); // same object reference
    });
  });
});
