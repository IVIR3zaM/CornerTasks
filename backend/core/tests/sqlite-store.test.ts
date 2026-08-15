import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { sqliteStore } from '../src/lib/sqlite-store';
import { createStoreFromEnv } from '../src/lib/store-factory';
import type { StoredEvent } from '../src/lib/db';

function makeEvent(accountDid: string, overrides: Partial<StoredEvent> = {}): StoredEvent {
  return {
    accountDid,
    deviceId: randomUUID(),
    eventId: overrides.eventId ?? randomUUID(),
    taskId: overrides.taskId ?? randomUUID(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
    op: overrides.op ?? 'upsert',
    ciphertext: Buffer.from('hello').toString('base64url'),
    nonce: Buffer.from('123456789012').toString('base64url'),
    ...overrides
  };
}

describe('sqliteStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ct-sqlite-store-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('basic semantics match memoryStore: last-writer-wins, stale rejection', async () => {
    const store = sqliteStore(join(dir, 'basic.sqlite3'));
    try {
      const accountDid = 'did:key:zTestAccount1';
      const taskId = randomUUID();
      const older = makeEvent(accountDid, { taskId, updatedAt: '2026-01-01T00:00:00.000Z' });
      const newer = makeEvent(accountDid, { taskId, updatedAt: '2026-01-02T00:00:00.000Z' });

      const r1 = await store.putEvent(newer);
      expect(r1.accepted).toBe(true);
      expect(r1.seq).toBe(1);

      const r2 = await store.putEvent(older);
      expect(r2.accepted).toBe(false);
      expect(r2.seq).toBeUndefined();

      const { events, nextCursor } = await store.queryEventsAfter(accountDid, '0');
      expect(events).toHaveLength(1);
      expect(events[0]!.eventId).toBe(newer.eventId);
      expect(nextCursor).toBe('1');
    } finally {
      store.close();
    }
  });

  test('stale rejection still consumes a seq (gap in the log)', async () => {
    const store = sqliteStore(join(dir, 'gap.sqlite3'));
    try {
      const accountDid = 'did:key:zTestAccount2';
      const taskId = randomUUID();
      const newer = makeEvent(accountDid, { taskId, updatedAt: '2026-01-02T00:00:00.000Z' });
      const older = makeEvent(accountDid, { taskId, updatedAt: '2026-01-01T00:00:00.000Z' });
      const other = makeEvent(accountDid, { updatedAt: '2026-01-03T00:00:00.000Z' });

      await store.putEvent(newer); // seq 1
      const rejected = await store.putEvent(older); // consumes seq 2, rejected
      expect(rejected.accepted).toBe(false);
      const accepted = await store.putEvent(other); // seq 3

      expect(accepted.seq).toBe(3);
      const { events } = await store.queryEventsAfter(accountDid, '0');
      expect(events.map((e) => e.eventId)).toEqual([newer.eventId, other.eventId]);
    } finally {
      store.close();
    }
  });

  test('50 parallel putEvent calls on one account yield 50 distinct sequential seq values', async () => {
    const store = sqliteStore(join(dir, 'concurrency.sqlite3'));
    try {
      const accountDid = 'did:key:zTestConcurrency';
      const events = Array.from({ length: 50 }, () => makeEvent(accountDid));

      const results = await Promise.all(events.map((ev) => store.putEvent(ev)));
      const seqs = results.map((r) => {
        expect(r.accepted).toBe(true);
        return r.seq;
      });

      const uniqueSeqs = new Set(seqs);
      expect(uniqueSeqs.size).toBe(50);
      expect([...uniqueSeqs].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(
        Array.from({ length: 50 }, (_, i) => i + 1)
      );
    } finally {
      store.close();
    }
  });

  test('restart: write, close, reopen, queryEventsAfter returns the data', async () => {
    const dbPath = join(dir, 'restart.sqlite3');
    const accountDid = 'did:key:zTestRestart';
    const ev = makeEvent(accountDid);

    const store1 = sqliteStore(dbPath);
    const put = await store1.putEvent(ev);
    expect(put.accepted).toBe(true);
    store1.close();

    const store2 = sqliteStore(dbPath);
    try {
      const { events, nextCursor } = await store2.queryEventsAfter(accountDid, '0');
      expect(events).toHaveLength(1);
      expect(events[0]!.eventId).toBe(ev.eventId);
      expect(events[0]!.ciphertext).toBe(ev.ciphertext);
      expect(nextCursor).toBe(String(put.seq));
    } finally {
      store2.close();
    }
  });

  test('pruneExpiredArchives removes only archived events past the retention cutoff', async () => {
    const store = sqliteStore(join(dir, 'prune.sqlite3'));
    try {
      const accountDid = 'did:key:zTestPrune';
      const old = makeEvent(accountDid, {
        archivedCompletedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
      });
      const fresh = makeEvent(accountDid);
      await store.putEvent(old);
      await store.putEvent(fresh);

      const removed = await store.pruneExpiredArchives(accountDid);
      expect(removed).toBe(1);

      const { events } = await store.queryEventsAfter(accountDid, '0');
      expect(events.map((e) => e.eventId)).toEqual([fresh.eventId]);
    } finally {
      store.close();
    }
  });

  test('putChallenge / consumeChallenge: one-time use, expiry enforced', async () => {
    const store = sqliteStore(join(dir, 'challenge.sqlite3'));
    try {
      const accountDid = 'did:key:zTestChallenge';
      await store.putChallenge({ accountDid, challenge: 'abc', expiresAt: Date.now() + 60_000 });
      expect(await store.consumeChallenge(accountDid, 'abc')).toBe(true);
      // Second consume of the same challenge fails — one-time use.
      expect(await store.consumeChallenge(accountDid, 'abc')).toBe(false);

      await store.putChallenge({ accountDid, challenge: 'expired', expiresAt: Date.now() - 1000 });
      expect(await store.consumeChallenge(accountDid, 'expired')).toBe(false);
      // Already consumed even though expired/rejected — matches memoryStore.
      expect(await store.consumeChallenge(accountDid, 'expired')).toBe(false);
    } finally {
      store.close();
    }
  });
});

