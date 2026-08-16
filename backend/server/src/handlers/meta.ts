// GET /v1/meta — unauthenticated transport negotiation (docs/sync-protocol.md
// §10.1). New in v0.3.0 (N02); this Node server doesn't implement WebSocket
// yet (N08), so `transports` only ever advertises `"rest"` and `wsUrl` is
// omitted, which §10.1 says is a fully-valid, fully-supported deployment.
//
// `audience` is computed with the *same* `audienceFromEvent(event)` call
// `handlers/auth/challenge.ts` and `handlers/auth/token.ts` use — not read
// directly from `PUBLIC_URL` — so it is guaranteed to equal the audience
// those endpoints assert, no matter how `requestContext.domainName`/`stage`
// ended up being populated for this request (see `lib/audience.ts`).

import type { HttpEvent, HttpResult } from '../../../core/src/types/http';
import { json } from '../../../core/src/lib/response';
import { audienceFromEvent } from '../../../core/src/lib/api-url';

export interface MetaResponse {
  protocolVersions: number[];
  transports: ('ws' | 'rest')[];
  wsUrl?: string;
  audience: string;
}

export async function handler(event: HttpEvent): Promise<HttpResult> {
  const resp: MetaResponse = {
    protocolVersions: [2, 3],
    transports: ['rest'],
    audience: audienceFromEvent(event)
  };
  // Cacheable for at most 60 seconds per §10.1.
  return json(200, resp, { 'cache-control': 'public, max-age=60' });
}
