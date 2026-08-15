// Wires this runtime's concrete implementations into the runtime-neutral
// seams `backend/core` exposes (`setStore`, `setSigningKey`). The core
// handlers only ever call `getStore()` / `getSigningKey()`; this module is
// what makes those resolve to DynamoDB and SSM in the AWS runtime.

import { setStore } from '../../../core/src/lib/db';
import { setSigningKey } from '../../../core/src/lib/signing-key';
import { dynamoStore } from './dynamo-store';
import { getSigningKey as getAwsSigningKey } from './signing-key';

let storeReady = false;

/** Registers the DynamoDB-backed store with core, once per Lambda instance. */
export function ensureStore(): void {
  if (storeReady) return;
  setStore(dynamoStore());
  storeReady = true;
}

/** Refreshes core's signing-key cache from the AWS (SSM-backed) provider.
 *  `getAwsSigningKey()` caches internally, so this is cheap after the first
 *  call in a warm Lambda instance. */
export async function ensureSigningKey(): Promise<void> {
  setSigningKey(await getAwsSigningKey());
}
