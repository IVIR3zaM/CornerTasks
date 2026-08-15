// Thin Lambda entry point: wires the AWS runtime (DynamoDB store, SSM
// signing key) into core's seams, then delegates to the runtime-neutral
// handler. No sync/auth logic lives here — see backend/core/src/handlers/push.ts.

import type { HttpEvent, HttpResult } from '../../../core/src/types/http';
import { handler as corePush } from '../../../core/src/handlers/push';
import { ensureStore, ensureSigningKey } from '../lib/runtime-bootstrap';

ensureStore();

export async function handler(event: HttpEvent): Promise<HttpResult> {
  await ensureSigningKey();
  return corePush(event);
}
