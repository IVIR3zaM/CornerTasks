export interface TaskItem {
  id: string;
  title: string;
  createdAt: Date;
  completedAt: Date | null;
  dueDate: Date | null;
  order: number;
}

export const isDone = (t: TaskItem): boolean => t.completedAt !== null;
