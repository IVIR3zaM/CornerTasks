import { useEffect, useState } from 'react';
import { TaskStore } from '../storage/TaskStore';
import { TaskItem } from '../models/TaskItem';
import { TaskList } from './TaskList';
import { ArchiveList } from './ArchiveList';
import { SettingsPanel } from './SettingsPanel';
import { GearIcon, CloseIcon, PlusIcon } from './icons';

type Tab = 'tasks' | 'archive';

export function App() {
  const [store, setStore] = useState<TaskStore | null>(null);
  const [tab, setTab] = useState<Tab>('tasks');
  const [showSettings, setShowSettings] = useState(false);
  const [active, setActive] = useState<TaskItem[]>([]);
  const [archived, setArchived] = useState<TaskItem[]>([]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    let cancelled = false;
    TaskStore.open().then((s) => {
      if (!cancelled) setStore(s);
    });
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
    if (store) void refresh(store);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

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
    </div>
  );
}