describe('createStoreFromEnv', () => {
  const originalStore = process.env.CT_STORE;
  const originalDbPath = process.env.CT_DB_PATH;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ct-sqlite-factory-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalStore === undefined) delete process.env.CT_STORE;
    else process.env.CT_STORE = originalStore;
    if (originalDbPath === undefined) delete process.env.CT_DB_PATH;
    else process.env.CT_DB_PATH = originalDbPath;
  });

  test('CT_STORE=sqlite returns a working SQLite-backed store using CT_DB_PATH', async () => {
    process.env.CT_STORE = 'sqlite';
    process.env.CT_DB_PATH = join(dir, 'factory.sqlite3');
    const store = createStoreFromEnv() as ReturnType<typeof sqliteStore>;
    try {
      const accountDid = 'did:key:zTestFactory';
      const r = await store.putEvent(makeEvent(accountDid));
      expect(r.accepted).toBe(true);
    } finally {
      store.close();
    }
  });

  test('CT_STORE=dynamo throws — not constructible from backend/core', () => {
    process.env.CT_STORE = 'dynamo';
    expect(() => createStoreFromEnv()).toThrow(
      "CT_STORE=dynamo is not constructible from backend/core; the runtime must select 'memory' or 'dynamo' itself"
    );
  });

  test('CT_STORE=memory throws — not constructible from backend/core', () => {
    process.env.CT_STORE = 'memory';
    expect(() => createStoreFromEnv()).toThrow(
      "CT_STORE=memory is not constructible from backend/core; the runtime must select 'memory' or 'dynamo' itself"
    );
  });
});
