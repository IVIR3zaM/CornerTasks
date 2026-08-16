// Builds a core `HttpEvent` from a `node:http` `IncomingMessage`, and writes
// a core `HttpResult` back to a `ServerResponse`. This is the one seam where
// a hand-rolled adapter usually diverges from API Gateway/Lambda, so every
// choice here mirrors what `APIGatewayProxyEventV2` actually does — see
// `tests/adapter.test.ts` and `tests/parity.test.ts`.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpEvent, HttpResult } from '../../core/src/types/http';

/** Reject bodies over 1 MB with 413, matching API Gateway's payload limits
 *  closely enough for a self-hosted deployment. */
export const MAX_BODY_BYTES = 1024 * 1024;

/** The pieces of `HttpEvent.requestContext` that come from configuration
 *  (PUBLIC_URL) rather than the individual request — see `lib/audience.ts`. */
export interface DomainContext {
  domainName: string;
  stage: string;
}

export interface ReadBodyResult {
  body: string;
  tooLarge: boolean;
}

/** Reads the request body up to `MAX_BODY_BYTES`. Stops buffering (but keeps
 *  draining the socket) once the cap is exceeded and reports `tooLarge`. */
export function readBody(req: IncomingMessage): Promise<ReadBodyResult> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;

    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0; // stop retaining data we're going to reject
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8'), tooLarge }));
    req.on('error', reject);
  });
}

/** Lowercases header names, as API Gateway's HttpApi (v2) payload does.
 *  `lib/auth.ts` in core reads `headers.authorization` — never the
 *  capitalized form — so this is the one adapter behavior that silently
 *  breaks auth if it's wrong. */
function lowercaseHeaders(req: IncomingMessage): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    out[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

/** Builds the `HttpEvent` a core handler expects from a raw request, its
 *  already-read body, and the configured domain context. `domain` — not the
 *  request's `Host` header — drives `requestContext.domainName`/`stage`
 *  (and therefore the DID-Auth audience), per D1. */
export function buildEvent(req: IncomingMessage, body: string, domain: DomainContext): HttpEvent {
  const url = new URL(req.url ?? '/', 'http://ct-server.invalid');

  const queryStringParameters: Record<string, string | undefined> = {};
  for (const key of url.searchParams.keys()) {
    queryStringParameters[key] = url.searchParams.get(key) ?? undefined;
  }

  return {
    headers: lowercaseHeaders(req),
    queryStringParameters,
    body: body.length > 0 ? body : undefined,
    requestContext: {
      domainName: domain.domainName,
      stage: domain.stage,
      http: {
        method: (req.method ?? 'GET').toUpperCase(),
        path: url.pathname
      }
    }
  };
}

/** Writes an `HttpResult` back to the underlying `ServerResponse`. */
export function writeResult(res: ServerResponse, result: HttpResult): void {
  res.writeHead(result.statusCode, result.headers ?? {});
  res.end(result.body ?? '');
}
