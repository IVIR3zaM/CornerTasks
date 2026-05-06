import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { errorResponse, json } from '../lib/response';
import { assertSubjectMatches, requireBearer } from '../lib/auth';
import { getStore } from '../lib/db';
import { PushRequestSchema } from '../types/api';
import type { PushReject, PushResponse } from '../types/api';

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const auth = await requireBearer(event);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return errorResponse(400, 'bad_request', 'invalid_json');
  }
  const parsed = PushRequestSchema.safeParse(body);
  if (!parsed.success) return errorResponse(400, 'bad_request', 'invalid', 'expected shape: ' + JSON.stringify(PushRequestSchema.shape) + ', got: ' + JSON.stringify(body));

  const subjectErr = assertSubjectMatches(auth.subject, parsed.data.accountDid);
  if (subjectErr) return subjectErr;

  const accepted: string[] = [];
  const rejected: PushReject[] = [];
  const seen = new Set<string>();

  for (const ev of parsed.data.events) {
    if (ev.accountDid !== parsed.data.accountDid) {
      return errorResponse(403, 'forbidden', 'did_mismatch');
    }
    if (seen.has(ev.eventId)) {
      // Idempotent on eventId — first wins, duplicates report as accepted.
      accepted.push(ev.eventId);
      continue;
    }
    seen.add(ev.eventId);
    const result = await getStore().putEvent(ev);
    if (result.accepted) accepted.push(ev.eventId);
    else rejected.push({ eventId: ev.eventId, reason: 'stale' });
  }

  const resp: PushResponse = { accepted, rejected };
  return json(200, resp);
}
