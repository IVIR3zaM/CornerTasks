import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { TaskStore } from '../src/storage/TaskStore';

let dbCounter = 0;

beforeEach(() => {
  // Fresh in-memory IndexedDB per test.
  globalThis.indexedDB = new IDBFactory();
  dbCounter += 1;
});

const newStore = (): Promise<TaskStore> => TaskStore.open(`test-${dbCounter}`);

describe('TaskStore', () => {
  it('add() creates a task with monotonically increasing order', async () => {
    const store = await newStore();
    const a = await store.add('first');
    const b = await store.add('second');
    expect(a?.order).toBe(0);
    expect(b?.order).toBe(1);
    const active = await store.activeTasks();
    expect(active.map((t) => t.title)).toEqual(['first', 'second']);
  });

  it('add() ignores blank titles', async () => {
    const store = await newStore();
    expect(await store.add('   ')).toBeNull();
    expect(await store.add('')).toBeNull();
    expect((await store.activeTasks()).length).toBe(0);
  });

  it('complete() moves a task to archive', async () => {
    const store = await newStore();
    const t = await store.add('do it');
    await store.complete(t!.id);
    expect((await store.activeTasks()).length).toBe(0);
    const archived = await store.archivedTasks();
    expect(archived.length).toBe(1);
    expect(archived[0].completedAt).toBeInstanceOf(Date);
  });

  it('updateTitle() trims and rejects blanks', async () => {
    const store = await newStore();
    const t = await store.add('orig');
    await store.updateTitle(t!.id, '  new title  ');
    expect((await store.activeTasks())[0].title).toBe('new title');
    await store.updateTitle(t!.id, '   ');
    expect((await store.activeTasks())[0].title).toBe('new title');
  });

  it('setDueDate() sets and clears the due date', async () => {
    const store = await newStore();
    const t = await store.add('with date');
    const due = new Date('2026-12-01');
    await store.setDueDate(t!.id, due);
    expect((await store.activeTasks())[0].dueDate?.getTime()).toBe(due.getTime());
    await store.setDueDate(t!.id, null);
    expect((await store.activeTasks())[0].dueDate).toBeNull();
  });

  it('deleteArchived() removes a completed task', async () => {
    const store = await newStore();
    const t = await store.add('temp');
    await store.complete(t!.id);
    await store.deleteArchived(t!.id);
    expect((await store.archivedTasks()).length).toBe(0);
  });

  it('moveActive() reorders by id list', async () => {
    const store = await newStore();
    const a = await store.add('a');
    const b = await store.add('b');
    const c = await store.add('c');
    await store.moveActive([c!.id, a!.id, b!.id]);
    const titles = (await store.activeTasks()).map((t) => t.title);
    expect(titles).toEqual(['c', 'a', 'b']);
  });

  it('persists across reopen (same db name)', async () => {
    const s1 = await TaskStore.open('persist-db');
    await s1.add('keep me');
    s1.close();
    const s2 = await TaskStore.open('persist-db');
    const active = await s2.activeTasks();
    expect(active.map((t) => t.title)).toEqual(['keep me']);
  });
});
