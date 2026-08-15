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
  }
};
