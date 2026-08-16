// Chooses WebSocket over REST when the backend advertises it, falls back to
// REST for anything WS can't or won't do reliably, and owns the reconnect /
// backoff policy from docs/sync-protocol.md §12. Implements the same
// `SyncTransport` interface `FetchTransport` does, so `SyncEngine` can hold it
// exactly like a plain REST transport — same seam, nothing new to learn.
//
// See docs/sync-protocol.md §10 (negotiation), §11 (WS framing), §12
// (reconnect/fallback). Implemented independently against the spec — see
// plan/v0.3.0/nodes/N14-web-transport.md.

import type { SyncEvent } from './syncEvent';
import type {
  ChallengeResponse,
  PullResponse,
  PushResponse,
  SyncTransport,
  TokenResponse,
} from './syncTransport';
import type { ConnectionState } from './connectionState';
import { WebSocketTransport, type WsFactory } from './WebSocketTransport';

/** Read-only view of the cursor storage SyncEngine already owns — this
 *  transport never persists a cursor itself; SyncEngine does, exactly as it
 *  does today for REST (§12.4: both transports are driven by the same
 *  persisted cursor). */
export interface CursorReader {
  get(): string | null;
}

export interface VisibilityHostLike {
  isHidden(): boolean;
  addListener(fn: () => void): () => void;
}

export interface NetworkChangeHostLike {
  addListener(fn: () => void): () => void;
}

export interface MetaResponse {
  protocolVersions: number[];
  transports: string[];
  wsUrl?: string;
  audience?: string;
}

const REST_ONLY_META: MetaResponse = { protocolVersions: [2], transports: ['rest'] };

const stripTrailingSlash = (s: string): string => (s.endsWith('/') ? s.slice(0, -1) : s);

const normalizeMeta = (body: unknown): MetaResponse => {
  if (!body || typeof body !== 'object') return REST_ONLY_META;
  const b = body as Record<string, unknown>;
  const transports = Array.isArray(b.transports)
    ? b.transports.filter((t): t is string => typeof t === 'string')
    : ['rest'];
  if (!transports.includes('rest')) transports.push('rest');
  const protocolVersions = Array.isArray(b.protocolVersions)
    ? b.protocolVersions.filter((v): v is number => typeof v === 'number')
    : [2];
  const wsUrl = typeof b.wsUrl === 'string' ? b.wsUrl : undefined;
  const audience = typeof b.audience === 'string' ? b.audience : undefined;
  return { protocolVersions, transports, wsUrl, audience };
};

const documentVisibilityHost = (): VisibilityHostLike => ({
  isHidden: () => typeof document !== 'undefined' && document.hidden,
  addListener: (fn) => {
    if (typeof document === 'undefined') return () => {};
    document.addEventListener('visibilitychange', fn);
    return () => document.removeEventListener('visibilitychange', fn);
  },
});

const windowNetworkChangeHost = (): NetworkChangeHostLike => ({
  addListener: (fn) => {
    if (typeof window === 'undefined') return () => {};
    window.addEventListener('online', fn);
    return () => window.removeEventListener('online', fn);
  },
});

export interface NegotiatingTransportOptions {
  /** The REST transport this falls back to — untouched, same as today. */
  restTransport: SyncTransport;
  apiUrl: string;
  cursor: CursorReader;
  visibility?: VisibilityHostLike;
  networkChange?: NetworkChangeHostLike;
  fetcher?: typeof fetch;
  wsFactory?: WsFactory;
  /** [0, 1) — injectable for deterministic backoff tests (§12.1 full jitter). */
  random?: () => number;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (h: unknown) => void;
  /** §3.4 of docs/connection-status.md: the reachability probe must bound its wait. */
  metaTimeoutMs?: number;
}

type WsPhase = 'idle' | 'connecting' | 'draining' | 'live' | 'closed';

const GIVE_UP_RETRY_MS = 15 * 60_000;

