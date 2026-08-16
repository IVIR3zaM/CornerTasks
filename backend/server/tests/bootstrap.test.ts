// Unit tests for lib/bootstrap.ts: does startup wiring fail loudly and
// early on missing configuration, and succeed with a domain derived from
// PUBLIC_URL when it's present? Mutates `process.env` and restores it
// afterward, matching backend/core/tests/sqlite-store.test.ts's pattern —
// `bootstrap()` reads `process.env` directly, the same as the backend/core
// functions it calls.

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootstrap } from '../src/lib/bootstrap';
import { resetStoreForTests } from '../../core/src/lib/db';
import { setSigningKey } from '../../core/src/lib/signing-key';

const ENV_KEYS = ['PUBLIC_URL', 'CT_STORE', 'CT_DB_PATH', 'CT_KEY_SOURCE', 'JWT_ALG', 'JWT_SECRET', 'JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY'] as const;
const originalEnv: Record<string, string | undefined> = {};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ct-server-bootstrap-'));
  resetStoreForTests();
  setSigningKey(null);
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  resetStoreForTests();
  setSigningKey(null);
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

test('throws with a clear message when CT_STORE=sqlite (default) and PUBLIC_URL is unset', async () => {
  delete process.env.PUBLIC_URL;
  delete process.env.CT_STORE;
  process.env.CT_DB_PATH = join(dir, 'db.sqlite3');

  await expect(bootstrap()).rejects.toThrow(/PUBLIC_URL is required/);
});

test('throws when the signing key is missing, even with PUBLIC_URL set', async () => {
  process.env.PUBLIC_URL = 'https://example.ngrok.app';
  process.env.CT_DB_PATH = join(dir, 'db.sqlite3');
  delete process.env.CT_KEY_SOURCE;

  await expect(bootstrap()).rejects.toThrow();
});

test('succeeds and derives domain from PUBLIC_URL when the key source and PUBLIC_URL are both set', async () => {
  process.env.PUBLIC_URL = 'https://example.ngrok.app';
  process.env.CT_DB_PATH = join(dir, 'db.sqlite3');
  process.env.CT_KEY_SOURCE = 'env';
  process.env.JWT_ALG = 'HS256';
  process.env.JWT_SECRET = Buffer.from('test-secret-32-bytes-padding-padd').toString('base64');

  const { domain } = await bootstrap();
  expect(domain).toEqual({ domainName: 'example.ngrok.app', stage: '' });
});
