import { describe, it, expect } from 'vitest';
import { dueStatusOf } from '../src/models/DueStatus';

describe('dueStatusOf', () => {
  const now = new Date('2026-05-06T12:00:00');

  it('returns none when no due date', () => {
    expect(dueStatusOf(null, now)).toBe('none');
    expect(dueStatusOf(undefined, now)).toBe('none');
  });

  it('returns today for the same calendar day', () => {
    expect(dueStatusOf(new Date('2026-05-06T08:00:00'), now)).toBe('today');
    expect(dueStatusOf(new Date('2026-05-06T23:59:00'), now)).toBe('today');
  });

  it('returns tomorrow for the next day', () => {
    expect(dueStatusOf(new Date('2026-05-07T00:01:00'), now)).toBe('tomorrow');
  });

  it('returns overdue for past dates', () => {
    expect(dueStatusOf(new Date('2026-05-05T23:59:00'), now)).toBe('overdue');
    expect(dueStatusOf(new Date('2025-12-01'), now)).toBe('overdue');
  });

  it('returns future for further-out dates', () => {
    expect(dueStatusOf(new Date('2026-05-08T08:00:00'), now)).toBe('future');
    expect(dueStatusOf(new Date('2027-01-01'), now)).toBe('future');
  });
});
