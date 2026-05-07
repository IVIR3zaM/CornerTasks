import { describe, expect, it } from 'vitest';
import { encodePlaintext, decodePlaintext, makeEvent, openEvent, eventAad } from '../src/sync/syncEvent';
import { encryptionKeyBytes } from '../src/crypto/keys';
import * as mnemonic from '../src/crypto/mnemonic';
import vectors from '../../../docs/crypto-vectors.json';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('encodePlaintext — fixed key order matches the macOS encoder', () => {
  it('orders keys: title, createdAt, completedAt, dueDate, order', () => {
    const bytes = encodePlaintext({
      title: 'Buy milk',
      createdAt: new Date('2026-05-04T10:00:00.000Z'),
      completedAt: null,
      dueDate: new Date('2026-05-06T00:00:00.000Z'),
      order: 3,
    });
    const s = new TextDecoder().decode(bytes);
    expect(s).toBe(
      '{"title":"Buy milk","createdAt":"2026-05-04T10:00:00.000Z","completedAt":null,"dueDate":"2026-05-06T00:00:00.000Z","order":3}'
    );
  });

  it('emits null for absent completedAt and dueDate', () => {
    const s = new TextDecoder().decode(encodePlaintext({
      title: 't', createdAt: new Date('2026-01-01T00:00:00.000Z'), completedAt: null, dueDate: null, order: 0,
    }));
    expect(s).toContain('"completedAt":null,"dueDate":null');
  });

  it('escapes JSON specials in title', () => {
    const s = new TextDecoder().decode(encodePlaintext({
      title: 'a"b\\c', createdAt: new Date('2026-01-01T00:00:00.000Z'), completedAt: null, dueDate: null, order: 0,
    }));
    expect(s).toContain('"title":"a\\"b\\\\c"');
  });
});

describe('makeEvent / openEvent', () => {
  it('round-trips upsert plaintext through AES-GCM', async () => {
    const seed = await mnemonic.toSeed(vectors.mnemonic);
    const key = await encryptionKeyBytes(seed);
    const event = await makeEvent({
      op: 'upsert',
      accountDid: vectors.accountDid,
      deviceId: 'dev-1',
      eventId: 'event-1',
      taskId: 'task-1',
      updatedAt: new Date('2026-05-05T12:00:00.000Z'),
      plaintext: { title: 'hello', createdAt: new Date('2026-05-05T11:00:00.000Z'), completedAt: null, dueDate: null, order: 0 },
      encryptionKey: key,
    });
    const pt = await openEvent(event, key);
    expect(pt?.title).toBe('hello');
  });

  it('encrypts delete events as {} and openEvent returns null', async () => {
    const seed = await mnemonic.toSeed(vectors.mnemonic);
    const key = await encryptionKeyBytes(seed);
    const event = await makeEvent({
      op: 'delete',
      accountDid: vectors.accountDid,
      deviceId: 'dev-1',
      eventId: 'event-2',
      taskId: 'task-2',
      updatedAt: new Date('2026-05-05T12:00:00.000Z'),
      plaintext: null,
      encryptionKey: key,
    });
    const pt = await openEvent(event, key);
    expect(pt).toBeNull();
  });

  it('AAD binds an event to its identifying tuple', () => {
    const aad = eventAad('did:key:abc', 'task-1', 'event-1');
    expect(new TextDecoder().decode(aad)).toBe('did:key:abc|task-1|event-1');
  });
});

describe('decodePlaintext', () => {
  it('parses the canonical encoding', () => {
    const json = '{"title":"x","createdAt":"2026-01-01T00:00:00.000Z","completedAt":null,"dueDate":null,"order":7}';
    const pt = decodePlaintext(utf8(json));
    expect(pt?.title).toBe('x');
    expect(pt?.order).toBe(7);
  });
});
