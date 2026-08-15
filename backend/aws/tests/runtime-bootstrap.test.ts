// Unit tests for the AWS↔core wiring introduced by the backend/core
// extraction: `ensureStore()` / `ensureSigningKey()` are the only new logic
// this runtime adds — everything else is a re-export or a thin delegation
// (see handlers.test.ts). dynamo-store and the SSM-backed signing-key
// provider are mocked so this suite never needs real AWS credentials.

import type { Store } from '../../core/src/lib/db';
import { getStore, resetStoreForTests } from '../../core/src/lib/db';
import type { SigningKey } from '../../core/src/lib/signing-key';
import { getSigningKey, setSigningKey } from '../../core/src/lib/signing-key';

const sentinelStore = { __sentinel: 'dynamo-store' } as unknown as Store;
const dynamoStoreMock = jest.fn<Store, []>(() => sentinelStore);
jest.mock('../src/lib/dynamo-store', () => ({
  dynamoStore: (...args: unknown[]) => dynamoStoreMock(...(args as [])),
}));

const awsSigningKey: SigningKey = {
  alg: 'HS256',
  kid: 'aws-ssm-key',
  privateKey: new Uint8Array([9, 9, 9]),
  publicKey: new Uint8Array([9, 9, 9])
};
const getAwsSigningKeyMock = jest.fn<Promise<SigningKey>, []>(async () => awsSigningKey);
jest.mock('../src/lib/signing-key', () => ({
  getSigningKey: () => getAwsSigningKeyMock()
}));

import { ensureSigningKey, ensureStore } from '../src/lib/runtime-bootstrap';

afterEach(() => {
  resetStoreForTests();
  setSigningKey(null);
  jest.clearAllMocks();
});

describe('ensureStore', () => {
  // `ensureStore`'s "already registered" flag is module-scoped (survives
  // across test cases in this file, deliberately — it mirrors one warm
  // Lambda instance), so both assertions live in a single test.
  test('registers the DynamoDB-backed store with core, once', () => {
    ensureStore();
    ensureStore();
    ensureStore();
    expect(getStore()).toBe(sentinelStore);
    expect(dynamoStoreMock).toHaveBeenCalledTimes(1);
  });
});

describe('ensureSigningKey', () => {
  test('copies the SSM-backed key into core\'s signing-key cache', async () => {
    await ensureSigningKey();
    await expect(getSigningKey()).resolves.toEqual(awsSigningKey);
  });

  test('refreshes on every call (SSM provider owns its own caching)', async () => {
    await ensureSigningKey();
    await ensureSigningKey();
    expect(getAwsSigningKeyMock).toHaveBeenCalledTimes(2);
  });
});
