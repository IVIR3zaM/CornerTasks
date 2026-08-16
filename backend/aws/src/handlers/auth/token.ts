// Thin Lambda entry point: wires the AWS runtime (DynamoDB store, SSM
// signing key) into core's seams, then delegates to the runtime-neutral
// handler. No auth/token logic lives here — see backend/core/src/handlers/auth/token.ts.

import type { HttpEvent, HttpResult } from '../../../../core/src/types/http';
import { handler as coreToken } from '../../../../core/src/handlers/auth/token';
import { ensureStore, ensureSigningKey } from '../../lib/runtime-bootstrap';

ensureStore();

export async function handler(event: HttpEvent): Promise<HttpResult> {
  await ensureSigningKey();
  return coreToken(event);
}
