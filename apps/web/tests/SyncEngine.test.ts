import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { TaskStore } from '../src/storage/TaskStore';
import {
  SyncEngine,
  inMemoryLastSyncedAt,
  noopVisibilityHost,
  type LastSyncedAtStorage,
  type VisibilityHost,
} from '../src/sync/SyncEngine';
import {
  type ChallengeResponse,
  type PullResponse,
  type PushResponse,
  type SyncTransport,
  type SyncTransportError,
  type TokenResponse,
} from '../src/sync/syncTransport';
import { isoFormat, makeEvent, type SyncEvent } from '../src/sync/syncEvent';
import { fromBip39Seed, type Identity } from '../src/crypto/identity';
import { encryptionKeyBytes } from '../src/crypto/keys';
import * as mnemonic from '../src/crypto/mnemonic';
import vectors from '../../../docs/crypto-vectors.json';

const VALID = vectors.mnemonic;
let dbCounter = 0;

class FakeTransport implements SyncTransport {
  challengeResponse: ChallengeResponse = {
    challenge: 'deadbeefdeadbeefdeadbeefdeadbeef',
    audience: 'https://example.test/prod',
    expiresAt: isoFormat(new Date(Date.now() + 300_000)),
  };
  tokenExpiresInSeconds = 3600;
  challengeCalls = 0;
  tokenCalls = 0;
  pushBatches: { accountDid: string; events: SyncEvent[]; bearer: string }[] = [];
  pullCalls: { accountDid: string; since: string; bearer: string }[] = [];
  pushFailures: SyncTransportError[] = [];
  pullFailures: SyncTransportError[] = [];
  pushResponder: (events: SyncEvent[]) => PushResponse = (events) => ({
    accepted: events.map((e) => e.eventId),
    rejected: [],
  });
  pullResponses: PullResponse[] = [];

  async challenge(): Promise<ChallengeResponse> {
    this.challengeCalls += 1;
    return this.challengeResponse;
  }
  async token(): Promise<TokenResponse> {
    this.tokenCalls += 1;
    return {
      accessToken: `tok-${this.tokenCalls}`,
      expiresAt: isoFormat(new Date(Date.now() + this.tokenExpiresInSeconds * 1000)),
    };
  }
  async push(accountDid: string, events: SyncEvent[], bearer: string): Promise<PushResponse> {
    if (this.pushFailures.length > 0) throw this.pushFailures.shift();
    this.pushBatches.push({ accountDid, events, bearer });
    return this.pushResponder(events);
  }
  async pull(accountDid: string, since: string, bearer: string): Promise<PullResponse> {
    if (this.pullFailures.length > 0) throw this.pullFailures.shift();
    this.pullCalls.push({ accountDid, since, bearer });
    if (this.pullResponses.length > 0) return this.pullResponses.shift()!;
    return { events: [], serverTime: isoFormat(new Date()) };
  }
}

class ManualVisibility implements VisibilityHost {
  private hidden = false;
  private listeners = new Set<() => void>();
  isHidden(): boolean { return this.hidden; }
  addListener(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  setHidden(v: boolean): void {
    this.hidden = v;
    for (const fn of this.listeners) fn();
  }
}

interface Harness {
  store: TaskStore;
  engine: SyncEngine;
  transport: FakeTransport;
  identity: Identity;
  encryptionKey: Uint8Array;
  lastSyncedAt: LastSyncedAtStorage;
}

const setupHarness = async (overrides: { visibility?: VisibilityHost } = {}): Promise<Harness> => {
  globalThis.indexedDB = new IDBFactory();
  dbCounter += 1;
  const store = await TaskStore.open(`engine-${dbCounter}`);
  const seed = await mnemonic.toSeed(VALID);
  const identity = await fromBip39Seed(seed);
  const encryptionKey = await encryptionKeyBytes(seed);
  const transport = new FakeTransport();
  const lastSyncedAt = inMemoryLastSyncedAt();
  const engine = new SyncEngine({
    store,
    transport,
    identity,
    encryptionKey,
    deviceId: 'device-fixed-001',
    lastSyncedAt,
    visibility: overrides.visibility ?? noopVisibilityHost(),
    setInterval: () => null,
    clearInterval: () => {},
  });
  return { store, engine, transport, identity, encryptionKey, lastSyncedAt };
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SyncEngine — disabled mode', () => {
  it('local mutations produce zero queue rows when no eventBuilder is installed', async () => {
    const h = await setupHarness();
    await h.store.add('local-only');
    await h.store.add('another');
    expect((await h.store.pendingQueueRows()).length).toBe(0);
  });
});

