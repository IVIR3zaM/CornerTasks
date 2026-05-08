import { useEffect, useState } from 'react';
import { TaskStore } from '../storage/TaskStore';
import { TaskItem } from '../models/TaskItem';
import { TaskList } from './TaskList';
import { ArchiveList } from './ArchiveList';
import { SettingsPanel } from './SettingsPanel';
import { GearIcon, CloseIcon, PlusIcon } from './icons';
import { Prefs } from '../models/Prefs';
import { AccountManager } from '../crypto/AccountManager';
import { encryptionKeyBytes } from '../crypto/keys';
import { toSeed } from '../crypto/mnemonic';
import { FetchTransport } from '../sync/syncTransport';
import { ensureDeviceId, SyncEngine, CLOUD_SYNC_CHANGED_EVENT, CLOUD_SYNC_INTERVAL_CHANGED_EVENT } from '../sync/SyncEngine';
import pkg from '../../package.json';

type Tab = 'tasks' | 'archive';

export function App() {
  const [store, setStore] = useState<TaskStore | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('tasks');
  const [showSettings, setShowSettings] = useState(false);
  const [active, setActive] = useState<TaskItem[]>([]);
  const [archived, setArchived] = useState<TaskItem[]>([]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    let cancelled = false;
    TaskStore.open().then(
      (s) => { if (!cancelled) setStore(s); },
      (e) => {
        console.error('TaskStore.open failed', e);
        if (!cancelled) setOpenError(e instanceof Error ? e.message : String(e));
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = async (s: TaskStore = store!): Promise<void> => {
    if (!s) return;
    const [a, b] = await Promise.all([s.activeTasks(), s.archivedTasks()]);
    setActive(a);
    setArchived(b);
  };

  useEffect(() => {
    if (!store) return;
    void refresh(store);
    return store.subscribe(() => { void refresh(store); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  useEffect(() => {
    if (!store) return;
    let engine: SyncEngine | null = null;
    // Generation counter: every concurrent invocation of startIfEnabled gets a
    // fresh id. Async work between the awaits and the engine.start() can be
    // overtaken by a newer call (user toggles sync rapidly); the older run
    // bails out when its id no longer matches `runId`. Without this guard the
    // older run would create a second engine after we already moved on,
    // leaking a never-stopped set of timers.
    let runId = 0;

    const startIfEnabled = async (): Promise<void> => {
      const myId = ++runId;
      engine?.stop();
      engine = null;
      if (!Prefs.cloudSyncEnabled()) {
        console.info('[CornerTasks sync] cloud sync disabled; engine not started');
        return;
      }
      const apiUrl = Prefs.backendURL();
      if (!apiUrl) {
        console.warn('[CornerTasks sync] cloud sync enabled but no backend URL set');
        return;
      }
      try {
        const account = await AccountManager.open();
        if (myId !== runId) return;
        if (!account.identity || !account.mnemonic) {
          console.warn('[CornerTasks sync] no mnemonic stored; engine not started');
          return;
        }
        const transport = new FetchTransport(apiUrl);
        const seed = await toSeed(account.mnemonic);
        if (myId !== runId) return;
        const key = await encryptionKeyBytes(seed);
        if (myId !== runId) return;
        engine = new SyncEngine({
          store,
          transport,
          identity: account.identity,
          encryptionKey: key,
          deviceId: ensureDeviceId(),
          intervalMs: () => Prefs.syncIntervalSeconds() * 1000,
          pendingFullResync: () => Prefs.pendingFullResync(),
          clearPendingFullResync: () => Prefs.setPendingFullResync(false),
        });
        engine.start();
        console.info('[CornerTasks sync] engine started', {
          intervalSec: Prefs.syncIntervalSeconds(),
          pendingFullResync: Prefs.pendingFullResync(),
          backend: apiUrl,
        });
      } catch (err) {
        console.error('[CornerTasks sync] engine start failed', err);
      }
    };

    void startIfEnabled();
    const onChange = (): void => { void startIfEnabled(); };
    const onIntervalChange = (): void => { engine?.reschedule(); };
    window.addEventListener(CLOUD_SYNC_CHANGED_EVENT, onChange);
    window.addEventListener(CLOUD_SYNC_INTERVAL_CHANGED_EVENT, onIntervalChange);
    return () => {
      window.removeEventListener(CLOUD_SYNC_CHANGED_EVENT, onChange);
      window.removeEventListener(CLOUD_SYNC_INTERVAL_CHANGED_EVENT, onIntervalChange);
      engine?.stop();
    };
  }, [store]);

  if (openError) return <div className="app"><div className="empty">Could not open local storage: {openError}</div></div>;
  if (!store) return <div className="app"><div className="empty">Loading…</div></div>;

  const onAdd = async (): Promise<void> => {
    const item = await store.add(draft);
    if (item) {
      setDraft('');
      await refresh();
    }
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-titles">
          <h1>Corner Tasks</h1>
          <p className="subtitle">
            {active.length} open • {archived.length} archived
          </p>
        </div>
        <button
          className="gear"
          aria-label={showSettings ? 'Close settings' : 'Open settings'}
          onClick={() => setShowSettings((v) => !v)}
        >
          {showSettings ? <CloseIcon /> : <GearIcon />}
        </button>
      </header>

      <div className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'tasks'}
          className={`tab ${tab === 'tasks' ? 'active' : ''}`}
          onClick={() => setTab('tasks')}
          disabled={showSettings}
        >
          Tasks
        </button>
        <button
          role="tab"
          aria-selected={tab === 'archive'}
          className={`tab ${tab === 'archive' ? 'active' : ''}`}
          onClick={() => setTab('archive')}
          disabled={showSettings}
        >
          Archive
        </button>
      </div>

      {showSettings ? (
        <SettingsPanel />
      ) : tab === 'tasks' ? (
        <>
          <div className="add-row">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void onAdd();
              }}
              placeholder="Add a task…"
              aria-label="New task"
            />
            <button className="add-btn" onClick={onAdd} aria-label="Add task">
              <PlusIcon />
            </button>
          </div>
          <TaskList tasks={active} store={store} onChanged={() => refresh()} />
        </>
      ) : (
        <ArchiveList tasks={archived} store={store} onChanged={() => refresh()} />
      )}

      <footer className="version-footer">v{pkg.version}</footer>
    </div>
  );
}
