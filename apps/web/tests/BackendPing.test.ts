import { describe, expect, it } from 'vitest';
import { buildPingURL, ping, describePingError } from '../src/sync/BackendPing';

const DID = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';

describe('buildPingURL', () => {
  it('points at /v1/auth/challenge — the only no-bearer endpoint', () => {
    const url = buildPingURL('https://api.example.com/Prod');
    expect(url).not.toBeNull();
    expect(new URL(url!).pathname).toBe('/Prod/v1/auth/challenge');
  });

  it('strips a trailing slash', () => {
    const url = buildPingURL('https://api.example.com/Prod/');
    expect(url).not.toBeNull();
    expect(new URL(url!).pathname).toBe('/Prod/v1/auth/challenge');
  });

  it('trims whitespace', () => {
    const url = buildPingURL('   https://api.example.com   ');
    expect(url).not.toBeNull();
  });

  it('returns null for empty input', () => {
    expect(buildPingURL('   ')).toBeNull();
  });

  it('returns null for malformed URL', () => {
    expect(buildPingURL('not a url')).toBeNull();
  });
});

describe('ping', () => {
  const okResponse = (body: unknown): Response =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

  it('resolves on a well-shaped challenge response with matching audience', async () => {
    const fetcher = async (): Promise<Response> =>
      okResponse({ challenge: 'abc', audience: 'https://api.example.com', expiresAt: '2099-01-01T00:00:00Z' });
    await expect(ping('https://api.example.com', DID, fetcher as typeof fetch)).resolves.toBeUndefined();
  });

  it('throws invalidURL when URL builder fails', async () => {
    await expect(ping('not a url', DID, (async () => okResponse({})) as unknown as typeof fetch))
      .rejects.toMatchObject({ kind: 'invalidURL' });
  });

  it('throws http on non-2xx and surfaces the server reason', async () => {
    const fetcher = async (): Promise<Response> =>
      new Response(JSON.stringify({ reason: 'invalid_did' }), { status: 400, headers: { 'content-type': 'application/json' } });
    await expect(ping('https://api.example.com', DID, fetcher as typeof fetch))
      .rejects.toMatchObject({ kind: 'http', status: 400, reason: 'invalid_did' });
  });

  it('throws unexpectedResponse when JSON shape is wrong', async () => {
    const fetcher = async (): Promise<Response> => okResponse({ foo: 'bar' });
    await expect(ping('https://api.example.com', DID, fetcher as typeof fetch))
      .rejects.toMatchObject({ kind: 'unexpectedResponse' });
  });

  it('throws audienceMismatch when the deploy advertises a different audience', async () => {
    const fetcher = async (): Promise<Response> =>
      okResponse({ challenge: 'abc', audience: 'https://other-deploy.example.com', expiresAt: '2099-01-01T00:00:00Z' });
    await expect(ping('https://api.example.com', DID, fetcher as typeof fetch))
      .rejects.toMatchObject({ kind: 'audienceMismatch' });
  });

  it('throws transport when fetch throws', async () => {
    const fetcher = async (): Promise<Response> => { throw new Error('boom'); };
    await expect(ping('https://api.example.com', DID, fetcher as typeof fetch))
      .rejects.toMatchObject({ kind: 'transport', message: 'boom' });
  });
});

describe('describePingError', () => {
  it('produces a sentence for each variant', () => {
    expect(describePingError({ kind: 'invalidURL' })).toMatch(/malformed/);
    expect(describePingError({ kind: 'http', status: 500 })).toMatch(/HTTP 500/);
    expect(describePingError({ kind: 'unexpectedResponse' })).toMatch(/CornerTasks/);
    expect(describePingError({ kind: 'audienceMismatch', expected: 'https://a', got: 'https://b' })).toMatch(/audience/);
    expect(describePingError({ kind: 'transport', message: 'eof' })).toMatch(/eof/);
  });
});
