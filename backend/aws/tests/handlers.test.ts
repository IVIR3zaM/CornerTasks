// Unit tests for the thin Lambda entry points: do they bootstrap the
// runtime and delegate to the runtime-neutral core handler, faithfully and
// without adding logic of their own? Business logic (sync, auth, JWT) is
// exercised by backend/core's own suites, not duplicated here.

import type { HttpEvent, HttpResult } from '../../core/src/types/http';

jest.mock('../src/lib/runtime-bootstrap', () => ({
  ensureStore: jest.fn(),
  ensureSigningKey: jest.fn(async () => undefined)
}));

const pushCore = jest.fn(async (): Promise<HttpResult> => ({ statusCode: 200, body: 'push-ok' }));
jest.mock('../../core/src/handlers/push', () => ({ handler: (...args: unknown[]) => pushCore(...(args as [])) }));

const pullCore = jest.fn(async (): Promise<HttpResult> => ({ statusCode: 200, body: 'pull-ok' }));
jest.mock('../../core/src/handlers/pull', () => ({ handler: (...args: unknown[]) => pullCore(...(args as [])) }));

const tokenCore = jest.fn(async (): Promise<HttpResult> => ({ statusCode: 200, body: 'token-ok' }));
jest.mock('../../core/src/handlers/auth/token', () => ({ handler: (...args: unknown[]) => tokenCore(...(args as [])) }));

const challengeCore = jest.fn(async (): Promise<HttpResult> => ({ statusCode: 200, body: 'challenge-ok' }));
jest.mock('../../core/src/handlers/auth/challenge', () => ({ handler: (...args: unknown[]) => challengeCore(...(args as [])) }));

import { ensureSigningKey } from '../src/lib/runtime-bootstrap';
import { handler as pushHandler } from '../src/handlers/push';
import { handler as pullHandler } from '../src/handlers/pull';
import { handler as tokenHandler } from '../src/handlers/auth/token';
import { handler as challengeHandler } from '../src/handlers/auth/challenge';
import { handler as mockedCoreChallengeHandler } from '../../core/src/handlers/auth/challenge';

const fakeEvent: HttpEvent = {
  headers: {},
  requestContext: { domainName: 'test.local', stage: 'test', http: { method: 'GET', path: '/' } }
};

afterEach(() => jest.clearAllMocks());

test('push: refreshes the signing key, then delegates to core unmodified', async () => {
  const result = await pushHandler(fakeEvent);
  expect(ensureSigningKey).toHaveBeenCalledTimes(1);
  expect(pushCore).toHaveBeenCalledWith(fakeEvent);
  expect(result).toEqual({ statusCode: 200, body: 'push-ok' });
});

test('pull: refreshes the signing key, then delegates to core unmodified', async () => {
  const result = await pullHandler(fakeEvent);
  expect(ensureSigningKey).toHaveBeenCalledTimes(1);
  expect(pullCore).toHaveBeenCalledWith(fakeEvent);
  expect(result).toEqual({ statusCode: 200, body: 'pull-ok' });
});

test('token: refreshes the signing key, then delegates to core unmodified', async () => {
  const result = await tokenHandler(fakeEvent);
  expect(ensureSigningKey).toHaveBeenCalledTimes(1);
  expect(tokenCore).toHaveBeenCalledWith(fakeEvent);
  expect(result).toEqual({ statusCode: 200, body: 'token-ok' });
});

test('challenge: needs no signing key, and is a direct re-export of the core handler', async () => {
  expect(challengeHandler).toBe(mockedCoreChallengeHandler);
  const result = await challengeHandler(fakeEvent);
  expect(result).toEqual({ statusCode: 200, body: 'challenge-ok' });
  expect(ensureSigningKey).not.toHaveBeenCalled();
});
