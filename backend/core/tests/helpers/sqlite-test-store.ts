// Swapped in for `./memory-store` (via jest.config.js's `moduleNameMapper`)
// when `CT_STORE=sqlite` — see jest.config.js for how this is wired. Exports
// the same `memoryStore` name so `sync.test.ts` / `auth.test.ts` run
// completely unmodified against a SQLite-backed store instead of the plain
// in-memory one; the type of `memoryStore` those files see at compile time
// still comes from the real `./memory-store.ts` (jest module mapping is a
// runtime concern, invisible to the TypeScript checker), so nothing here
// needs to match that file's exported shape beyond satisfying `Store` itself.
import { sqliteStore } from '../../src/lib/sqlite-store';

export function memoryStore() {
  // A fresh `:memory:` database per call mirrors memoryStore()'s fresh Maps
  // per call — each `beforeEach` in the existing suites gets an empty store.
  return sqliteStore(':memory:');
}
