// WebSocket transport for the self-hosted runtime — docs/sync-protocol.md
// §11 (framing) and §12 (what the client does when this goes wrong).
//
// This module owns three things that are silent when they are wrong, which is
// why each has a named invariant below:
//
//   1. Identity. A connection's `accountDid` comes from the verified bearer
//      token and is fixed for the socket's lifetime (§11.1). No frame can
//      change it. Fan-out is keyed on that value, so getting this wrong is a
//      cross-account data leak, not a bug.
//   2. Ordering and completeness. A client's cursor is the only durability
//      mechanism (§11.4); a frame that advances a client past an event it was
//      never sent is permanent data loss on that device. Everything about how
//      `nextCursor` is chosen below exists to make that impossible.
//   3. Liveness. Sockets die without close frames on tunnels and mobile
//      networks (§11.5). A connection that is never reaped holds a slot in the
//      per-account cap and leaks a map entry.
//
// What this module deliberately does NOT own: reconnection, backoff, and REST
// fallback are the client's job (§12), and accept/reject semantics belong to
// backend/core's push handler, which is called here rather than reimplemented.

import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { getStore, parseCursor, toWireEvent, type StoredEvent } from '../../core/src/lib/db';
import { verifyBearerToken } from '../../core/src/lib/auth';
import { handler as pushHandler } from '../../core/src/handlers/push';
import type { PushReject, PushResponse } from '../../core/src/types/api';
import type { DomainContext } from './adapter';
import { WS_PATH } from './lib/ws-config';

export { WS_PATH };

// ---------------------------------------------------------------------------
// Tunables. Every default is pinned by the protocol; the options object exists
// so tests can compress wall-clock timings, not so deployments can retune the
// wire contract.
// ---------------------------------------------------------------------------

/** §11.1: close with `4401` after 5s without a successful `auth`. */
export const AUTH_TIMEOUT_MS = 5_000;
/** §11.5: the server sends `ping` every 30 seconds. */
export const PING_INTERVAL_MS = 30_000;
/** §11.5: close a peer that has not answered within 60 seconds. */
export const HEARTBEAT_TIMEOUT_MS = 60_000;
/** §11: "Frames larger than 1 MiB MUST be rejected." Same ceiling as the HTTP
 *  body cap in `adapter.ts`, so a payload that is too big is too big on both
 *  transports rather than depending on which one the client picked. */
export const MAX_FRAME_BYTES = 1024 * 1024;
/** Sockets one account may hold open at once, before `4429` (§11.6). Sized for
 *  the real shape of the product — a laptop, a phone, a tablet, plus headroom
 *  for a reconnect that overlaps a not-yet-reaped dead socket. Rejecting is
 *  specified behaviour; the client falls back to REST and retries in 5 minutes,
 *  which is strictly better than degrading every socket on the account. */
export const MAX_CONNECTIONS_PER_ACCOUNT = 8;
/** Events per `events` frame. §11.2 leaves chunking to the server's
 *  discretion; this keeps a large first drain well under `MAX_FRAME_BYTES`. */
export const EVENTS_CHUNK_SIZE = 200;
/** Fairness bound on the drain/catch-up loop — see `pump()`. Not a
 *  correctness bound: exceeding it costs latency, never events. */
const MAX_PUMP_ROUNDS = 64;

/** §11.6 close codes. */
export const CLOSE_AUTH_FAILED = 4401;
export const CLOSE_AUDIENCE_MISMATCH = 4403;
export const CLOSE_HEARTBEAT_TIMEOUT = 4408;
export const CLOSE_TOO_MANY_CONNECTIONS = 4429;

export interface WsServerOptions {
  authTimeoutMs?: number;
  pingIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  maxFrameBytes?: number;
  maxConnectionsPerAccount?: number;
  eventsChunkSize?: number;
}

// ---------------------------------------------------------------------------
// Connection state
// ---------------------------------------------------------------------------

/**
 * `unauthenticated` → `authenticating` → `authenticated` → `draining` → `live`
 *
 * `authenticating` is a real state, not a formality: token verification is
 * `await`ed, and without an explicit state a client could pipeline a second
 * `auth` (or a `push`) into that window and be served before the first
 * verification resolved.
 */
