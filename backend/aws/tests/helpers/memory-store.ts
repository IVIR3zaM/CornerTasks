import type { AuthChallenge, Store, StoredEvent } from '../../src/lib/db';

const ARCHIVE_CUTOFF_MS = 60 * 24 * 60 * 60 * 1000;

export function memoryStore(): Store & {
  events: Map<string, StoredEvent>;
  challenges: Map<string, AuthChallenge>;
} {
  const events = new Map<string, StoredEvent>();
  const challenges = new Map<string, AuthChallenge>();

  const eventKey = (accountDid: string, taskId: string) => `${accountDid}::${taskId}`;
  const chalKey = (accountDid: string, challenge: string) => `${accountDid}::${challenge}`;

  return {
    events,
    challenges,
    async putEvent(ev) {
      const k = eventKey(ev.accountDid, ev.taskId);
      const cur = events.get(k);
      if (cur) {
        if (cur.updatedAt > ev.updatedAt) return { accepted: false };
        if (cur.updatedAt === ev.updatedAt && cur.eventId >= ev.eventId) return { accepted: false };
      }
      events.set(k, { ...ev });
      return { accepted: true };
    },
    async queryEventsSince(accountDid, sinceMs) {
      const cutoff = Date.now() - ARCHIVE_CUTOFF_MS;
      const out: StoredEvent[] = [];
      for (const ev of events.values()) {
        if (ev.accountDid !== accountDid) continue;
        if (Date.parse(ev.updatedAt) < sinceMs) continue;
        if (ev.archivedCompletedAt && Date.parse(ev.archivedCompletedAt) < cutoff) continue;
        out.push(ev);
      }
      out.sort((a, b) => {
        if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? -1 : 1;
        return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
      });
      return out;
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
