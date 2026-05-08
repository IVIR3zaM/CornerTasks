// End-to-end-encrypted sync engine for the web app. Mirrors apps/macos/Sources/CornerTasks/Sync/SyncEngine.swift.
//
// Lifecycle:
// - Constructed only when cloud sync is enabled, a backendURL is set, and an Identity exists.
//   While disabled, no instance exists → no eventBuilder installed → no syncQueue rows → no
//   network calls.
// - `start()` installs a `TaskStore.eventBuilder` that writes encrypted queue rows on every
//   local mutation, immediately runs `flushPushes()` and `pullSince()`, and schedules the
//   10-minute push and 1-minute pull intervals. While `document.hidden`, the periodic timers
//   are paused; `visibilitychange → visible` resumes them and runs both immediately.
// - `stop()` clears intervals, removes the eventBuilder, releases the visibility listener.

import type { Identity } from '../crypto/identity';
import type { TaskStore, TaskMutationSnapshot, BuiltSyncEvent, EventBuilder } from '../storage/TaskStore';
import { isoParse, makeEvent, openEvent, type SyncEvent } from './syncEvent';
import { AuthSession } from './authSession';
import type { SyncTransport, SyncTransportError } from './syncTransport';
import { isSyncTransportError } from './syncTransport';

export interface LastSyncedAtStorage {
  get(): string | null;
  set(v: string | null): void;
}

export interface VisibilityHost {
  isHidden(): boolean;
  addListener(fn: () => void): () => void;
}

export const ARCHIVE_CUTOFF_MS = 60 * 24 * 60 * 60 * 1000;

/** Interim fix for the pull-cursor race: events whose client-set `updatedAt`
 *  is older than the server's `serverTime` at our last pull but which arrive
 *  at the server *after* that pull would otherwise be lost forever. We rewind
 *  `lastSyncedAt` by `CURSOR_LOOKBACK_MS` on every advance so those events
 *  come back on the next round. `applyRemote` is idempotent under
 *  last-writer-wins, so the redelivery is harmless. Replace with a
 *  server-assigned monotonic cursor in a follow-up iteration; see README
 *  "Known limitations". */
export const CURSOR_LOOKBACK_MS = 5 * 60 * 1000;

const cursorAfter = (serverTime: string): string => {
  const t = Date.parse(serverTime);
  if (Number.isNaN(t)) return serverTime;
  return new Date(Math.max(0, t - CURSOR_LOOKBACK_MS)).toISOString();
};
/** Test/legacy default. Real cadence is now `Prefs.syncIntervalSeconds`. */
export const DEFAULT_SYNC_INTERVAL_MS = 60_000;

const LS_LAST_SYNCED = 'cornertasks.sync.lastSyncedAt';
const LS_DEVICE_ID = 'cornertasks.sync.deviceId';
const EPOCH_ZERO_ISO = new Date(0).toISOString();

export const localStorageLastSyncedAt = (): LastSyncedAtStorage => ({
  get: () => localStorage.getItem(LS_LAST_SYNCED),
  set: (v) => {
    if (v === null) localStorage.removeItem(LS_LAST_SYNCED);
    else localStorage.setItem(LS_LAST_SYNCED, v);
  },
});

export const inMemoryLastSyncedAt = (initial?: string): LastSyncedAtStorage => {
  let v: string | null = initial ?? null;
  return { get: () => v, set: (x) => { v = x; } };
};

export const ensureDeviceId = (): string => {
  const existing = localStorage.getItem(LS_DEVICE_ID);
  if (existing) return existing;
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });
  localStorage.setItem(LS_DEVICE_ID, id);
  return id;
};

export const documentVisibilityHost = (): VisibilityHost => ({
  isHidden: () => typeof document !== 'undefined' && document.hidden,
  addListener: (fn) => {
    if (typeof document === 'undefined') return () => {};
    document.addEventListener('visibilitychange', fn);
    return () => document.removeEventListener('visibilitychange', fn);
  },
});

export const noopVisibilityHost = (): VisibilityHost => ({
  isHidden: () => false,
  addListener: () => () => {},
});

