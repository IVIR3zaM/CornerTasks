// GET /v1/meta — unauthenticated transport negotiation (docs/sync-protocol.md
// §10.1). New in v0.3.0 (N02).
//
// `audience` is computed with the *same* `audienceFromEvent(event)` call
// `handlers/auth/challenge.ts` and `handlers/auth/token.ts` use — not read
// directly from `PUBLIC_URL` — so it is guaranteed to equal the audience
// those endpoints assert, no matter how `requestContext.domainName`/`stage`
// ended up being populated for this request (see `lib/audience.ts`).
//
// `wsUrl` is then derived from that same `audience` (see `lib/ws-config.ts`),
// which makes the socket origin and the origin whose bearer tokens this
// deployment honours the same string by construction. Advertising a `wsUrl`
// on a different origin would produce a socket that opens and then fails
// `auth` — a failure clients report as `failed`, with no hint as to why.

import type { HttpEvent, HttpResult } from '../../../core/src/types/http';
import { json } from '../../../core/src/lib/response';
import { audienceFromEvent } from '../../../core/src/lib/api-url';
import { isWsServed, wsUrlFromAudience } from '../lib/ws-config';

export interface MetaResponse {
  protocolVersions: number[];
  transports: ('ws' | 'rest')[];
  wsUrl?: string;
  audience: string;
}

export async function handler(event: HttpEvent): Promise<HttpResult> {
  const audience = audienceFromEvent(event);
  // The *attached* endpoint, not the configured intent: advertising a socket
  // this process does not serve costs every client its three §12.3 WebSocket
  // attempts before it falls back, on every start.
  const ws = isWsServed();
  const resp: MetaResponse = {
    protocolVersions: [2, 3],
    // §10.1: `transports` MUST contain "rest"; `wsUrl` is present if and only
    // if "ws" is advertised. REST stays advertised while WS is on — it is the
    // fallback every client keeps armed (§12.2), not a legacy mode.
    transports: ws ? ['ws', 'rest'] : ['rest'],
    ...(ws ? { wsUrl: wsUrlFromAudience(audience) } : {}),
    audience
  };
  // Cacheable for at most 60 seconds per §10.1.
  return json(200, resp, { 'cache-control': 'public, max-age=60' });
}
