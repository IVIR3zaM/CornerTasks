// CT_STORE env-based Store selection, for the pieces backend/core owns.
//
// `sqlite` is fully implemented here. `dynamo` needs
// `@aws-sdk/client-dynamodb` (`backend/aws/src/lib/dynamo-store.ts`) and
// `memory` is a test-only convenience (`tests/helpers/memory-store.ts`) —
// backend/core stays free of AWS dependencies and does not ship a
// production in-memory store, so a runtime that wants either of those
// selects it itself and never needs to call this factory. `backend/server`
// (N07) is expected to be the place that composes all three.
import type { Store } from './db';
import { sqliteStore } from './sqlite-store';

export function createStoreFromEnv(): Store {
  const kind = process.env.CT_STORE ?? 'sqlite';
  if (kind === 'sqlite') return sqliteStore();
  throw new Error(
    `CT_STORE=${kind} is not constructible from backend/core; the runtime must select 'memory' or 'dynamo' itself`
  );
}