export const CLOUD_SYNC_CHANGED_EVENT = 'cornertasks:cloud-sync-changed';
/** Lightweight signal: only the timer cadence changed. The current engine
 *  reschedules its timers and keeps its bearer + AuthSession. Distinct from
 *  `CLOUD_SYNC_CHANGED_EVENT`, which is a full restart trigger. */
export const CLOUD_SYNC_INTERVAL_CHANGED_EVENT = 'cornertasks:cloud-sync-interval-changed';

export const fireCloudSyncChanged = (enabled: boolean): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CLOUD_SYNC_CHANGED_EVENT, { detail: { enabled } }));
};

export const fireCloudSyncIntervalChanged = (): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CLOUD_SYNC_INTERVAL_CHANGED_EVENT));
};

export interface SyncEngineOptions {
  store: TaskStore;
  transport: SyncTransport;
  identity: Identity;
  encryptionKey: Uint8Array;
  deviceId: string;
  lastSyncedAt?: LastSyncedAtStorage;
  visibility?: VisibilityHost;
  now?: () => Date;
  /** User-configured cadence in ms; same value drives push and pull timers. */
  intervalMs?: () => number;
  /** Returns true once the user has just (re-)enabled cloud sync. The engine
   *  consumes the flag exactly once via `clearPendingFullResync`. */
  pendingFullResync?: () => boolean;
  clearPendingFullResync?: () => void;
  /** Test seam: replaces window.setInterval / clearInterval. */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

export class SyncEngine {
  private readonly store: TaskStore;
  private readonly transport: SyncTransport;
  private readonly identity: Identity;
  private readonly encryptionKey: Uint8Array;
  private readonly deviceId: string;
  private readonly lastSyncedAt: LastSyncedAtStorage;
  private readonly visibility: VisibilityHost;
  private readonly now: () => Date;
  private readonly setIntervalImpl: (fn: () => void, ms: number) => unknown;
  private readonly clearIntervalImpl: (h: unknown) => void;
  private readonly intervalMs: () => number;
  private readonly pendingFullResyncFn: () => boolean;
  private readonly clearPendingFullResyncFn: () => void;
  readonly authSession: AuthSession;

  private pushTimer: unknown = null;
  private pullTimer: unknown = null;
  private removeVisibilityListener: (() => void) | null = null;

  constructor(opts: SyncEngineOptions) {
    this.store = opts.store;
    this.transport = opts.transport;
    this.identity = opts.identity;
    this.encryptionKey = opts.encryptionKey;
    this.deviceId = opts.deviceId;
    this.lastSyncedAt = opts.lastSyncedAt ?? localStorageLastSyncedAt();
    this.visibility = opts.visibility ?? documentVisibilityHost();
    this.now = opts.now ?? (() => new Date());
    this.setIntervalImpl =
      opts.setInterval ??
      ((fn, ms) => (typeof window !== 'undefined' ? window.setInterval(fn, ms) : setInterval(fn, ms)));
    this.clearIntervalImpl =
      opts.clearInterval ??
      ((h) => {
        if (typeof window !== 'undefined') window.clearInterval(h as number);
        else clearInterval(h as ReturnType<typeof setInterval>);
      });
    this.intervalMs = opts.intervalMs ?? (() => DEFAULT_SYNC_INTERVAL_MS);
    this.pendingFullResyncFn = opts.pendingFullResync ?? (() => false);
    this.clearPendingFullResyncFn = opts.clearPendingFullResync ?? (() => {});
    this.authSession = new AuthSession(this.identity, this.transport, { now: this.now });
  }

  start(): void {
    this.installEventBuilder();
    if (this.pendingFullResyncFn()) {
      void this.performFullResync().then(() => this.clearPendingFullResyncFn());
    } else {
      void this.flushPushes();
      void this.pullSince();
    }
    if (!this.visibility.isHidden()) this.scheduleTimers();
    this.removeVisibilityListener = this.visibility.addListener(() => this.onVisibilityChange());
  }

  stop(): void {
    this.cancelTimers();
    this.store.eventBuilder = null;
    if (this.removeVisibilityListener) {
      this.removeVisibilityListener();
      this.removeVisibilityListener = null;
    }
  }

