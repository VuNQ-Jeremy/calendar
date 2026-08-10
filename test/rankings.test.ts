import { describe, it, expect } from 'vitest';
import {
  attendanceComponent,
  behaviorComponent,
  remarkComponent,
  combineTotal,
  computeMonthRankings,
  cohortKeyOf,
  groupByCohort,
  computeClassRankings,
  DEFAULT_RANKING_WEIGHTS,
  type RankRowInput,
} from '../shared/logic/rankings.js';

const W = DEFAULT_RANKING_WEIGHTS;

/** A student with nothing recorded; spread over it to set just the field under test. */
function row(studentId: string, over: Partial<RankRowInput> = {}): RankRowInput {
  return {
    studentId,
    attendanceStatuses: [],
    behaviorTypes: [],
    scores: [],
    remarkRatings: null,
    ...over,
  };
}

describe('attendanceComponent()', () => {
  it('scores present=1, late=0.5, absent=0', () => {
    // (1 + 1 + 0.5 + 0) / 4 * 10 = 6.25 → 6.3
    expect(attendanceComponent(['present', 'present', 'late', 'absent'])).toBe(6.3);
  });

  it('leaves excused out of the denominator', () => {
    expect(attendanceComponent(['present', 'excused'])).toBe(10);
  });

  it('is null when every row is excused', () => {
    expect(attendanceComponent(['excused', 'excused'])).toBeNull();
  });

  it('is null with no rows at all', () => {
    expect(attendanceComponent([])).toBeNull();
  });
});

describe('behaviorComponent()', () => {
  it('is null when nothing was recorded', () => {
    expect(behaviorComponent([])).toBeNull();
  });

  it('caps praise at 10', () => {
    expect(behaviorComponent(['praise'])).toBe(10);
  });

  it('subtracts one per negative record', () => {
    expect(behaviorComponent(['late', 'disruptive'])).toBe(8);
  });

  it('nets praise against negatives', () => {
    expect(behaviorComponent(['missing_homework', 'praise'])).toBe(9.5);
  });

  it('floors at zero', () => {
    expect(behaviorComponent(Array(12).fill('absent'))).toBe(0);
  });

  it('ignores unrecognised types', () => {
    expect(behaviorComponent(['not_a_real_type'])).toBe(10);
  });
});

describe('remarkComponent()', () => {
  it('is null without a remark', () => {
    expect(remarkComponent(null)).toBeNull();
  });

  it('is null when the remark has no ratings', () => {
    expect(remarkComponent({})).toBeNull();
  });

  it('doubles the 1-5 mean onto the 0-10 scale', () => {
    expect(remarkComponent({ rc_attitude: 4, rc_homework: 5 })).toBe(9);
  });
});

describe('combineTotal()', () => {
  it('weights the two criteria', () => {
    // 8 * 40% + 6 * 60% = 3.2 + 3.6 = 6.8
    expect(combineTotal(8, 6, W)).toBe(6.8);
  });

  it('falls back to the test average when there is no attitude data', () => {
    expect(combineTotal(null, 7, W)).toBe(7);
  });

  it('falls back to attitude when no tests were sat', () => {
    expect(combineTotal(7, null, W)).toBe(7);
  });

  it('is null when the student has no data at all', () => {
    expect(combineTotal(null, null, W)).toBeNull();
  });

  it('ships with weights that add up to 100', () => {
    expect(W.attitude + W.score).toBe(100);
  });
});

