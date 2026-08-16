// Unit tests for lib/audience.ts — the PUBLIC_URL → domainName/stage
// decomposition D1 depends on, and the "fail fast" rule for CT_STORE=sqlite
// deployments that omit it.

import { readPublicAudience, requirePublicAudienceForStore } from '../src/lib/audience';

describe('readPublicAudience', () => {
  test('returns null when PUBLIC_URL is unset', () => {
    expect(readPublicAudience({})).toBeNull();
  });

  test('host-only PUBLIC_URL: domainName is the host, stage is empty, audience matches the normalized URL', () => {
    const result = readPublicAudience({ PUBLIC_URL: 'https://example.ngrok.app' });
    expect(result).toEqual({
      domainName: 'example.ngrok.app',
      stage: '',
      audience: 'https://example.ngrok.app/'
    });
  });

  test('PUBLIC_URL with a path: stage carries the path (no leading slash)', () => {
    const result = readPublicAudience({ PUBLIC_URL: 'https://api.example.com/prod' });
    expect(result).toEqual({
      domainName: 'api.example.com',
      stage: 'prod',
      audience: 'https://api.example.com/prod'
    });
  });

  test('reconstructing "https://${domainName}/${stage}" always equals the reported audience', () => {
    for (const raw of ['https://example.ngrok.app', 'https://api.example.com/prod', 'https://host.test/a/b']) {
      const result = readPublicAudience({ PUBLIC_URL: raw });
      expect(result).not.toBeNull();
      const reconstructed = `https://${result!.domainName}/${result!.stage}`;
      expect(reconstructed).toBe(result!.audience);
    }
  });

  test('rejects a malformed URL', () => {
    expect(() => readPublicAudience({ PUBLIC_URL: 'not-a-url' })).toThrow(/valid absolute URL/);
  });

  test('rejects a non-https:// URL', () => {
    expect(() => readPublicAudience({ PUBLIC_URL: 'http://example.ngrok.app' })).toThrow(/https:\/\//);
  });

  test('rejects a PUBLIC_URL with a query string', () => {
    expect(() => readPublicAudience({ PUBLIC_URL: 'https://example.ngrok.app?x=1' })).toThrow(/query string/);
  });
});

describe('requirePublicAudienceForStore', () => {
  test('CT_STORE=sqlite (explicit) without PUBLIC_URL throws a clear startup error', () => {
    expect(() => requirePublicAudienceForStore({ CT_STORE: 'sqlite' })).toThrow(/PUBLIC_URL is required/);
  });

  test('CT_STORE unset (defaults to sqlite) without PUBLIC_URL throws', () => {
    expect(() => requirePublicAudienceForStore({})).toThrow(/PUBLIC_URL is required/);
  });

  test('CT_STORE=sqlite with PUBLIC_URL set returns the parsed audience', () => {
    const result = requirePublicAudienceForStore({ CT_STORE: 'sqlite', PUBLIC_URL: 'https://example.ngrok.app' });
    expect(result?.audience).toBe('https://example.ngrok.app/');
  });

  test('a non-sqlite CT_STORE without PUBLIC_URL does not throw, returns null', () => {
    expect(requirePublicAudienceForStore({ CT_STORE: 'memory' })).toBeNull();
  });
});
