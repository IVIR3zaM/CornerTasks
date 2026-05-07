// Reachability + shape check for the user-supplied ApiUrl.
// Mirrors apps/macos/Sources/CornerTasks/Sync/BackendPing.swift.
//
// Hits POST /v1/auth/challenge — the only sync-protocol endpoint that does NOT
// require a bearer token (per docs/sync-protocol.md §8). The response carries
// the deploy's canonical `audience`; verifying it catches the most common
// BYO-AWS misconfig (URL ≠ canonical audience), which would otherwise blow up
// at the auth-token step with `bad_audience`.

export type BackendPingError =
  | { kind: 'invalidURL' }
  | { kind: 'http'; status: number; reason?: string }
  | { kind: 'unexpectedResponse' }
  | { kind: 'audienceMismatch'; expected: string; got: string }
  | { kind: 'transport'; message: string };

export const describePingError = (e: BackendPingError): string => {
  switch (e.kind) {
    case 'invalidURL': return 'URL looks malformed.';
    case 'http': return e.reason ? `Server replied HTTP ${e.status} (${e.reason}).` : `Server replied HTTP ${e.status}.`;
    case 'unexpectedResponse': return 'Reachable, but the response did not look like a CornerTasks backend.';
    case 'audienceMismatch':
      return `URL mismatch: this deploy's canonical audience is ${e.got}, but you typed ${e.expected}. Use the canonical URL or the auth-token step will reject your DID-JWT.`;
    case 'transport': return `Could not reach the URL: ${e.message}`;
  }
};

const canonicalise = (url: string): string => {
  const t = url.trim();
  const stripped = t.endsWith('/') ? t.slice(0, -1) : t;
  return stripped.toLowerCase();
};

export const buildPingURL = (apiUrl: string): string | null => {
  const trimmed = apiUrl.trim();
  const stripped = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  if (stripped.length === 0) return null;
  try {
    return new URL(stripped + '/v1/auth/challenge').toString();
  } catch {
    return null;
  }
};

export const ping = async (
  apiUrl: string,
  accountDid: string,
  fetcher: typeof fetch = fetch
): Promise<void> => {
  const url = buildPingURL(apiUrl);
  if (!url) throw { kind: 'invalidURL' } as BackendPingError;
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountDid }),
    });
  } catch (e) {
    throw { kind: 'transport', message: e instanceof Error ? e.message : String(e) } as BackendPingError;
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const reason = (body && typeof body === 'object') ? (body as Record<string, unknown>).reason as string | undefined : undefined;
    throw { kind: 'http', status: response.status, reason } as BackendPingError;
  }
  if (
    typeof body !== 'object' || body === null ||
    typeof (body as Record<string, unknown>).challenge !== 'string' ||
    typeof (body as Record<string, unknown>).audience !== 'string'
  ) {
    throw { kind: 'unexpectedResponse' } as BackendPingError;
  }
  const audience = (body as { audience: string }).audience;
  const expected = canonicalise(apiUrl);
  const got = canonicalise(audience);
  if (expected !== got) {
    throw { kind: 'audienceMismatch', expected, got } as BackendPingError;
  }
};

export const isBackendPingError = (e: unknown): e is BackendPingError =>
  typeof e === 'object' && e !== null && typeof (e as { kind?: unknown }).kind === 'string';
