#!/usr/bin/env -S node --enable-source-maps
// Tiny helper used by docs/sync-protocol.md §9 hand-testing examples.
//
// Usage:
//   npx ts-node scripts/sign-did-jwt.ts \
//     --private-key-hex <64 hex chars> \
//     --audience https://abc.execute-api.us-east-1.amazonaws.com/prod \
//     --challenge <base64url challenge from /v1/auth/challenge>
//
// Mnemonic-derived keys land in iteration 7; once that ships this script
// will accept `--mnemonic "..."` directly. For now the macOS app can dump
// its identity private key in hex and pipe it here.

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { didFromPublicKey, methodSpecificId } from '../src/lib/did';
import { signEdDsa } from '../src/lib/jwt';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const privateKeyHex = arg('private-key-hex');
  const audience = arg('audience');
  const challenge = arg('challenge');
  const lifetimeS = Number(arg('lifetime-s') ?? 120);

  if (!privateKeyHex || !audience || !challenge) {
    console.error('--private-key-hex, --audience, and --challenge are required');
    process.exit(2);
    return;
  }

  const privateKey = Buffer.from(privateKeyHex, 'hex');
  if (privateKey.length !== 32) {
    console.error('--private-key-hex must decode to 32 bytes');
    process.exit(2);
    return;
  }

  const publicKey = await ed.getPublicKey(privateKey);
  const did = didFromPublicKey(publicKey);
  const iat = Math.floor(Date.now() / 1000);
  const claims = { iss: did, sub: did, aud: audience, nonce: challenge, iat, exp: iat + lifetimeS };
  const header = { alg: 'EdDSA' as const, typ: 'JWT' as const, kid: `${did}#${methodSpecificId(did)}` };
  const jwt = await signEdDsa(header, claims, privateKey);
  process.stdout.write(`${did}\n${jwt}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
