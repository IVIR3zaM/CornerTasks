// Cloud sync is OFF by default and there is NO `backendURL` baked into the build.
// This mirrors the standalone-first contract documented in AGENTS.md.
// Later iterations (9, 10, 11, 12) will let the user enable sync and provide their
// own `ApiUrl`. Until then, these helpers exist only to make the default explicit.
const KEY_CLOUD_SYNC = 'cornertasks.cloudSyncEnabled';
const KEY_BACKEND_URL = 'cornertasks.backendURL';
const KEY_SYNC_INTERVAL = 'cornertasks.sync.intervalSeconds';
const KEY_PENDING_FULL_RESYNC = 'cornertasks.sync.pendingFullResync';

export const SYNC_INTERVAL_MIN_SECONDS = 10;
export const SYNC_INTERVAL_MAX_SECONDS = 24 * 60 * 60;
export const SYNC_INTERVAL_DEFAULT_SECONDS = 60;

const clampInterval = (v: number): number =>
  Math.max(SYNC_INTERVAL_MIN_SECONDS, Math.min(SYNC_INTERVAL_MAX_SECONDS, Math.floor(v)));

export const Prefs = {
  cloudSyncEnabled(): boolean {
    return localStorage.getItem(KEY_CLOUD_SYNC) === 'true';
  },
  setCloudSyncEnabled(v: boolean): void {
    localStorage.setItem(KEY_CLOUD_SYNC, v ? 'true' : 'false');
  },
  backendURL(): string | null {
    return localStorage.getItem(KEY_BACKEND_URL);
  },
  setBackendURL(url: string | null): void {
    if (url === null) localStorage.removeItem(KEY_BACKEND_URL);
    else localStorage.setItem(KEY_BACKEND_URL, url);
  },
  syncIntervalSeconds(): number {
    const raw = localStorage.getItem(KEY_SYNC_INTERVAL);
    const n = raw === null ? SYNC_INTERVAL_DEFAULT_SECONDS : Number(raw);
    if (!Number.isFinite(n)) return SYNC_INTERVAL_DEFAULT_SECONDS;
    return clampInterval(n);
  },
  setSyncIntervalSeconds(seconds: number): void {
    localStorage.setItem(KEY_SYNC_INTERVAL, String(clampInterval(seconds)));
  },
  pendingFullResync(): boolean {
    return localStorage.getItem(KEY_PENDING_FULL_RESYNC) === 'true';
  },
  setPendingFullResync(v: boolean): void {
    if (v) localStorage.setItem(KEY_PENDING_FULL_RESYNC, 'true');
    else localStorage.removeItem(KEY_PENDING_FULL_RESYNC);
  },
};
