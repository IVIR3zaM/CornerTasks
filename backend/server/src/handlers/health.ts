// GET /v1/health — unauthenticated liveness check for Docker/compose
// (`HEALTHCHECK` in backend/docker/Dockerfile, N09). Confirms the configured
// `Store` actually responds, without requiring auth or exposing any account
// data: the query targets a fixed sentinel `accountDid` that is not a valid
// DID and can never collide with a real account, and the response never
// includes the store's result — only ok/error.

import type { HttpEvent, HttpResult } from '../../../core/src/types/http';
import { json } from '../../../core/src/lib/response';
import { getStore } from '../../../core/src/lib/db';

const HEALTH_CHECK_ACCOUNT_DID = '__cornertasks_health_check__';

export async function handler(_event: HttpEvent): Promise<HttpResult> {
  try {
    await getStore().queryEventsAfter(HEALTH_CHECK_ACCOUNT_DID, '0');
    return json(200, { status: 'ok' });
  } catch {
    return json(503, { status: 'error' });
  }
}
