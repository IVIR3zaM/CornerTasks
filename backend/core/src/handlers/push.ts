import type { HttpEvent, HttpResult } from '../types/http';
import { errorResponse, json } from '../lib/response';
import { assertSubjectMatches, requireBearer } from '../lib/auth';
import { getStore } from '../lib/db';
import { PushRequestSchema } from '../types/api';
import type { PushReject, PushResponse } from '../types/api';

export async function handler(event: HttpEvent): Promise<HttpResult> {
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

  // Opportunistic retention sweep: archived events past the retention window are
  // removed for this account on every push. Cheap because writes are infrequent
  // and the partition is bounded by per-account event count.
  try {
    await getStore().pruneExpiredArchives(parsed.data.accountDid);
  } catch {
    // Cleanup failure must not fail the push — rows simply linger until next attempt.
  }

  const resp: PushResponse = { accepted, rejected };
  return json(200, resp);
}
