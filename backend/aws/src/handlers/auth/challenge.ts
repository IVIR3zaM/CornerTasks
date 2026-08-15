// Thin Lambda entry point: wires the AWS runtime's DynamoDB store into
// core's seam, then re-exports the runtime-neutral handler unchanged. No
// signing key is needed here — see backend/core/src/handlers/auth/challenge.ts.

import { handler as coreChallenge } from '../../../../core/src/handlers/auth/challenge';
import { ensureStore } from '../../lib/runtime-bootstrap';

ensureStore();

export const handler = coreChallenge;
