// Thin Lambda entry point: wires the AWS runtime (DynamoDB store, SSM
// signing key) into core's seams, then delegates to the runtime-neutral
// handler. No sync/auth logic lives here — see backend/core/src/handlers/pull.ts.

import type { HttpEvent, HttpResult } from '../../../core/src/types/http';
import { handler as corePull } from '../../../core/src/handlers/pull';
import { ensureStore, ensureSigningKey } from '../lib/runtime-bootstrap';

ensureStore();

export async function handler(event: HttpEvent): Promise<HttpResult> {
  await ensureSigningKey();
  return corePull(event);
}