export class NegotiatingTransport implements SyncTransport {
  private readonly restTransport: SyncTransport;
  private readonly apiUrl: string;
  private readonly cursor: CursorReader;
  private readonly visibility: VisibilityHostLike;
  private readonly networkChange: NetworkChangeHostLike;
  private readonly fetcher: typeof fetch;
  private readonly wsFactory?: WsFactory;
  private readonly random: () => number;
  private readonly setTimeoutFn: (fn: () => void, ms: number) => unknown;
  private readonly clearTimeoutFn: (h: unknown) => void;
  private readonly metaTimeoutMs: number;

  private bearerProvider: (() => Promise<string>) | null = null;
  private stopped = true;
  private removeVisibilityListener: (() => void) | null = null;
  private removeNetworkChangeListener: (() => void) | null = null;

  private wsPhase: WsPhase = 'idle';
  private ws: WebSocketTransport | null = null;
  private wsUrl: string | null = null;
  /** Permanently disabled for this instance — set on close code 4403 (§11.6);
   *  only a new instance (new backend URL) clears it. */
  private wsDisabled = false;
  private consecutiveFailures = 0;
  private backoffAttempt = 0;
  private reconnectHandle: unknown = null;
  private giveUpHandle: unknown = null;
  private metaInFlight = false;
  private lastOutcome: 'none' | 'ok' | 'failed' = 'none';

  private bufferedEvents: SyncEvent[] = [];
  private bufferedCursor: string | null = null;

  constructor(opts: NegotiatingTransportOptions) {
    this.restTransport = opts.restTransport;
    this.apiUrl = stripTrailingSlash(opts.apiUrl.trim());
    this.cursor = opts.cursor;
    this.visibility = opts.visibility ?? documentVisibilityHost();
    this.networkChange = opts.networkChange ?? windowNetworkChangeHost();
    this.fetcher = opts.fetcher ?? fetch.bind(globalThis);
    this.wsFactory = opts.wsFactory;
    this.random = opts.random ?? Math.random;
    this.setTimeoutFn = opts.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeoutFn = opts.clearTimeoutFn ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.metaTimeoutMs = opts.metaTimeoutMs ?? 10_000;
  }

  /** Wired by SyncEngine right after it constructs its AuthSession — a
   *  chicken/egg the constructor can't resolve, since AuthSession needs a
   *  transport and this transport needs AuthSession's bearer. */
  setBearerProvider(fn: () => Promise<string>): void {
    this.bearerProvider = fn;
  }

  // ---- SyncTransport ----------------------------------------------------
  // Auth never happens over WS (§11.1) — the bearer token itself is always
  // obtained via the §8 REST challenge/token flow.

  challenge(accountDid: string): Promise<ChallengeResponse> {
    return this.restTransport.challenge(accountDid);
  }

  token(accountDid: string, didJwt: string): Promise<TokenResponse> {
    return this.restTransport.token(accountDid, didJwt);
  }

  async push(accountDid: string, events: SyncEvent[], bearer: string): Promise<PushResponse> {
    if (this.wsPhase === 'live' && this.ws) {
      try {
        const result = await this.ws.push(events);
        this.lastOutcome = 'ok';
        return result;
      } catch {
        // A push frame with no ack is a lost push, not a delivered one
        // (§11.3) — REST retries the same (still-queued) events.
      }
    }
    try {
      const result = await this.restTransport.push(accountDid, events, bearer);
      this.lastOutcome = 'ok';
      return result;
    } catch (e) {
      this.lastOutcome = 'failed';
      throw e;
    }
  }

  async pull(accountDid: string, cursor: string, bearer: string): Promise<PullResponse> {
    if (this.bufferedEvents.length > 0) {
      const events = this.bufferedEvents;
      const nextCursor = this.bufferedCursor ?? cursor;
      this.bufferedEvents = [];
      this.bufferedCursor = null;
      return { events, nextCursor };
    }
    if (this.wsPhase === 'live') {
      // Already caught up via the socket — nothing new to fetch over REST.
      // (The pull timer keeps running per §12.2; this just makes each tick free.)
      return { events: [], nextCursor: cursor };
    }
    try {
      const result = await this.restTransport.pull(accountDid, cursor, bearer);
      this.lastOutcome = 'ok';
      return result;
    } catch (e) {
      this.lastOutcome = 'failed';
      throw e;
    }
  }

