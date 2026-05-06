import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { randomBytes } from 'crypto';
import { errorResponse, json } from '../../lib/response';
import { getStore } from '../../lib/db';
import { ChallengeRequestSchema } from '../../types/api';
import type { ChallengeResponse } from '../../types/api';
import { base64urlEncode } from '../../lib/encoding';
import { audienceFromEvent } from '../../lib/api-url';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  let body: unknown;
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return errorResponse(400, 'bad_request', 'invalid_json');
  }
  const parsed = ChallengeRequestSchema.safeParse(body);
  if (!parsed.success) return errorResponse(400, 'bad_request', 'invalid_did');

  const challenge = base64urlEncode(randomBytes(32));
  const expiresAtMs = Date.now() + CHALLENGE_TTL_MS;
  await getStore().putChallenge({
    accountDid: parsed.data.accountDid,
    challenge,
    expiresAt: expiresAtMs
  });

  const resp: ChallengeResponse = {
    challenge,
    audience: audienceFromEvent(event),
    expiresAt: new Date(expiresAtMs).toISOString()
  };
  return json(200, resp);
}
