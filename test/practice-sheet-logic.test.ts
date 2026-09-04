import { describe, it, expect } from 'vitest';
import {
  buildSheet,
  lastDayOfMonth,
  monthDates,
  needsReviewCount,
} from '../shared/logic/practice-sheet';

/**
 * The sheet shows one student's month as date groups. These pin the three things a teacher
 * would notice if they broke: a day missing from the month, a blank row on a past or off day,
 * and a filter that hides the wrong rows.
 */
const copy = (id: string, date: string, status: string, taskId: string | null = 'T') => ({
  id,
  taskId,
  date,
  status,
});

describe('practice sheet — month dates', () => {
  it('knows month lengths, leap years included', () => {
    expect(lastDayOfMonth('2026-09')).toBe('2026-09-30');
    expect(lastDayOfMonth('2028-02')).toBe('2028-02-29');
    expect(lastDayOfMonth('2027-02')).toBe('2027-02-28');
    expect(monthDates('2028-02')).toHaveLength(29);
    expect(monthDates('2026-09')[0]).toBe('2026-09-01');
    expect(monthDates('2026-09').at(-1)).toBe('2026-09-30');
  });
});

describe('practice sheet — grouping', () => {
  const base = {
    month: '2026-09',
    today: '2026-09-04',
    practiceDays: ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'],
    misses: [{ id: 'm1', date: '2026-09-03', excused: false }],
    excuses: [{ id: 'e1', date: '2026-09-04', status: 'pending', reason: 'sick' }],
    copies: [
      copy('c1', '2026-09-02', 'accepted'),
      copy('c2', '2026-09-02', 'submitted'),
      copy('c3', '2026-09-02', 'open', null),
      copy('c4', '2026-09-04', 'open'),
    ],
  };

  it('emits every day of the month in order with its rows, miss and excuse attached', () => {
    const days = buildSheet({ ...base, filter: 'all' });
    expect(days).toHaveLength(30);
    expect(days[1].date).toBe('2026-09-02');
    expect(days[1].rows.map((r) => r.copy.id)).toEqual(['c1', 'c2', 'c3']);
    expect(days[1].rows.map((r) => r.scope)).toEqual(['class', 'class', 'student']);
    expect(days[2].miss?.id).toBe('m1');
    expect(days[3].excuse?.id).toBe('e1');
    expect(days[3].isToday).toBe(true);
    expect(days[5].isPractice).toBe(false); // 06/09 not in practiceDays
  });

  it('shows a blank row only on practice days from today on, and only unfiltered', () => {
    const all = buildSheet({ ...base, filter: 'all' });
    expect(all[1].showBlank).toBe(false); // 02/09 is past
    expect(all[3].showBlank).toBe(true); // today
    expect(all[4].showBlank).toBe(true); // 05/09 practice day
    expect(all[5].showBlank).toBe(false); // 06/09 day off
    expect(buildSheet({ ...base, filter: 'review' }).every((d) => !d.showBlank)).toBe(true);
  });

  it('review filter keeps only submitted rows and drops days without one', () => {
    const days = buildSheet({ ...base, filter: 'review' });
    expect(days.map((d) => d.date)).toEqual(['2026-09-02']);
    expect(days[0].rows.map((r) => r.copy.id)).toEqual(['c2']);
  });

  it('misses filter keeps only days with a miss row', () => {
    const days = buildSheet({ ...base, filter: 'misses' });
    expect(days.map((d) => d.date)).toEqual(['2026-09-03']);
    expect(days[0].rows).toEqual([]);
  });

  it('counts submitted copies for the tab badge', () => {
    expect(needsReviewCount(base.copies)).toBe(1);
  });
});