  /** Internal but exposed so tests can install the builder without scheduling intervals. */
  installEventBuilder(): void {
    const builder: EventBuilder = async (snapshot: TaskMutationSnapshot): Promise<BuiltSyncEvent | null> => {
      const eventId = newEventId();
      const plaintext =
        snapshot.op === 'delete'
          ? null
          : {
              title: snapshot.title,
              createdAt: snapshot.createdAt,
              completedAt: snapshot.completedAt,
              dueDate: snapshot.dueDate,
              order: snapshot.order,
            };
      try {
        const event = await makeEvent({
          op: snapshot.op,
          accountDid: this.identity.accountDid,
          deviceId: this.deviceId,
          eventId,
          // Canonical lowercase per docs/sync-protocol.md §3. crypto.randomUUID
          // already lowercases, but old web rows or imports could still hold an
          // uppercase id; lowercase here so wire events are always canonical.
          taskId: snapshot.taskId.toLowerCase(),
          updatedAt: snapshot.updatedAt,
          plaintext,
          encryptionKey: this.encryptionKey,
        });
        return { eventId, payloadJSON: JSON.stringify(event) };
      } catch {
        return null;
      }
    };
    this.store.eventBuilder = builder;
  }

  async flushPushes(): Promise<void> {
    const rows = await this.store.pendingQueueRows();
    if (rows.length === 0) return;

    const cutoff = this.now().getTime() - ARCHIVE_CUTOFF_MS;
    const toSend: SyncEvent[] = [];
    const skippedSent: string[] = [];

    for (const row of rows) {
      if (row.op === 'upsert') {
        const completedAt = await this.store.taskCompletedAt(row.taskId);
        if (completedAt && completedAt.getTime() < cutoff) {
          skippedSent.push(row.eventId);
          continue;
        }
      }
      try {
        toSend.push(JSON.parse(row.payloadJSON) as SyncEvent);
      } catch {
        // Corrupt row — skip silently; the next mutation will replace it.
      }
    }

    if (skippedSent.length > 0) await this.store.markQueueRowsSent(skippedSent);
    if (toSend.length === 0) return;

    try {
      const response = await this.pushWithAuth(toSend);
      const toMark = [...response.accepted, ...response.rejected.map((r) => r.eventId)];
      if (toMark.length > 0) await this.store.markQueueRowsSent(toMark);
    } catch (err) {
      console.warn('[CornerTasks sync] push failed; will retry next tick', err);
    }
  }

  /** One-shot reset. Discards every row in the local outbound queue, pulls the
   *  full state from the backend (since-epoch), then re-enqueues an upsert for
   *  every local task the server did not return — and pushes the lot. After this
   *  runs, the cloud holds an up-to-date copy of every live local task. Archived
   *  tasks completed more than `ARCHIVE_CUTOFF_MS` ago are intentionally left out
   *  — they are dropped from both ends by the retention policy. */
  async performFullResync(): Promise<void> {
    await this.store.clearSyncQueue();
    this.lastSyncedAt.set(EPOCH_ZERO_ISO);
    const pulled = await this.pullForResync();
    const cutoff = this.now().getTime() - ARCHIVE_CUTOFF_MS;
    for (const snapshot of await this.store.liveSnapshots()) {
      if (pulled.has(snapshot.taskId)) continue;
      if (snapshot.completedAt && snapshot.completedAt.getTime() < cutoff) continue;
      await this.store.enqueueSnapshot(snapshot);
    }
    await this.flushPushes();
  }

  private async pullForResync(): Promise<Set<string>> {
    const since = this.lastSyncedAt.get() ?? EPOCH_ZERO_ISO;
    try {
      const response = await this.pullWithAuth(since);
      const pulled = new Set<string>();
      for (const event of response.events) {
        await this.applyRemote(event);
        pulled.add(event.taskId);
      }
      this.lastSyncedAt.set(cursorAfter(response.serverTime));
      console.info('[CornerTasks sync] resync pull complete', { pulled: pulled.size });
      return pulled;
    } catch (err) {
      console.warn('[CornerTasks sync] resync pull failed; rebuilding queue from local only', err);
      return new Set();
    }
  }

