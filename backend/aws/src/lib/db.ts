// Storage layer for events + auth challenges. The real implementation wraps
// a DynamoDB DocumentClient; tests inject an in-memory adapter via setStore().

import type { SyncEvent } from '../types/api';
import { dynamoStore } from './dynamo-store';

export { ARCHIVE_RETENTION_DAYS, ARCHIVE_RETENTION_MS } from './archive-retention';

export interface StoredEvent extends SyncEvent {
  archivedCompletedAt?: string | null;
  /** Server-assigned monotonic per-account sequence number. Set inside
   *  `putEvent`; absent on the in-flight `SyncEvent` the client sends. */
  seq?: number;
}

export interface AuthChallenge {
  accountDid: string;
  challenge: string;
  expiresAt: number;
}

export interface QueryEventsResult {
  events: StoredEvent[];
  /** New cursor — clients pass this back on the next pull. If no events were
   *  returned, this equals the input cursor. */
  nextCursor: string;
}

export interface Store {
  /** Allocates a server-assigned `seq` for the event, then conditionally writes
   *  it as the latest snapshot for `(accountDid, taskId)`. Stale-rejected events
   *  consume a `seq` (gap in the log) — readers skip gaps automatically since
   *  they query `seq > cursor`. */
  putEvent(ev: StoredEvent): Promise<{ accepted: boolean; seq?: number }>;
  /** Returns events with `seq > cursor`, ordered ascending by seq, plus the
   *  cursor to use on the next pull (max `seq` returned, or the input cursor if
   *  no events). The cursor is opaque to clients; the protocol guarantees only
   *  monotonicity. */
  queryEventsAfter(accountDid: string, cursor: string): Promise<QueryEventsResult>;
  /** Hard-deletes archived events whose `completedAt` is older than the retention
   *  cutoff (currently 60 days). Returns the number of rows removed. */
  pruneExpiredArchives(accountDid: string): Promise<number>;
  putChallenge(c: AuthChallenge): Promise<void>;
  consumeChallenge(accountDid: string, challenge: string): Promise<boolean>;
}

/** Parses an opaque cursor string into a number. Invalid input is treated as
 *  `0` ("from the beginning"). The cursor is server-issued so this lenient
 *  parsing exists only for the bootstrap case where a client sends `cursor=0`
 *  or omits the parameter. */
export function parseCursor(s: string | undefined | null): number {
  if (!s) return 0;
  if (!/^[0-9]+$/.test(s)) return 0;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

let store: Store | null = null;

export function setStore(s: Store): void {
  store = s;
}

export function getStore(): Store {
  if (!store) store = dynamoStore();
  return store;
}

export function resetStoreForTests(): void {
  store = null;
}
