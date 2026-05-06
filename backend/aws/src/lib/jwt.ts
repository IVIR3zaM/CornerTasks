import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { base64urlDecode, base64urlEncode, utf8Encode } from './encoding';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

export type JwtAlg = 'EdDSA' | 'HS256';

export interface JwtHeader {
  alg: JwtAlg;
  typ: 'JWT';
  kid?: string;
}

export interface JwtClaims {
  iss?: string;
  sub?: string;
  aud?: string;
  nonce?: string;
  iat?: number;
  exp?: number;
  jti?: string;
  [k: string]: unknown;
}

export interface DecodedJwt {
  header: JwtHeader;
  claims: JwtClaims;
  signingInput: string;
  signature: Uint8Array;
}

export function decodeJwt(token: string): DecodedJwt {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('invalid_did_jwt');
  const [h, p, s] = parts as [string, string, string];
  let header: JwtHeader;
  let claims: JwtClaims;
  try {
    header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  } catch {
    throw new Error('invalid_did_jwt');
  }
  if (!header || header.typ !== 'JWT' || (header.alg !== 'EdDSA' && header.alg !== 'HS256')) {
    throw new Error('invalid_did_jwt');
  }
  return { header, claims, signingInput: `${h}.${p}`, signature: base64urlDecode(s) };
}

export async function verifyEdDsa(decoded: DecodedJwt, publicKey: Uint8Array): Promise<boolean> {
  if (decoded.header.alg !== 'EdDSA') return false;
  return ed.verify(decoded.signature, utf8Encode(decoded.signingInput), publicKey);
}

export function verifyHs256(decoded: DecodedJwt, secret: Uint8Array): boolean {
  if (decoded.header.alg !== 'HS256') return false;
  const expected = hmac(sha256, secret, utf8Encode(decoded.signingInput));
  if (expected.length !== decoded.signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= (expected[i] as number) ^ (decoded.signature[i] as number);
  }
  return diff === 0;
}

export async function signEdDsa(
  header: JwtHeader,
  claims: JwtClaims,
  privateKey: Uint8Array
): Promise<string> {
  const h = base64urlEncode(utf8Encode(JSON.stringify(header)));
  const p = base64urlEncode(utf8Encode(JSON.stringify(claims)));
  const signingInput = `${h}.${p}`;
  const sig = await ed.sign(utf8Encode(signingInput), privateKey);
  return `${signingInput}.${base64urlEncode(sig)}`;
}

export function signHs256(header: JwtHeader, claims: JwtClaims, secret: Uint8Array): string {
  const h = base64urlEncode(utf8Encode(JSON.stringify(header)));
  const p = base64urlEncode(utf8Encode(JSON.stringify(claims)));
  const signingInput = `${h}.${p}`;
  const sig = hmac(sha256, secret, utf8Encode(signingInput));
  return `${signingInput}.${base64urlEncode(sig)}`;
}
