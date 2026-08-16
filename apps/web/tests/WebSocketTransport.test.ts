import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketTransport, type WsLike, type WebSocketTransportHandlers } from '../src/sync/WebSocketTransport';
import { isoFormat, type SyncEvent } from '../src/sync/syncEvent';

class FakeSocket implements WsLike {
  sent: unknown[] = [];
  closed = false;
  lastCloseCode: number | null = null;
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
    this.lastCloseCode = code;
    this.onclose?.({ code, reason });
  }

  // ---- test helpers, simulating the server side ----
  open(): void {
    this.onopen?.();
  }
  serverSend(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  serverClose(code: number, reason = ''): void {
    if (this.closed) return;
    this.closed = true;
    this.lastCloseCode = code;
    this.onclose?.({ code, reason });
  }
}

const sampleEvent: SyncEvent = {
  accountDid: 'did:key:zTest',
  deviceId: 'device-1',
  eventId: 'evt-1',
  taskId: 'a4b2c1d0-1111-2222-3333-444455556666',
  updatedAt: isoFormat(new Date('2026-05-05T17:42:11.000Z')),
  op: 'upsert',
  ciphertext: 'cGxhaW50ZXh0',
  nonce: 'bm9uY2Vub25jZQ',
};

describe('WebSocketTransport', () => {
  let socket: FakeSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    socket = new FakeSocket();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const makeTransport = (handlers: WebSocketTransportHandlers = {}) =>
    new WebSocketTransport('wss://example.test/v1/sync/ws', handlers, {
      wsFactory: () => socket,
    });

  it('sends the auth frame as the first message after open (§11.1)', () => {
    const t = makeTransport();
    t.connect('bearer-token-123');
    expect(socket.sent).toHaveLength(0);
    socket.open();
    expect(socket.sent).toEqual([{ type: 'auth', token: 'bearer-token-123' }]);
  });

  it('reports auth_ok with the accountDid', () => {
    const onAuthOk = vi.fn();
    const t = makeTransport({ onAuthOk });
    t.connect('tok');
    socket.open();
    socket.serverSend({ type: 'auth_ok', accountDid: 'did:key:z6Mk...' });
    expect(onAuthOk).toHaveBeenCalledWith('did:key:z6Mk...');
  });

  it('reports auth_err with the reason', () => {
    const onAuthErr = vi.fn();
    const t = makeTransport({ onAuthErr });
    t.connect('tok');
    socket.open();
    socket.serverSend({ type: 'auth_err', reason: 'token_expired' });
    expect(onAuthErr).toHaveBeenCalledWith('token_expired');
  });

  it('subscribe() sends the cursor frame', () => {
    const t = makeTransport();
    t.connect('tok');
    socket.open();
    t.subscribe('147');
    expect(socket.sent).toContainEqual({ type: 'subscribe', cursor: '147' });
  });

  it('delivers events + nextCursor frames, then live', () => {
    const onEvents = vi.fn();
    const onLive = vi.fn();
    const t = makeTransport({ onEvents, onLive });
    t.connect('tok');
    socket.open();
    socket.serverSend({ type: 'events', events: [sampleEvent], nextCursor: '149' });
    expect(onEvents).toHaveBeenCalledWith([sampleEvent], '149');
    socket.serverSend({ type: 'live', cursor: '149' });
    expect(onLive).toHaveBeenCalledWith('149');
  });

  it('push() resolves on the matching push_ack', async () => {
    const t = makeTransport();
    t.connect('tok');
    socket.open();
    const promise = t.push([sampleEvent]);
    const sentPush = socket.sent.find((m) => (m as { type: string }).type === 'push') as {
      type: string;
      pushId: string;
      events: SyncEvent[];
    };
    expect(sentPush).toBeDefined();
    expect(sentPush.events).toEqual([sampleEvent]);
    socket.serverSend({ type: 'push_ack', pushId: sentPush.pushId, accepted: [sampleEvent.eventId], rejected: [] });
    await expect(promise).resolves.toEqual({ accepted: [sampleEvent.eventId], rejected: [] });
  });

  it('push() rejects if no push_ack arrives within the timeout', async () => {
    const t = makeTransport();
    t.connect('tok');
    socket.open();
    const promise = t.push([sampleEvent], 30_000);
    const assertion = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });

  it('answers a server ping with pong, echoing t', () => {
    const t = makeTransport();
    t.connect('tok');
    socket.open();
    socket.serverSend({ type: 'ping', t: 1755264000000 });
    expect(socket.sent).toContainEqual({ type: 'pong', t: 1755264000000 });
  });

  it('ignores unknown frame types without throwing', () => {
    const onEvents = vi.fn();
    const t = makeTransport({ onEvents });
    t.connect('tok');
    socket.open();
    expect(() => socket.serverSend({ type: 'some_future_frame', payload: 42 })).not.toThrow();
    expect(onEvents).not.toHaveBeenCalled();
  });

  it('calls onClose exactly once for a server-initiated close', () => {
    const onClose = vi.fn();
    const t = makeTransport({ onClose });
    t.connect('tok');
    socket.open();
    socket.serverClose(1000, 'bye');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith(1000, 'bye');
  });

  it('client-initiated close() calls onClose exactly once and closes the socket', () => {
    const onClose = vi.fn();
    const t = makeTransport({ onClose });
    t.connect('tok');
    socket.open();
    t.close(1000, 'client closing');
    expect(socket.closed).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('treats a missed heartbeat (no traffic at all) as a disconnect (§11.5)', () => {
    const onClose = vi.fn();
    const t = makeTransport({ onClose });
    t.connect('tok');
    socket.open();
    vi.advanceTimersByTime(65_000);
    expect(onClose).toHaveBeenCalledWith(4408, 'heartbeat-timeout');
    expect(socket.closed).toBe(true);
  });

  it('any incoming traffic rearms the heartbeat watchdog', () => {
    const onClose = vi.fn();
    const t = makeTransport({ onClose });
    t.connect('tok');
    socket.open();
    vi.advanceTimersByTime(60_000);
    socket.serverSend({ type: 'ping', t: 1 }); // traffic within the window
    vi.advanceTimersByTime(60_000); // another 60s from the ping, still under 65s watchdog
    expect(onClose).not.toHaveBeenCalled();
  });
});
