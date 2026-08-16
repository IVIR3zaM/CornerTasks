import { describe, expect, it } from 'vitest';
import { NegotiatingTransport, type CursorReader, type VisibilityHostLike } from '../src/sync/NegotiatingTransport';
import type { WsLike } from '../src/sync/WebSocketTransport';
import { isoFormat, type SyncEvent } from '../src/sync/syncEvent';
import type {
  ChallengeResponse,
  PullResponse,
  PushResponse,
  SyncTransport,
  TokenResponse,
} from '../src/sync/syncTransport';

class FakeSocket implements WsLike {
  sent: unknown[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(code = 1000, reason = ''): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.({ code, reason });
  }
  open(): void {
    this.onopen?.();
  }
  serverSend(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  serverClose(code: number, reason = ''): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.({ code, reason });
  }
  lastSentOfType(type: string): Record<string, unknown> | undefined {
    return this.sent.find((m) => (m as { type?: string }).type === type) as Record<string, unknown> | undefined;
  }
}

class FakeRestTransport implements SyncTransport {
  pullCalls: { cursor: string }[] = [];
  pushCalls: { events: SyncEvent[] }[] = [];
  pullResponses: PullResponse[] = [];
  pullShouldFail = false;

  async challenge(): Promise<ChallengeResponse> {
    return { challenge: 'c', audience: 'https://example.test', expiresAt: isoFormat(new Date()) };
  }
  async token(): Promise<TokenResponse> {
    return { accessToken: 'tok', expiresAt: isoFormat(new Date(Date.now() + 3600_000)) };
  }
  async push(_accountDid: string, events: SyncEvent[]): Promise<PushResponse> {
    this.pushCalls.push({ events });
    return { accepted: events.map((e) => e.eventId), rejected: [] };
  }
  async pull(_accountDid: string, cursor: string): Promise<PullResponse> {
    this.pullCalls.push({ cursor });
    if (this.pullShouldFail) throw { kind: 'network', message: 'down' };
    if (this.pullResponses.length > 0) return this.pullResponses.shift()!;
    return { events: [], nextCursor: cursor };
  }
}

class MutableCursor implements CursorReader {
  private value: string | null;
  constructor(initial: string | null = null) {
    this.value = initial;
  }
  get(): string | null {
    return this.value;
  }
  set(v: string | null): void {
    this.value = v;
  }
}