  // ---- Lifecycle ----------------------------------------------------------

  start(): void {
    this.stopped = false;
    this.removeVisibilityListener = this.visibility.addListener(() => this.onVisibilityChange());
    this.removeNetworkChangeListener = this.networkChange.addListener(() => this.onNetworkChange());
    if (!this.visibility.isHidden()) void this.negotiate();
  }

  stop(): void {
    this.stopped = true;
    this.removeVisibilityListener?.();
    this.removeVisibilityListener = null;
    this.removeNetworkChangeListener?.();
    this.removeNetworkChangeListener = null;
    this.cancelReconnect();
    this.cancelGiveUpTimer();
    this.teardownSocket();
  }

  connectionState(): ConnectionState {
    if (this.wsPhase === 'live') return 'live';
    if (this.wsPhase === 'connecting' || this.wsPhase === 'draining') return 'syncing';
    if (this.metaInFlight) return 'checking';
    if (this.lastOutcome === 'ok') return 'polling';
    if (this.lastOutcome === 'failed') return 'failed';
    return 'checking';
  }

  // ---- Negotiation (§10) ---------------------------------------------------

  private wsRuntimeAvailable(): boolean {
    return this.wsFactory !== undefined || typeof WebSocket !== 'undefined';
  }

  private async negotiate(): Promise<void> {
    if (this.stopped || this.wsDisabled) return;
    const meta = await this.fetchMeta();
    if (this.stopped) return;
    if (meta.transports.includes('ws') && meta.wsUrl && this.wsRuntimeAvailable()) {
      this.wsUrl = meta.wsUrl;
      this.openSocket();
    } else {
      this.wsUrl = null;
      this.wsPhase = 'idle';
    }
  }

  private async fetchMeta(): Promise<MetaResponse> {
    this.metaInFlight = true;
    let timeoutHandle: unknown = null;
    try {
      const metaUrl = this.apiUrl + '/v1/meta';
      return await Promise.race<MetaResponse>([
        this.doFetchMeta(metaUrl),
        new Promise<MetaResponse>((_, reject) => {
          timeoutHandle = this.setTimeoutFn(() => reject(new Error('meta timeout')), this.metaTimeoutMs);
        }),
      ]);
    } catch {
      // Any failure — 404, timeout, malformed body — assume REST-only (§10.2.1).
      return REST_ONLY_META;
    } finally {
      // `Promise.race` doesn't cancel the loser — if the fetch won, the timer
      // is still pending and must be cleared explicitly, or it leaks until it
      // fires on an already-settled promise.
      if (timeoutHandle !== null) this.clearTimeoutFn(timeoutHandle);
      this.metaInFlight = false;
    }
  }

  private async doFetchMeta(url: string): Promise<MetaResponse> {
    const response = await this.fetcher(url, { method: 'GET' });
    if (!response.ok) throw new Error(`meta http ${response.status}`);
    const body: unknown = await response.json();
    return normalizeMeta(body);
  }

  // ---- WS connection lifecycle (§11, §12) ----------------------------------

