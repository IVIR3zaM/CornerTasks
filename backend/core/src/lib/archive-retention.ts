// Leaf module: no other imports, so it is safe to import from both db.ts and
// dynamo-store.ts without creating an evaluation-order cycle. Pulling these
// constants out of db.ts is what keeps `Date.now() - ARCHIVE_RETENTION_MS`
// from collapsing to NaN inside the Lambda cold-start.

export const ARCHIVE_RETENTION_DAYS = 60;
export const ARCHIVE_RETENTION_MS = ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
