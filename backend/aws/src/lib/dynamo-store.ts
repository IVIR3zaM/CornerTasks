import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  DeleteCommand
} from '@aws-sdk/lib-dynamodb';
import { ARCHIVE_RETENTION_MS } from './archive-retention';
import type { AuthChallenge, Store, StoredEvent } from './db';

const ARCHIVE_CUTOFF_MS = ARCHIVE_RETENTION_MS;

export function dynamoStore(): Store {
  const eventsTable = process.env.EVENTS_TABLE;
  const challengesTable = process.env.AUTH_CHALLENGES_TABLE;
  if (!eventsTable || !challengesTable) {
    throw new Error('EVENTS_TABLE / AUTH_CHALLENGES_TABLE env vars are required');
  }
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  return {
    async putEvent(ev: StoredEvent) {
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
              ...(ev.archivedCompletedAt
                ? { archivedCompletedAt: ev.archivedCompletedAt }
                : {})
            },
            ConditionExpression:
              'attribute_not_exists(updatedAt) OR updatedAt < :u OR (updatedAt = :u AND eventId < :e)',
            ExpressionAttributeValues: { ':u': ev.updatedAt, ':e': ev.eventId }
          })
        );
        return { accepted: true };
      } catch (err) {
        const name = (err as { name?: string }).name;
        if (name === 'ConditionalCheckFailedException') return { accepted: false };
        throw err;
      }
    },

    async queryEventsSince(accountDid, sinceMs) {
      const cutoff = new Date(Date.now() - ARCHIVE_CUTOFF_MS).toISOString();
      const sinceIso = new Date(sinceMs).toISOString();
      const results: StoredEvent[] = [];
      let exclusiveStartKey: Record<string, unknown> | undefined;
      do {
        const out = await client.send(
          new QueryCommand({
            TableName: eventsTable,
            IndexName: 'ByUpdatedAt',
            KeyConditionExpression: 'pk = :pk AND updatedAt >= :since',
            ExpressionAttributeValues: { ':pk': `ACCOUNT#${accountDid}`, ':since': sinceIso },
            ExclusiveStartKey: exclusiveStartKey
          })
        );
        for (const item of out.Items ?? []) {
          const ev = item as StoredEvent;
          if (ev.archivedCompletedAt && ev.archivedCompletedAt < cutoff) continue;
          results.push(ev);
        }
        exclusiveStartKey = out.LastEvaluatedKey;
      } while (exclusiveStartKey);
      results.sort((a, b) => {
        if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? -1 : 1;
        return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
      });
      return results;
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
