import { useState } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TaskItem } from '../models/TaskItem';
import { TaskStore } from '../storage/TaskStore';
import { DueColor, DueStatus, dueStatusOf } from '../models/DueStatus';
import { DueDatePicker } from './DueDatePicker';
import { PencilIcon, HandleIcon, CalendarIcon } from './icons';

interface Props {
  tasks: TaskItem[];
  store: TaskStore;
  onChanged: () => void;
}

const fmtDate = (d: Date): string =>
  d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

const dueLabel = (status: DueStatus, due: Date): string => {
  const date = fmtDate(due);
  switch (status) {
    case 'overdue': return `Overdue · ${date}`;
    case 'today': return `Today · ${date}`;
    case 'tomorrow': return `Tomorrow · ${date}`;
    default: return `Due · ${date}`;
  }
};

export function TaskList({ tasks, store, onChanged }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = async (e: DragEndEvent): Promise<void> => {
    if (!e.over || e.active.id === e.over.id) return;
    const oldIdx = tasks.findIndex((t) => t.id === e.active.id);
    const newIdx = tasks.findIndex((t) => t.id === e.over!.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(tasks, oldIdx, newIdx);
    await store.moveActive(next.map((t) => t.id));
    onChanged();
  };

  if (tasks.length === 0) {
    return <div className="empty">Nothing on your head. Nice.</div>;
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="list">
          {tasks.map((t) => (
            <SortableRow key={t.id} task={t} store={store} onChanged={onChanged} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({
  task,
  store,
  onChanged,
}: {
  task: TaskItem;
  store: TaskStore;
  onChanged: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);

  const status = dueStatusOf(task.dueDate);
  const color = DueColor[status];

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const onComplete = async (): Promise<void> => {
    await store.complete(task.id);
    onChanged();
  };

  const onSave = async (): Promise<void> => {
    setEditing(false);
    if (draft.trim() && draft !== task.title) {
      await store.updateTitle(task.id, draft);
      onChanged();
    } else {
      setDraft(task.title);
    }
  };

  const onSetDue = async (d: Date | null): Promise<void> => {
    await store.setDueDate(task.id, d);
    onChanged();
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`task task-${status}${isDragging ? ' dragging' : ''}`}
    >
      <div className="task-main">
        <button className="check" onClick={onComplete} aria-label="Complete" />

        {editing ? (
          <input
            autoFocus
            className="title-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={onSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onSave();
              if (e.key === 'Escape') {
                setDraft(task.title);
                setEditing(false);
              }
            }}
          />
        ) : (
          <span
            className="title"
            onDoubleClick={() => setEditing(true)}
            title={task.title}
          >
            {task.title}
          </span>
        )}

        <button
          className="icon-btn"
          onClick={() => {
            setDraft(task.title);
            setEditing(true);
          }}
          aria-label="Edit task"
          title="Edit task"
        >
          <PencilIcon />
        </button>

        <DueDatePicker due={task.dueDate} status={status} onSet={onSetDue} />

        <span className="handle" {...attributes} {...listeners} aria-label="Drag to reorder">
          <HandleIcon />
        </span>
      </div>

      <div className="task-meta">
        <span className="meta-chip">
          <CalendarIcon size={12} />
          <span>{fmtDate(task.createdAt)}</span>
        </span>
        {task.dueDate && (
          <span
            className="due-badge"
            style={{ background: `${color}33`, color }}
          >
            {dueLabel(status, task.dueDate)}
          </span>
        )}
      </div>
      <div className="task-debug-row">
        <span className="debug-id" title="Task ID (debug)">{task.id.toLowerCase()}</span>
      </div>
    </div>
  );
}
