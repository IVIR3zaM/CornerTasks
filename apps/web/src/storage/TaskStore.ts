import { TaskItem, isDone } from '../models/TaskItem';

const DB_NAME = 'cornertasks';
const DB_VERSION = 2;
const STORE = 'tasks';
const QUEUE = 'syncQueue';

interface StoredTask {
  id: string;
  title: string;
  createdAt: number;
  completedAt: number | null;
  dueDate: number | null;
  order: number;
  updatedAt: number;
  deletedAt: number | null;
}

// V1 rows (created before DB_VERSION bumped to 2) lack `updatedAt`/`deletedAt`,
// and `completedAt`/`dueDate` may be `undefined` instead of `null`. Normalise on
// read so callers always see the v2 shape.
const normaliseStored = (raw: unknown): StoredTask | null => {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<StoredTask>;
  if (typeof r.id !== 'string') return null;
  const completedAt = typeof r.completedAt === 'number' ? r.completedAt : null;
  const dueDate = typeof r.dueDate === 'number' ? r.dueDate : null;
  const createdAt = typeof r.createdAt === 'number' ? r.createdAt : 0;
  const candidates = [createdAt, completedAt, dueDate].filter((v): v is number => typeof v === 'number');
  return {
    id: r.id,
    title: typeof r.title === 'string' ? r.title : '',
    createdAt,
    completedAt,
    dueDate,
    order: typeof r.order === 'number' ? r.order : 0,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : (candidates.length === 0 ? 0 : Math.max(...candidates)),
    deletedAt: typeof r.deletedAt === 'number' ? r.deletedAt : null,
  };
};

export interface TaskMutationSnapshot {
  taskId: string;
  op: 'upsert' | 'delete';
  title: string;
  createdAt: Date;
  completedAt: Date | null;
  dueDate: Date | null;
  order: number;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface BuiltSyncEvent {
  eventId: string;
  payloadJSON: string;
}

export interface PendingQueueRow {
  eventId: string;
  taskId: string;
  op: 'upsert' | 'delete';
  payloadJSON: string;
  createdAt: number;
}

export type EventBuilder = (snapshot: TaskMutationSnapshot) => Promise<BuiltSyncEvent | null>;

interface QueueRowRecord {
  eventId: string;
  taskId: string;
  op: 'upsert' | 'delete';
  payloadJSON: string;
  createdAt: number;
  sentAt: number | null;
}

const toStored = (t: TaskItem, updatedAt: number): StoredTask => ({
  id: t.id,
  title: t.title,
  createdAt: t.createdAt.getTime(),
  completedAt: t.completedAt ? t.completedAt.getTime() : null,
  dueDate: t.dueDate ? t.dueDate.getTime() : null,
  order: t.order,
  updatedAt,
  deletedAt: null,
});

const fromStored = (s: StoredTask): TaskItem => ({
  id: s.id,
  title: s.title,
  createdAt: new Date(s.createdAt),
  completedAt: s.completedAt === null ? null : new Date(s.completedAt),
  dueDate: s.dueDate === null ? null : new Date(s.dueDate),
  order: s.order,
});

const newId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
};

const promisifyTx = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