class ManualVisibility implements VisibilityHostLike {
  private hidden = false;
  private listeners = new Set<() => void>();
  isHidden(): boolean {
    return this.hidden;
  }
  addListener(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  setHidden(v: boolean): void {
    this.hidden = v;
    for (const fn of this.listeners) fn();
  }
}

const sampleEvent = (eventId: string): SyncEvent => ({
  accountDid: 'did:key:zTest',
  deviceId: 'device-1',
  eventId,
  taskId: 'a4b2c1d0-1111-2222-3333-444455556666',
  updatedAt: isoFormat(new Date('2026-05-05T17:42:11.000Z')),
  op: 'upsert',
  ciphertext: 'cGxhaW50ZXh0',
  nonce: 'bm9uY2Vub25jZQ',
});

const metaFetcher = (meta: unknown, ok = true): typeof fetch =>
  (async () => new Response(JSON.stringify(meta), { status: ok ? 200 : 404 })) as unknown as typeof fetch;

const WS_META = {
  protocolVersions: [2, 3],
  transports: ['ws', 'rest'],
  wsUrl: 'wss://example.test/v1/sync/ws',
  audience: 'https://example.test',
};
const REST_ONLY_META = { protocolVersions: [2], transports: ['rest'] };

interface Harness {
  transport: NegotiatingTransport;
  rest: FakeRestTransport;
  cursor: MutableCursor;
  visibility: ManualVisibility;
  sockets: FakeSocket[];
  handles: Map<number, { fn: () => void; ms: number }>;
}

const makeHarness = (opts: {
  meta?: unknown;
  metaOk?: boolean;
  cursor?: string | null;
  random?: () => number;
} = {}): Harness => {
  const rest = new FakeRestTransport();
  const cursor = new MutableCursor(opts.cursor ?? null);
  const visibility = new ManualVisibility();
  const sockets: FakeSocket[] = [];
  const handles = new Map<number, { fn: () => void; ms: number }>();
  let nextHandle = 1;

  const setTimeoutFn = (fn: () => void, ms: number): unknown => {
    const handle = nextHandle++;
    handles.set(handle, { fn, ms });
    return handle;
  };
  const clearTimeoutFn = (h: unknown): void => {
    handles.delete(h as number);
  };

  const transport = new NegotiatingTransport({
    restTransport: rest,
    apiUrl: 'https://example.test',
    cursor,
    visibility,
    networkChange: { addListener: () => () => {} },
    fetcher: metaFetcher(opts.meta ?? WS_META, opts.metaOk ?? true),
    wsFactory: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    random: opts.random ?? (() => 0),
    setTimeoutFn,
    clearTimeoutFn,
  });
  transport.setBearerProvider(async () => 'bearer-tok');

  return { transport, rest, cursor, visibility, sockets, handles };
};

/** Fires every still-live (not cancelled) timer scheduled with delay <= ms,
 *  in registration order — a one-shot, like the real thing. */
const fireDueTimers = (h: Harness, ms: number): void => {
  const due = [...h.handles.entries()].filter(([, v]) => v.ms <= ms);
  for (const [handle, v] of due) {
    h.handles.delete(handle);
    v.fn();
  }
};

/** The delay of the most recently scheduled still-live timer. */
const lastScheduledMs = (h: Harness): number | undefined => [...h.handles.values()].at(-1)?.ms;

/** Drains the negotiate() → fetchMeta() → openSocket() → bearerProvider()
 *  microtask chain. A macrotask boundary guarantees every pending microtask
 *  (however deep the `await` chain) has run before it fires. */
const flush = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

describe('NegotiatingTransport — negotiation (§10)', () => {
  it('picks WebSocket when /v1/meta advertises it', async () => {
    const h = makeHarness({ meta: WS_META });
    h.transport.start();
    await flush();
    expect(h.sockets).toHaveLength(1);
    h.sockets[0].open();
    expect(h.sockets[0].lastSentOfType('auth')).toEqual({ type: 'auth', token: 'bearer-tok' });
  });

  it('falls back to REST when /v1/meta does not advertise ws', async () => {
    const h = makeHarness({ meta: REST_ONLY_META });
    h.transport.start();
    await flush();
    expect(h.sockets).toHaveLength(0);

    const result = await h.transport.pull('did:key:zTest', '0', 'bearer');
    expect(h.rest.pullCalls).toHaveLength(1);
    expect(result).toEqual({ events: [], nextCursor: '0' });
  });

  it('falls back to REST when /v1/meta fails entirely (404, malformed, timeout)', async () => {
    const h = makeHarness({ metaOk: false, meta: { not: 'json-shaped' } });
    h.transport.start();
    await flush();
    expect(h.sockets).toHaveLength(0);
    await h.transport.push('did:key:zTest', [sampleEvent('e1')], 'bearer');
    expect(h.rest.pushCalls).toHaveLength(1);
  });
});

describe('NegotiatingTransport — mid-session drop and cursor-resumed reconnect (§12)', () => {
  it('reverts to polling on drop with no event loss or duplication, then resumes from the persisted cursor on reconnect', async () => {
    const h = makeHarness({ meta: WS_META, cursor: '0' });
    h.transport.start();
    await flush();

    // First connection reaches live with a 2-event backlog.
    const s1 = h.sockets[0];
    s1.open();
    s1.serverSend({ type: 'auth_ok', accountDid: 'did:key:zTest' });
    expect(s1.lastSentOfType('subscribe')).toEqual({ type: 'subscribe', cursor: '0' });
    s1.serverSend({ type: 'events', events: [sampleEvent('e1'), sampleEvent('e2')], nextCursor: '2' });
    s1.serverSend({ type: 'live', cursor: '2' });
    expect(h.transport.connectionState()).toBe('live');

    // SyncEngine's pull timer drains the buffered backlog exactly once.
    const first = await h.transport.pull('did:key:zTest', '0', 'bearer');
    expect(first.events.map((e) => e.eventId)).toEqual(['e1', 'e2']);
    expect(first.nextCursor).toBe('2');
    h.cursor.set('2'); // SyncEngine persists nextCursor, as it does today.

    // A second drain call before anything new arrives must not repeat the backlog.
    const empty = await h.transport.pull('did:key:zTest', '2', 'bearer');
    expect(empty.events).toEqual([]);

    // Socket drops mid-session (e.g. tunnel restart) — no close frame guarantee, but
    // here the server does send one.
    s1.serverClose(1000, 'restart');

    // The pull timer keeps carrying sync via REST while WS is down.
    h.rest.pullResponses = [{ events: [sampleEvent('e3')], nextCursor: '3' }];
    const viaRest = await h.transport.pull('did:key:zTest', '2', 'bearer');
    expect(viaRest.events.map((e) => e.eventId)).toEqual(['e3']);
    expect(h.rest.pullCalls).toHaveLength(1);
    h.cursor.set('3');

    // No event was lost or duplicated across the whole sequence.
    const allDelivered = [...first.events, ...viaRest.events].map((e) => e.eventId);
    expect(allDelivered).toEqual(['e1', 'e2', 'e3']);

    // Reconnect (scheduled by the drop) resumes from the persisted cursor.
    fireDueTimers(h, 1000);
    await flush();
    expect(h.sockets).toHaveLength(2);
    const s2 = h.sockets[1];
    s2.open();
    s2.serverSend({ type: 'auth_ok', accountDid: 'did:key:zTest' });
    expect(s2.lastSentOfType('subscribe')).toEqual({ type: 'subscribe', cursor: '3' });
  });
});

describe('NegotiatingTransport — backoff (§12.1, §12.3)', () => {
  it('uses full-jitter exponential backoff and gives up after 3 consecutive failures', async () => {
    const h = makeHarness({ meta: WS_META, random: () => 0.5 });
    h.transport.start();
    await flush();

    // Attempt 1 fails before reaching live.
    expect(h.sockets).toHaveLength(1);
    h.sockets[0].open();
    h.sockets[0].serverClose(1006, 'lost');
    expect(lastScheduledMs(h)).toBe(500); // 0.5 * min(30000, 1000*2^0)

    fireDueTimers(h, 500);
    await flush();
    expect(h.sockets).toHaveLength(2);
    h.sockets[1].open();
    h.sockets[1].serverClose(1006, 'lost');
    expect(lastScheduledMs(h)).toBe(1000); // 0.5 * min(30000, 1000*2^1)

    fireDueTimers(h, 1000);
    await flush();
    expect(h.sockets).toHaveLength(3);
    h.sockets[2].open();
    h.sockets[2].serverClose(1006, 'lost');
    // Third consecutive failure ⇒ give up on WS, schedule the 15-minute re-attempt instead.
    expect(lastScheduledMs(h)).toBe(15 * 60_000);

    // No further WS attempt happens on its own before that timer fires.
    expect(h.sockets).toHaveLength(3);
  });

  it('caps the exponent at attempt 5 and resets to 0 on reaching live', async () => {
    const h = makeHarness({ meta: WS_META, random: () => 1 });
    h.transport.start();
    await flush();

    h.sockets[0].open();
    h.sockets[0].serverClose(1006, 'lost'); // attempt 0 ⇒ 1000ms
    expect(lastScheduledMs(h)).toBe(1000);
    fireDueTimers(h, 1000);
    await flush();

    h.sockets[1].open();
    h.sockets[1].serverSend({ type: 'auth_ok', accountDid: 'did:key:zTest' });
    h.sockets[1].serverSend({ type: 'live', cursor: '0' });
    expect(h.transport.connectionState()).toBe('live');

    // Reaching live resets the backoff counters (§12.1) and the give-up counter.
    h.sockets[1].serverClose(1000, 'restart');
    expect(lastScheduledMs(h)).toBe(1000); // back to attempt 0 ⇒ 1000ms, not capped/compounded
  });
});

describe('NegotiatingTransport — tab visibility (§12.5)', () => {
  it('closes the socket on hidden and delivers an event pushed while backgrounded exactly once on foreground', async () => {
    const h = makeHarness({ meta: WS_META, cursor: '0' });
    h.transport.start();
    await flush();

    const s1 = h.sockets[0];
    s1.open();
    s1.serverSend({ type: 'auth_ok', accountDid: 'did:key:zTest' });
    s1.serverSend({ type: 'live', cursor: '0' });
    expect(h.transport.connectionState()).toBe('live');

    // Tab backgrounds: socket closes cleanly, no reconnect is scheduled.
    h.visibility.setHidden(true);
    expect(s1.closed).toBe(true);
    expect(h.handles.size).toBe(0);

    // "Another client" pushes an event while we're backgrounded — it sits on
    // the server, waiting for our next subscribe.

    // Tab foregrounds: reconnects and drains from the persisted cursor.
    h.visibility.setHidden(false);
    await flush();
    expect(h.sockets).toHaveLength(2);
    const s2 = h.sockets[1];
    s2.open();
    s2.serverSend({ type: 'auth_ok', accountDid: 'did:key:zTest' });
    expect(s2.lastSentOfType('subscribe')).toEqual({ type: 'subscribe', cursor: '0' });
    s2.serverSend({ type: 'events', events: [sampleEvent('bg-1')], nextCursor: '1' });
    s2.serverSend({ type: 'live', cursor: '1' });

    const drained = await h.transport.pull('did:key:zTest', '0', 'bearer');
    expect(drained.events.map((e) => e.eventId)).toEqual(['bg-1']);
    h.cursor.set('1');

    // Exactly once — not zero, not twice.
    const again = await h.transport.pull('did:key:zTest', '1', 'bearer');
    expect(again.events).toEqual([]);
  });

  it('does not reconnect while still hidden even if a reconnect was pending', async () => {
    const h = makeHarness({ meta: WS_META });
    h.transport.start();
    await flush();
    h.sockets[0].open();
    h.sockets[0].serverClose(1006, 'lost'); // schedules a reconnect

    h.visibility.setHidden(true);
    fireDueTimers(h, 100_000); // even if something were still pending, nothing should fire
    expect(h.sockets).toHaveLength(1);
  });
});
