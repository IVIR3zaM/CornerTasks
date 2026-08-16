// The JWT signing key contract. This module defines the shape, the get/set
// injection seam, and the CT_KEY_SOURCE-driven loader for self-hosted runtimes.
// AWS Lambda uses its own SSM-backed path (backend/aws/src/lib/runtime-bootstrap.ts)
// and does not call the loader here; only self-hosted runtimes use CT_KEY_SOURCE.

import { readFileSync } from 'fs';
import type { JwtAlg } from './jwt';

export interface SigningKey {
  alg: JwtAlg;
  kid: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

let cached: SigningKey | null = null;

export function setSigningKey(k: SigningKey | null): void {
  cached = k;
}

export async function getSigningKey(): Promise<SigningKey> {
  if (cached) return cached;

  // Try CT_KEY_SOURCE-driven loading first (self-hosted runtimes).
  const keySource = process.env.CT_KEY_SOURCE;
  if (keySource === 'env') {
    cached = await loadFromEnv();
    return cached;
  }
  if (keySource === 'file') {
    cached = loadFromFile();
    return cached;
  }
  if (keySource === 'ssm' || keySource === undefined) {
    throw new Error(
      'SSM signing key source not available in backend/core; ' +
      'the AWS Lambda runtime supplies its own SSM-backed key directly via runtime-bootstrap.ts. ' +
      'To use this core-side loader, set CT_KEY_SOURCE=env or CT_KEY_SOURCE=file'
    );
  }

  throw new Error(`unknown CT_KEY_SOURCE: ${keySource}`);
}

async function loadFromEnv(): Promise<SigningKey> {
  const alg = (process.env.JWT_ALG as JwtAlg) ?? 'EdDSA';
  const kid = process.env.JWT_KID ?? 'ct-signing-key';

  if (alg === 'HS256') {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('CT_KEY_SOURCE=env with JWT_ALG=HS256 requires JWT_SECRET environment variable');
    }
    validateBase64(secret, 'JWT_SECRET');
    const secretBytes = new Uint8Array(Buffer.from(secret, 'base64'));
    return { alg, kid, privateKey: secretBytes, publicKey: secretBytes };
  }

  const privBase64 = process.env.JWT_PRIVATE_KEY;
  const pubBase64 = process.env.JWT_PUBLIC_KEY;

  if (!privBase64) {
    throw new Error('CT_KEY_SOURCE=env with JWT_ALG=EdDSA requires JWT_PRIVATE_KEY environment variable');
  }
  if (!pubBase64) {
    throw new Error('CT_KEY_SOURCE=env with JWT_ALG=EdDSA requires JWT_PUBLIC_KEY environment variable');
  }

  validateBase64(privBase64, 'JWT_PRIVATE_KEY');
  validateBase64(pubBase64, 'JWT_PUBLIC_KEY');
  const privateKey = new Uint8Array(Buffer.from(privBase64, 'base64'));
  const publicKey = new Uint8Array(Buffer.from(pubBase64, 'base64'));

  return { alg, kid, privateKey, publicKey };
}

function loadFromFile(): SigningKey {
  const alg = (process.env.JWT_ALG as JwtAlg) ?? 'EdDSA';
  const kid = process.env.JWT_KID ?? 'ct-signing-key';

  if (alg === 'HS256') {
    const secretPath = process.env.JWT_SECRET_FILE;
    if (!secretPath) {
      throw new Error('CT_KEY_SOURCE=file with JWT_ALG=HS256 requires JWT_SECRET_FILE environment variable');
    }
    let secretBase64: string;
    try {
      secretBase64 = readFileSync(secretPath, 'utf8').trim();
    } catch (e) {
      throw new Error(
        `JWT_SECRET_FILE cannot be read from ${secretPath}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
    validateBase64(secretBase64, `${secretPath}`);
    const secretBytes = new Uint8Array(Buffer.from(secretBase64, 'base64'));
    return { alg, kid, privateKey: secretBytes, publicKey: secretBytes };
  }

  const privPath = process.env.JWT_PRIVATE_KEY_FILE;
  const pubPath = process.env.JWT_PUBLIC_KEY_FILE;

  if (!privPath) {
    throw new Error('CT_KEY_SOURCE=file with JWT_ALG=EdDSA requires JWT_PRIVATE_KEY_FILE environment variable');
  }
  if (!pubPath) {
    throw new Error('CT_KEY_SOURCE=file with JWT_ALG=EdDSA requires JWT_PUBLIC_KEY_FILE environment variable');
  }

  let privBase64: string;
  let pubBase64: string;

  try {
    privBase64 = readFileSync(privPath, 'utf8').trim();
  } catch (e) {
    throw new Error(
      `JWT_PRIVATE_KEY_FILE cannot be read from ${privPath}: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  try {
    pubBase64 = readFileSync(pubPath, 'utf8').trim();
  } catch (e) {
    throw new Error(
      `JWT_PUBLIC_KEY_FILE cannot be read from ${pubPath}: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  validateBase64(privBase64, `${privPath}`);
  validateBase64(pubBase64, `${pubPath}`);
  const privateKey = new Uint8Array(Buffer.from(privBase64, 'base64'));
  const publicKey = new Uint8Array(Buffer.from(pubBase64, 'base64'));

  return { alg, kid, privateKey, publicKey };
}

// Validate that a string is properly formatted base64 (RFC 4648).
// Base64 strings contain only [A-Za-z0-9+/] with optional padding (=, ==).
function validateBase64(value: string, varName: string): void {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error(`${varName} is not valid base64`);
  }
}
