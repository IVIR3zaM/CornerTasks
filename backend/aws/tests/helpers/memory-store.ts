import type { AuthChallenge, QueryEventsResult, Store, StoredEvent } from '../../src/lib/db';
import { parseCursor } from '../../src/lib/db';

const ARCHIVE_CUTOFF_MS = 60 * 24 * 60 * 60 * 1000;

export function memoryStore(): Store & {
  events: Map<string, StoredEvent>;
  challenges: Map<string, AuthChallenge>;
  counters: Map<string, number>;
} {
  const events = new Map<string, StoredEvent>();
  const challenges = new Map<string, AuthChallenge>();
  const counters = new Map<string, number>();

  const eventKey = (accountDid: string, taskId: string) => `${accountDid}::${taskId}`;
  const chalKey = (accountDid: string, challenge: string) => `${accountDid}::${challenge}`;

  function nextSeq(accountDid: string): number {
    const cur = counters.get(accountDid) ?? 0;
    const next = cur + 1;
    counters.set(accountDid, next);
    return next;
  }

  return {
    events,
    challenges,
    counters,
    async putEvent(ev) {
      const seq = nextSeq(ev.accountDid);
      const k = eventKey(ev.accountDid, ev.taskId);
      const cur = events.get(k);
      if (cur) {
        if (cur.updatedAt > ev.updatedAt) return { accepted: false };
        if (cur.updatedAt === ev.updatedAt && cur.eventId >= ev.eventId) return { accepted: false };
      }
      events.set(k, { ...ev, seq });
      return { accepted: true, seq };
    },
    async queryEventsAfter(accountDid, cursor): Promise<QueryEventsResult> {
      const cursorN = parseCursor(cursor);
      const cutoffIso = new Date(Date.now() - ARCHIVE_CUTOFF_MS).toISOString();
      const out: StoredEvent[] = [];
      for (const ev of events.values()) {
        if (ev.accountDid !== accountDid) continue;
        if (typeof ev.seq !== 'number' || ev.seq <= cursorN) continue;
        if (ev.archivedCompletedAt && ev.archivedCompletedAt < cutoffIso) continue;
        out.push(ev);
      }
      out.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
      const nextCursor = out.reduce(
        (acc, ev) => (ev.seq && ev.seq > acc ? ev.seq : acc),
        cursorN
      );
      return { events: out, nextCursor: String(nextCursor) };
    },
    async pruneExpiredArchives(accountDid) {
      const cutoff = Date.now() - ARCHIVE_CUTOFF_MS;
      let removed = 0;
      for (const [k, ev] of events) {
        if (ev.accountDid !== accountDid) continue;
        if (ev.archivedCompletedAt && Date.parse(ev.archivedCompletedAt) < cutoff) {
          events.delete(k);
          removed += 1;
        }
      }
      return removed;
    },
    async putChallenge(c) {
      challenges.set(chalKey(c.accountDid, c.challenge), { ...c });
    },
    async consumeChallenge(accountDid, challenge) {
      const k = chalKey(accountDid, challenge);
      const cur = challenges.get(k);
      if (!cur) return false;
      if (cur.expiresAt < Date.now()) {
        challenges.delete(k);
        return false;
      }
      challenges.delete(k);
      return true;
    }
  };
}
