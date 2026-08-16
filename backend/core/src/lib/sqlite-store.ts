// SQLite-backed Store for the self-hosted runtime (no DynamoDB required).
// Semantics are a persistent port of `tests/helpers/memory-store.ts`, which
// is what the existing sync/auth test suites pin: last-writer-wins on
// `(updatedAt, eventId)`, a per-account monotonic `seq` that stale-rejected
// writes still consume (a gap in the log), and a 60-day archive cutoff.
//
// `node:sqlite` (`DatabaseSync`) is fully synchronous, so every method below
// does its work in a single call with no `await` between reading and writing
// — that is what makes the per-account `seq` allocation race-free even under
// concurrent `Promise.all` callers (see the `ON CONFLICT ... DO UPDATE ...
// RETURNING` below): Node's single-threaded event loop cannot interleave two
// synchronous statements, so there is no window for two callers to observe
// the same counter value.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ARCHIVE_RETENTION_MS } from './archive-retention';
import type { AuthChallenge, QueryEventsResult, Store, StoredEvent } from './db';
import { parseCursor } from './db';

const ARCHIVE_CUTOFF_MS = ARCHIVE_RETENTION_MS;

/** Default path inside the container volume. `backend/docker/` (N09) mounts
 *  its named volume here; set `CT_DB_PATH` to override for any other layout. */
const DEFAULT_DB_PATH = '/data/cornertasks.sqlite3';

interface EventRow {
  account_did: string;
  task_id: string;
  seq: number;
  payload: string;
  archived_completed_at: string | null;
}

/** Everything about a `StoredEvent` that isn't part of the row's key or the
 *  columns queried on directly (`seq`, `archived_completed_at`). Stored as a
 *  single JSON column — the wire event shape isn't something SQLite needs to
 *  index into, and it keeps schema churn out of this file when the event
 *  shape changes. */
interface EventPayload {
  deviceId: string;
  eventId: string;
  updatedAt: string;
  op: 'upsert' | 'delete';
  ciphertext: string;
  nonce: string;
}

function toStoredEvent(row: EventRow): StoredEvent {
  const p = JSON.parse(row.payload) as EventPayload;
  return {
    accountDid: row.account_did,
    taskId: row.task_id,
    seq: row.seq,
    archivedCompletedAt: row.archived_completed_at ?? undefined,
    deviceId: p.deviceId,
    eventId: p.eventId,
    updatedAt: p.updatedAt,
    op: p.op,
    ciphertext: p.ciphertext,
    nonce: p.nonce
  };
}

function createSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      account_did TEXT NOT NULL,
      task_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      payload TEXT NOT NULL,
      archived_completed_at TEXT,
      PRIMARY KEY (account_did, task_id)
    );
    CREATE INDEX IF NOT EXISTS events_account_seq ON events (account_did, seq);
    CREATE TABLE IF NOT EXISTS seq_counters (
      account_did TEXT PRIMARY KEY,
      seq INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS challenges (
      account_did TEXT NOT NULL,
      challenge TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (account_did, challenge)
    );
  `);
}

/** Creates (or opens) a SQLite-backed `Store`.
 *
 * `dbPath` defaults to `CT_DB_PATH`, then to `DEFAULT_DB_PATH`. Pass
 * `:memory:` for an ephemeral, process-local database (used by tests and by
 * the `CT_STORE=sqlite` test override — see `tests/helpers/`).
 *
 * The returned store also exposes `close()` to release the underlying file
 * handle, beyond the plain `Store` contract — used by the restart test and
 * by graceful shutdown in the server runtime (N07). */
export function sqliteStore(dbPath?: string): Store & { close(): void } {
  const path = dbPath ?? process.env.CT_DB_PATH ?? DEFAULT_DB_PATH;
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  createSchema(db);

  // Allocates the next per-account seq atomically: a single UPSERT that
  // either seeds the counter at 1 or increments the existing row, returning
  // the new value in the same statement. No separate SELECT-then-INSERT
  // round trip, so there is nothing to wrap in an explicit transaction.
  const nextSeqStmt = db.prepare(
    `INSERT INTO seq_counters (account_did, seq) VALUES (?, 1)
     ON CONFLICT(account_did) DO UPDATE SET seq = seq + 1
     RETURNING seq`
  );
  const getEventStmt = db.prepare(
    'SELECT account_did, task_id, seq, payload, archived_completed_at FROM events WHERE account_did = ? AND task_id = ?'
  );
  const upsertEventStmt = db.prepare(
    `INSERT INTO events (account_did, task_id, seq, payload, archived_completed_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_did, task_id) DO UPDATE SET
       seq = excluded.seq,
       payload = excluded.payload,
       archived_completed_at = excluded.archived_completed_at`
  );
  const queryAfterStmt = db.prepare(
    'SELECT account_did, task_id, seq, payload, archived_completed_at FROM events WHERE account_did = ? AND seq > ? ORDER BY seq ASC'
  );
  const pruneCandidatesStmt = db.prepare(
    'SELECT task_id FROM events WHERE account_did = ? AND archived_completed_at IS NOT NULL AND archived_completed_at < ?'
  );
  const deleteEventStmt = db.prepare('DELETE FROM events WHERE account_did = ? AND task_id = ?');
  const putChallengeStmt = db.prepare(
    `INSERT INTO challenges (account_did, challenge, expires_at) VALUES (?, ?, ?)
     ON CONFLICT(account_did, challenge) DO UPDATE SET expires_at = excluded.expires_at`
  );
  const getChallengeStmt = db.prepare(
    'SELECT expires_at FROM challenges WHERE account_did = ? AND challenge = ?'
  );
  const deleteChallengeStmt = db.prepare('DELETE FROM challenges WHERE account_did = ? AND challenge = ?');

  function nextSeq(accountDid: string): number {
    const row = nextSeqStmt.get(accountDid) as { seq: number };
    return row.seq;
  }

  return {
    async putEvent(ev: StoredEvent) {
      // Allocate the seq first and unconditionally — a stale-rejected write
      // still consumes it, leaving a gap the pull cursor skips over, exactly
      // as memoryStore's independent counter does.
      const seq = nextSeq(ev.accountDid);
      const cur = getEventStmt.get(ev.accountDid, ev.taskId) as EventRow | undefined;
      if (cur) {
        const curPayload = JSON.parse(cur.payload) as EventPayload;
        if (curPayload.updatedAt > ev.updatedAt) return { accepted: false };
        if (curPayload.updatedAt === ev.updatedAt && curPayload.eventId >= ev.eventId) return { accepted: false };
      }
      const payload: EventPayload = {
        deviceId: ev.deviceId,
        eventId: ev.eventId,
        updatedAt: ev.updatedAt,
        op: ev.op,
        ciphertext: ev.ciphertext,
        nonce: ev.nonce
      };
      upsertEventStmt.run(ev.accountDid, ev.taskId, seq, JSON.stringify(payload), ev.archivedCompletedAt ?? null);
      return { accepted: true, seq };
    },

    async queryEventsAfter(accountDid, cursor): Promise<QueryEventsResult> {
      const cursorN = parseCursor(cursor);
      const cutoffIso = new Date(Date.now() - ARCHIVE_CUTOFF_MS).toISOString();
      const rows = queryAfterStmt.all(accountDid, cursorN) as unknown as EventRow[];
      const out: StoredEvent[] = [];
      for (const row of rows) {
        if (row.archived_completed_at && row.archived_completed_at < cutoffIso) continue;
        out.push(toStoredEvent(row));
      }
      const nextCursor = out.reduce((acc, ev) => (ev.seq && ev.seq > acc ? ev.seq : acc), cursorN);
      return { events: out, nextCursor: String(nextCursor) };
    },

    async pruneExpiredArchives(accountDid) {
      const cutoffIso = new Date(Date.now() - ARCHIVE_CUTOFF_MS).toISOString();
      const rows = pruneCandidatesStmt.all(accountDid, cutoffIso) as { task_id: string }[];
      for (const row of rows) {
        deleteEventStmt.run(accountDid, row.task_id);
      }
      return rows.length;
    },

    async putChallenge(c: AuthChallenge) {
      putChallengeStmt.run(c.accountDid, c.challenge, c.expiresAt);
    },

    async consumeChallenge(accountDid, challenge) {
      const row = getChallengeStmt.get(accountDid, challenge) as { expires_at: number } | undefined;
      if (!row) return false;
      deleteChallengeStmt.run(accountDid, challenge);
      return row.expires_at >= Date.now();
    },

    close() {
      db.close();
    }
  };
}
