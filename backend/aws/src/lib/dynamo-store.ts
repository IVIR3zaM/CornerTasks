import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  UpdateCommand
} from '@aws-sdk/lib-dynamodb';
import { ARCHIVE_RETENTION_MS } from '../../../core/src/lib/archive-retention';
import type { AuthChallenge, QueryEventsResult, Store, StoredEvent } from '../../../core/src/lib/db';
import { parseCursor } from '../../../core/src/lib/db';

const ARCHIVE_CUTOFF_MS = ARCHIVE_RETENTION_MS;

const COUNTER_SK = 'COUNTER';

export function dynamoStore(): Store {
  const eventsTable = process.env.EVENTS_TABLE;
  const challengesTable = process.env.AUTH_CHALLENGES_TABLE;
  if (!eventsTable || !challengesTable) {
    throw new Error('EVENTS_TABLE / AUTH_CHALLENGES_TABLE env vars are required');
  }
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  /** Atomically increment the per-account sequence counter and return the new
   *  value. Allocates a fresh seq even if the subsequent event write is
   *  stale-rejected — gaps are harmless because pull queries `seq > cursor`. */
  async function nextSeq(accountDid: string): Promise<number> {
    const out = await client.send(
      new UpdateCommand({
        TableName: eventsTable,
        Key: { pk: `ACCOUNT#${accountDid}`, sk: COUNTER_SK },
        UpdateExpression: 'ADD seq :one',
        ExpressionAttributeValues: { ':one': 1 },
        ReturnValues: 'UPDATED_NEW'
      })
    );
    const seq = (out.Attributes ?? {}).seq;
    if (typeof seq !== 'number') {
      throw new Error('counter update did not return a numeric seq');
    }
    return seq;
  }

  return {
    async putEvent(ev: StoredEvent) {
      const seq = await nextSeq(ev.accountDid);
      try {
        await client.send(
          new PutCommand({
            TableName: eventsTable,
            Item: {
              pk: `ACCOUNT#${ev.accountDid}`,
              sk: `TASK#${ev.taskId}`,
              accountDid: ev.accountDid,
              deviceId: ev.deviceId,
              eventId: ev.eventId,
              taskId: ev.taskId,
              updatedAt: ev.updatedAt,
              op: ev.op,
              ciphertext: ev.ciphertext,
              nonce: ev.nonce,
              seq,
              ...(ev.archivedCompletedAt
                ? { archivedCompletedAt: ev.archivedCompletedAt }
                : {})
            },
            ConditionExpression:
              'attribute_not_exists(updatedAt) OR updatedAt < :u OR (updatedAt = :u AND eventId < :e)',
            ExpressionAttributeValues: { ':u': ev.updatedAt, ':e': ev.eventId }
          })
        );
        return { accepted: true, seq };
      } catch (err) {
        const name = (err as { name?: string }).name;
        if (name === 'ConditionalCheckFailedException') return { accepted: false };
        throw err;
      }
    },

    async queryEventsAfter(accountDid, cursor): Promise<QueryEventsResult> {
      const cursorN = parseCursor(cursor);
      const archiveCutoffIso = new Date(Date.now() - ARCHIVE_CUTOFF_MS).toISOString();
      const results: StoredEvent[] = [];
      let exclusiveStartKey: Record<string, unknown> | undefined;
      do {
        const out = await client.send(
          new QueryCommand({
            TableName: eventsTable,
            IndexName: 'BySeq',
            KeyConditionExpression: 'pk = :pk AND seq > :cursor',
            ExpressionAttributeValues: { ':pk': `ACCOUNT#${accountDid}`, ':cursor': cursorN },
            ExclusiveStartKey: exclusiveStartKey
          })
        );
        for (const item of out.Items ?? []) {
          const ev = item as StoredEvent;
          // The COUNTER row lives in the same partition. It has no `eventId` so
          // it gets a defensive type-guard skip in case the GSI ever projects it.
          if (!ev.eventId) continue;
          if (ev.archivedCompletedAt && ev.archivedCompletedAt < archiveCutoffIso) continue;
          results.push(ev);
        }
        exclusiveStartKey = out.LastEvaluatedKey;
      } while (exclusiveStartKey);
      results.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
      const nextCursor = results.reduce(
        (acc, ev) => (ev.seq && ev.seq > acc ? ev.seq : acc),
        cursorN
      );
      return { events: results, nextCursor: String(nextCursor) };
    },

    async pruneExpiredArchives(accountDid) {
      const cutoff = new Date(Date.now() - ARCHIVE_CUTOFF_MS).toISOString();
      let removed = 0;
      let exclusiveStartKey: Record<string, unknown> | undefined;
      do {
        const out = await client.send(
          new QueryCommand({
            TableName: eventsTable,
            KeyConditionExpression: 'pk = :pk',
            FilterExpression: 'attribute_exists(archivedCompletedAt) AND archivedCompletedAt < :cutoff',
            ExpressionAttributeValues: { ':pk': `ACCOUNT#${accountDid}`, ':cutoff': cutoff },
            ExclusiveStartKey: exclusiveStartKey
          })
        );
        for (const item of out.Items ?? []) {
          const row = item as { pk: string; sk: string };
          await client.send(
            new DeleteCommand({ TableName: eventsTable, Key: { pk: row.pk, sk: row.sk } })
          );
          removed += 1;
        }
        exclusiveStartKey = out.LastEvaluatedKey;
      } while (exclusiveStartKey);
      return removed;
    },

    async putChallenge(c: AuthChallenge) {
      await client.send(
        new PutCommand({
          TableName: challengesTable,
          Item: {
            pk: `AUTHCHAL#${c.accountDid}`,
            sk: c.challenge,
            accountDid: c.accountDid,
            challenge: c.challenge,
            ttl: Math.floor(c.expiresAt / 1000)
          }
        })
      );
    },

    async consumeChallenge(accountDid, challenge) {
      try {
        await client.send(
          new DeleteCommand({
            TableName: challengesTable,
            Key: { pk: `AUTHCHAL#${accountDid}`, sk: challenge },
            ConditionExpression: 'attribute_exists(challenge) AND #t > :now',
            ExpressionAttributeNames: { '#t': 'ttl' },
            ExpressionAttributeValues: { ':now': Math.floor(Date.now() / 1000) }
          })
        );
        return true;
      } catch (err) {
        const name = (err as { name?: string }).name;
        if (name === 'ConditionalCheckFailedException') return false;
        throw err;
      }
    }
  };
}
