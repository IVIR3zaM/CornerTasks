import type { HttpEvent, HttpResult } from '../types/http';
import { decodeJwt, verifyEdDsa, verifyHs256 } from './jwt';
import { getSigningKey } from './signing-key';
import { errorResponse } from './response';

export const BEARER_AUDIENCE = 'cornertasks-sync-v1';

export interface BearerSubject {
  accountDid: string;
}

export type BearerResult = { ok: true; subject: BearerSubject } | { ok: false; response: HttpResult };

export async function requireBearer(event: HttpEvent): Promise<BearerResult> {
  const headers = event.headers ?? {};
  const auth = headers.authorization ?? headers.Authorization;
  if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
    return { ok: false, response: errorResponse(401, 'unauthorized', 'missing_token') };
  }
  const token = auth.slice('bearer '.length).trim();

  let decoded;
  try {
    decoded = decodeJwt(token);
  } catch {
    return { ok: false, response: errorResponse(401, 'unauthorized', 'bad_token') };
  }

  const signing = await getSigningKey();
  if (decoded.header.alg !== signing.alg) {
    return { ok: false, response: errorResponse(401, 'unauthorized', 'bad_token') };
  }
  const valid =
    signing.alg === 'EdDSA'
      ? await verifyEdDsa(decoded, signing.publicKey)
      : verifyHs256(decoded, signing.privateKey);
  if (!valid) return { ok: false, response: errorResponse(401, 'unauthorized', 'bad_token') };

  const { aud, exp, sub } = decoded.claims;
  if (aud !== BEARER_AUDIENCE) {
    return { ok: false, response: errorResponse(401, 'unauthorized', 'bad_token') };
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof exp !== 'number' || exp < now) {
    return { ok: false, response: errorResponse(401, 'unauthorized', 'token_expired') };
  }
  if (typeof sub !== 'string' || !sub.startsWith('did:key:')) {
    return { ok: false, response: errorResponse(401, 'unauthorized', 'bad_token') };
  }
  return { ok: true, subject: { accountDid: sub } };
}

export function assertSubjectMatches(subject: BearerSubject, accountDid: string): HttpResult | null {
  if (subject.accountDid !== accountDid) {
    return errorResponse(403, 'forbidden', 'did_mismatch');
  }
  return null;
}
