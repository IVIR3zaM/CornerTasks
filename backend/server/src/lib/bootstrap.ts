// Wires this runtime's concrete implementations into the runtime-neutral
// seams backend/core exposes (`setStore`, `getSigningKey`) — the self-hosted
// equivalent of backend/aws/src/lib/runtime-bootstrap.ts. Only ever called
// once per process, at startup.

import { setStore } from '../../../core/src/lib/db';
import { createStoreFromEnv } from '../../../core/src/lib/store-factory';
import { getSigningKey } from '../../../core/src/lib/signing-key';
import { requirePublicAudienceForStore } from './audience';
import type { DomainContext } from '../adapter';

export interface Bootstrapped {
  domain: DomainContext;
  /** Releases the store's underlying file handle, if it has one (the SQLite
   *  store does — see its `close()` doc comment). Safe to call on stores
   *  that don't expose one. Intended for graceful shutdown. */
  closeStore(): void;
}

/** Validates and wires configuration for this process:
 *  - `PUBLIC_URL` (required whenever `CT_STORE=sqlite`, which is this
 *    runtime's only supported store — see `lib/audience.ts` and D1).
 *  - The `Store`, via backend/core's own `CT_STORE`-driven factory.
 *  - The JWT signing key, fetched (and therefore validated) once up front so
 *    a missing/malformed key fails loudly at startup rather than on the
 *    first request (N06).
 *
 *  Throws with a message meant to be read by a human starting the container,
 *  not caught and handled — callers should let this reject `main()`.
 *
 *  Reads configuration from `process.env` throughout (never an injected
 *  object) because `createStoreFromEnv()` and `getSigningKey()` in
 *  backend/core do the same — a partial override here would only be
 *  misleading. Tests set `process.env` directly and restore it afterward,
 *  matching backend/core/tests/sqlite-store.test.ts. */
export async function bootstrap(): Promise<Bootstrapped> {
  const publicAudience = requirePublicAudienceForStore();
  const store = createStoreFromEnv();
  setStore(store);
  await getSigningKey();

  const domain: DomainContext = publicAudience
    ? { domainName: publicAudience.domainName, stage: publicAudience.stage }
    : { domainName: process.env.CT_FALLBACK_DOMAIN ?? 'localhost', stage: '' };

  const closeStore = (): void => {
    (store as unknown as { close?: () => void }).close?.();
  };

  return { domain, closeStore };
}
