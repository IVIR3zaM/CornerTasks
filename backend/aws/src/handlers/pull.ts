import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { errorResponse, json } from '../lib/response';
import { assertSubjectMatches, requireBearer } from '../lib/auth';
import { getStore } from '../lib/db';
import { DidKey } from '../types/api';
import type { PullResponse } from '../types/api';

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const auth = await requireBearer(event);
  if (!auth.ok) return auth.response;

  const qs = event.queryStringParameters ?? {};
  const accountDid = qs.accountDid;
  const since = qs.since;
  if (!accountDid) {
    return errorResponse(400, 'bad_request', 'invalid_did.no_account_did', 'qs object: ' + JSON.stringify(qs));
  }
  if (!DidKey.safeParse(accountDid).success) {
    return errorResponse(400, 'bad_request', 'invalid_did.malformed_account_did', 'accountDid: ' + accountDid);
  }
  if (!since) return errorResponse(400, 'bad_request', 'missing_since');
  const sinceMs = Date.parse(since);
  if (Number.isNaN(sinceMs)) return errorResponse(400, 'bad_request', 'invalid_since');

  const subjectErr = assertSubjectMatches(auth.subject, accountDid);
  if (subjectErr) return subjectErr;

  const events = await getStore().queryEventsSince(accountDid, sinceMs);
  const resp: PullResponse = {
    events: events.map(({ archivedCompletedAt: _ignored, ...rest }) => rest),
    serverTime: new Date().toISOString()
  };
  return json(200, resp);
}
