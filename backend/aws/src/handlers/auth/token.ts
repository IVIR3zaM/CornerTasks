import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { errorResponse, json } from '../../lib/response';
import { getStore } from '../../lib/db';
import { TokenRequestSchema } from '../../types/api';
import type { TokenResponse } from '../../types/api';
import { decodeJwt, signEdDsa, signHs256, verifyEdDsa } from '../../lib/jwt';
import { InvalidDidError, methodSpecificId, publicKeyFromDid } from '../../lib/did';
import { getSigningKey } from '../../lib/signing-key';
import { BEARER_AUDIENCE } from '../../lib/auth';
import { audienceFromEvent } from '../../lib/api-url';

const ACCESS_TOKEN_TTL_S = Number(process.env.ACCESS_TOKEN_TTL_S ?? 3600);
const MAX_DID_JWT_LIFETIME_S = 300;
const IAT_SKEW_S = 60;

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  let body: unknown;
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return errorResponse(400, 'bad_request', 'invalid_json');
  }
  const parsed = TokenRequestSchema.safeParse(body);
  if (!parsed.success) return errorResponse(400, 'bad_request', 'invalid_did_jwt.not_parsed');
  const { accountDid, didJwt } = parsed.data;

  let pub: Uint8Array;
  try {
    pub = publicKeyFromDid(accountDid);
  } catch (err) {
    if (err instanceof InvalidDidError) return errorResponse(400, 'bad_request', 'invalid_did');
    throw err;
  }

  let decoded;
  try {
    decoded = decodeJwt(didJwt);
  } catch {
    return errorResponse(400, 'bad_request', 'invalid_did_jwt.decode_failed');
  }
  if (decoded.header.alg !== 'EdDSA') {
    return errorResponse(400, 'bad_request', 'invalid_did_jwt.unsupported_alg');
  }
  const expectedKid = `${accountDid}#${methodSpecificId(accountDid)}`;
  if (decoded.header.kid !== expectedKid) {
    return errorResponse(400, 'bad_request', 'invalid_did_jwt.invalid_kid', 'expected_kid: ' + expectedKid + ', got: ' + decoded.header.kid);
  }

  const sigOk = await verifyEdDsa(decoded, pub);
  if (!sigOk) return errorResponse(401, 'unauthorized', 'bad_signature');

  const { iss, sub, aud, nonce, iat, exp } = decoded.claims;
  if (iss !== accountDid || sub !== accountDid) {
    return errorResponse(400, 'bad_request', 'invalid_did_jwt.invalid_sub_iss');
  }
  const expectedAud = audienceFromEvent(event);
  if (typeof aud !== 'string' || aud !== expectedAud) {
    return errorResponse(401, 'unauthorized', 'bad_audience');
  }
  if (typeof iat !== 'number' || typeof exp !== 'number') {
    return errorResponse(400, 'bad_request', 'invalid_did_jwt.invalid_iat_exp');
  }
  if (exp - iat > MAX_DID_JWT_LIFETIME_S) {
    return errorResponse(401, 'unauthorized', 'bad_lifetime');
  }
  const now = Math.floor(Date.now() / 1000);
  if (iat > now + IAT_SKEW_S || exp < now) {
    return errorResponse(401, 'unauthorized', 'bad_lifetime');
  }
  if (typeof nonce !== 'string' || nonce.length === 0) {
    return errorResponse(400, 'bad_request', 'invalid_did_jwt.invalid_nonce');
  }

  const consumed = await getStore().consumeChallenge(accountDid, nonce);
  if (!consumed) return errorResponse(401, 'unauthorized', 'unknown_challenge');

  const signing = await getSigningKey();
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + ACCESS_TOKEN_TTL_S;
  const claims = {
    iss: expectedAud,
    sub: accountDid,
    aud: BEARER_AUDIENCE,
    iat: issuedAt,
    exp: expiresAt,
    jti: randomUUID()
  };
  const header = { alg: signing.alg, typ: 'JWT' as const, kid: signing.kid };
  const accessToken =
    signing.alg === 'EdDSA'
      ? await signEdDsa(header, claims, signing.privateKey)
      : signHs256(header, claims, signing.privateKey);

  const resp: TokenResponse = {
    accessToken,
    tokenType: 'Bearer',
    expiresIn: ACCESS_TOKEN_TTL_S,
    expiresAt: new Date(expiresAt * 1000).toISOString()
  };
  return json(200, resp);
}
