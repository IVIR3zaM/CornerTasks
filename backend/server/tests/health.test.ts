// Unit test for the /v1/health handler's failure branch, which is hard to
// trigger through a real running server (the store is healthy by
// construction there) — call it directly with a `Store` wired to fail.

import { handler as healthHandler } from '../src/handlers/health';
import { setStore, resetStoreForTests, type Store } from '../../core/src/lib/db';

afterEach(() => resetStoreForTests());

const fakeEvent = {
  headers: {},
  queryStringParameters: {},
  requestContext: { domainName: 'test.local', stage: '', http: { method: 'GET', path: '/v1/health' } }
};

test('healthy store → 200 {status: "ok"}, no account data in the body', async () => {
  setStore({
    async putEvent() {
      return { accepted: true, seq: 1 };
    },
    async queryEventsAfter() {
      return { events: [], nextCursor: '0' };
    },
    async pruneExpiredArchives() {
      return 0;
    },
    async putChallenge() {},
    async consumeChallenge() {
      return false;
    }
  } as Store);

  const result = await healthHandler(fakeEvent);
  expect(result.statusCode).toBe(200);
  expect(JSON.parse(result.body!)).toEqual({ status: 'ok' });
});

test('a store that throws → 503 {status: "error"}', async () => {
  setStore({
    async putEvent() {
      return { accepted: true, seq: 1 };
    },
    async queryEventsAfter() {
      throw new Error('db unavailable');
    },
    async pruneExpiredArchives() {
      return 0;
    },
    async putChallenge() {},
    async consumeChallenge() {
      return false;
    }
  } as Store);

  const result = await healthHandler(fakeEvent);
  expect(result.statusCode).toBe(503);
  expect(JSON.parse(result.body!)).toEqual({ status: 'error' });
});

test('does not require Authorization', async () => {
  setStore({
    async putEvent() {
      return { accepted: true, seq: 1 };
    },
    async queryEventsAfter() {
      return { events: [], nextCursor: '0' };
    },
    async pruneExpiredArchives() {
      return 0;
    },
    async putChallenge() {},
    async consumeChallenge() {
      return false;
    }
  } as Store);

  const result = await healthHandler({ ...fakeEvent, headers: {} });
  expect(result.statusCode).toBe(200);
});
