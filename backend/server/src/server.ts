// Wires the adapter, the router and (from N08) the §11 WebSocket endpoint
// into a plain `node:http` server. Split out from `index.ts` so tests can
// build a fully-wired stack against an injected `Store`/domain without going
// through env parsing or `listen()` on a real port.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { buildEvent, readBody, writeResult, type DomainContext } from './adapter';
import { route } from './router';
import { json } from '../../core/src/lib/response';
import { attachWsServer, type WsHub, type WsServerOptions } from './ws-server';
import { setWsServed, wsEnabled } from './lib/ws-config';

/** Lets the request listener reach a hub that is created *after* it — the
 *  WebSocket server needs the `http.Server`, and the `http.Server` needs the
 *  listener. */
type HubRef = () => WsHub | null;

export function createRequestListener(domain: DomainContext, hub: HubRef = () => null) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const { body, tooLarge } = await readBody(req);
      if (tooLarge) {
        writeResult(res, json(413, { error: 'bad_request', reason: 'payload_too_large' }));
        return;
      }
      const event = buildEvent(req, body, domain);
      const result = await route(event);
      writeResult(res, result);
      fanOutAfterRestPush(event.requestContext.http, body, result.statusCode, hub());
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('cornertasks-server: unhandled request error', err);
      writeResult(res, json(500, { error: 'internal', reason: 'unhandled_exception' }));
    }
  };
}

/**
 * A REST push is a successful write too, so §11.4's fan-out applies to it.
 *
 * The failure this closes: a device that reached `live` stands down its pull
 * timer (§12.2). If another device — an older client, a phone whose socket the
 * OS killed, the sync doctor — pushes over `POST /v1/sync/push`, the live
 * device has neither a poll nor a fan-out to learn from, and stays stale until
 * something else makes it reconnect. Both transports feeding one notify path
 * is what makes "prefer WS, fall back to REST" safe to mix within an account.
 *
 * `accountDid` is read back out of the request body only on a `200`, which
 * means `handlers/push.ts` has already schema-validated it *and* checked it
 * against the bearer token's `sub` — it is a verified value by then, not
 * client input. No originator is passed: a REST caller holds no socket, and if
 * it happens to also hold one, receiving its own event back is harmless (event
 * application is idempotent) and strictly safer than guessing.
 */
function fanOutAfterRestPush(
  http: { method: string; path: string },
  body: string,
  statusCode: number,
  hub: WsHub | null
): void {
  if (!hub || statusCode !== 200) return;
  if (http.method !== 'POST' || http.path !== '/v1/sync/push') return;
  try {
    const accountDid = (JSON.parse(body) as { accountDid?: unknown }).accountDid;
    if (typeof accountDid === 'string') hub.notifyAccount(accountDid);
  } catch {
    // Unreachable on a 200 (the handler parsed the same bytes), and a failure
    // here must never turn a completed write into an error.
  }
}

export interface ServerStack {
  server: Server;
  /** `null` when `CT_WS=off` or `ws: false` — a REST-only deployment, which
   *  §10.2 calls fully supported, not degraded. */
  hub: WsHub | null;
  /** Closes the WebSocket hub *and* the HTTP server. Order matters: open
   *  sockets keep `http.Server.close()` from ever calling back. */
  close(): Promise<void>;
}

export function createServerStack(
  domain: DomainContext,
  opts: { ws?: false | WsServerOptions } = {}
): ServerStack {
  const ref: { current: WsHub | null } = { current: null };
  const server = createServer(createRequestListener(domain, () => ref.current));
  if (opts.ws !== false && wsEnabled()) {
    ref.current = attachWsServer(server, domain, opts.ws ?? {});
  }
  // `/v1/meta` advertises what is actually attached, decided here and nowhere
  // else — see `setWsServed` in lib/ws-config.ts.
  setWsServed(ref.current !== null);
  return {
    server,
    hub: ref.current,
    async close() {
      if (ref.current) await ref.current.close();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  };
}

/** Back-compat shim for callers that only want the HTTP server. */
export function createHttpServer(domain: DomainContext): Server {
  return createServerStack(domain).server;
}
