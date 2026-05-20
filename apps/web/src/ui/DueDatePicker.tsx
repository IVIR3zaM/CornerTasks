import { useRef } from 'react';
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
  const inputRef = useRef<HTMLInputElement | null>(null);

  const color = due ? DueColor[status] : 'var(--muted)';

  const openPicker = (): void => {
    const el = inputRef.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') {
      el.showPicker();
    } else {
      el.focus();
      el.click();
    }
  };

  return (
    <div className="due-picker">
      <button
        type="button"
        className="icon-btn calendar-btn"
        style={{ color }}
        onClick={openPicker}
        aria-label={due ? 'Change due date' : 'Set due date'}
      >
        {due ? <CalendarIcon /> : <CalendarPlusIcon />}
      </button>
      <input
        ref={inputRef}
        type="date"
        className="due-hidden-input"
        value={due ? toInputValue(due) : ''}
        onChange={(e) => {
          const d = fromInputValue(e.target.value);
          onSet(d);
        }}
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
}
