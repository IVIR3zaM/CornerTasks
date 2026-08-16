// Wires the adapter and router into a plain `node:http` server. Split out
// from `index.ts` so tests can build a fully-wired `http.Server` against an
// injected `Store`/domain without going through env parsing or `listen()`
// on a real port.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { buildEvent, readBody, writeResult, type DomainContext } from './adapter';
import { route } from './router';
import { json } from '../../core/src/lib/response';

export function createRequestListener(domain: DomainContext) {
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
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('cornertasks-server: unhandled request error', err);
      writeResult(res, json(500, { error: 'internal', reason: 'unhandled_exception' }));
    }
  };
}

export function createHttpServer(domain: DomainContext): Server {
  return createServer(createRequestListener(domain));
}
