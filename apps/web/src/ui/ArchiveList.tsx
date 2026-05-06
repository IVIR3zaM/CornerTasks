import { TaskItem } from '../models/TaskItem';
import { TaskStore } from '../storage/TaskStore';
import { DueColor, DueStatus, dueStatusOf } from '../models/DueStatus';
import { CheckCircleIcon, TrashIcon } from './icons';

interface Props {
  tasks: TaskItem[];
  store: TaskStore;
  onChanged: () => void;
}

const fmt = (d: Date): string =>
  d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const fmtDay = (d: Date): string =>
  d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

const dueLabel = (status: DueStatus, due: Date): string => {
  const date = fmtDay(due);
  switch (status) {
    case 'overdue': return `Overdue · ${date}`;
    case 'today': return `Today · ${date}`;
    case 'tomorrow': return `Tomorrow · ${date}`;
    default: return `Due · ${date}`;
  }
};

export function ArchiveList({ tasks, store, onChanged }: Props) {
  if (tasks.length === 0) {
    return <div className="empty">No completed tasks yet.</div>;
  }

  const onDelete = async (id: string): Promise<void> => {
    await store.deleteArchived(id);
    onChanged();
  };

  return (
    <div className="list">
      {tasks.map((t) => {
        const status = dueStatusOf(t.dueDate);
        const color = DueColor[status];
        return (
          <div key={t.id} className="task task-archived">
            <div className="task-main">
              <span className="check-done" aria-hidden="true">
                <CheckCircleIcon />
              </span>
              <span className="title archived">{t.title}</span>
              <button
                className="icon-btn"
                onClick={() => onDelete(t.id)}
                aria-label="Delete archived task"
                title="Delete"
              >
                <TrashIcon />
              </button>
            </div>
            <div className="task-meta archive-meta">
              <div>Added: {fmt(t.createdAt)}</div>
              <div>Done: {t.completedAt ? fmt(t.completedAt) : '—'}</div>
              {t.dueDate && (
                <div className="archive-due">
                  <span>Due:</span>
                  <span
                    className="due-badge"
                    style={{ background: `${color}33`, color }}
                  >
                    {dueLabel(status, t.dueDate)}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
