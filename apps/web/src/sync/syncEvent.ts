// Wire format for one synchronisation event. Mirrors apps/macos/Sources/CornerTasks/Sync/SyncEvent.swift.
// See docs/sync-protocol.md §3 / §4.

import { open as boxOpen, seal as boxSeal } from '../crypto/box';

export interface SyncEvent {
  accountDid: string;
  deviceId: string;
  eventId: string;
  taskId: string;
  updatedAt: string;
  op: 'upsert' | 'delete';
  ciphertext: string;
  nonce: string;
}

export interface EventPlaintext {
  title: string;
  createdAt: Date;
  completedAt: Date | null;
  dueDate: Date | null;
  order: number;
}

const b64urlEncode = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

const b64urlDecode = (s: string): Uint8Array => {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const std = s.replaceAll('-', '+').replaceAll('_', '/') + pad;
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export const isoFormat = (d: Date): string => d.toISOString();
export const isoParse = (s: string): Date | null => {
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
};

const jsonString = (s: string): string => JSON.stringify(s);

// Hand-built so the byte sequence matches the macOS encoder exactly:
// title, createdAt, completedAt, dueDate, order. Asserted by docs/crypto-vectors.json.
export const encodePlaintext = (pt: EventPlaintext): Uint8Array => {
  let out = '{';
  out += '"title":' + jsonString(pt.title) + ',';
  out += '"createdAt":' + jsonString(isoFormat(pt.createdAt)) + ',';
  out += '"completedAt":' + (pt.completedAt ? jsonString(isoFormat(pt.completedAt)) : 'null') + ',';
  out += '"dueDate":' + (pt.dueDate ? jsonString(isoFormat(pt.dueDate)) : 'null') + ',';
  out += '"order":' + String(pt.order);
  out += '}';
  return new TextEncoder().encode(out);
};

export const decodePlaintext = (bytes: Uint8Array): EventPlaintext | null => {
  let obj: unknown;
  try {
    obj = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.title !== 'string') return null;
  if (typeof o.createdAt !== 'string') return null;
  const createdAt = isoParse(o.createdAt);
  if (!createdAt) return null;
  let completedAt: Date | null = null;
  if (typeof o.completedAt === 'string') completedAt = isoParse(o.completedAt);
  let dueDate: Date | null = null;
  if (typeof o.dueDate === 'string') dueDate = isoParse(o.dueDate);
  const order = typeof o.order === 'number' ? o.order : 0;
  return { title: o.title, createdAt, completedAt, dueDate, order };
};

export const eventAad = (accountDid: string, taskId: string, eventId: string): Uint8Array =>
  new TextEncoder().encode(`${accountDid}|${taskId}|${eventId}`);

export interface MakeEventArgs {
  op: 'upsert' | 'delete';
  accountDid: string;
  deviceId: string;
  eventId?: string;
  taskId: string;
  updatedAt: Date;
  plaintext: EventPlaintext | null;
  encryptionKey: Uint8Array;
  nonce?: Uint8Array;
}

const newEventId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
};

export const makeEvent = async (args: MakeEventArgs): Promise<SyncEvent> => {
  const eventId = args.eventId ?? newEventId();
  let pt: Uint8Array;
  if (args.op === 'delete') {
    pt = new TextEncoder().encode('{}');
  } else if (args.plaintext) {
    pt = encodePlaintext(args.plaintext);
  } else {
    pt = new TextEncoder().encode('{}');
  }
  const aad = eventAad(args.accountDid, args.taskId, eventId);
  const sealed = await boxSeal(pt, args.encryptionKey, aad, args.nonce);
  return {
    accountDid: args.accountDid,
    deviceId: args.deviceId,
    eventId,
    taskId: args.taskId,
    updatedAt: isoFormat(args.updatedAt),
    op: args.op,
    ciphertext: b64urlEncode(sealed.ciphertext),
    nonce: b64urlEncode(sealed.nonce),
  };
};

// Returns null for delete events (and on decode failure of an upsert plaintext). Throws on AEAD failure.
export const openEvent = async (event: SyncEvent, encryptionKey: Uint8Array): Promise<EventPlaintext | null> => {
  const ct = b64urlDecode(event.ciphertext);
  const nonce = b64urlDecode(event.nonce);
  const aad = eventAad(event.accountDid, event.taskId, event.eventId);
  const pt = await boxOpen(ct, nonce, encryptionKey, aad);
  if (event.op === 'delete') return null;
  return decodePlaintext(pt);
};