type ConnState = 'unauthenticated' | 'authenticating' | 'authenticated' | 'draining' | 'live' | 'closed';

export class Connection {
  state: ConnState = 'unauthenticated';
  /** Set once, from the verified token. Never read from a client frame. */
  accountDid: string | null = null;
  /** Retained so pushes can be replayed through the *REST* push handler
   *  verbatim (see `handlePush`), which re-checks `exp` on every write — a
   *  socket therefore cannot outlive its token's authority to write. */
  token: string | null = null;

  /** Highest `seq` this connection has been *sent*. Distinct from whatever the
   *  client has persisted, which may lag by the events the client itself
   *  authored (see `pump`). Server-side only. */
  cursor = 0;
  /** "There may be events after `cursor`." This one boolean is the drain
   *  buffer §11.2 mandates — see the note in `pump()`. */
  pending = false;
  /** A `pump()` is in flight; re-entrant callers must not start a second one,
   *  or two interleaved reads could emit frames out of `seq` order. */
  pumping = false;
  /** Event ids this connection just wrote itself, to be withheld from the very
   *  next catch-up read (§11.4 "never to the originating connection"). */
  suppress: Set<string> | null = null;
  /** Bumped whenever `cursor` is reset from outside a read (i.e. by
   *  `subscribe`). A read that completes across such a reset is discarded —
   *  see `handleSubscribe`. */
  generation = 0;

  authTimer: NodeJS.Timeout | null = null;
  pingTimer: NodeJS.Timeout | null = null;
  deadTimer: NodeJS.Timeout | null = null;

  constructor(readonly socket: WebSocket) {}
}

/** Every `await` in this module is a window in which the peer can vanish, so
 *  each one is followed by this check. It is a function rather than an inline
 *  `conn.state === 'closed'` because TypeScript narrows a mutable property
 *  across `await` as though nothing else could have written it — which would
 *  make exactly these checks look like dead code and invite their removal. */
function isClosed(conn: Connection): boolean {
  return conn.state === 'closed';
}

// ---------------------------------------------------------------------------
// Hub
// ---------------------------------------------------------------------------

export class WsHub {
  private readonly wss: WebSocketServer;
  private readonly byAccount = new Map<string, Set<Connection>>();
  private readonly authTimeoutMs: number;
  private readonly pingIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly maxConnectionsPerAccount: number;
  private readonly eventsChunkSize: number;

  constructor(
    server: HttpServer,
    private readonly domain: DomainContext,
    opts: WsServerOptions = {}
  ) {
    this.authTimeoutMs = opts.authTimeoutMs ?? AUTH_TIMEOUT_MS;
    this.pingIntervalMs = opts.pingIntervalMs ?? PING_INTERVAL_MS;
    this.heartbeatTimeoutMs = opts.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS;
    this.maxConnectionsPerAccount = opts.maxConnectionsPerAccount ?? MAX_CONNECTIONS_PER_ACCOUNT;
    this.eventsChunkSize = opts.eventsChunkSize ?? EVENTS_CHUNK_SIZE;

    this.wss = new WebSocketServer({
      server,
      path: WS_PATH,
      // `ws` closes an over-size frame with 1009 before it ever reaches
      // `onMessage`, which is what §11's 1 MiB rule requires: rejecting after
      // buffering would be exactly the memory-exhaustion the rule prevents.
      maxPayload: opts.maxFrameBytes ?? MAX_FRAME_BYTES
    });
    this.wss.on('connection', (socket) => this.onConnection(socket));
  }

  // -- registry ------------------------------------------------------------

  /** Live connections for one account. Empty sets are deleted, not left
   *  behind — a `Map` keyed by account that only ever grows is a slow leak on
   *  a long-lived self-hosted process. */
  connectionsFor(accountDid: string): number {
    return this.byAccount.get(accountDid)?.size ?? 0;
  }

  /** Accounts with at least one live connection. Tests assert this is empty
   *  after every socket disconnects. */
  accountCount(): number {
    return this.byAccount.size;
  }

  totalConnections(): number {
    let n = 0;
    for (const set of this.byAccount.values()) n += set.size;
    return n;
  }

