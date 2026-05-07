#!/usr/bin/env -S node --enable-source-maps
//
// CornerTasks sync-doctor — end-to-end smoke test against a deployed backend.
//
// Pointed at a real `ApiUrl` and a test mnemonic, it walks the full §8 + §7 wire
// protocol: challenge → DID-JWT → bearer token → push 1 encrypted upsert →
// pull from a fresh `since` → assert the round-trip ciphertext arrives byte-equal
// → assert AES-256-GCM decryption recovers the original plaintext.
//
// The point is to fail loudly (and pinpoint which step broke) when a refactor
// drifts the client/server contract. Run locally for ad-hoc checks; run from
// `.github/workflows/smoke-test.yml` against a long-lived dev deployment so
// regressions are caught before they reach a release.
//
// Inputs (all required):
//   CT_API_URL    Base URL of a deployed CornerTasks backend (e.g.
//                 https://abc.execute-api.us-east-1.amazonaws.com/Prod).
//   CT_MNEMONIC   12-word BIP-39 mnemonic. Use a throwaway test account —
//                 every event the doctor pushes is visible to anyone holding
//                 this mnemonic. Store in CI as a repository secret.
//
// Exit codes: 0 success; 2 missing/invalid env; 1 wire-format / network failure.
// On failure, the offending response (status, reason, body) is printed.

