// Browser WebSocket client for the CornerTasks sync protocol v3 WS framing.
// See docs/sync-protocol.md §11. Implemented independently against the spec
// (not ported from the macOS Swift client — see plan/v0.3.0/nodes/N14-web-transport.md).
//
// D2 (plan/v0.3.0/decisions.md): a browser WebSocket cannot set an
// `Authorization` header, so the bearer token travels as the first frame
// after open, never in the URL.
//
// This class owns exactly one connection and the §11 frame protocol. It knows
// nothing about reconnection, backoff, or REST fallback — that's
// NegotiatingTransport's job (§12).

import type { SyncEvent } from './syncEvent';

/** Structural subset of the DOM `WebSocket` this module needs — lets tests
 *  inject a fake without pulling in a real socket implementation. */
export interface WsLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type WsFactory = (url: string) => WsLike;

export interface PushAckResult {
  accepted: string[];
  rejected: { eventId: string; reason: string }[];
}

export interface WebSocketTransportHandlers {
  onAuthOk?: (accountDid: string) => void;
  onAuthErr?: (reason: string) => void;
  onEvents?: (events: SyncEvent[], nextCursor: string) => void;
  onLive?: (cursor: string) => void;
  onClose?: (code: number, reason: string) => void;
  onError?: (err: unknown) => void;
}

export interface WebSocketTransportOptions {
  wsFactory?: WsFactory;
  /** No traffic at all (including our own heartbeat) for this long ⇒ treat the
   *  peer as dead (sync-protocol §11.5: server pings every 30s and closes a
   *  non-responsive peer after 60s — "absence of traffic is the only
   *  reliable signal", so the client runs the same kind of watchdog). */
  heartbeatTimeoutMs?: number;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (h: unknown) => void;
}

const defaultWsFactory: WsFactory = (url) => new WebSocket(url) as unknown as WsLike;

const randomId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
};

interface PendingPush {
  resolve: (r: PushAckResult) => void;
  reject: (e: unknown) => void;
  timeoutHandle: unknown;
}

/** One WebSocket connection speaking the §11 frame protocol. */
export class WebSocketTransport {
  private socket: WsLike | null = null;
  private readonly wsFactory: WsFactory;
  private readonly heartbeatTimeoutMs: number;
  private readonly setTimeoutFn: (fn: () => void, ms: number) => unknown;
  private readonly clearTimeoutFn: (h: unknown) => void;
  private heartbeatHandle: unknown = null;
  private readonly pendingPushes = new Map<string, PendingPush>();