  /**
   * "Something was written for this account — everyone catch up."
   *
   * Called after a successful write on *either* transport. Passing the
   * originating connection (and the ids it just wrote) is what implements
   * §11.4's "never to the originating connection"; a REST push has no
   * originating socket and passes neither, so all live sockets of that account
   * get the update. Without the REST branch, a device sitting on a healthy
   * socket would stand down its pull timer (§12.2) and then never hear about a
   * push another device made over REST until it reconnected.
   */
  notifyAccount(
    accountDid: string,
    origin?: { connection: Connection; writtenEventIds: string[] }
  ): void {
    const set = this.byAccount.get(accountDid);
    if (!set) return;
    for (const conn of set) {
      // A connection that has not subscribed has no cursor, so there is
      // nothing meaningful to send it; its eventual drain reads everything.
      if (conn.state !== 'draining' && conn.state !== 'live') continue;
      if (origin && conn === origin.connection) {
        const suppress = conn.suppress ?? new Set<string>();
        for (const id of origin.writtenEventIds) suppress.add(id);
        conn.suppress = suppress;
      }
      conn.pending = true;
      void this.pump(conn);
    }
  }

  /** Closes every socket and stops accepting new ones. */
  async close(): Promise<void> {
    // Snapshot first: `teardown` deletes from the very sets/keys being walked.
    const all: Connection[] = [];
    for (const set of this.byAccount.values()) all.push(...set);
    for (const conn of all) this.teardown(conn, 1001, 'server_shutdown');
    // Sockets that never authenticated are not in `byAccount`; `wss.clients`
    // still holds them, so terminate from there too.
    for (const socket of this.wss.clients) socket.terminate();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }

  // -- lifecycle -----------------------------------------------------------

