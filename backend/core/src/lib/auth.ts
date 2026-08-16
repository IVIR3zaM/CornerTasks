import type { HttpEvent, HttpResult } from '../types/http';
import { decodeJwt, verifyEdDsa, verifyHs256 } from './jwt';
import { getSigningKey } from './signing-key';
import { errorResponse } from './response';

export const BEARER_AUDIENCE = 'cornertasks-sync-v1';

export interface BearerSubject {
  accountDid: string;
}

export type BearerResult = { ok: true; subject: BearerSubject } | { ok: false; response: HttpResult };

/** The `reason` values §8.6 defines for a *bearer* token (as opposed to the
 *  DID-JWT presented at `/v1/auth/token`). These are the same strings the
 *  WebSocket `auth_err` frame carries — §11.1 says "reason values match §8.6"
 *  — which is why they live here rather than being re-derived per transport. */
export type BearerFailureReason = 'missing_token' | 'bad_token' | 'token_expired';

export type TokenVerification =
  | { ok: true; subject: BearerSubject }
  | { ok: false; reason: BearerFailureReason };

/** Verifies a raw bearer token string: signature against the deployment's
 *  signing key, `aud`, `exp`, and a `did:key` `sub`.
 *
 *  This is the transport-neutral half of `requireBearer`. It exists because
 *  the WebSocket handshake (§11.1, D2) carries the token in a JSON frame, not
 *  in an `Authorization` header, and there is no `HttpEvent` to hand to
 *  `requireBearer`. Splitting it out — rather than reimplementing the checks
 *  on the WS side — is what stops the two transports from drifting into
 *  different notions of "valid token", which would show up as one transport
 *  accepting a token the other rejects. `requireBearer` below is now a thin
 *  header-parsing wrapper over this function, so there is exactly one
 *  implementation. */
export async function verifyBearerToken(token: string): Promise<TokenVerification> {
  let decoded;
  try {
    decoded = decodeJwt(token);
  } catch {
    return { ok: false, reason: 'bad_token' };
  }

  const signing = await getSigningKey();
  if (decoded.header.alg !== signing.alg) {
    return { ok: false, reason: 'bad_token' };
  }
  const valid =
    signing.alg === 'EdDSA'
      ? await verifyEdDsa(decoded, signing.publicKey)
      : verifyHs256(decoded, signing.privateKey);
  if (!valid) return { ok: false, reason: 'bad_token' };

  const { aud, exp, sub } = decoded.claims;
  // Note: a bearer `aud` mismatch is `bad_token`, not `bad_audience` — §8.6
  // reserves `bad_audience` for the DID-JWT's `aud` at `/v1/auth/token`.
  if (aud !== BEARER_AUDIENCE) {
    return { ok: false, reason: 'bad_token' };
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof exp !== 'number' || exp < now) {
    return { ok: false, reason: 'token_expired' };
  }
  if (typeof sub !== 'string' || !sub.startsWith('did:key:')) {
    return { ok: false, reason: 'bad_token' };
  }
  return { ok: true, subject: { accountDid: sub } };
}

export async function requireBearer(event: HttpEvent): Promise<BearerResult> {
  const headers = event.headers ?? {};
  const auth = headers.authorization ?? headers.Authorization;
  if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
    return { ok: false, response: errorResponse(401, 'unauthorized', 'missing_token') };
  }
  const token = auth.slice('bearer '.length).trim();

  const result = await verifyBearerToken(token);
  if (!result.ok) {
    return { ok: false, response: errorResponse(401, 'unauthorized', result.reason) };
  }
  return { ok: true, subject: result.subject };
}

export function assertSubjectMatches(subject: BearerSubject, accountDid: string): HttpResult | null {
  if (subject.accountDid !== accountDid) {
    return errorResponse(403, 'forbidden', 'did_mismatch');
  }
  return null;
}
