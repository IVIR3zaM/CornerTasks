// Transport for the CornerTasks sync protocol. Mirrors apps/macos/Sources/CornerTasks/Sync/SyncTransport.swift.
// See docs/sync-protocol.md §7 / §8.

import type { SyncEvent } from './syncEvent';

export interface ChallengeResponse {
  challenge: string;
  audience: string;
  expiresAt: string;
}

export interface TokenResponse {
  accessToken: string;
  expiresAt: string;
  // tokenType and expiresIn are not used by the client.
}

export interface PushResponse {
  accepted: string[];
  rejected: { eventId: string; reason: string }[];
}

export interface PullResponse {
  events: SyncEvent[];
  serverTime: string;
}

export type SyncTransportError =
  | { kind: 'missingToken' }
  | { kind: 'badToken' }
  | { kind: 'tokenExpired' }
  | { kind: 'didMismatch' }
  | { kind: 'http'; status: number; reason?: string }
  | { kind: 'decoding' }
  | { kind: 'network'; message: string }
  | { kind: 'invalidURL' };

export const isSyncTransportError = (e: unknown): e is SyncTransportError =>
  typeof e === 'object' && e !== null && typeof (e as { kind?: unknown }).kind === 'string';

export interface SyncTransport {
  challenge(accountDid: string): Promise<ChallengeResponse>;
  token(accountDid: string, didJwt: string): Promise<TokenResponse>;
  push(accountDid: string, events: SyncEvent[], bearer: string): Promise<PushResponse>;
  pull(accountDid: string, since: string, bearer: string): Promise<PullResponse>;
}

const stripTrailingSlash = (s: string): string => (s.endsWith('/') ? s.slice(0, -1) : s);

const reasonOf = (body: unknown): string | undefined => {
  if (body && typeof body === 'object') {
    const r = (body as Record<string, unknown>).reason;
    if (typeof r === 'string') return r;
  }
  return undefined;
};

const mapHttpError = (status: number, body: unknown): SyncTransportError => {
  const reason = reasonOf(body);
  if (status === 401) {
    if (reason === 'token_expired') return { kind: 'tokenExpired' };
    if (
      reason === 'bad_token' ||
      reason === 'missing_token' ||
      reason === 'bad_signature' ||
      reason === 'bad_audience' ||
      reason === 'unknown_challenge' ||
      reason === 'bad_lifetime'
    ) return { kind: 'badToken' };
    return { kind: 'http', status, reason };
  }
  if (status === 403) {
    if (reason === 'did_mismatch') return { kind: 'didMismatch' };
    return { kind: 'http', status, reason };
  }
  return { kind: 'http', status, reason };
};

export class FetchTransport implements SyncTransport {
  private readonly baseURL: string;

  private readonly fetcher: typeof fetch;

  constructor(apiUrl: string, fetcher?: typeof fetch) {
    // `window.fetch` must be invoked with `window` as its receiver. Storing it
    // as a class field and calling `this.fetcher(...)` rebinds `this` to the
    // class instance and triggers "Illegal invocation". Bind once at construction.
    this.fetcher = fetcher ?? fetch.bind(globalThis);
    const trimmed = apiUrl.trim();
    const stripped = stripTrailingSlash(trimmed);
    if (stripped.length === 0) throw { kind: 'invalidURL' } as SyncTransportError;
    try {
      new URL(stripped);
    } catch {
      throw { kind: 'invalidURL' } as SyncTransportError;
    }
    this.baseURL = stripped;
  }

  challenge(accountDid: string): Promise<ChallengeResponse> {
    return this.postJSON('/v1/auth/challenge', { accountDid }, null);
  }

  token(accountDid: string, didJwt: string): Promise<TokenResponse> {
    return this.postJSON('/v1/auth/token', { accountDid, didJwt }, null);
  }

  push(accountDid: string, events: SyncEvent[], bearer: string): Promise<PushResponse> {
    return this.postJSON('/v1/sync/push', { accountDid, events }, bearer);
  }

  async pull(accountDid: string, since: string, bearer: string): Promise<PullResponse> {
    const url = new URL(this.baseURL + '/v1/sync/pull');
    url.searchParams.set('accountDid', accountDid);
    url.searchParams.set('since', since);
    let response: Response;
    try {
      response = await this.fetcher(url.toString(), {
        method: 'GET',
        headers: { Authorization: `Bearer ${bearer}` },
      });
    } catch (e) {
      throw { kind: 'network', message: e instanceof Error ? e.message : String(e) } as SyncTransportError;
    }
    return this.handle<PullResponse>(response);
  }

  private async postJSON<T>(path: string, body: unknown, bearer: string | null): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
    let response: Response;
    try {
      response = await this.fetcher(this.baseURL + path, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw { kind: 'network', message: e instanceof Error ? e.message : String(e) } as SyncTransportError;
    }
    return this.handle<T>(response);
  }

  private async handle<T>(response: Response): Promise<T> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) throw mapHttpError(response.status, body);
    if (body === null || typeof body !== 'object') throw { kind: 'decoding' } as SyncTransportError;
    return body as T;
  }
}
