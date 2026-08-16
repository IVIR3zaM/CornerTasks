import type { HttpEvent, HttpResult } from '../types/http';
import { errorResponse, json } from '../lib/response';
import { assertSubjectMatches, requireBearer } from '../lib/auth';
import { getStore, toWireEvent } from '../lib/db';
import { DidKey } from '../types/api';
import type { PullResponse } from '../types/api';

export async function handler(event: HttpEvent): Promise<HttpResult> {
  const auth = await requireBearer(event);
  if (!auth.ok) return auth.response;

  const qs = event.queryStringParameters ?? {};
  const accountDid = qs.accountDid;
  // Opaque server-issued cursor; "0" or absent means "from the beginning".
  const cursor = qs.cursor ?? '0';
  if (!accountDid) {
    return errorResponse(400, 'bad_request', 'invalid_did.no_account_did', 'qs object: ' + JSON.stringify(qs));
  }
  if (!DidKey.safeParse(accountDid).success) {
    return errorResponse(400, 'bad_request', 'invalid_did.malformed_account_did', 'accountDid: ' + accountDid);
  }
  if (!/^[0-9]+$/.test(cursor)) {
    return errorResponse(400, 'bad_request', 'invalid_cursor', 'cursor: ' + cursor);
  }

  const subjectErr = assertSubjectMatches(auth.subject, accountDid);
  if (subjectErr) return subjectErr;

  const result = await getStore().queryEventsAfter(accountDid, cursor);
  const resp: PullResponse = {
    events: result.events.map(toWireEvent),
    nextCursor: result.nextCursor
  };
  return json(200, resp);
}