  private onConnection(socket: WebSocket): void {
    const conn = new Connection(socket);

    // §11.1: unauthenticated sockets get 5 seconds, then 4401. Unref'd so a
    // pending timer never holds the process open on shutdown.
    conn.authTimer = setTimeout(() => {
      if (conn.state === 'unauthenticated' || conn.state === 'authenticating') {
        this.teardown(conn, CLOSE_AUTH_FAILED, 'auth_timeout');
      }
    }, this.authTimeoutMs);
    conn.authTimer.unref?.();

    this.armHeartbeat(conn);

    socket.on('message', (data: RawData, isBinary: boolean) => {
      // Same reasoning as `pump`'s catch: an exception inside frame handling
      // is an unhandled rejection here, and Node's default for that is to exit
      // — one malformed frame from one device would take the backend down for
      // every device.
      this.onMessage(conn, data, isBinary).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('cornertasks-server: ws frame handling failed', err);
        this.teardown(conn, 1011, 'frame_handling_failed');
      });
    });
    socket.on('close', () => this.forget(conn));
    // A socket error (ECONNRESET on a dropped tunnel) does not always emit
    // 'close' before the process notices, so it gets the same cleanup path.
    socket.on('error', () => this.teardown(conn, 1011, 'socket_error'));
  }

  /** Removes a connection from the registry and stops its timers. Idempotent —
   *  `teardown` and the socket's own `close` event both land here. */
  private forget(conn: Connection): void {
    conn.state = 'closed';
    if (conn.authTimer) clearTimeout(conn.authTimer);
    if (conn.pingTimer) clearInterval(conn.pingTimer);
    if (conn.deadTimer) clearTimeout(conn.deadTimer);
    conn.authTimer = null;
    conn.pingTimer = null;
    conn.deadTimer = null;
    if (!conn.accountDid) return;
    const set = this.byAccount.get(conn.accountDid);
    if (!set) return;
    set.delete(conn);
    if (set.size === 0) this.byAccount.delete(conn.accountDid);
  }

  private teardown(conn: Connection, code: number, reason: string): void {
    this.forget(conn);
    try {
      if (conn.socket.readyState === WebSocket.OPEN) conn.socket.close(code, reason);
      else conn.socket.terminate();
    } catch {
      // already gone
    }
  }

  // -- heartbeat (§11.5) ---------------------------------------------------

  /** Two timers, not one. The interval sends `ping` every 30s; a separate
   *  deadline, rearmed on *any* inbound frame, fires at 60s. Folding them into
   *  one interval would make the effective dead-peer bound 60–90s depending on
   *  phase, and "closes a connection that has not answered within 60 seconds"
   *  is a number clients (§12.1 backoff, docs/connection-status.md) count on. */
  private armHeartbeat(conn: Connection): void {
    conn.pingTimer = setInterval(() => {
      this.send(conn, { type: 'ping', t: Date.now() });
    }, this.pingIntervalMs);
    conn.pingTimer.unref?.();
    this.touch(conn);
  }

  private touch(conn: Connection): void {
    if (isClosed(conn)) return;
    if (conn.deadTimer) clearTimeout(conn.deadTimer);
    conn.deadTimer = setTimeout(() => {
      this.teardown(conn, CLOSE_HEARTBEAT_TIMEOUT, 'heartbeat_timeout');
    }, this.heartbeatTimeoutMs);
    conn.deadTimer.unref?.();
  }

  // -- frames --------------------------------------------------------------

  private send(conn: Connection, frame: unknown): void {
    if (conn.socket.readyState !== WebSocket.OPEN) return;
    conn.socket.send(JSON.stringify(frame));
  }

  private async onMessage(conn: Connection, data: RawData, isBinary: boolean): Promise<void> {
    // Any traffic proves the peer is alive, whether or not we understand it.
    this.touch(conn);
    if (isClosed(conn)) return;

    // §11: "One JSON object per WebSocket message, UTF-8". A binary frame or
    // unparseable text is ignored rather than fatal — same forward-
    // compatibility posture as an unknown `type`. An unauthenticated socket
    // that only ever sends garbage still hits the 5s `4401` timeout, so
    // ignoring is not a way to stay connected for free.
    if (isBinary) return;
    let frame: unknown;
    try {
      frame = JSON.parse(data.toString('utf8'));
    } catch {
      return;
    }
    if (!frame || typeof frame !== 'object') return;
    const msg = frame as Record<string, unknown>;
    if (typeof msg.type !== 'string') return;

    // §11.1: reject every frame other than `auth` until authentication
    // succeeds. "Reject" here means "do not act on it" — §11 defines no error
    // frame for this case, and the 5s timeout is the specified consequence.
    if (conn.state === 'unauthenticated') {
      if (msg.type === 'auth') await this.handleAuth(conn, msg);
      return;
    }
    if (conn.state === 'authenticating') return;

    switch (msg.type) {
      case 'auth':
        // A second `auth` on an authenticated socket is ignored, never
        // honoured. Re-binding identity mid-socket would let a connection move
        // between accounts while sitting in `byAccount` under the old key —
        // i.e. it would receive another account's fan-out.
        return;
      case 'subscribe':
        this.handleSubscribe(conn, msg);
        return;
      case 'push':
        await this.handlePush(conn, msg);
        return;
      case 'ping':
        // §11.5: "a server MUST answer with `pong` echoing `t`".
        this.send(conn, { type: 'pong', t: msg.t });
        return;
      case 'pong':
        // Liveness already recorded by `touch()` above.
        return;
      default:
        // §11: unknown `type` values MUST be ignored, not treated as errors.
        return;
    }
  }

  // -- §11.1 auth ----------------------------------------------------------

  private async handleAuth(conn: Connection, msg: Record<string, unknown>): Promise<void> {
    conn.state = 'authenticating';
    const token = typeof msg.token === 'string' ? msg.token : '';
    if (token.length === 0) {
      this.send(conn, { type: 'auth_err', reason: 'bad_token' });
      this.teardown(conn, CLOSE_AUTH_FAILED, 'bad_token');
      return;
    }

    const result = await verifyBearerToken(token);
    if (isClosed(conn)) return;

    if (!result.ok) {
      this.send(conn, { type: 'auth_err', reason: result.reason });
      // §11.6 reserves `4403` for an audience mismatch. `verifyBearerToken`
      // cannot produce `bad_audience`: a bearer token's `aud` is the fixed
      // string `cornertasks-sync-v1`, and a token minted by a *different*
      // deployment fails signature verification first, reported as
      // `bad_token`. `bad_audience` is a client-side guard (BackendPing
      // comparing `/v1/auth/challenge`'s `audience` to the configured URL), so
      // `4403` is unreachable from here by construction. The branch is written
      // anyway so that if a future reason is added, the close code follows it
      // instead of silently degrading to `4401` — which a client retries.
      const code =
        (result.reason as string) === 'bad_audience' ? CLOSE_AUDIENCE_MISMATCH : CLOSE_AUTH_FAILED;
      this.teardown(conn, code, result.reason);
      return;
    }

    const accountDid = result.subject.accountDid;
    const set = this.byAccount.get(accountDid) ?? new Set<Connection>();
    if (set.size >= this.maxConnectionsPerAccount) {
      // No `auth_err`: §11.1 fixes the `reason` vocabulary to §8.6's token
      // failures, and this is not one — the token was good. §11.6's `4429` is
      // the whole signal, and the client's response to it (fall back to REST,
      // retry in 5 min) is specified there.
      this.teardown(conn, CLOSE_TOO_MANY_CONNECTIONS, 'too_many_connections');
      return;
    }

    if (conn.authTimer) clearTimeout(conn.authTimer);
    conn.authTimer = null;
    conn.accountDid = accountDid;
    conn.token = token;
    conn.state = 'authenticated';
    set.add(conn);
    this.byAccount.set(accountDid, set);

    this.send(conn, { type: 'auth_ok', accountDid });
  }

  // -- §11.2 subscribe / drain --------------------------------------------

  private handleSubscribe(conn: Connection, msg: Record<string, unknown>): void {
    // A `subscribe` arriving while a drain is already in flight is dropped:
    // honouring it would emit two `live` frames for one drain, and §11.2 says
    // exactly one. From `live`, a re-subscribe is honoured — it is how a
    // client asks to be re-sent from an earlier position.
    if (conn.state !== 'authenticated' && conn.state !== 'live') return;

    // §7.2 answers a malformed cursor with `400 invalid_cursor`; §11 defines
    // no error frame, so the choice here is between ignoring the frame (the
    // client hangs forever waiting for `live`) and clamping to 0 (a full
    // resync). Clamping wins: re-delivering events is idempotent at the
    // client, whereas a hung socket is indistinguishable from a dead backend.
    conn.cursor = parseCursor(typeof msg.cursor === 'string' ? msg.cursor : '0');
    conn.suppress = null;
    conn.state = 'draining';
    // Invalidates any read that is mid-flight against the *old* cursor. Without
    // this, a re-subscribe that lands while a fan-out read is awaiting would
    // have its rewound cursor overwritten by that read's `nextCursor`, and the
    // replay the client asked for would silently never arrive.
    conn.generation++;
    conn.pending = true;
    void this.pump(conn);
  }

  /**
   * The single reader for a connection: drains the backlog, delivers fan-out,
   * and decides when the connection is `live`. Both §11.2's drain and §11.4's
   * fan-out are the same operation — "send everything after your cursor" —
   * which is why they share one code path.
   *
   * **The drain race (§11.2), and why `pending` is the buffer.** The window
   * this closes is between "read the backlog" and "start listening". The
   * obvious implementation buffers *event payloads* arriving during the drain
   * and flushes them before `live`; that works but has to then de-duplicate
   * against whatever the drain query already returned, and getting the overlap
   * wrong delivers an event twice or not at all. Here the buffer is a single
   * boolean: a concurrent write sets `pending`, and the loop simply reads
   * again from the cursor. Re-reading cannot duplicate (the read is `seq >
   * cursor` and the cursor only moves forward) and cannot drop (the read is
   * complete over that range).
   *
   * **Why there is no gap at the `live` transition.** `pending` is cleared
   * *before* the `await`, and the decision to go `live` is taken in the same
   * synchronous block as the `pending` test — no `await` separates them. Node
   * cannot interleave a write's `notifyAccount` into that block, so "pending
   * is false" and "we are now live" are established atomically. Any write that
   * lands during the `await` is seen by the next loop iteration.
   *
   * **Why the store is re-read rather than the accepted events forwarded.**
   * The store keeps one row per `(accountDid, taskId)` — the current snapshot,
   * whose `seq` moves on each write. Forwarding the events of a single push
   * could therefore deliver a task state that a later push has already
   * superseded, and would require inventing a `nextCursor` for a set that is
   * not a contiguous prefix of the log. Reading gives both correctness and a
   * cursor that is safe by construction.
   */
  private async pump(conn: Connection): Promise<void> {
    if (conn.pumping) return;
    conn.pumping = true;
    try {
      let rounds = 0;
      for (;;) {
        if (isClosed(conn)) return;
        const generation = conn.generation;

        // --- synchronous decision point: do not introduce an `await` above
        // --- this block and below the previous loop iteration's `await`.
        if (!conn.pending || rounds >= MAX_PUMP_ROUNDS) {
          if (conn.state === 'draining') {
            conn.state = 'live';
            this.send(conn, { type: 'live', cursor: String(conn.cursor) });
          }
          if (conn.pending) {
            // Only reachable under the fairness bound. Yield the turn and come
            // back; nothing is stranded, and going `live` first was safe
            // because the cursor we sent is accurate — the client is simply
            // told about the remainder in the next `events` frame.
            // `conn.pumping` is cleared by this function's `finally` before
            // the immediate runs, so the re-entry is not blocked by the guard.
            setImmediate(() => void this.pump(conn));
            return;
          }
          return;
        }
        rounds++;
        conn.pending = false;
        const suppress = conn.suppress;
        conn.suppress = null;

        const accountDid = conn.accountDid as string;
        // The *same* call `GET /v1/sync/pull` makes (§7.2, handlers/pull.ts):
        // same ordering, same archive cutoff, same cursor arithmetic. A second
        // query here is how the two transports would come to disagree about
        // what "after cursor N" means.
        const result = await getStore().queryEventsAfter(accountDid, String(conn.cursor));
        if (isClosed(conn)) return;
        // A `subscribe` landed during the read and rewound the cursor. This
        // result describes a position the connection is no longer at; sending
        // it would replay from the wrong place *and* stamp the client with a
        // cursor past the events it just asked to be re-sent.
        if (conn.generation !== generation) continue;

        const nextCursor = parseCursor(result.nextCursor);
        const outgoing = suppress
          ? result.events.filter((ev) => !suppress.has(ev.eventId))
          : result.events;

        if (outgoing.length > 0) this.sendEvents(conn, outgoing, result.nextCursor);
        // Advance past everything the read covered, including anything
        // suppressed. Suppressed events are ones this connection wrote itself,
        // so it already has them; re-sending them on the next round would be
        // the duplicate §11.4 forbids.
        if (nextCursor > conn.cursor) conn.cursor = nextCursor;
      }
    } catch (err) {
      // A failing store read must not become an unhandled rejection (which
      // takes the whole process down under Node's default) and must not be
      // swallowed either: a connection stuck in `draining` never sends `live`,
      // so the client waits forever on a socket that looks healthy. Closing
      // hands it back to §12.1, where reconnect and backoff already live.
      // eslint-disable-next-line no-console
      console.error('cornertasks-server: ws drain failed, closing connection', err);
      this.teardown(conn, 1011, 'drain_failed');
    } finally {
      conn.pumping = false;
    }
  }

  /**
   * Emits one or more `events` frames.
   *
   * The load-bearing rule is the per-chunk `nextCursor`. A client persists
   * `nextCursor` from *every* `events` frame (§11.2), so if a socket dies
   * between chunk 1 and chunk 2, whatever chunk 1 claimed is what that device
   * will ask from next time. Chunk 1 therefore carries the `seq` of its own
   * last event, never the batch's final cursor — the latter would silently
   * skip every event in the chunks that never arrived.
   *
   * The final chunk is the one exception: it carries the batch cursor from the
   * store, which may be higher than its last event's `seq` when trailing
   * events were suppressed as self-authored. Advancing the client over its own
   * events is correct; it wrote them.
   */
  private sendEvents(conn: Connection, events: StoredEvent[], batchCursor: string): void {
    for (let i = 0; i < events.length; i += this.eventsChunkSize) {
      const chunk = events.slice(i, i + this.eventsChunkSize);
      const isLast = i + this.eventsChunkSize >= events.length;
      const last = chunk[chunk.length - 1] as StoredEvent;
      // `seq` is server bookkeeping and optional on the `StoredEvent` type; a
      // store that omits it gets the conservative cursor (no advance) rather
      // than a guess, because a guessed cursor that is too high loses data.
      const chunkCursor = isLast
        ? batchCursor
        : last.seq !== undefined
          ? String(last.seq)
          : String(conn.cursor);
      this.send(conn, { type: 'events', events: chunk.map(toWireEvent), nextCursor: chunkCursor });
    }
  }

  // -- §11.3 push ----------------------------------------------------------

  private async handlePush(conn: Connection, msg: Record<string, unknown>): Promise<void> {
    // Without a `pushId` there is nothing to correlate an ack to, and §11.3
    // says a client keeps the events queued until the ack arrives — so the
    // client is already covered by its own retry.
    if (typeof msg.pushId !== 'string') return;
    const pushId = msg.pushId;
    const events = Array.isArray(msg.events) ? (msg.events as unknown[]) : [];
    const accountDid = conn.accountDid as string;

    // Run the *REST* push handler, unmodified. §11.3: "Servers MUST route this
    // through the same code path as the REST push — a second implementation is
    // how the two transports drift apart." That handler's contract is
    // `HttpEvent -> HttpResult`, so calling it means building the request it
    // would have received; that is the point, not a workaround. It buys the
    // whole of §7.1 for free — LWW stale rejection counting as success,
    // idempotency on `eventId`, the batch size bound, `did_mismatch`, and the
    // archive retention sweep — plus a re-check of the bearer token's `exp` on
    // every write, so a long-lived socket cannot outlive its authority.
    //
    // `accountDid` is injected from the verified token and overrides anything
    // the client sent (§11.1). The `events[].accountDid` mismatch check inside
    // the handler then rejects a batch that tries to write to another account.
    const result = await pushHandler({
      headers: { authorization: `Bearer ${conn.token}` },
      queryStringParameters: {},
      body: JSON.stringify({ accountDid, events }),
      requestContext: {
        domainName: this.domain.domainName,
        stage: this.domain.stage,
        http: { method: 'POST', path: '/v1/sync/push' }
      }
    });
    if (isClosed(conn)) return;

    if (result.statusCode === 401) {
      // The token expired while the socket was open. §11.1 tells the client
      // exactly what to do with this pair, and §12.2 keeps its pull timer
      // running meanwhile, so nothing stalls.
      const reason = readReason(result.body) ?? 'token_expired';
      this.send(conn, { type: 'auth_err', reason });
      this.teardown(conn, CLOSE_AUTH_FAILED, reason);
      return;
    }

    if (result.statusCode !== 200) {
      // 400 / 403. §11 has no error frame, and a `push` with no `push_ack`
      // means the client retries the same batch forever (§11.3). So the
      // failure is reported as a total rejection, using the §7.1 reject
      // vocabulary the client already handles.
      const reason: PushReject['reason'] = result.statusCode === 403 ? 'did_mismatch' : 'invalid';
      this.send(conn, {
        type: 'push_ack',
        pushId,
        accepted: [],
        rejected: eventIdsOf(events).map((eventId) => ({ eventId, reason }))
      });
      return;
    }

    const body = JSON.parse(result.body ?? '{}') as PushResponse;
    this.send(conn, {
      type: 'push_ack',
      pushId,
      accepted: body.accepted ?? [],
      rejected: body.rejected ?? []
    });

    // §11.4. The originator is excluded by id, not by skipping it entirely:
    // it still needs anything *another* device wrote concurrently, and only
    // this push's own ids are withheld.
    this.notifyAccount(accountDid, { connection: conn, writtenEventIds: body.accepted ?? [] });
  }
}

/** Best-effort `eventId` extraction from an unvalidated `events` array — used
 *  only to name the events in a total-rejection ack. */
function eventIdsOf(events: unknown[]): string[] {
  const ids: string[] = [];
  for (const ev of events) {
    const id = (ev as { eventId?: unknown } | null)?.eventId;
    if (typeof id === 'string') ids.push(id);
  }
  return ids;
}

function readReason(body: string | undefined): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as { reason?: unknown };
    return typeof parsed.reason === 'string' ? parsed.reason : null;
  } catch {
    return null;
  }
}

/** Attaches a §11 WebSocket endpoint to an existing HTTP server at
 *  `WS_PATH`. Sharing the port matters for the intended deployment: one ngrok
 *  tunnel, one `PUBLIC_URL`, one origin for both transports. */
export function attachWsServer(
  server: HttpServer,
  domain: DomainContext,
  opts: WsServerOptions = {}
): WsHub {
  return new WsHub(server, domain, opts);
}
