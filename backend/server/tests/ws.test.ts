// docs/sync-protocol.md §11 / §12 conformance for the self-hosted WebSocket
// server (plan/v0.3.0/nodes/N08-ws-server.md).
//
// Everything here runs against a real `http.Server` with a real socket over
// loopback and a real SQLite store — no mocked transport. The one seam the
// tests reach into is `Store.queryEventsAfter`, and only to *delay* it, so the
// drain/live race can be provoked deterministically instead of by luck.

import { randomUUID } from 'node:crypto';
import { startTestServer, type Harness } from './helpers/harness';
import { TestClient, settle } from './helpers/ws-client';
import { forgeBearer, generateKeyPair, mintBearer, type KeyPair } from './helpers/bearer';
import { getStore, setStore, type Store } from '../../core/src/lib/db';
import { MAX_FRAME_BYTES, AUTH_TIMEOUT_MS, PING_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS } from '../src/ws-server';
import { WS_PATH, wsUrlFromAudience } from '../src/lib/ws-config';
import type { WsServerOptions } from '../src/ws-server';

let harness: Harness | null = null;
const clients: TestClient[] = [];

async function start(ws: WsServerOptions = {}): Promise<Harness> {
  harness = await startTestServer({ ws });
  return harness;
}

async function connect(h: Harness): Promise<TestClient> {
  const c = await TestClient.open(h.wsUrl);
  clients.push(c);
  return c;
}

/** Connect + `auth` + wait for `auth_ok`. */
async function connectAuthed(h: Harness, token: string): Promise<TestClient> {
  const c = await connect(h);
  c.send({ type: 'auth', token });
  await c.waitType('auth_ok');
  return c;
}

/** Connect + auth + `subscribe` + wait for `live`. */
async function connectLive(h: Harness, token: string, cursor = '0'): Promise<TestClient> {
  const c = await connectAuthed(h, token);
  c.send({ type: 'subscribe', cursor });
  await c.waitType('live');
  return c;
}

afterEach(async () => {
  for (const c of clients.splice(0)) await c.close();
  if (harness) await harness.close();
  harness = null;
});

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function makeEvent(accountDid: string, over: Partial<Record<string, string>> = {}) {
  return {
    accountDid,
    deviceId: over.deviceId ?? '11111111-2222-3333-4444-555555555555',
    eventId: over.eventId ?? randomUUID(),
    taskId: over.taskId ?? randomUUID(),
    updatedAt: over.updatedAt ?? new Date().toISOString(),
    op: (over.op as 'upsert' | 'delete') ?? 'upsert',
    ciphertext: Buffer.from(over.body ?? 'ciphertext').toString('base64url'),
    nonce: Buffer.from('123456789012').toString('base64url')
  };
}

