// In-memory bearer-token lifecycle. Mirrors apps/macos/Sources/CornerTasks/Sync/AuthSession.swift.
// SENSITIVE: the bearer token MUST NOT be persisted (no localStorage, no IndexedDB).
// See docs/sync-protocol.md §8.

import type { Identity } from '../crypto/identity';
import type { SyncTransport } from './syncTransport';
import { isoParse } from './syncEvent';

export interface AuthSessionOptions {
  refreshSlackSeconds?: number;
  now?: () => Date;
}

export class AuthSession {
  private cachedToken: string | null = null;
  private cachedExpiresAt: Date | null = null;
  private readonly refreshSlack: number;
  private readonly now: () => Date;

  constructor(
    private readonly identity: Identity,
    private readonly transport: SyncTransport,
    opts: AuthSessionOptions = {}
  ) {
    this.refreshSlack = opts.refreshSlackSeconds ?? 60;
    this.now = opts.now ?? (() => new Date());
  }

  /** Returns a valid bearer token, refreshing if absent or within `refreshSlack` of expiry. */
  async bearer(): Promise<string> {
    if (this.cachedToken && this.cachedExpiresAt) {
      const remaining = (this.cachedExpiresAt.getTime() - this.now().getTime()) / 1000;
      if (remaining > this.refreshSlack) return this.cachedToken;
    }
    return this.refresh();
  }

  invalidate(): void {
    this.cachedToken = null;
    this.cachedExpiresAt = null;
  }

  /** Test seam: in-memory cache lets tests assert the token never leaked to storage. */
  cachedTokenForTesting(): string | null {
    return this.cachedToken;
  }

  private async refresh(): Promise<string> {
    const challenge = await this.transport.challenge(this.identity.accountDid);
    const iat = Math.floor(this.now().getTime() / 1000);
    const didJwt = await this.identity.makeDidJwt({
      audience: challenge.audience,
      nonce: challenge.challenge,
      iat,
    });
    const token = await this.transport.token(this.identity.accountDid, didJwt);
    this.cachedToken = token.accessToken;
    const exp = isoParse(token.expiresAt);
    this.cachedExpiresAt = exp ?? new Date(this.now().getTime() + 3_600_000);
    return token.accessToken;
  }
}