  private openSocket(): void {
    if (this.stopped || !this.wsUrl || this.wsDisabled || this.visibility.isHidden()) return;
    if (!this.bearerProvider) return;
    // A fresh `subscribe` always replays the full backlog since the persisted
    // cursor, so anything buffered from a previous, never-drained connection
    // is about to be resent — drop it here rather than risk delivering it twice.
    this.bufferedEvents = [];
    this.bufferedCursor = null;
    this.wsPhase = 'connecting';

    const ws: WebSocketTransport = new WebSocketTransport(
      this.wsUrl,
      {
        onAuthOk: () => {
          this.wsPhase = 'draining';
          const cursor = this.cursor.get() ?? '0';
          ws.subscribe(cursor);
        },
        onAuthErr: (reason) => {
          if (reason === 'bad_audience') {
            // §11.6 4403 analog for the handshake — do not retry.
            this.wsDisabled = true;
            this.teardownSocket();
            return;
          }
          this.teardownSocket();
          this.registerFailure();
        },
        onEvents: (events, nextCursor) => {
          this.bufferedEvents.push(...events);
          this.bufferedCursor = nextCursor;
        },
        onLive: () => {
          this.wsPhase = 'live';
          this.consecutiveFailures = 0;
          this.backoffAttempt = 0;
        },
        onClose: (code) => {
          const reachedLive = this.wsPhase === 'live';
          this.wsPhase = 'closed';
          this.ws = null;
          if (this.stopped) return;
          if (code === 4403) {
            this.wsDisabled = true;
            return;
          }
          if (!reachedLive) {
            this.registerFailure();
          } else {
            this.consecutiveFailures = 0;
            this.scheduleReconnect();
          }
        },
        onError: () => {
          // WsLike surfaces errors separately from close; the close handler
          // (real sockets always eventually fire one) drives reconnection.
        },
      },
      { wsFactory: this.wsFactory, setTimeoutFn: this.setTimeoutFn, clearTimeoutFn: this.clearTimeoutFn }
    );
    this.ws = ws;

    void this.bearerProvider()
      .then((token) => {
        if (this.ws !== ws) return; // superseded by a teardown while awaiting the token
        ws.connect(token);
      })
      .catch(() => {
        if (this.ws === ws) {
          this.ws = null;
          this.wsPhase = 'idle';
          this.registerFailure();
        }
      });
  }

  private registerFailure(): void {
    this.consecutiveFailures += 1;
    this.wsPhase = 'idle';
    this.ws = null;
    if (this.consecutiveFailures >= 3) {
      // §12.3: stop retrying WS for now; the pull timer (owned by SyncEngine)
      // carries sync. Re-attempt on foreground, network change, or after 15
      // minutes — whichever comes first.
      this.scheduleGiveUpRetry();
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.wsDisabled) return;
    const attempt = Math.min(this.backoffAttempt, 5);
    const capMs = Math.min(30_000, 1000 * 2 ** attempt);
    const delay = this.random() * capMs; // full jitter, §12.1
    this.backoffAttempt = Math.min(this.backoffAttempt + 1, 5);
    this.cancelReconnect();
    this.reconnectHandle = this.setTimeoutFn(() => {
      this.reconnectHandle = null;
      this.openSocket();
    }, delay);
  }

  private scheduleGiveUpRetry(): void {
    this.cancelGiveUpTimer();
    this.giveUpHandle = this.setTimeoutFn(() => {
      this.giveUpHandle = null;
      this.consecutiveFailures = 0;
      this.backoffAttempt = 0;
      this.openSocket();
    }, GIVE_UP_RETRY_MS);
  }

  private cancelReconnect(): void {
    if (this.reconnectHandle !== null) {
      this.clearTimeoutFn(this.reconnectHandle);
      this.reconnectHandle = null;
    }
  }

  private cancelGiveUpTimer(): void {
    if (this.giveUpHandle !== null) {
      this.clearTimeoutFn(this.giveUpHandle);
      this.giveUpHandle = null;
    }
  }

  private teardownSocket(): void {
    // Silent: this is *us* deliberately tearing the connection down (hidden,
    // stop(), giving up after auth_err). The generic "it closed on us" path
    // in `openSocket()`'s `onClose` handler must not run for this — it would
    // read the still-`live` phase and schedule an unwanted reconnect.
    this.ws?.closeSilently(1000, 'client closing');
    this.ws = null;
    this.wsPhase = 'idle';
  }

  // ---- Tab visibility (§12.5) ----------------------------------------------

  private onVisibilityChange(): void {
    if (this.visibility.isHidden()) {
      this.cancelReconnect();
      this.cancelGiveUpTimer();
      this.teardownSocket();
    } else {
      this.consecutiveFailures = 0;
      this.backoffAttempt = 0;
      this.cancelReconnect();
      this.cancelGiveUpTimer();
      void this.negotiate();
    }
  }

  private onNetworkChange(): void {
    if (this.stopped || this.visibility.isHidden() || this.wsPhase === 'live') return;
    this.consecutiveFailures = 0;
    this.backoffAttempt = 0;
    this.cancelReconnect();
    this.cancelGiveUpTimer();
    void this.negotiate();
  }
}
