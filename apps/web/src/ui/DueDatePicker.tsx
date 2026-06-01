import { useEffect, useRef, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import { DueColor, DueStatus } from '../models/DueStatus';
import { CalendarIcon, CalendarPlusIcon } from './icons';

interface Props {
  due: Date | null;
  status: DueStatus;
  onSet: (date: Date | null) => void;
}

const startOfToday = (): Date => {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate(), 0, 0, 0, 0);
};

const startOfDay = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);

export function DueDatePicker({ due, status, onSet }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);

  const color = due ? DueColor[status] : 'var(--muted)';

  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: PointerEvent): void => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDocPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (d: Date | null): void => {
    onSet(d);
    setOpen(false);
  };

  return (
    <span className="due-picker" ref={rootRef}>
      <button
        type="button"
        className="icon-btn calendar-btn"
        style={{ color }}
        onClick={() => setOpen((v) => !v)}
        aria-label={due ? 'Change due date' : 'Set due date'}
        aria-expanded={open}
      >
        {due ? <CalendarIcon /> : <CalendarPlusIcon />}
      </button>
      {open && (
        <div className="due-popover" role="dialog">
          <DayPicker
            mode="single"
            selected={due ?? undefined}
            onSelect={(d) => d && pick(startOfDay(d))}
            showOutsideDays
            weekStartsOn={1}
          />
          <div className="due-popover-actions">
            <button
              type="button"
              className="btn-text danger"
              onClick={() => pick(null)}
              disabled={!due}
            >
              Clear
            </button>
            <button
              type="button"
              className="btn-text"
              onClick={() => pick(startOfToday())}
            >
              Today
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
