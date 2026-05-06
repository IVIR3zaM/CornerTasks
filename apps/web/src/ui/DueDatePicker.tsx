import { useEffect, useRef, useState } from 'react';
import { DueColor, DueStatus } from '../models/DueStatus';
import { CalendarIcon, CalendarPlusIcon } from './icons';

interface Props {
  due: Date | null;
  status: DueStatus;
  onSet: (date: Date | null) => void;
}

const toInputValue = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const fromInputValue = (s: string): Date | null => {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0);
};

export function DueDatePicker({ due, status, onSet }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string>(due ? toInputValue(due) : toInputValue(new Date()));
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const color = due ? DueColor[status] : 'var(--muted)';

  const onOpen = (): void => {
    setDraft(due ? toInputValue(due) : toInputValue(new Date()));
    setOpen(true);
  };

  const onSave = (): void => {
    const d = fromInputValue(draft);
    onSet(d);
    setOpen(false);
  };

  const onClear = (): void => {
    onSet(null);
    setOpen(false);
  };

  return (
    <div className="due-picker" ref={wrapRef}>
      <button
        type="button"
        className="icon-btn calendar-btn"
        style={{ color }}
        onClick={onOpen}
        aria-label={due ? 'Change due date' : 'Set due date'}
      >
        {due ? <CalendarIcon /> : <CalendarPlusIcon />}
      </button>

      {open && (
        <div className="popover" role="dialog">
          <input
            type="date"
            className="date-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
          />
          <div className="popover-actions">
            {due && (
              <button type="button" className="btn-text danger" onClick={onClear}>
                Clear
              </button>
            )}
            <span className="spacer" />
            <button type="button" className="btn-text" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={onSave}>
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
