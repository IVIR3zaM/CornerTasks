import { TaskItem, isDone } from '../models/TaskItem';

const DB_NAME = 'cornertasks';
const DB_VERSION = 1;
const STORE = 'tasks';

interface StoredTask {
  id: string;
  title: string;
  createdAt: number;
  completedAt: number | null;
  dueDate: number | null;
  order: number;
}

const toStored = (t: TaskItem): StoredTask => ({
  id: t.id,
  title: t.title,
  createdAt: t.createdAt.getTime(),
  completedAt: t.completedAt ? t.completedAt.getTime() : null,
  dueDate: t.dueDate ? t.dueDate.getTime() : null,
  order: t.order,
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

export class TaskStore {
  private constructor(private db: IDBDatabase) {}

  static async open(name: string = DB_NAME): Promise<TaskStore> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) {
          d.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return new TaskStore(db);
  }

  close(): void {
    this.db.close();
  }

  async all(): Promise<TaskItem[]> {
    const rows = await this.run<StoredTask[]>('readonly', (s) => s.getAll());
    return rows.map(fromStored);
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
    await this.run('readwrite', (s) => s.add(toStored(item)));
    return item;
  }

  async complete(id: string): Promise<void> {
    await this.update(id, (t) => ({ ...t, completedAt: Date.now() }));
  }

  async updateTitle(id: string, title: string): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed) return;
    await this.update(id, (t) => ({ ...t, title: trimmed }));
  }

  async setDueDate(id: string, due: Date | null): Promise<void> {
    await this.update(id, (t) => ({ ...t, dueDate: due ? due.getTime() : null }));
  }

  async deleteArchived(id: string): Promise<void> {
    await this.run('readwrite', (s) => s.delete(id));
  }

  /** Persist the new ordering of active tasks. `orderedIds` is the desired order, top to bottom. */
  async moveActive(orderedIds: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const tx = this.db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      orderedIds.forEach((id, idx) => {
        const getReq = store.get(id);
        getReq.onsuccess = () => {
          const row = getReq.result as StoredTask | undefined;
          if (row) store.put({ ...row, order: idx });
        };
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  private async update(id: string, mut: (s: StoredTask) => StoredTask): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const tx = this.db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const row = getReq.result as StoredTask | undefined;
        if (row) store.put(mut(row));
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  private run<T>(
    mode: IDBTransactionMode,
    op: (store: IDBObjectStore) => IDBRequest<T> | void,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const req = op(store);
      let value: T | undefined;
      if (req) req.onsuccess = () => (value = req.result);
      tx.oncomplete = () => resolve(value as T);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
}
