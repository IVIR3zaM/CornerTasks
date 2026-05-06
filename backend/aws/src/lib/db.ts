// Storage layer for events + auth challenges. The real implementation wraps
// a DynamoDB DocumentClient; tests inject an in-memory adapter via setStore().

import type { SyncEvent } from '../types/api';
import { dynamoStore } from './dynamo-store';

export interface StoredEvent extends SyncEvent {
  archivedCompletedAt?: string | null;
}

export interface AuthChallenge {
  accountDid: string;
  challenge: string;
  expiresAt: number;
}

export interface Store {
  putEvent(ev: StoredEvent): Promise<{ accepted: boolean }>;
  queryEventsSince(accountDid: string, sinceMs: number): Promise<StoredEvent[]>;
  putChallenge(c: AuthChallenge): Promise<void>;
  consumeChallenge(accountDid: string, challenge: string): Promise<boolean>;
}

let store: Store | null = null;

export function setStore(s: Store): void {
  store = s;
}

export function getStore(): Store {
  if (!store) store = dynamoStore();
  return store;
}

export function resetStoreForTests(): void {
  store = null;
}