  constructor(
    private readonly url: string,
    private readonly handlers: WebSocketTransportHandlers,
    opts: WebSocketTransportOptions = {}
  ) {
    this.wsFactory = opts.wsFactory ?? defaultWsFactory;
    this.heartbeatTimeoutMs = opts.heartbeatTimeoutMs ?? 65_000;
    this.setTimeoutFn = opts.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeoutFn = opts.clearTimeoutFn ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** Opens the socket; sends `{"type":"auth","token":...}` as the first frame
   *  once open (§11.1). */
  connect(token: string): void {
    const socket = this.wsFactory(this.url);
    this.socket = socket;
    socket.onopen = () => {
      this.armHeartbeat();
      this.send({ type: 'auth', token });
    };
    socket.onmessage = (ev) => this.handleMessage(ev.data);
    socket.onclose = (ev) => this.teardown(ev.code, ev.reason ?? '', true);
    socket.onerror = (ev) => this.handlers.onError?.(ev);
  }

  /** Client → server after `auth_ok` (§11.2). */
  subscribe(cursor: string): void {
    this.send({ type: 'subscribe', cursor });
  }

  /** Sends a `push` frame and resolves when the matching `push_ack` arrives,
   *  or rejects after `timeoutMs` — a push frame with no ack is a lost push,
   *  not a delivered one (§11.3). Default bound matches
   *  docs/connection-status.md §8.3 (30s, the same dead-peer bound as §11.5). */
  push(events: SyncEvent[], timeoutMs = 30_000): Promise<PushAckResult> {
    const pushId = randomId();
    return new Promise<PushAckResult>((resolve, reject) => {
      const timeoutHandle = this.setTimeoutFn(() => {
        this.pendingPushes.delete(pushId);
        reject(new Error('push_ack timeout'));
      }, timeoutMs);
      this.pendingPushes.set(pushId, { resolve, reject, timeoutHandle });
      this.send({ type: 'push', pushId, events });
    });
  }

  /** Client-initiated close (normal shutdown, tab hidden, giving up). */
  close(code = 1000, reason = ''): void {
    this.teardown(code, reason, true);
  }

  /** Same as `close()`, but does not invoke `onClose` — for callers who are
   *  deliberately tearing the connection down and already know why, so the
   *  generic "the socket closed" handling (reconnect scheduling, failure
   *  bookkeeping) does not misfire for an intentional close. */
  closeSilently(code = 1000, reason = ''): void {
    this.teardown(code, reason, false);
  }

  private send(obj: unknown): void {
    this.socket?.send(JSON.stringify(obj));
  }

  private handleMessage(raw: string): void {
    this.armHeartbeat(); // any traffic counts as "alive"
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || typeof (msg as { type?: unknown }).type !== 'string') return;
    const m = msg as Record<string, unknown>;
    switch (m.type) {
      case 'auth_ok':
        this.handlers.onAuthOk?.(String(m.accountDid ?? ''));
        break;
      case 'auth_err':
        this.handlers.onAuthErr?.(String(m.reason ?? ''));
        break;
      case 'events':
        this.handlers.onEvents?.((m.events as SyncEvent[]) ?? [], String(m.nextCursor ?? ''));
        break;
      case 'live':
        this.handlers.onLive?.(String(m.cursor ?? ''));
        break;
      case 'push_ack': {
        const pushId = String(m.pushId ?? '');
        const pending = this.pendingPushes.get(pushId);
        if (pending) {
          this.pendingPushes.delete(pushId);
          this.clearTimeoutFn(pending.timeoutHandle);
          pending.resolve({
            accepted: (m.accepted as string[]) ?? [],
            rejected: (m.rejected as { eventId: string; reason: string }[]) ?? [],
          });
        }
        break;
      }
      case 'ping':
        // The server pings; we answer, echoing `t` (§11.5). We do not need to
        // separately handle an incoming `pong` — any message already rearms
        // the heartbeat watchdog above.
        this.send({ type: 'pong', t: m.t });
        break;
      case 'pong':
        break;
      default:
        // Unknown frame types are ignored, not errors — the forward-
        // compatibility hinge (§11).
        break;
    }
  }

  /** Single teardown path for every way a connection ends: the server closing
   *  it, us closing it, or our own heartbeat watchdog deciding it's dead. */
  private teardown(code: number, reason: string, notify: boolean): void {
    this.disarmHeartbeat();
    this.failAllPendingPushes(new Error(`socket closed (${code})`));
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      // Prevent a real `close` event from re-entering teardown once we've
      // already decided to tear down (e.g. a heartbeat-timeout-triggered close).
      socket.onclose = null;
      socket.onmessage = null;
      socket.onerror = null;
      try {
        socket.close(code, reason);
      } catch {
        // already closed
      }
    }
    if (notify) this.handlers.onClose?.(code, reason);
  }

  private failAllPendingPushes(err: unknown): void {
    for (const [, pending] of this.pendingPushes) {
      this.clearTimeoutFn(pending.timeoutHandle);
      pending.reject(err);
    }
    this.pendingPushes.clear();
  }

  private armHeartbeat(): void {
    this.disarmHeartbeat();
    this.heartbeatHandle = this.setTimeoutFn(() => {
      // No traffic at all for heartbeatTimeoutMs — the mobile-network/tunnel
      // case where the peer vanishes without a close frame (§11.5). Treat it
      // as a disconnect and let NegotiatingTransport reconnect per §12.
      this.teardown(4408, 'heartbeat-timeout', true);
    }, this.heartbeatTimeoutMs);
  }

  private disarmHeartbeat(): void {
    if (this.heartbeatHandle !== null) {
      this.clearTimeoutFn(this.heartbeatHandle);
      this.heartbeatHandle = null;
    }
  }
}