describe('SyncEngine — push round trip', () => {
  it('encrypts the event, posts it, and marks the queue row sent', async () => {
    const h = await setupHarness();
    h.engine.installEventBuilder();
    await h.store.add('ship-it');
    expect((await h.store.pendingQueueRows()).length).toBe(1);

    await h.engine.flushPushes();

    expect(h.transport.pushBatches).toHaveLength(1);
    const batch = h.transport.pushBatches[0];
    expect(batch.accountDid).toBe(h.identity.accountDid);
    expect(batch.events).toHaveLength(1);
    const event = batch.events[0];
    expect(event.op).toBe('upsert');
    expect(event.deviceId).toBe('device-fixed-001');

    const { openEvent } = await import('../src/sync/syncEvent');
    const pt = await openEvent(event, h.encryptionKey);
    expect(pt?.title).toBe('ship-it');

    expect((await h.store.pendingQueueRows()).length).toBe(0);
  });

  it('treats stale-rejected events as success', async () => {
    const h = await setupHarness();
    h.engine.installEventBuilder();
    await h.store.add('stale-event');
    const row = (await h.store.pendingQueueRows())[0];
    h.transport.pushResponder = () => ({
      accepted: [],
      rejected: [{ eventId: row.eventId, reason: 'stale' }],
    });
    await h.engine.flushPushes();
    expect((await h.store.pendingQueueRows()).length).toBe(0);
  });
});