import { pbkdf2Sync, createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import * as ed from '@noble/ed25519';
import { didFromPublicKey, methodSpecificId } from '../src/lib/did';
import { signEdDsa } from '../src/lib/jwt';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const IDENTITY_INFO = new TextEncoder().encode('cornertasks-identity-ed25519');
const ENCRYPTION_INFO = new TextEncoder().encode('cornertasks-encryption-aesgcm');

interface Env {
  apiUrl: string;
  mnemonic: string;
}

function readEnv(): Env {
  const apiUrl = (process.env.CT_API_URL ?? '').trim().replace(/\/+$/, '');
  const mnemonic = (process.env.CT_MNEMONIC ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
  const missing: string[] = [];
  if (!apiUrl) missing.push('CT_API_URL');
  if (!mnemonic) missing.push('CT_MNEMONIC');
  if (missing.length > 0) {
    console.error(`sync-doctor: missing required env: ${missing.join(', ')}`);
    process.exit(2);
  }
  if (mnemonic.split(' ').length !== 12) {
    console.error('sync-doctor: CT_MNEMONIC must be a 12-word BIP-39 mnemonic');
    process.exit(2);
  }
  return { apiUrl, mnemonic };
}

function bip39Seed(mnemonic: string, passphrase = ''): Uint8Array {
  // BIP-39 spec: PBKDF2-HMAC-SHA512(mnemonic_NFKD, "mnemonic"+passphrase, 2048, 64).
  const salt = `mnemonic${passphrase}`.normalize('NFKD');
  const norm = mnemonic.normalize('NFKD');
  return new Uint8Array(pbkdf2Sync(Buffer.from(norm, 'utf8'), Buffer.from(salt, 'utf8'), 2048, 64, 'sha512'));
}

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  return new Uint8Array(Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
}

function aesGcmSeal(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return new Uint8Array(Buffer.concat([ct, tag]));
}

function aesGcmOpen(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, ctAndTag: Uint8Array): Uint8Array {
  if (ctAndTag.length < 16) throw new Error('ciphertext too short');
  const tag = ctAndTag.slice(ctAndTag.length - 16);
  const ct = ctAndTag.slice(0, ctAndTag.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  decipher.setAAD(aad);
  return new Uint8Array(Buffer.concat([decipher.update(ct), decipher.final()]));
}

async function postJson(url: string, body: unknown, bearer?: string): Promise<{ status: number; body: any }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* server may return empty body */ }
  return { status: res.status, body: json };
}

async function getJson(url: string, bearer: string): Promise<{ status: number; body: any }> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${bearer}` } });
  let json: any = null;
  try { json = await res.json(); } catch { /* server may return empty body */ }
  return { status: res.status, body: json };
}

function fail(step: string, status: number, body: any): never {
  const reason = (body && (body.reason ?? body.error)) ?? '';
  console.error(`sync-doctor: ${step} failed — HTTP ${status}${reason ? ` (${reason})` : ''}`);
  if (body) console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}

async function main(): Promise<void> {
  const { apiUrl, mnemonic } = readEnv();
  const seed = bip39Seed(mnemonic);
  const identitySeed = hkdf(sha256, seed, new Uint8Array(0), IDENTITY_INFO, 32);
  const encryptionKey = hkdf(sha256, seed, new Uint8Array(0), ENCRYPTION_INFO, 32);
  const publicKey = await ed.getPublicKey(identitySeed);
  const did = didFromPublicKey(publicKey);
  console.log(`sync-doctor: DID = ${did}`);
  console.log(`sync-doctor: API = ${apiUrl}`);

  // 1. challenge
  const ch = await postJson(`${apiUrl}/v1/auth/challenge`, { accountDid: did });
  if (ch.status !== 200) fail('POST /v1/auth/challenge', ch.status, ch.body);
  const { challenge, audience } = ch.body as { challenge: string; audience: string };
  console.log(`sync-doctor: got challenge (audience=${audience})`);

  // 2. DID-JWT → bearer
  const iat = Math.floor(Date.now() / 1000);
  const claims = { iss: did, sub: did, aud: audience, nonce: challenge, iat, exp: iat + 120 };
  const header = { alg: 'EdDSA' as const, typ: 'JWT' as const, kid: `${did}#${methodSpecificId(did)}` };
  const didJwt = await signEdDsa(header, claims, identitySeed);
  const tk = await postJson(`${apiUrl}/v1/auth/token`, { accountDid: did, didJwt });
  if (tk.status !== 200) fail('POST /v1/auth/token', tk.status, tk.body);
  const accessToken: string = tk.body.accessToken;
  if (!accessToken) fail('POST /v1/auth/token (no accessToken)', tk.status, tk.body);
  console.log('sync-doctor: bearer token issued');

  // 3. push one encrypted upsert
  const taskId = randomUUID();
  const eventId = randomUUID();
  const deviceId = randomUUID();
  const updatedAt = new Date().toISOString();
  const plaintext = JSON.stringify({
    title: `sync-doctor probe ${updatedAt}`,
    createdAt: updatedAt,
    completedAt: null,
    dueDate: null,
    order: 0,
  });
  const nonce = new Uint8Array(randomBytes(12));
  const aad = new TextEncoder().encode(`${did}|${taskId}|${eventId}`);
  const ctTag = aesGcmSeal(encryptionKey, nonce, aad, new TextEncoder().encode(plaintext));
  const event = {
    accountDid: did,
    deviceId,
    eventId,
    taskId,
    updatedAt,
    op: 'upsert',
    ciphertext: base64UrlEncode(ctTag),
    nonce: base64UrlEncode(nonce),
  };
  const push = await postJson(`${apiUrl}/v1/sync/push`, { accountDid: did, events: [event] }, accessToken);
  if (push.status !== 200) fail('POST /v1/sync/push', push.status, push.body);
  if (!(push.body.accepted ?? []).includes(eventId)) {
    console.error('sync-doctor: pushed event not in accepted list');
    console.error(JSON.stringify(push.body, null, 2));
    process.exit(1);
  }
  console.log('sync-doctor: pushed event accepted');

  // 4. pull and assert ciphertext round-trip
  const sinceParam = encodeURIComponent(new Date(Date.parse(updatedAt) - 1000).toISOString());
  const pull = await getJson(`${apiUrl}/v1/sync/pull?accountDid=${encodeURIComponent(did)}&since=${sinceParam}`, accessToken);
  if (pull.status !== 200) fail('GET /v1/sync/pull', pull.status, pull.body);
  const events: any[] = pull.body.events ?? [];
  const echoed = events.find((e) => e.eventId === eventId);
  if (!echoed) {
    console.error('sync-doctor: pushed event was not returned by pull');
    process.exit(1);
  }
  if (echoed.ciphertext !== event.ciphertext || echoed.nonce !== event.nonce) {
    console.error('sync-doctor: pulled ciphertext/nonce did not match (server is mutating events?)');
    process.exit(1);
  }

  // 5. decryption parity (catches encoder skew between sender and verifier)
  const decoded = new TextDecoder().decode(
    aesGcmOpen(encryptionKey, base64UrlDecode(echoed.nonce), aad, base64UrlDecode(echoed.ciphertext))
  );
  if (decoded !== plaintext) {
    console.error('sync-doctor: decryption succeeded but plaintext changed (encoder skew?)');
    console.error(`expected: ${plaintext}`);
    console.error(`got:      ${decoded}`);
    process.exit(1);
  }

  console.log('sync-doctor: round-trip OK ✓');
}

main().catch((err) => {
  console.error('sync-doctor: unhandled error');
  console.error(err);
  process.exit(1);
});
