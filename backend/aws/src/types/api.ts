// Shared API request / response shapes pinned by docs/sync-protocol.md.

import { z } from 'zod';

const Base64url = z.string().regex(/^[A-Za-z0-9_-]+$/);
const Iso8601 = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'invalid ISO 8601');
const Uuid = z.string().uuid();
const DidKey = z.string().regex(/^did:key:z[1-9A-HJ-NP-Za-km-z]+$/);

export const EventSchema = z.object({
  accountDid: DidKey,
  deviceId: Uuid,
  eventId: Uuid,
  taskId: Uuid,
  updatedAt: Iso8601,
  op: z.enum(['upsert', 'delete']),
  ciphertext: Base64url,
  nonce: Base64url
});
export type SyncEvent = z.infer<typeof EventSchema>;

export const PushRequestSchema = z.object({
  accountDid: DidKey,
  events: z.array(EventSchema).min(1).max(500)
});
export type PushRequest = z.infer<typeof PushRequestSchema>;

export interface PushReject {
  eventId: string;
  reason: 'stale' | 'invalid' | 'did_mismatch';
}
export interface PushResponse {
  accepted: string[];
  rejected: PushReject[];
}

export interface PullResponse {
  events: SyncEvent[];
  serverTime: string;
}

export const ChallengeRequestSchema = z.object({ accountDid: DidKey });
export interface ChallengeResponse {
  challenge: string;
  audience: string;
  expiresAt: string;
}

export const TokenRequestSchema = z.object({
  accountDid: DidKey,
  didJwt: z.string().min(1)
});
export interface TokenResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  expiresAt: string;
}

export interface ApiError {
  error: 'bad_request' | 'unauthorized' | 'forbidden' | 'internal';
  reason: string;
  details?: string | null;
}

export { DidKey };
