/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  clearMocks: true,
  // @noble/* and @scure/* (pulled in transitively via backend/core) ship pure
  // ESM; let ts-jest transpile them, matching backend/core/jest.config.js.
  transformIgnorePatterns: ['/node_modules/(?!(@noble|@scure)/)'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true }],
    '^.+\\.m?js$': ['ts-jest', { isolatedModules: true, useESM: false }]
  }
};