async function restPush(
  h: Harness,
  token: string,
  accountDid: string,
  events: unknown[]
): Promise<{ status: number; body: { accepted: string[]; rejected: { eventId: string; reason: string }[] } }> {
  const res = await fetch(`${h.baseUrl}/v1/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ accountDid, events })
  });
  return { status: res.status, body: (await res.json()) as never };
}

async function restPull(
  h: Harness,
  token: string,
  accountDid: string,
  cursor = '0'
): Promise<{ events: { eventId: string }[]; nextCursor: string }> {
  const res = await fetch(
    `${h.baseUrl}/v1/sync/pull?accountDid=${encodeURIComponent(accountDid)}&cursor=${cursor}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return (await res.json()) as never;
}

interface Account {
  kp: KeyPair;
  token: string;
}

async function account(h: Harness, seed: number): Promise<Account> {
  const kp = await generateKeyPair(seed);
  return { kp, token: await mintBearer(h, kp) };
}

// ---------------------------------------------------------------------------
// §11 constants
// ---------------------------------------------------------------------------

describe('§11 timings are the protocol\'s, not this implementation\'s', () => {
  test('auth timeout, heartbeat and frame cap match the spec', () => {
    expect(AUTH_TIMEOUT_MS).toBe(5_000); // §11.1
    expect(PING_INTERVAL_MS).toBe(30_000); // §11.5
    expect(HEARTBEAT_TIMEOUT_MS).toBe(60_000); // §11.5
    expect(MAX_FRAME_BYTES).toBe(1024 * 1024); // §11
  });

  test('the advertised wsUrl keeps the audience origin and path (§10.1)', () => {
    expect(WS_PATH).toBe('/v1/sync/ws');
    expect(wsUrlFromAudience('https://example.ngrok.app/')).toBe('wss://example.ngrok.app/v1/sync/ws');
    // A deployment behind a path prefix must keep it — dropping the prefix
    // would advertise a URL on an origin whose tokens it does not honour.
    expect(wsUrlFromAudience('https://example.com/dev')).toBe('wss://example.com/dev/v1/sync/ws');
  });
});

// ---------------------------------------------------------------------------
// §11.1 — handshake
// ---------------------------------------------------------------------------

describe('§11.1 auth', () => {
  test('a token from the real §8 flow is accepted, and identity comes from the token', async () => {
    const h = await start();
    const a = await account(h, 11);

    const c = await connect(h);
    c.send({ type: 'auth', token: a.token, accountDid: 'did:key:zSomeoneElse' });
    const ok = await c.waitType('auth_ok');

    expect(ok.accountDid).toBe(a.kp.did);
    expect(h.hub!.connectionsFor(a.kp.did)).toBe(1);
    // The `accountDid` the client put in the frame is not authoritative and
    // must not have created a registry entry of its own (§11.1).
    expect(h.hub!.accountCount()).toBe(1);
  });

  test('a malformed token is auth_err bad_token then close 4401', async () => {
    const h = await start();
    const c = await connect(h);
    c.send({ type: 'auth', token: 'not-a-jwt' });

    expect((await c.waitType('auth_err')).reason).toBe('bad_token');
    expect((await c.waitClose()).code).toBe(4401);
    expect(h.hub!.accountCount()).toBe(0);
  });

  test('an expired token is auth_err token_expired then close 4401', async () => {
    const h = await start();
    const kp = await generateKeyPair(12);
    const c = await connect(h);
    c.send({ type: 'auth', token: forgeBearer({ sub: kp.did, expInS: -60 }) });

    // §11.1: the client re-runs the §8 challenge flow on this reason, so it
    // must be distinguishable from `bad_token`, which means a bad deploy.
    expect((await c.waitType('auth_err')).reason).toBe('token_expired');
    expect((await c.waitClose()).code).toBe(4401);
  });

  test('a token signed by another deployment is bad_token, never accepted', async () => {
    const h = await start();
    const kp = await generateKeyPair(13);
    const c = await connect(h);
    c.send({
      type: 'auth',
      token: forgeBearer({ sub: kp.did, secret: Buffer.from('a-different-deployments-secret-ab') })
    });

    expect((await c.waitType('auth_err')).reason).toBe('bad_token');
    expect((await c.waitClose()).code).toBe(4401);
  });

  test('a bearer token minted for the wrong audience is rejected', async () => {
    const h = await start();
    const kp = await generateKeyPair(14);
    const c = await connect(h);
    c.send({ type: 'auth', token: forgeBearer({ sub: kp.did, aud: 'some-other-api' }) });

    expect((await c.waitType('auth_err')).reason).toBe('bad_token');
    expect((await c.waitClose()).code).toBe(4401);
  });

  test('no auth within the timeout closes 4401', async () => {
    const h = await start({ authTimeoutMs: 150 });
    const c = await connect(h);

    const close = await c.waitClose();
    expect(close.code).toBe(4401);
    expect(c.frames).toEqual([]);
  });

  test('every frame other than auth is rejected until authenticated', async () => {
    const h = await start({ authTimeoutMs: 250 });
    const a = await account(h, 15);
    const c = await connect(h);

    // A client that skips the handshake gets no service, and — the part that
    // matters — sending frames does not keep the socket alive past the
    // deadline. Otherwise an unauthenticated peer could hold a slot forever.
    c.send({ type: 'subscribe', cursor: '0' });
    c.send({ type: 'push', pushId: randomUUID(), events: [makeEvent(a.kp.did)] });
    await settle(120);
    c.send({ type: 'subscribe', cursor: '0' });

    expect((await c.waitClose()).code).toBe(4401);
    expect(c.frames).toEqual([]);
    // Nothing was written: the push was never routed to the store.
    expect((await restPull(h, a.token, a.kp.did)).events).toEqual([]);
  });

  test('a second auth frame cannot move an authenticated socket to another account', async () => {
    const h = await start();
    const a = await account(h, 16);
    const b = await account(h, 17);
    const c = await connectAuthed(h, a.token);

    c.send({ type: 'auth', token: b.token });
    await settle();

    expect(c.of('auth_ok')).toHaveLength(1);
    expect(h.hub!.connectionsFor(a.kp.did)).toBe(1);
    expect(h.hub!.connectionsFor(b.kp.did)).toBe(0);
  });

  test('connections past the per-account cap are closed 4429, leaving the existing ones alone', async () => {
    const h = await start({ maxConnectionsPerAccount: 2 });
    const a = await account(h, 18);

    const c1 = await connectAuthed(h, a.token);
    const c2 = await connectAuthed(h, a.token);
    const c3 = await connect(h);
    c3.send({ type: 'auth', token: a.token });

    // §11.6: `4429` is the entire signal — there is no `auth_err` reason for
    // "too many connections", and inventing one would break clients that
    // switch on the §8.6 vocabulary.
    expect((await c3.waitClose()).code).toBe(4429);
    expect(c3.of('auth_ok')).toHaveLength(0);
    expect(c1.close_).toBeNull();
    expect(c2.close_).toBeNull();
    expect(h.hub!.connectionsFor(a.kp.did)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// §11.2 — drain
// ---------------------------------------------------------------------------

describe('§11.2 subscribe → events* → live', () => {
  test('a backlog drains in seq order and agrees with REST pull byte for byte', async () => {
    const h = await start();
    const a = await account(h, 21);
    const seeded = [1, 2, 3, 4, 5].map(() => makeEvent(a.kp.did));
    await restPush(h, a.token, a.kp.did, seeded);

    const c = await connectAuthed(h, a.token);
    c.send({ type: 'subscribe', cursor: '0' });
    const live = await c.waitType('live');

    const pull = await restPull(h, a.token, a.kp.did, '0');
    expect(c.deliveredEventIds()).toEqual(seeded.map((e) => e.eventId));
    expect(c.deliveredEventIds()).toEqual(pull.events.map((e) => e.eventId));
    // §12.4 only works if both transports hand back the same cursor for the
    // same position in the log.
    expect(live.cursor).toBe(pull.nextCursor);
    expect(c.cursors()[c.cursors().length - 1]).toBe(pull.nextCursor);
    // Server bookkeeping must not leak onto the wire on either transport.
    for (const frame of c.of('events')) {
      for (const ev of frame.events as Record<string, unknown>[]) {
        expect(ev).not.toHaveProperty('seq');
        expect(ev).not.toHaveProperty('archivedCompletedAt');
        expect(Object.keys(ev).sort()).toEqual(
          ['accountDid', 'ciphertext', 'deviceId', 'eventId', 'nonce', 'op', 'taskId', 'updatedAt'].sort()
        );
      }
    }
  });

  test('exactly one live frame, and it is the last frame of the drain', async () => {
    const h = await start();
    const a = await account(h, 22);
    await restPush(h, a.token, a.kp.did, [makeEvent(a.kp.did)]);

    const c = await connectAuthed(h, a.token);
    c.send({ type: 'subscribe', cursor: '0' });
    await c.waitType('live');
    await settle();

    expect(c.of('live')).toHaveLength(1);
    expect(c.frames[c.frames.length - 1]!.type).toBe('live');
  });

  test('an empty backlog goes straight to live with the client\'s own cursor', async () => {
    const h = await start();
    const a = await account(h, 23);

    const c = await connectAuthed(h, a.token);
    c.send({ type: 'subscribe', cursor: '0' });
    const live = await c.waitType('live');

    expect(c.of('events')).toHaveLength(0);
    expect(live.cursor).toBe('0');
  });

  test('subscribing from the cursor REST last returned replays nothing (§12.4)', async () => {
    const h = await start();
    const a = await account(h, 24);
    const first = makeEvent(a.kp.did);
    await restPush(h, a.token, a.kp.did, [first]);
    const pull = await restPull(h, a.token, a.kp.did, '0');

    const c = await connectAuthed(h, a.token);
    c.send({ type: 'subscribe', cursor: pull.nextCursor });
    const live = await c.waitType('live');

    expect(c.deliveredEventIds()).toEqual([]);
    expect(live.cursor).toBe(pull.nextCursor);

    // …and a later write still arrives on the same socket.
    const second = makeEvent(a.kp.did);
    await restPush(h, a.token, a.kp.did, [second]);
    await c.waitFor((f) => f.type === 'events');
    expect(c.deliveredEventIds()).toEqual([second.eventId]);
  });

  test('an unparseable cursor resyncs from the beginning rather than hanging the client', async () => {
    const h = await start();
    const a = await account(h, 25);
    const seeded = makeEvent(a.kp.did);
    await restPush(h, a.token, a.kp.did, [seeded]);

    const c = await connectAuthed(h, a.token);
    c.send({ type: 'subscribe', cursor: 'not-a-number' });
    await c.waitType('live');

    // Over-delivering is idempotent at the client; a socket that never sends
    // `live` is indistinguishable from a dead backend and burns a §12.3 retry.
    expect(c.deliveredEventIds()).toEqual([seeded.eventId]);
  });
});

// ---------------------------------------------------------------------------
// The drain/live race — the reason this node exists
// ---------------------------------------------------------------------------

describe('§11.2 the drain race', () => {
  test('an event pushed by A mid-drain reaches B exactly once, in seq order, before live', async () => {
    const h = await start();
    const a = await account(h, 31);

    // Backlog, so B's drain has real work to do.
    const backlog = [makeEvent(a.kp.did), makeEvent(a.kp.did)];
    await restPush(h, a.token, a.kp.did, backlog);

    // A is already live on its own socket.
    const clientA = await connectLive(h, a.token);

    // Wedge a write into the exact window §11.2 warns about: after B's backlog
    // read has produced its rows, before B is listening. A naive server —
    // "query, send, mark live" — drops this event permanently, and the only
    // symptom is that B's task list is missing one row until it reconnects.
    const real = getStore();
    let onNextQuery: null | (() => Promise<void>) = null;
    const wrapped: Store = {
      putEvent: (ev) => real.putEvent(ev),
      pruneExpiredArchives: (did) => real.pruneExpiredArchives(did),
      putChallenge: (ch) => real.putChallenge(ch),
      consumeChallenge: (did, ch) => real.consumeChallenge(did, ch),
      async queryEventsAfter(did, cursor) {
        const result = await real.queryEventsAfter(did, cursor);
        const hook = onNextQuery;
        onNextQuery = null;
        if (hook) await hook();
        return result;
      }
    };
    setStore(wrapped);

    const midDrain = makeEvent(a.kp.did);
    const pushId = randomUUID();
    const clientB = await connectAuthed(h, a.token);
    onNextQuery = async () => {
      clientA.send({ type: 'push', pushId, events: [midDrain] });
      await clientA.waitFor((f) => f.type === 'push_ack' && f.pushId === pushId);
    };
    clientB.send({ type: 'subscribe', cursor: '0' });

    const live = await clientB.waitType('live');
    await settle();

    const delivered = clientB.deliveredEventIds();
    // Exactly once: no duplicate of the backlog, no duplicate of the racer.
    expect(delivered).toEqual([...backlog.map((e) => e.eventId), midDrain.eventId]);
    expect(new Set(delivered).size).toBe(delivered.length);
    // In seq order, and `live` is still the last frame of the drain.
    expect(clientB.frames[clientB.frames.length - 1]!.type).toBe('live');
    expect(live.cursor).toBe('3');
    // Every `events` frame's cursor is non-decreasing and never overshoots
    // `live` — a client that dies mid-drain must not resume past what it got.
    const cursors = clientB.cursors().map(Number);
    expect(cursors).toEqual([...cursors].sort((x, y) => x - y));
    expect(Math.max(...cursors)).toBeLessThanOrEqual(Number(live.cursor));

    // A pushed it, so A must not receive it back (§11.4).
    expect(clientA.deliveredEventIds()).not.toContain(midDrain.eventId);
  });

  test('a subscribe that lands during an in-flight read still rewinds the client', async () => {
    const h = await start();
    const a = await account(h, 32);
    const first = makeEvent(a.kp.did);
    await restPush(h, a.token, a.kp.did, [first]);
    const c = await connectLive(h, a.token); // drains `first`, cursor = 1

    const real = getStore();
    let onNextQuery: null | (() => Promise<void>) = null;
    setStore({
      putEvent: (ev) => real.putEvent(ev),
      pruneExpiredArchives: (did) => real.pruneExpiredArchives(did),
      putChallenge: (ch) => real.putChallenge(ch),
      consumeChallenge: (did, ch) => real.consumeChallenge(did, ch),
      async queryEventsAfter(did, cursor) {
        const result = await real.queryEventsAfter(did, cursor);
        const hook = onNextQuery;
        onNextQuery = null;
        if (hook) await hook();
        return result;
      }
    } as Store);

    // The fan-out read below is issued against cursor 1. While it is in
    // flight, the client asks to be re-sent from 0. If the read's own
    // `nextCursor` were allowed to land afterwards it would overwrite the
    // rewind, and the replay the client asked for would never arrive — with no
    // error anywhere.
    onNextQuery = async () => {
      c.send({ type: 'subscribe', cursor: '0' });
      await settle(60);
    };
    const second = makeEvent(a.kp.did);
    await restPush(h, a.token, a.kp.did, [second]);

    await c.waitFor((f) => f.type === 'live' && f.cursor === '2');
    await settle();

    const delivered = c.deliveredEventIds();
    expect(delivered.filter((id) => id === first.eventId)).toHaveLength(2); // drain + replay
    expect(delivered.filter((id) => id === second.eventId).length).toBeGreaterThanOrEqual(1);
    // The replay is contiguous and ends where `live` says it does.
    expect(delivered.slice(-2)).toEqual([first.eventId, second.eventId]);
  });

  test('a failing store read closes the socket instead of leaving a client waiting for live', async () => {
    const h = await start();
    const a = await account(h, 33);
    const real = getStore();
    setStore({
      putEvent: (ev) => real.putEvent(ev),
      pruneExpiredArchives: (did) => real.pruneExpiredArchives(did),
      putChallenge: (ch) => real.putChallenge(ch),
      consumeChallenge: (did, ch) => real.consumeChallenge(did, ch),
      async queryEventsAfter() {
        throw new Error('db unavailable');
      }
    } as Store);

    const c = await connectAuthed(h, a.token);
    c.send({ type: 'subscribe', cursor: '0' });

    // Silence would look identical to a healthy-but-quiet backend, and the
    // client would sit on a socket that will never send `live` (§12.2 would
    // still be polling, but the connection state would lie).
    expect((await c.waitClose()).code).toBe(1011);
    expect(c.of('live')).toHaveLength(0);
    expect(h.hub!.accountCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §11.3 / §11.4 — push and fan-out
// ---------------------------------------------------------------------------

describe('§11.3 push', () => {
  test('push_ack echoes the pushId and the event is readable over REST pull', async () => {
    const h = await start();
    const a = await account(h, 41);
    const c = await connectLive(h, a.token);

    const ev = makeEvent(a.kp.did);
    const pushId = randomUUID();
    c.send({ type: 'push', pushId, events: [ev] });
    const ack = await c.waitType('push_ack');

    expect(ack.pushId).toBe(pushId);
    expect(ack.accepted).toEqual([ev.eventId]);
    expect(ack.rejected).toEqual([]);

    const pull = await restPull(h, a.token, a.kp.did, '0');
    expect(pull.events.map((e) => e.eventId)).toEqual([ev.eventId]);
  });

  test('accept/reject matches REST exactly: a stale write is rejected, not silently dropped', async () => {
    const h = await start();
    const a = await account(h, 42);
    const taskId = randomUUID();
    const newer = makeEvent(a.kp.did, { taskId, updatedAt: '2026-05-05T18:00:00.000Z' });
    await restPush(h, a.token, a.kp.did, [newer]);

    const c = await connectLive(h, a.token);
    const older = makeEvent(a.kp.did, { taskId, updatedAt: '2026-05-05T17:00:00.000Z' });
    const pushId = randomUUID();
    c.send({ type: 'push', pushId, events: [older] });
    const ack = await c.waitType('push_ack');

    expect(ack.accepted).toEqual([]);
    expect(ack.rejected).toEqual([{ eventId: older.eventId, reason: 'stale' }]);

    // Same batch over REST answers identically — one code path, so it must.
    const rest = await restPush(h, a.token, a.kp.did, [older]);
    expect(rest.body).toEqual({ accepted: [], rejected: [{ eventId: older.eventId, reason: 'stale' }] });
  });

  test('duplicate eventIds inside one batch are idempotent, as on REST (§7.1)', async () => {
    const h = await start();
    const a = await account(h, 43);
    const c = await connectLive(h, a.token);

    const ev = makeEvent(a.kp.did);
    const pushId = randomUUID();
    c.send({ type: 'push', pushId, events: [ev, ev] });
    const ack = await c.waitType('push_ack');

    expect(ack.accepted).toEqual([ev.eventId, ev.eventId]);
    expect(ack.rejected).toEqual([]);
  });

  test('a push naming another account is rejected and writes nothing', async () => {
    const h = await start();
    const a = await account(h, 44);
    const victim = await account(h, 45);
    const c = await connectLive(h, a.token);

    const ev = makeEvent(victim.kp.did);
    const pushId = randomUUID();
    c.send({ type: 'push', pushId, events: [ev] });
    const ack = await c.waitType('push_ack');

    // An ack always answers a push — §11.3 says the client keeps events queued
    // until one arrives, so staying silent would wedge that client forever.
    expect(ack.pushId).toBe(pushId);
    expect(ack.accepted).toEqual([]);
    expect(ack.rejected).toEqual([{ eventId: ev.eventId, reason: 'did_mismatch' }]);
    expect((await restPull(h, victim.token, victim.kp.did)).events).toEqual([]);
  });

  test('a schema-invalid batch is acked as rejected rather than left unanswered', async () => {
    const h = await start();
    const a = await account(h, 46);
    const c = await connectLive(h, a.token);

    const pushId = randomUUID();
    c.send({ type: 'push', pushId, events: [{ eventId: 'e-1', nonsense: true }] });
    const ack = await c.waitType('push_ack');

    expect(ack.pushId).toBe(pushId);
    expect(ack.accepted).toEqual([]);
    expect(ack.rejected).toEqual([{ eventId: 'e-1', reason: 'invalid' }]);
    expect(c.close_).toBeNull();
  });

  test('a push on a socket whose token has expired closes 4401 instead of writing', async () => {
    const h = await start();
    const kp = await generateKeyPair(47);
    const c = await connect(h);
    // Valid at handshake time, expired a moment later: exactly what happens to
    // a socket that outlives the 1 h bearer TTL. (`exp === now` still passes
    // `requireBearer`, which rejects only on `exp < now`, so the wait has to
    // cross a whole second boundary.)
    c.send({ type: 'auth', token: forgeBearer({ sub: kp.did, expInS: 0 }) });
    await c.waitType('auth_ok');
    await settle(2100);

    c.send({ type: 'push', pushId: randomUUID(), events: [makeEvent(kp.did)] });
    expect((await c.waitType('auth_err')).reason).toBe('token_expired');
    expect((await c.waitClose()).code).toBe(4401);
    expect(c.of('push_ack')).toHaveLength(0);
  });
});

describe('§11.4 fan-out', () => {
  test('reaches the account\'s other live connections and excludes the sender', async () => {
    const h = await start();
    const a = await account(h, 51);
    const sender = await connectLive(h, a.token);
    const peer = await connectLive(h, a.token);

    const ev = makeEvent(a.kp.did);
    sender.send({ type: 'push', pushId: randomUUID(), events: [ev] });
    await sender.waitType('push_ack');
    await peer.waitFor((f) => f.type === 'events');
    await settle();

    expect(peer.deliveredEventIds()).toEqual([ev.eventId]);
    expect(sender.of('events')).toHaveLength(0);
    // The peer's cursor advanced to the new seq, so a reconnect will not
    // replay it.
    expect(peer.cursors()).toEqual(['1']);
  });

  test('never crosses accounts', async () => {
    const h = await start();
    const a = await account(h, 52);
    const b = await account(h, 53);
    const aClient = await connectLive(h, a.token);
    const bClient = await connectLive(h, b.token);

    aClient.send({ type: 'push', pushId: randomUUID(), events: [makeEvent(a.kp.did)] });
    await aClient.waitType('push_ack');
    await settle();

    expect(bClient.of('events')).toHaveLength(0);
    expect(bClient.frames.map((f) => f.type)).toEqual(['auth_ok', 'live']);
  });

  test('a REST push reaches a live socket, so a mixed-transport account cannot go stale', async () => {
    const h = await start();
    const a = await account(h, 54);
    const c = await connectLive(h, a.token);

    // §12.2: this client has stood its pull timer down. If a REST push did not
    // fan out, it would not learn about this event until it reconnected.
    const ev = makeEvent(a.kp.did);
    await restPush(h, a.token, a.kp.did, [ev]);
    await c.waitFor((f) => f.type === 'events');

    expect(c.deliveredEventIds()).toEqual([ev.eventId]);
  });

  test('a connection that has not subscribed receives no fan-out, then drains it', async () => {
    const h = await start();
    const a = await account(h, 55);
    const idle = await connectAuthed(h, a.token);

    const ev = makeEvent(a.kp.did);
    await restPush(h, a.token, a.kp.did, [ev]);
    await settle();
    expect(idle.of('events')).toHaveLength(0);

    idle.send({ type: 'subscribe', cursor: '0' });
    await idle.waitType('live');
    expect(idle.deliveredEventIds()).toEqual([ev.eventId]);
  });

  test('the sender still receives a peer\'s concurrent write, only its own is withheld', async () => {
    const h = await start();
    const a = await account(h, 56);
    const one = await connectLive(h, a.token);
    const two = await connectLive(h, a.token);

    const fromTwo = makeEvent(a.kp.did);
    two.send({ type: 'push', pushId: randomUUID(), events: [fromTwo] });
    await two.waitType('push_ack');
    await one.waitFor((f) => f.type === 'events');

    const fromOne = makeEvent(a.kp.did);
    one.send({ type: 'push', pushId: randomUUID(), events: [fromOne] });
    await one.waitType('push_ack');
    await two.waitFor((f) => f.type === 'events');
    await settle();

    expect(one.deliveredEventIds()).toEqual([fromTwo.eventId]);
    expect(two.deliveredEventIds()).toEqual([fromOne.eventId]);
  });
});

// ---------------------------------------------------------------------------
// §11.5 — heartbeat
// ---------------------------------------------------------------------------

describe('§11.5 heartbeat', () => {
  test('a silent peer is pinged and then dropped with 4408, and leaves no registry entry', async () => {
    const h = await start({ pingIntervalMs: 40, heartbeatTimeoutMs: 200 });
    const a = await account(h, 61);
    const c = await connectLive(h, a.token);

    // The client never answers — the tunnel/mobile case where the socket is
    // gone but no close frame ever arrives (§11.5).
    const close = await c.waitClose();
    expect(close.code).toBe(4408);
    expect(c.of('ping').length).toBeGreaterThanOrEqual(2);
    expect(h.hub!.connectionsFor(a.kp.did)).toBe(0);
    expect(h.hub!.accountCount()).toBe(0);
  });

  test('any inbound traffic keeps a connection alive', async () => {
    const h = await start({ pingIntervalMs: 30, heartbeatTimeoutMs: 200 });
    const a = await account(h, 62);
    const c = await connectLive(h, a.token);

    for (let i = 0; i < 8; i++) {
      c.send({ type: 'pong', t: Date.now() });
      await settle(60);
    }
    expect(c.close_).toBeNull();
    expect(h.hub!.connectionsFor(a.kp.did)).toBe(1);
  });

  test('a client ping is answered with pong echoing t', async () => {
    const h = await start();
    const a = await account(h, 63);
    const c = await connectLive(h, a.token);

    c.send({ type: 'ping', t: 1755264000000 });
    const pong = await c.waitType('pong');
    expect(pong.t).toBe(1755264000000);
  });
});

// ---------------------------------------------------------------------------
// §11 — framing hygiene and registry lifecycle
// ---------------------------------------------------------------------------

describe('§11 framing', () => {
  test('unknown frame types are ignored, not errors', async () => {
    const h = await start();
    const a = await account(h, 71);
    const c = await connectLive(h, a.token);

    // The forward-compatibility hinge: a v3.1 client talking to a v3 server
    // must not be disconnected for using a frame this server has never heard of.
    c.send({ type: 'telemetry', payload: { anything: true } });
    c.sendRaw('this is not json');
    await settle();

    expect(c.close_).toBeNull();
    c.send({ type: 'ping', t: 7 });
    expect((await c.waitType('pong')).t).toBe(7);
  });

  test('a frame over the size cap is rejected by the transport', async () => {
    const h = await start({ maxFrameBytes: 4096 });
    const a = await account(h, 72);
    const c = await connectAuthed(h, a.token);

    c.sendRaw(JSON.stringify({ type: 'push', pushId: randomUUID(), pad: 'x'.repeat(8192) }));
    // 1009 "message too big" — rejected at the frame layer, before it is
    // buffered, which is the point of the rule.
    expect((await c.waitClose()).code).toBe(1009);
  });

  test('the registry is empty after every connection disconnects', async () => {
    const h = await start();
    const a = await account(h, 73);
    const b = await account(h, 74);
    const c1 = await connectLive(h, a.token);
    const c2 = await connectLive(h, a.token);
    const c3 = await connectLive(h, b.token);
    expect(h.hub!.totalConnections()).toBe(3);
    expect(h.hub!.accountCount()).toBe(2);

    await c1.close();
    await settle();
    expect(h.hub!.connectionsFor(a.kp.did)).toBe(1);
    expect(h.hub!.accountCount()).toBe(2);

    await c2.close();
    await c3.close();
    await settle();

    // Not just zero connections — zero *accounts*. A map that keeps an empty
    // Set per account that ever connected is a leak on a process meant to run
    // for months on a Mac mini.
    expect(h.hub!.totalConnections()).toBe(0);
    expect(h.hub!.accountCount()).toBe(0);
  });

  test('an abruptly terminated socket is reaped too', async () => {
    const h = await start();
    const a = await account(h, 75);
    const c = await connectLive(h, a.token);

    c.terminate();
    await settle();
    expect(h.hub!.accountCount()).toBe(0);
  });

  test('CT_WS=off yields a REST-only deployment with no socket endpoint', async () => {
    const h = await start();
    // `ws: false` is the in-process equivalent of `CT_WS=off`.
    await h.close();
    harness = await startTestServer({ ws: false });
    expect(harness.hub).toBeNull();

    const meta = (await (await fetch(`${harness.baseUrl}/v1/meta`)).json()) as {
      transports: string[];
      wsUrl?: string;
    };
    // §10.1: `wsUrl` present if and only if "ws" is advertised.
    expect(meta.transports).toEqual(['rest']);
    expect(meta.wsUrl).toBeUndefined();
    await expect(TestClient.open(harness.wsUrl)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §12.4 — one log, two transports
// ---------------------------------------------------------------------------

describe('§12.4 transport switching', () => {
  test('pushing over WS and pulling over REST yields one consistent log: same seqs, no gaps, no duplicates', async () => {
    const h = await start();
    const a = await account(h, 81);
    const c = await connectLive(h, a.token);

    // Interleave the transports, the way a client that flaps between them does.
    const overWs1 = makeEvent(a.kp.did);
    c.send({ type: 'push', pushId: randomUUID(), events: [overWs1] });
    await c.waitType('push_ack');

    const overRest = makeEvent(a.kp.did);
    await restPush(h, a.token, a.kp.did, [overRest]);
    await c.waitFor((f) => f.type === 'events');

    const overWs2 = makeEvent(a.kp.did);
    c.send({ type: 'push', pushId: randomUUID(), events: [overWs2] });
    await c.waitFor((f) => f.type === 'push_ack' && (f.accepted as string[])[0] === overWs2.eventId);
    await settle();

    const full = await restPull(h, a.token, a.kp.did, '0');
    expect(full.events.map((e) => e.eventId)).toEqual([overWs1.eventId, overRest.eventId, overWs2.eventId]);
    expect(full.nextCursor).toBe('3');

    // Walk the REST cursor forward one step at a time: a consistent log means
    // every event appears exactly once across the walk, with no gap.
    const walked: string[] = [];
    let cursor = '0';
    for (;;) {
      const page = await restPull(h, a.token, a.kp.did, cursor);
      if (page.events.length === 0) break;
      walked.push(...page.events.map((e) => e.eventId));
      cursor = page.nextCursor;
    }
    expect(walked).toEqual(full.events.map((e) => e.eventId));
    expect(new Set(walked).size).toBe(walked.length);

    // A fresh socket subscribing at the REST cursor sees nothing new, and one
    // subscribing at 0 sees the identical log in the identical order.
    const fresh = await connectAuthed(h, a.token);
    fresh.send({ type: 'subscribe', cursor: full.nextCursor });
    expect((await fresh.waitType('live')).cursor).toBe(full.nextCursor);
    expect(fresh.deliveredEventIds()).toEqual([]);

    const replay = await connectAuthed(h, a.token);
    replay.send({ type: 'subscribe', cursor: '0' });
    expect((await replay.waitType('live')).cursor).toBe(full.nextCursor);
    expect(replay.deliveredEventIds()).toEqual(full.events.map((e) => e.eventId));
  });

  test('a chunked drain never advances a client past events it has not received', async () => {
    const h = await start({ eventsChunkSize: 2 });
    const a = await account(h, 82);
    const seeded = [1, 2, 3, 4, 5].map(() => makeEvent(a.kp.did));
    await restPush(h, a.token, a.kp.did, seeded);

    const c = await connectAuthed(h, a.token);
    c.send({ type: 'subscribe', cursor: '0' });
    await c.waitType('live');

    const frames = c.of('events');
    expect(frames).toHaveLength(3);
    // Each frame's `nextCursor` covers that frame and no more. If a client
    // died after frame 1 and resumed from its cursor, it would get events 3-5
    // — never 5 alone.
    expect(frames.map((f) => f.nextCursor)).toEqual(['2', '4', '5']);
    expect(frames.map((f) => (f.events as unknown[]).length)).toEqual([2, 2, 1]);
    expect(c.deliveredEventIds()).toEqual(seeded.map((e) => e.eventId));
  });
});
