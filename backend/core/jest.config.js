// CT_STORE=sqlite runs the existing suites (sync.test.ts, auth.test.ts)
// against the SQLite-backed Store unmodified: they import `memoryStore` from
// `./helpers/memory-store`, and this maps that exact module to a SQLite-
// backed drop-in (`./helpers/sqlite-test-store`) exporting the same name.
// See N05 in plan/v0.3.0/nodes/ for why the swap lives here rather than in
// the test files themselves.
const useSqlite = process.env.CT_STORE === 'sqlite';

/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  clearMocks: true,
  // @noble/* and @scure/* ship pure ESM; let ts-jest transpile them.
  transformIgnorePatterns: ['/node_modules/(?!(@noble|@scure)/)'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true }],
    '^.+\\.m?js$': ['ts-jest', { isolatedModules: true, useESM: false }]
  },
  ...(useSqlite
    ? { moduleNameMapper: { '^\\./helpers/memory-store$': '<rootDir>/tests/helpers/sqlite-test-store.ts' } }
    : {})
};
