import { describe, it, expect } from 'vitest';
import {
  weekStart,
  bucketBehaviorByWeek,
  bucketBehaviorByWeekInMonth,
  monthWeekStarts,
  scoreColorId,
  scoreStats,
  scoreStatsByClass,
} from '../src/lib/assess.js';
import type { BehaviorRow, ScoreRow } from '../server/services/assessments.js';

function beh(date: string, type: string): BehaviorRow {
  return { id: `${date}-${type}`, studentId: 's1', classId: null, date, type, notes: null };
}

function score(date: string, value: number): ScoreRow {
  return {
    id: date,
    studentId: 's1',
    classId: null,
    date,
    score: value,
    assessmentTypeId: null,
    notes: null,
  };
}

describe('weekStart()', () => {
  it('maps a Wednesday to its Monday', () => {
    // 2026-06-24 is a Wednesday
    expect(weekStart('2026-06-24')).toBe('2026-06-22');
  });

  it('maps a Monday to itself', () => {
    expect(weekStart('2026-06-22')).toBe('2026-06-22');
  });

  it('maps a Sunday to the previous Monday', () => {
    // 2026-06-28 is a Sunday, belongs to the week starting 2026-06-22
    expect(weekStart('2026-06-28')).toBe('2026-06-22');
  });

  it('handles a month boundary', () => {
    // 2026-06-01 is a Monday
    expect(weekStart('2026-06-02')).toBe('2026-06-01');
  });

  it('handles a year boundary', () => {
    // 2026-01-01 is a Thursday, week starts 2025-12-29
    expect(weekStart('2026-01-01')).toBe('2025-12-29');
  });
});

describe('bucketBehaviorByWeek()', () => {
  it('returns exactly N buckets ending at the current week', () => {
    const buckets = bucketBehaviorByWeek([], 4, '2026-06-24');
    expect(buckets.length).toBe(4);
    expect(buckets[buckets.length - 1].key).toBe('2026-06-22');
  });

  it('counts land in the right bucket and empty weeks show zero', () => {
    const records = [beh('2026-06-23', 'late'), beh('2026-06-23', 'absent')];
    const buckets = bucketBehaviorByWeek(records, 2, '2026-06-24');
    expect(buckets[0].total).toBe(0);
    expect(buckets[1].total).toBe(2);
    expect(buckets[1].counts.late).toBe(1);
    expect(buckets[1].counts.absent).toBe(1);
  });

  it('excludes praise from the counts', () => {
    const records = [beh('2026-06-23', 'praise')];
    const buckets = bucketBehaviorByWeek(records, 1, '2026-06-24');
    expect(buckets[0].total).toBe(0);
  });

  it('ignores records outside the window', () => {
    const records = [beh('2025-01-01', 'late')];
    const buckets = bucketBehaviorByWeek(records, 2, '2026-06-24');
    expect(buckets.every((b) => b.total === 0)).toBe(true);
  });
});

describe('scoreStats()', () => {
  it('returns all nulls for no records', () => {
    expect(scoreStats([])).toEqual({ average: null, latest: null, delta: null });
  });

  it('single score: average equals latest, delta is null', () => {
    const stats = scoreStats([score('2026-05-01', 7)]);
    expect(stats.average).toBe(7);
    expect(stats.latest).toBe(7);
    expect(stats.delta).toBeNull();
  });

  it('computes delta as avg(last 3) - avg(prev 3) for 6+ scores', () => {
    const records = [
      score('2026-01-01', 5),
      score('2026-02-01', 5),
      score('2026-03-01', 5),
      score('2026-04-01', 8),
      score('2026-05-01', 8),
      score('2026-06-01', 8),
    ];
    const stats = scoreStats(records);
    expect(stats.average).toBe(6.5);
    expect(stats.latest).toBe(8);
    expect(stats.delta).toBe(3);
  });
});

describe('scoreColorId()', () => {
  it('is red below 5', () => {
    expect(scoreColorId(0)).toBe('rose');
    expect(scoreColorId(4.9)).toBe('rose');
  });

  it('is orange from 5 up to 7', () => {
    expect(scoreColorId(5)).toBe('orange');
    expect(scoreColorId(6.9)).toBe('orange');
  });

  it('is green from 7 up', () => {
    expect(scoreColorId(7)).toBe('green');
    expect(scoreColorId(10)).toBe('green');
  });
});

describe('monthWeekStarts()', () => {
  it('covers a month that starts mid-week, including the overlapping week before it', () => {
    // Aug 1 2026 is a Saturday, so the first bucket is the Monday of the week it falls in.
    const keys = monthWeekStarts('2026-08');
    expect(keys[0]).toBe('2026-07-27');
    expect(keys[keys.length - 1]).toBe('2026-08-31');
    expect(keys).toHaveLength(6);
  });

  it('gives exactly four weeks for a 28-day month that starts on a Monday', () => {
    // Feb 2027: Feb 1 is a Monday and there are 28 days, so the weeks line up exactly.
    expect(monthWeekStarts('2027-02')).toEqual([
      '2027-02-01',
      '2027-02-08',
      '2027-02-15',
      '2027-02-22',
    ]);
  });

  it('starts on the 1st when the 1st is a Monday', () => {
    expect(monthWeekStarts('2026-06')[0]).toBe('2026-06-01');
  });
});

describe('bucketBehaviorByWeekInMonth()', () => {
  it('keeps the overlapping week but counts only that month’s days', () => {
    const rows = [
      beh('2026-07-31', 'late'), // same week as the 2026-07-27 bucket, but July
      beh('2026-08-01', 'late'), // August, and lands in that same bucket
    ];
    const buckets = bucketBehaviorByWeekInMonth(rows, '2026-08');
    expect(buckets[0].key).toBe('2026-07-27');
    expect(buckets[0].counts.late).toBe(1);
    expect(buckets[0].total).toBe(1);
  });

  it('excludes praise, like the trailing-weeks bucketing does', () => {
    const buckets = bucketBehaviorByWeekInMonth([beh('2026-08-10', 'praise')], '2026-08');
    expect(buckets.reduce((a, b) => a + b.total, 0)).toBe(0);
  });

  it('returns every week of an empty month at zero', () => {
    const buckets = bucketBehaviorByWeekInMonth([], '2027-02');
    expect(buckets.map((b) => b.key)).toEqual(monthWeekStarts('2027-02'));
    expect(buckets.every((b) => b.total === 0)).toBe(true);
  });
});

describe('scoreStatsByClass', () => {
  it('groups by class, rounds to 1dp, keeps first-appearance order', () => {
    const rows = [
      { classId: 'c1', score: 7.5 },
      { classId: 'c2', score: 8 },
      { classId: 'c1', score: 8.5 },
      { classId: null, score: 5 },
    ];
    expect(scoreStatsByClass(rows)).toEqual([
      { classId: 'c1', average: 8, count: 2 },
      { classId: 'c2', average: 8, count: 1 },
      { classId: null, average: 5, count: 1 },
    ]);
  });

  it('returns [] for no records', () => {
    expect(scoreStatsByClass([])).toEqual([]);
  });
});
