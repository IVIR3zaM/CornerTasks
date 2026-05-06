// Reachability + shape check for the user-supplied ApiUrl.
// Mirrors apps/macos/Sources/CornerTasks/Sync/BackendPing.swift.

export type BackendPingError =
  | { kind: 'invalidURL' }
  | { kind: 'http'; status: number }
  | { kind: 'unexpectedResponse' }
  | { kind: 'transport'; message: string };

export const describePingError = (e: BackendPingError): string => {
  switch (e.kind) {
    case 'invalidURL': return 'URL looks malformed.';
    case 'http': return `Server replied HTTP ${e.status}.`;
    case 'unexpectedResponse': return 'Reachable, but the response did not look like a CornerTasks backend.';
    case 'transport': return `Could not reach the URL: ${e.message}`;
  }
};

export const buildPingURL = (apiUrl: string, accountDid: string): string | null => {
  const trimmed = apiUrl.trim();
  const stripped = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  if (stripped.length === 0) return null;
  let url: URL;
  try {
    url = new URL(stripped + '/v1/sync/pull');
  } catch {
    return null;
  }
  url.searchParams.set('accountDid', accountDid);
  url.searchParams.set('since', '2099-01-01T00:00:00Z');
  return url.toString();
};

export const ping = async (
  apiUrl: string,
  accountDid: string,
  fetcher: typeof fetch = fetch
): Promise<void> => {
  const url = buildPingURL(apiUrl, accountDid);
  if (!url) throw { kind: 'invalidURL' } as BackendPingError;
  let response: Response;
  try {
    response = await fetcher(url);
  } catch (e) {
    throw { kind: 'transport', message: e instanceof Error ? e.message : String(e) } as BackendPingError;
  }
  if (!response.ok) throw { kind: 'http', status: response.status } as BackendPingError;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw { kind: 'unexpectedResponse' } as BackendPingError;
  }
  if (
    typeof body !== 'object' || body === null ||
    !Array.isArray((body as Record<string, unknown>).events) ||
    (body as Record<string, unknown>).serverTime === undefined
  ) {
    throw { kind: 'unexpectedResponse' } as BackendPingError;
  }
};

export const isBackendPingError = (e: unknown): e is BackendPingError =>
  typeof e === 'object' && e !== null && typeof (e as { kind?: unknown }).kind === 'string';
