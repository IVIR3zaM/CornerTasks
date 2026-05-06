// SENSITIVE: This module persists the user's BIP-39 mnemonic — the only secret
// the user must back up. It must NEVER be sent over the network. Touch with care.

const DB_NAME = 'cornertasks-secrets';
const DB_VERSION = 1;
const STORE = 'secrets';
const MNEMONIC_KEY = 'mnemonic';

const openDb = (name: string): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const tx = <T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

export class MnemonicStore {
  private constructor(private db: IDBDatabase) {}

  static async open(name: string = DB_NAME): Promise<MnemonicStore> {
    return new MnemonicStore(await openDb(name));
  }

  /** SENSITIVE: writes the mnemonic to IndexedDB. */
  async save(mnemonic: string): Promise<void> {
    await tx(this.db, 'readwrite', (s) => s.put(mnemonic, MNEMONIC_KEY));
  }

  /** SENSITIVE: reads the mnemonic from IndexedDB. Returns null if not set. */
  async load(): Promise<string | null> {
    const v = await tx<unknown>(this.db, 'readonly', (s) => s.get(MNEMONIC_KEY));
    if (v === undefined || v === null) return null;
    if (typeof v !== 'string') throw new Error('mnemonic store corrupted');
    return v;
  }

  async clear(): Promise<void> {
    await tx(this.db, 'readwrite', (s) => s.delete(MNEMONIC_KEY));
  }

  close(): void {
    this.db.close();
  }
}