const promisifyReq = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export class TaskStore {
  /** Set by `SyncEngine` while cloud sync is enabled. While null, mutations skip the queue. */
  eventBuilder: EventBuilder | null = null;

  private readonly lastEventIdByTask = new Map<string, string>();
  private readonly listeners = new Set<() => void>();

  private constructor(private db: IDBDatabase) {}

  /** Subscribe to mutation notifications. Fires after every local or remote change.
   *  Returns an unsubscribe function. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  static async open(name: string = DB_NAME): Promise<TaskStore> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) {
          d.createObjectStore(STORE, { keyPath: 'id' });
        }
        if (!d.objectStoreNames.contains(QUEUE)) {
          d.createObjectStore(QUEUE, { keyPath: 'eventId' });
        }
        // No data backfill: legacy rows missing `updatedAt`/`deletedAt` are
        // normalised at read time (see normaliseStored). They get rewritten with
        // the full v2 shape the next time the user mutates them.
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB open blocked: another tab holds an older version. Close other CornerTasks tabs and reload.'));
    });
    return new TaskStore(db);
  }

  close(): void {
    this.db.close();
  }

  async all(): Promise<TaskItem[]> {
    const rows = await this.allStored();
    return rows.filter((r) => r.deletedAt === null).map(fromStored);
  }

  async activeTasks(): Promise<TaskItem[]> {
    const all = await this.all();
    return all.filter((t) => !isDone(t)).sort((a, b) => a.order - b.order);
  }

  async archivedTasks(): Promise<TaskItem[]> {
    const all = await this.all();
    return all
      .filter(isDone)
      .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
  }

  async add(title: string): Promise<TaskItem | null> {
    const trimmed = title.trim();
    if (!trimmed) return null;
    const active = await this.activeTasks();
    const nextOrder = active.length === 0 ? 0 : Math.max(...active.map((t) => t.order)) + 1;
    const item: TaskItem = {
      id: newId(),
      title: trimmed,
      createdAt: new Date(),
      completedAt: null,
      dueDate: null,
      order: nextOrder,
    };
    const now = Date.now();
    const stored = toStored(item, now);
    await this.runWriteTx(async (tx) => {
      tx.objectStore(STORE).add(stored);
    });
    await this.enqueue(item.id, 'upsert');
    this.notify();
    return item;
  }

  async complete(id: string): Promise<void> {
    await this.update(id, (s) => ({ ...s, completedAt: Date.now() }));
    await this.enqueue(id, 'upsert');
    this.notify();
  }

  async updateTitle(id: string, title: string): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed) return;
    await this.update(id, (s) => ({ ...s, title: trimmed }));
    await this.enqueue(id, 'upsert');
    this.notify();
  }

  async setDueDate(id: string, due: Date | null): Promise<void> {
    await this.update(id, (s) => ({ ...s, dueDate: due ? due.getTime() : null }));
    await this.enqueue(id, 'upsert');
    this.notify();
  }

  async deleteArchived(id: string): Promise<void> {
    // Soft-delete so the sync engine can replicate the deletion.
    const now = Date.now();
    await this.update(id, (s) => ({ ...s, deletedAt: now }));
    await this.enqueue(id, 'delete');
    this.notify();
  }

  async moveActive(orderedIds: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const tx = this.db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const now = Date.now();
      orderedIds.forEach((id, idx) => {
        const getReq = store.get(id);
        getReq.onsuccess = () => {
          const row = normaliseStored(getReq.result);
          if (row) store.put({ ...row, order: idx, updatedAt: now });
        };
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    for (const id of orderedIds) await this.enqueue(id, 'upsert');
    this.notify();
  }

  // MARK: - Sync queue support

  async pendingQueueRows(): Promise<PendingQueueRow[]> {
    const tx = this.db.transaction(QUEUE, 'readonly');
    const all = await promisifyReq<QueueRowRecord[]>(tx.objectStore(QUEUE).getAll());
    return all
      .filter((r) => r.sentAt === null)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((r) => ({
        eventId: r.eventId,
        taskId: r.taskId,
        op: r.op,
        payloadJSON: r.payloadJSON,
        createdAt: r.createdAt,
      }));
  }

  async markQueueRowsSent(eventIds: string[], at: number = Date.now()): Promise<void> {
    if (eventIds.length === 0) return;
    await new Promise<void>((resolve, reject) => {
      const tx = this.db.transaction(QUEUE, 'readwrite');
      const store = tx.objectStore(QUEUE);
      for (const id of eventIds) {
        const getReq = store.get(id);
        getReq.onsuccess = () => {
          const row = getReq.result as QueueRowRecord | undefined;
          if (row) store.put({ ...row, sentAt: at });
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  /** Hard-deletes every row from the local outbound queue. Used by the full
   *  resync flow when the user enables cloud sync. */
  async clearSyncQueue(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const tx = this.db.transaction(QUEUE, 'readwrite');
      tx.objectStore(QUEUE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  /** Snapshots of every non-deleted task, used by the resync flow to rebuild the
   *  outbound queue without going through the normal mutation path. */
  async liveSnapshots(): Promise<TaskMutationSnapshot[]> {
    const rows = await this.allStored();
    return rows
      .filter((r) => r.deletedAt === null)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((s) => ({
        taskId: s.id,
        op: 'upsert',
        title: s.title,
        createdAt: new Date(s.createdAt),
        completedAt: s.completedAt === null ? null : new Date(s.completedAt),
        dueDate: s.dueDate === null ? null : new Date(s.dueDate),
        order: s.order,
        updatedAt: new Date(s.updatedAt),
        deletedAt: null,
      }));
  }

  /** Builder used by the full-resync flow to enqueue a row directly from a snapshot.
   *  The caller is responsible for skipping archived snapshots past the cutoff. */
  async enqueueSnapshot(snapshot: TaskMutationSnapshot): Promise<void> {
    const builder = this.eventBuilder;
    if (!builder) return;
    const event = await builder(snapshot);
    if (!event) return;
    const row: QueueRowRecord = {
      eventId: event.eventId,
      taskId: snapshot.taskId,
      op: snapshot.op,
      payloadJSON: event.payloadJSON,
      createdAt: snapshot.updatedAt.getTime(),
      sentAt: null,
    };
    await this.runWriteTx(async (tx) => {
      tx.objectStore(QUEUE).add(row);
    });
  }

  async taskCompletedAt(taskId: string): Promise<Date | null> {
    const row = await this.getStored(taskId);
    if (!row || row.completedAt === null) return null;
    return new Date(row.completedAt);
  }

  // MARK: - Remote application (no event re-enqueue)

  async applyRemoteUpsert(args: {
    taskId: string;
    title: string;
    createdAt: Date;
    completedAt: Date | null;
    dueDate: Date | null;
    order: number;
    updatedAt: Date;
    eventId: string;
  }): Promise<void> {
    const existing = await this.getStored(args.taskId);
    if (existing && !this.shouldReplace(existing.updatedAt, this.lastEventIdByTask.get(args.taskId), args.updatedAt.getTime(), args.eventId)) {
      return;
    }
    const row: StoredTask = {
      id: args.taskId,
      title: args.title,
      createdAt: args.createdAt.getTime(),
      completedAt: args.completedAt ? args.completedAt.getTime() : null,
      dueDate: args.dueDate ? args.dueDate.getTime() : null,
      order: args.order,
      updatedAt: args.updatedAt.getTime(),
      deletedAt: null,
    };
    await this.runWriteTx(async (tx) => {
      tx.objectStore(STORE).put(row);
    });
    this.lastEventIdByTask.set(args.taskId, args.eventId);
    this.notify();
  }

  async applyRemoteDelete(args: { taskId: string; updatedAt: Date; eventId: string }): Promise<void> {
    const existing = await this.getStored(args.taskId);
    if (existing && !this.shouldReplace(existing.updatedAt, this.lastEventIdByTask.get(args.taskId), args.updatedAt.getTime(), args.eventId)) {
      return;
    }
    const stamp = args.updatedAt.getTime();
    const row: StoredTask = existing
      ? { ...existing, updatedAt: stamp, deletedAt: stamp }
      : {
          id: args.taskId,
          title: '',
          createdAt: stamp,
          completedAt: null,
          dueDate: null,
          order: 0,
          updatedAt: stamp,
          deletedAt: stamp,
        };
    await this.runWriteTx(async (tx) => {
      tx.objectStore(STORE).put(row);
    });
    this.lastEventIdByTask.set(args.taskId, args.eventId);
    this.notify();
  }

  // MARK: - Internals

  private shouldReplace(localUpdated: number, localEventId: string | undefined, incomingUpdated: number, incomingEventId: string): boolean {
    if (incomingUpdated > localUpdated) return true;
    if (incomingUpdated < localUpdated) return false;
    if (!localEventId) return true;
    return incomingEventId > localEventId;
  }

  private async enqueue(taskId: string, op: 'upsert' | 'delete'): Promise<void> {
    const builder = this.eventBuilder;
    if (!builder) return;
    const snapshot = await this.snapshot(taskId, op);
    if (!snapshot) return;
    const event = await builder(snapshot);
    if (!event) return;
    const row: QueueRowRecord = {
      eventId: event.eventId,
      taskId,
      op,
      payloadJSON: event.payloadJSON,
      createdAt: snapshot.updatedAt.getTime(),
      sentAt: null,
    };
    await this.runWriteTx(async (tx) => {
      tx.objectStore(QUEUE).add(row);
    });
  }

  private async snapshot(taskId: string, op: 'upsert' | 'delete'): Promise<TaskMutationSnapshot | null> {
    const row = await this.getStored(taskId);
    if (!row) return null;
    return {
      taskId,
      op,
      title: row.title,
      createdAt: new Date(row.createdAt),
      completedAt: row.completedAt === null ? null : new Date(row.completedAt),
      dueDate: row.dueDate === null ? null : new Date(row.dueDate),
      order: row.order,
      updatedAt: new Date(row.updatedAt),
      deletedAt: row.deletedAt === null ? null : new Date(row.deletedAt),
    };
  }

  private async update(id: string, mut: (s: StoredTask) => StoredTask): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const tx = this.db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const row = normaliseStored(getReq.result);
        if (row) store.put({ ...mut(row), updatedAt: Date.now() });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  private async runWriteTx(fn: (tx: IDBTransaction) => void | Promise<void>): Promise<void> {
    const stores = this.db.objectStoreNames;
    const names: string[] = [];
    if (stores.contains(STORE)) names.push(STORE);
    if (stores.contains(QUEUE)) names.push(QUEUE);
    const tx = this.db.transaction(names, 'readwrite');
    const done = promisifyTx(tx);
    await fn(tx);
    await done;
  }

  private async allStored(): Promise<StoredTask[]> {
    const tx = this.db.transaction(STORE, 'readonly');
    const raw = await promisifyReq<unknown[]>(tx.objectStore(STORE).getAll());
    return raw.map(normaliseStored).filter((r): r is StoredTask => r !== null);
  }

  private async getStored(id: string): Promise<StoredTask | null> {
    const tx = this.db.transaction(STORE, 'readonly');
    const row = await promisifyReq<unknown>(tx.objectStore(STORE).get(id));
    return normaliseStored(row);
  }
}