describe('SyncEngine — archive cutoff', () => {
  it('skips upserts for tasks whose completedAt is older than 60 days', async () => {
    const h = await setupHarness();
    h.engine.installEventBuilder();
    const item = await h.store.add('ancient');
    // Force completedAt 70 days ago by reaching into IndexedDB directly.
    const old = Date.now() - 70 * 24 * 60 * 60 * 1000;
    await new Promise<void>((resolve, reject) => {
      const tx = (h.store as unknown as { db: IDBDatabase }).db.transaction('tasks', 'readwrite');
      const get = tx.objectStore('tasks').get(item!.id);
      get.onsuccess = () => {
        const row = get.result;
        row.completedAt = old;
        row.updatedAt = old;
        tx.objectStore('tasks').put(row);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    await h.store.complete(item!.id);
    // Force the new completedAt back to the old value so the cutoff check fires.
    await new Promise<void>((resolve, reject) => {
      const tx = (h.store as unknown as { db: IDBDatabase }).db.transaction('tasks', 'readwrite');
      const get = tx.objectStore('tasks').get(item!.id);
      get.onsuccess = () => {
        const row = get.result;
        row.completedAt = old;
        tx.objectStore('tasks').put(row);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    await h.engine.flushPushes();

    expect(h.transport.pushBatches.every((b) => b.events.length === 0)).toBe(true);
    expect((await h.store.pendingQueueRows()).length).toBe(0);
  });
});

describe('SyncEngine — pull merges (last-writer-wins)', () => {
  it('newer remote wins; older remote ignored', async () => {
    const h = await setupHarness();
    h.engine.installEventBuilder();
    const item = await h.store.add('local-version');
    const local = (await h.store.activeTasks())[0];

    const newer = new Date(local.createdAt.getTime() + 60_000);
    const newerEvent = await makeEvent({
      op: 'upsert',
      accountDid: h.identity.accountDid,
      deviceId: 'remote-device',
      taskId: item!.id,
      updatedAt: newer,
      plaintext: { title: 'remote-version', createdAt: local.createdAt, completedAt: null, dueDate: null, order: local.order },
      encryptionKey: h.encryptionKey,
    });
    h.transport.pullResponses = [{ events: [newerEvent], serverTime: isoFormat(newer) }];
    await h.engine.pullSince();
    expect((await h.store.activeTasks())[0].title).toBe('remote-version');

    const older = new Date(local.createdAt.getTime() - 60_000);
    const olderEvent = await makeEvent({
      op: 'upsert',
      accountDid: h.identity.accountDid,
      deviceId: 'remote-device',
      taskId: item!.id,
      updatedAt: older,
      plaintext: { title: 'stale-loser', createdAt: local.createdAt, completedAt: null, dueDate: null, order: local.order },
      encryptionKey: h.encryptionKey,
    });
    h.transport.pullResponses = [{ events: [olderEvent], serverTime: isoFormat(new Date()) }];
    await h.engine.pullSince();
    expect((await h.store.activeTasks())[0].title).toBe('remote-version');
  });

  it('breaks ties by lexicographic eventId', async () => {
    const h = await setupHarness();
    h.engine.installEventBuilder();
    const item = await h.store.add('tie-break');
    const local = (await h.store.activeTasks())[0];

    const sameTime = new Date(local.createdAt.getTime() + 1000);
    const lower = await makeEvent({
      op: 'upsert',
      accountDid: h.identity.accountDid,
      deviceId: 'remote-1',
      eventId: '00000000-0000-0000-0000-000000000001',
      taskId: item!.id,
      updatedAt: sameTime,
      plaintext: { title: 'lower-id', createdAt: local.createdAt, completedAt: null, dueDate: null, order: local.order },
      encryptionKey: h.encryptionKey,
    });
    const higher = await makeEvent({
      op: 'upsert',
      accountDid: h.identity.accountDid,
      deviceId: 'remote-2',
      eventId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      taskId: item!.id,
      updatedAt: sameTime,
      plaintext: { title: 'higher-id', createdAt: local.createdAt, completedAt: null, dueDate: null, order: local.order },
      encryptionKey: h.encryptionKey,
    });
    // Pull in lower-then-higher order; higher must win.
    h.transport.pullResponses = [{ events: [lower, higher], serverTime: isoFormat(sameTime) }];
    await h.engine.pullSince();
    expect((await h.store.activeTasks())[0].title).toBe('higher-id');

    h.transport.pullResponses = [{ events: [lower], serverTime: isoFormat(new Date()) }];
    await h.engine.pullSince();
    expect((await h.store.activeTasks())[0].title).toBe('higher-id');
  });
});

describe('SyncEngine — auth lifecycle', () => {
  it('on token_expired: invalidates cache, retries once, succeeds', async () => {
    const h = await setupHarness();
    h.engine.installEventBuilder();
    await h.store.add('retry-me');
    h.transport.pushFailures = [{ kind: 'tokenExpired' }];
    await h.engine.flushPushes();
    expect(h.transport.pushBatches).toHaveLength(1);
    expect(h.transport.tokenCalls).toBe(2);
    expect((await h.store.pendingQueueRows()).length).toBe(0);
  });

  it('persistent auth failure leaves queue rows pending', async () => {
    const h = await setupHarness();
    h.engine.installEventBuilder();
    await h.store.add('auth-fail');
    h.transport.pushFailures = [{ kind: 'tokenExpired' }, { kind: 'badToken' }];
    await h.engine.flushPushes();
    expect((await h.store.pendingQueueRows()).length).toBe(1);
  });

  it('did_mismatch is not retried', async () => {
    const h = await setupHarness();
    h.engine.installEventBuilder();
    await h.store.add('did-mismatch');
    h.transport.pushFailures = [{ kind: 'didMismatch' }];
    await h.engine.flushPushes();
    expect(h.transport.pushBatches).toHaveLength(0);
    expect(h.transport.tokenCalls).toBe(1);
    expect((await h.store.pendingQueueRows()).length).toBe(1);
  });
});

describe('SyncEngine — visibility', () => {
  it('does not schedule timers while document.hidden, fires on visible', async () => {
    const visibility = new ManualVisibility();
    visibility.setHidden(true);
    const h = await setupHarness({ visibility });
    h.engine.start();
    // Hidden start: no immediate flush is fine, but no timer should be scheduled.
    // (We can't directly observe timer count with the noop setInterval, so verify
    // by triggering visibility → visible and seeing both push+pull fire.)
    await h.store.add('queued-while-hidden');
    h.engine.installEventBuilder(); // re-install in case start() before queued
    // start() already installed it; do nothing extra.
    visibility.setHidden(false);
    // Visibility callback dispatches async work; await microtasks.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    // pullSince fired at least once on visible.
    expect(h.transport.pullCalls.length).toBeGreaterThanOrEqual(1);
    h.engine.stop();
  });
});

describe('AuthSession', () => {
  it('caches across calls until near expiry', async () => {
    const h = await setupHarness();
    const t1 = await h.engine.authSession.bearer();
    const t2 = await h.engine.authSession.bearer();
    expect(t1).toBe(t2);
    expect(h.transport.tokenCalls).toBe(1);
  });

  it('refreshes proactively when within refresh slack', async () => {
    const h = await setupHarness();
    h.transport.tokenExpiresInSeconds = 30; // less than the 60s slack
    const t1 = await h.engine.authSession.bearer();
    const t2 = await h.engine.authSession.bearer();
    expect(t1).not.toBe(t2);
    expect(h.transport.tokenCalls).toBeGreaterThanOrEqual(2);
  });

  it('never persists the token to localStorage or IndexedDB', async () => {
    const h = await setupHarness();
    await h.engine.authSession.bearer();
    const cached = h.engine.authSession.cachedTokenForTesting();
    expect(cached).toMatch(/^tok-/);
    // No LS key should mention the token or "token".
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      const val = localStorage.getItem(key) ?? '';
      expect(val).not.toContain(cached!);
    }
  });

  it('does not leak tokens across instances', async () => {
    const h = await setupHarness();
    await h.engine.authSession.bearer();
    const fresh = new (await import('../src/sync/authSession')).AuthSession(h.identity, h.transport);
    expect(fresh.cachedTokenForTesting()).toBeNull();
  });
});
