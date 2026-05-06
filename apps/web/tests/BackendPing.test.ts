import { describe, expect, it } from 'vitest';
import { buildPingURL, ping, describePingError } from '../src/sync/BackendPing';

const DID = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';

describe('buildPingURL', () => {
  it('appends /v1/sync/pull plus accountDid and a far-future since', () => {
    const url = buildPingURL('https://api.example.com/Prod', DID);
    expect(url).not.toBeNull();
    const u = new URL(url!);
    expect(u.pathname).toBe('/Prod/v1/sync/pull');
    expect(u.searchParams.get('accountDid')).toBe(DID);
    expect(u.searchParams.get('since')).toBe('2099-01-01T00:00:00Z');
  });

  it('strips a trailing slash', () => {
    const url = buildPingURL('https://api.example.com/Prod/', DID);
    expect(url).not.toBeNull();
    expect(new URL(url!).pathname).toBe('/Prod/v1/sync/pull');
  });

  it('trims whitespace', () => {
    const url = buildPingURL('   https://api.example.com   ', DID);
    expect(url).not.toBeNull();
  });

  it('returns null for empty input', () => {
    expect(buildPingURL('   ', DID)).toBeNull();
  });

  it('returns null for malformed URL', () => {
    expect(buildPingURL('not a url', DID)).toBeNull();
  });
});

describe('ping', () => {
  const okResponse = (body: unknown): Response =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

  it('resolves on a well-shaped response', async () => {
    const fetcher = async (): Promise<Response> => okResponse({ events: [], serverTime: '2026-01-01T00:00:00Z' });
    await expect(ping('https://api.example.com', DID, fetcher as typeof fetch)).resolves.toBeUndefined();
  });

  it('throws invalidURL when URL builder fails', async () => {
    await expect(ping('not a url', DID, (async () => okResponse({})) as unknown as typeof fetch))
      .rejects.toMatchObject({ kind: 'invalidURL' });
  });

  it('throws http on non-2xx', async () => {
    const fetcher = async (): Promise<Response> => new Response('nope', { status: 403 });
    await expect(ping('https://api.example.com', DID, fetcher as typeof fetch))
      .rejects.toMatchObject({ kind: 'http', status: 403 });
  });

  it('throws unexpectedResponse when JSON shape is wrong', async () => {
    const fetcher = async (): Promise<Response> => okResponse({ foo: 'bar' });
    await expect(ping('https://api.example.com', DID, fetcher as typeof fetch))
      .rejects.toMatchObject({ kind: 'unexpectedResponse' });
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
    expect(describePingError({ kind: 'transport', message: 'eof' })).toMatch(/eof/);
  });
});
