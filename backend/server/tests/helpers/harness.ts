// Spins up a real `node:http` server (adapter + router, wired to an
// ephemeral SQLite store) on a free port, for supertest-style tests that
// exercise the whole stack over real HTTP rather than calling handlers
// directly.

import type { AddressInfo } from 'node:net';
import { createServerStack } from '../../src/server';
import { setStore, resetStoreForTests } from '../../../core/src/lib/db';
import { sqliteStore } from '../../../core/src/lib/sqlite-store';
import { setSigningKey } from '../../../core/src/lib/signing-key';
import type { DomainContext } from '../../src/adapter';
import { WS_PATH } from '../../src/lib/ws-config';
import type { WsHub, WsServerOptions } from '../../src/ws-server';

// A placeholder that satisfies `lib/audience.ts`'s https:// requirement.
// Never dialed — only used to derive `domainName`/`stage` for the DID-Auth
// audience, exactly as a real deployment's PUBLIC_URL would be.
export const TEST_PUBLIC_URL = 'https://ct-server-test.example';

export const TEST_SIGNING_KEY = {
  alg: 'HS256' as const,
  kid: 'ct-server-test',
  privateKey: Buffer.from('test-secret-32-bytes-padding-padd'),
  publicKey: Buffer.from('test-secret-32-bytes-padding-padd')
};

export interface Harness {
  baseUrl: string;
  /** `ws://127.0.0.1:<port>/v1/sync/ws` — the real, dialable socket URL. The
   *  `wsUrl` `/v1/meta` advertises is derived from `PUBLIC_URL` instead (a
   *  `wss://` URL that is not reachable in a unit test), so tests assert the
   *  advertised shape separately and dial this. */
  wsUrl: string;
  domain: DomainContext;
  /** Equal to `audienceFromEvent()`'s output for every request this server
   *  handles — i.e. what `/v1/auth/challenge` and `/v1/meta` will report. */
  audience: string;
  /** `null` only when the harness was started with `ws: false`. */
  hub: WsHub | null;
  close(): Promise<void>;
}

export function domainFromPublicUrl(publicUrl: string): { domain: DomainContext; audience: string } {
  const url = new URL(publicUrl);
  return {
    domain: { domainName: url.host, stage: url.pathname.replace(/^\//, '') },
    audience: url.href
  };
}

export async function startTestServer(opts: { ws?: false | WsServerOptions } = {}): Promise<Harness> {
  resetStoreForTests();
  const store = sqliteStore(':memory:');
  setStore(store);
  setSigningKey(TEST_SIGNING_KEY);

  const { domain, audience } = domainFromPublicUrl(TEST_PUBLIC_URL);
  const stack = createServerStack(domain, { ws: opts.ws ?? {} });

  await new Promise<void>((resolve) => stack.server.listen(0, '127.0.0.1', resolve));
  const { port } = stack.server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}${WS_PATH}`,
    domain,
    audience,
    hub: stack.hub,
    async close() {
      await stack.close();
      store.close();
      setSigningKey(null);
      resetStoreForTests();
    }
  };
}
