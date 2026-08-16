// The two facts about WebSocket support that *two* independent pieces of code
// need to agree on: `GET /v1/meta` (which tells clients whether to try a
// socket at all, §10.1) and `server.ts` (which decides whether to attach one).
//
// They live here rather than being read from `process.env` at each site
// because the failure mode of disagreement is silent and bad in both
// directions: advertise `ws` without attaching a server and every client
// burns its three §12.3 WebSocket attempts on ECONNREFUSED before falling
// back; attach a server without advertising it and no client ever dials it,
// so the transport looks "implemented" while 100% of traffic polls.

/** Path the WebSocket endpoint is served on. Pinned by the `wsUrl` example in
 *  docs/sync-protocol.md §10.1 (`wss://example.ngrok.app/v1/sync/ws`) — it is
 *  part of the advertised contract, not an implementation detail, because
 *  `wsUrl` is an absolute URL a client stores and redials. */
export const WS_PATH = '/v1/sync/ws';

/** WebSocket is on by default; `CT_WS=off` turns it off.
 *
 *  Default-on is deliberate: §10.2 makes a REST-only deployment fully
 *  supported, so the cost of a client failing to negotiate WS is a slower
 *  sync, never a broken one — whereas requiring an opt-in env var would mean
 *  every self-hosted deployment silently ships without the headline feature of
 *  v0.3.0. The escape hatch exists for reverse proxies that cannot pass the
 *  `Upgrade` header. */
export function wsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.CT_WS ?? 'on').toLowerCase() !== 'off';
}

/** Whether *this process* actually has a socket endpoint attached.
 *
 *  `wsEnabled()` is the configured intent; this is the observed fact, and
 *  `/v1/meta` advertises the fact. They are separate because they can differ —
 *  a caller that constructs the stack with WebSocket suppressed, a future
 *  runtime that fails to attach — and the direction of that difference is what
 *  decides whether every client on the deployment wastes its §12.3 attempts on
 *  a port that will never upgrade. `createServerStack()` is the only writer,
 *  in the same statement that decides whether to attach the hub, so the two
 *  cannot drift. */
let served = false;

export function setWsServed(value: boolean): void {
  served = value;
}

export function isWsServed(): boolean {
  return served;
}

/** Derives the advertised `wsUrl` from the DID-Auth `audience` string.
 *
 *  Deriving it from the audience — not from `PUBLIC_URL` directly and never
 *  from the request's `Host` header — means the socket URL and the `aud` claim
 *  the socket's own bearer token must carry are the same string by
 *  construction (D1). If they could differ, a client would connect to a host
 *  whose tokens this deployment refuses, and the only symptom would be a
 *  socket that authenticates on REST but not on WS.
 *
 *  `audienceFromEvent()` emits `https://<domainName>/<stage>`, so `stage` may
 *  be empty (`https://host/`) or a path segment (`https://host/dev`). Both
 *  must keep their prefix, hence the explicit trailing slash before resolving
 *  the relative path — `new URL('v1/sync/ws', 'https://host/dev')` would
 *  silently drop `/dev`. */
export function wsUrlFromAudience(audience: string): string {
  const base = audience.endsWith('/') ? audience : `${audience}/`;
  const url = new URL(WS_PATH.replace(/^\//, ''), base);
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
  return url.href;
}