describe('computeMonthRankings()', () => {
  it('excludes missing components from the attitude mean instead of zeroing them', () => {
    // Only a remark exists: 5/5 stars → 10. Averaging in two absent components would give 3.3.
    const [s] = computeMonthRankings([row('s1', { remarkRatings: { rc_attitude: 5 } })], W);
    expect(s.attitude).toBe(10);
    expect(s.attendance).toBeNull();
    expect(s.behavior).toBeNull();
  });

  it('averages the month’s test scores', () => {
    const [s] = computeMonthRankings([row('s1', { scores: [7, 8] })], W);
    expect(s.avgScore).toBe(7.5);
    expect(s.testCount).toBe(2);
  });

  it('gives tied totals the same rank and skips the next one (1, 2, 2, 4)', () => {
    const ranked = computeMonthRankings(
      [
        row('a', { scores: [9] }),
        row('b', { scores: [8] }),
        row('c', { scores: [8] }),
        row('d', { scores: [7] }),
      ],
      W,
    );
    expect(ranked.map((s) => s.rank)).toEqual([1, 2, 2, 4]);
    // ties keep the caller's (name) ordering
    expect(ranked.map((s) => s.studentId)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('ranks a student who only sat tests, and leaves the empty one unranked at the bottom', () => {
    const ranked = computeMonthRankings([row('empty'), row('tested', { scores: [6] })], W);
    expect(ranked[0].studentId).toBe('tested');
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].studentId).toBe('empty');
    expect(ranked[1].rank).toBeNull();
    expect(ranked[1].total).toBeNull();
  });

  it('combines all three attitude components with the test average', () => {
    const [s] = computeMonthRankings(
      [
        row('s1', {
          attendanceStatuses: ['present', 'present'], // 10
          behaviorTypes: ['late'], // 9
          remarkRatings: { rc_attitude: 4 }, // 8
          scores: [5],
        }),
      ],
      W,
    );
    expect(s.attitude).toBe(9); // (10 + 9 + 8) / 3
    expect(s.avgScore).toBe(5);
    expect(s.total).toBe(6.6); // 9 * 0.4 + 5 * 0.6
  });

  it('respects custom weights', () => {
    const [s] = computeMonthRankings(
      [row('s1', { attendanceStatuses: ['present'], scores: [5] })],
      { attitude: 100, score: 0 },
    );
    expect(s.total).toBe(10);
  });
});

describe('cohortKeyOf()', () => {
  it('keys on both halves', () => {
    expect(cohortKeyOf({ id: 'c1', gradeLevelId: 'gl6', classLevelId: 'cl1' })).toBe('gl6::cl1');
  });

  it('is null when either half is missing', () => {
    expect(cohortKeyOf({ id: 'c1', gradeLevelId: 'gl6', classLevelId: null })).toBeNull();
    expect(cohortKeyOf({ id: 'c1', gradeLevelId: null, classLevelId: 'cl1' })).toBeNull();
    expect(cohortKeyOf({ id: 'c1', gradeLevelId: null, classLevelId: null })).toBeNull();
  });
});

describe('groupByCohort()', () => {
  const cls = (id: string, g: string | null, l: string | null) => ({
    id,
    gradeLevelId: g,
    classLevelId: l,
  });

  it('buckets classes sharing a grade and a level', () => {
    const map = groupByCohort([
      cls('a', 'gl6', 'cl1'),
      cls('b', 'gl6', 'cl2'),
      cls('c', 'gl6', 'cl1'),
    ]);
    expect([...map.keys()]).toEqual(['gl6::cl1', 'gl6::cl2']);
    expect(map.get('gl6::cl1')!.map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('drops classes that cannot compete', () => {
    const map = groupByCohort([
      cls('a', 'gl6', null),
      cls('b', null, null),
      cls('c', 'gl6', 'cl1'),
    ]);
    expect([...map.keys()]).toEqual(['gl6::cl1']);
    expect(map.get('gl6::cl1')!.map((c) => c.id)).toEqual(['c']);
  });
});

describe('computeClassRankings()', () => {
  it('averages only the students who have data', () => {
    const [c] = computeClassRankings([{ classId: 'a', totals: [8, null, 9] }]);
    expect(c.average).toBe(8.5);
    expect(c.rankedCount).toBe(2);
  });

  it('leaves a class with no ranked students unranked, listed last', () => {
    const out = computeClassRankings([
      { classId: 'empty', totals: [] },
      { classId: 'blank', totals: [null, null] },
      { classId: 'real', totals: [7] },
    ]);
    expect(out.map((c) => c.classId)).toEqual(['real', 'empty', 'blank']);
    expect(out[0].rank).toBe(1);
    expect(out[1].average).toBeNull();
    expect(out[1].rank).toBeNull();
    expect(out[2].rank).toBeNull();
  });

  it('shares a rank between classes with the same average, competition style', () => {
    // a and b both average 8.5; c is behind, so it takes rank 3 rather than 2.
    const out = computeClassRankings([
      { classId: 'a', totals: [8, 9] },
      { classId: 'b', totals: [9, 8] },
      { classId: 'c', totals: [7] },
    ]);
    expect(out.map((c) => [c.classId, c.rank])).toEqual([
      ['a', 1],
      ['b', 1],
      ['c', 3],
    ]);
  });

  it('compares the rounded averages the user sees', () => {
    // 8.25 → 8.3 and 8.3 display identically, so they must share a rank.
    const out = computeClassRankings([
      { classId: 'a', totals: [8.2, 8.3] },
      { classId: 'b', totals: [8.3] },
    ]);
    expect(out.map((c) => c.average)).toEqual([8.3, 8.3]);
    expect(out.map((c) => c.rank)).toEqual([1, 1]);
  });

  it('keeps the caller order on ties', () => {
    const out = computeClassRankings([
      { classId: 'zebra', totals: [8] },
      { classId: 'alpha', totals: [8] },
    ]);
    expect(out.map((c) => c.classId)).toEqual(['zebra', 'alpha']);
  });
});
