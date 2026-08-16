// Routes, mapped exactly as backend/aws/template.yaml declares them, plus
// the two endpoints new in v0.3.0 (/v1/meta from N02, /v1/health for
// Docker). Every route below delegates to a handler that takes `HttpEvent`
// and returns `HttpResult` — the four sync/auth handlers are the *exact*
// backend/core handlers Lambda calls, imported unmodified.

import type { HttpEvent, HttpResult } from '../../core/src/types/http';
import { json } from '../../core/src/lib/response';
import { handler as challengeHandler } from '../../core/src/handlers/auth/challenge';
import { handler as tokenHandler } from '../../core/src/handlers/auth/token';
import { handler as pushHandler } from '../../core/src/handlers/push';
import { handler as pullHandler } from '../../core/src/handlers/pull';
import { handler as metaHandler } from './handlers/meta';
import { handler as healthHandler } from './handlers/health';

type RouteHandler = (event: HttpEvent) => Promise<HttpResult>;

export const ROUTES: Record<string, RouteHandler> = {
  'POST /v1/auth/challenge': challengeHandler,
  'POST /v1/auth/token': tokenHandler,
  'POST /v1/sync/push': pushHandler,
  'GET /v1/sync/pull': pullHandler,
  'GET /v1/meta': metaHandler,
  'GET /v1/health': healthHandler
};

function routeKey(event: HttpEvent): string {
  return `${event.requestContext.http.method} ${event.requestContext.http.path}`;
}

/** Dispatches an `HttpEvent` to the matching handler above. Unknown
 *  method+path pairs get a 404; a handler that throws gets a 500 rather than
 *  crashing the process or leaking a stack trace to the client. */
export async function route(event: HttpEvent): Promise<HttpResult> {
  const handler = ROUTES[routeKey(event)];
  if (!handler) {
    return json(404, { error: 'not_found', reason: 'no_route' });
  }
  try {
    return await handler(event);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('cornertasks-server: unhandled error in', routeKey(event), err);
    return json(500, { error: 'internal', reason: 'unhandled_exception' });
  }
}