  async pullSince(): Promise<void> {
    const since = this.lastSyncedAt.get() ?? EPOCH_ZERO_ISO;
    try {
      const response = await this.pullWithAuth(since);
      for (const event of response.events) {
        await this.applyRemote(event);
      }
      this.lastSyncedAt.set(cursorAfter(response.serverTime));
    } catch (err) {
      console.warn('[CornerTasks sync] pull failed; will retry next tick', err);
    }
  }

  // MARK: - Bearer-aware push/pull

  private async pushWithAuth(events: SyncEvent[]) {
    const token = await this.authSession.bearer();
    try {
      return await this.transport.push(this.identity.accountDid, events, token);
    } catch (e) {
      if (isAuthRetryable(e)) {
        this.authSession.invalidate();
        const fresh = await this.authSession.bearer();
        return await this.transport.push(this.identity.accountDid, events, fresh);
      }
      throw e;
    }
  }

  private async pullWithAuth(since: string) {
    const token = await this.authSession.bearer();
    try {
      return await this.transport.pull(this.identity.accountDid, since, token);
    } catch (e) {
      if (isAuthRetryable(e)) {
        this.authSession.invalidate();
        const fresh = await this.authSession.bearer();
        return await this.transport.pull(this.identity.accountDid, since, fresh);
      }
      throw e;
    }
  }

  // MARK: - Apply pulled events

  private async applyRemote(event: SyncEvent): Promise<void> {
    if (event.accountDid !== this.identity.accountDid) return;
    const updatedAt = isoParse(event.updatedAt);
    if (!updatedAt) return;

    // Defense-in-depth: ignore very old upserts.
    if (event.op === 'upsert' && updatedAt.getTime() < this.now().getTime() - ARCHIVE_CUTOFF_MS) return;

    let plaintext;
    try {
      plaintext = await openEvent(event, this.encryptionKey);
    } catch {
      return;
    }
    // Canonical lowercase per docs/sync-protocol.md §3. v0.2.0-pre macOS
    // builds emitted uppercase taskIds; lowercasing on receipt keeps
    // IndexedDB keys consistent across clients.
    const taskId = event.taskId.toLowerCase();
    if (event.op === 'upsert') {
      if (!plaintext) return;
      await this.store.applyRemoteUpsert({
        taskId,
        title: plaintext.title,
        createdAt: plaintext.createdAt,
        completedAt: plaintext.completedAt,
        dueDate: plaintext.dueDate,
        order: plaintext.order,
        updatedAt,
        eventId: event.eventId,
      });
    } else if (event.op === 'delete') {
      await this.store.applyRemoteDelete({ taskId, updatedAt, eventId: event.eventId });
    }
  }

  // MARK: - Tab visibility

  private onVisibilityChange(): void {
    if (this.visibility.isHidden()) {
      this.cancelTimers();
    } else {
      void this.flushPushes();
      void this.pullSince();
      this.scheduleTimers();
    }
  }

  /** Re-arm both timers at the current `intervalMs()` without an immediate
   *  push/pull and without rebuilding `AuthSession`. Use this when only the
   *  cadence changes — full engine recreate (which loses the cached bearer
   *  and re-auths) is overkill for a slider drag. */
  reschedule(): void {
    if (this.pushTimer === null && this.pullTimer === null) return;
    this.cancelTimers();
    if (!this.visibility.isHidden()) this.scheduleTimers();
  }

  private scheduleTimers(): void {
    const ms = Math.max(1000, this.intervalMs());
    if (this.pushTimer === null) {
      this.pushTimer = this.setIntervalImpl(() => { void this.flushPushes(); }, ms);
    }
    if (this.pullTimer === null) {
      this.pullTimer = this.setIntervalImpl(() => { void this.pullSince(); }, ms);
    }
  }

  private cancelTimers(): void {
    if (this.pushTimer !== null) { this.clearIntervalImpl(this.pushTimer); this.pushTimer = null; }
    if (this.pullTimer !== null) { this.clearIntervalImpl(this.pullTimer); this.pullTimer = null; }
  }
}

const newEventId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
};

const isAuthRetryable = (e: unknown): boolean => {
  if (!isSyncTransportError(e)) return false;
  return e.kind === 'tokenExpired' || e.kind === 'badToken';
};

// Re-export so tests can inject without importing the type directly.
export type { SyncTransportError };
