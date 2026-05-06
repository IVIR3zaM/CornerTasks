// Mirror of apps/macos/Sources/CornerTasks/Models/DueStatus.swift.
// Single source of truth for due-date coloring on the web.
export type DueStatus = 'overdue' | 'today' | 'tomorrow' | 'future' | 'none';

export const DueColor: Record<DueStatus, string> = {
  overdue: '#ff453a',
  today: '#ff9f0a',
  tomorrow: '#ffd60a',
  future: '#0a84ff',
  none: '#8e8e93',
};

const startOfDay = (d: Date): number => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
};

export function dueStatusOf(due: Date | null | undefined, now: Date = new Date()): DueStatus {
  if (!due) return 'none';
  const today = startOfDay(now);
  const dueDay = startOfDay(due);
  const days = Math.round((dueDay - today) / 86_400_000);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return 'future';
}
