// Storage layer for events + auth challenges. This module defines the
// runtime-neutral `Store` contract only. Each runtime supplies its own
// concrete implementation and registers it with `setStore()` before serving
// requests — backend/aws does this with a DynamoDB-backed store, a future
// self-hosted runtime with SQLite. Tests inject an in-memory adapter.

import type { SyncEvent } from '../types/api';

export { ARCHIVE_RETENTION_DAYS, ARCHIVE_RETENTION_MS } from './archive-retention';

export interface StoredEvent extends SyncEvent {
  archivedCompletedAt?: string | null;
  /** Server-assigned monotonic per-account sequence number. Set inside
   *  `putEvent`; absent on the in-flight `SyncEvent` the client sends. */
  seq?: number;
}

/** Projects a `StoredEvent` down to the on-the-wire `Event` shape.
 *
 *  `seq` and `archivedCompletedAt` are server-side bookkeeping: `seq` is
 *  surfaced to clients only as the opaque `nextCursor`, and
 *  `archivedCompletedAt` is a retention index. Both MUST be stripped before an
 *  event leaves the server, on **every** transport — `GET /v1/sync/pull`
 *  (§7.2) and the WebSocket `events` frame (§11.2, §11.4) deliver the same
 *  bytes, and §12.4 lets a client change transport mid-session, so a field
 *  present on one and absent on the other would surface as a decode failure or
 *  a spurious diff the moment a client switched. One function, both callers.
 *
 *  Written as an explicit allowlist rather than a rest-spread that drops the
 *  two known extras: a field added to `StoredEvent` for future server
 *  bookkeeping would be *published* by a denylist and silently ignored here,
 *  and `tsc` flags the reverse case (a genuinely new wire field) as a missing
 *  property. The wire shape is a contract two independent clients parse; it
 *  should only ever change on purpose. */
export function toWireEvent(ev: StoredEvent): SyncEvent {
  return {
    accountDid: ev.accountDid,
    deviceId: ev.deviceId,
    eventId: ev.eventId,
    taskId: ev.taskId,
    updatedAt: ev.updatedAt,
    op: ev.op,
    ciphertext: ev.ciphertext,
    nonce: ev.nonce
  };
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
  if (!store) {
    throw new Error('no Store configured; the runtime must call setStore() before handling requests');
  }
  return store;
}

export function resetStoreForTests(): void {
  store = null;
}
