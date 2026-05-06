// Cloud sync is OFF by default and there is NO `backendURL` baked into the build.
// This mirrors the standalone-first contract documented in AGENTS.md.
// Later iterations (9, 10, 11, 12) will let the user enable sync and provide their
// own `ApiUrl`. Until then, these helpers exist only to make the default explicit.
const KEY_CLOUD_SYNC = 'cornertasks.cloudSyncEnabled';
const KEY_BACKEND_URL = 'cornertasks.backendURL';

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
};
