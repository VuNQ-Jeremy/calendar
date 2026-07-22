import { describe, it, expect } from 'vitest';
import { weekStart, bucketBehaviorByWeek, scoreStats } from '../src/lib/assess.js';
import type { BehaviorRow, ScoreRow } from '../server/services/assessments.js';

function beh(date: string, type: string): BehaviorRow {
  return { id: `${date}-${type}`, studentId: 's1', classId: null, date, type, notes: null };
}

function score(date: string, value: number): ScoreRow {
  return { id: date, studentId: 's1', classId: null, date, score: value, label: null, notes: null };
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
