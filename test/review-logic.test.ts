import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REVIEW_SETTINGS,
  REVIEW_LADDER_LENGTH,
  applyAnswer,
  foldAnswers,
  groupDueByTopic,
  isDue,
  isValidLadder,
  type ReviewState,
} from '../shared/logic/review.js';

/** The default ladder: 3 → 5 → 7 → 14 → 30. */
const L = DEFAULT_REVIEW_SETTINGS.intervals;

const TODAY = '2026-08-10';

function state(level: number, dueDay: string | null): ReviewState {
  return { level, dueDay };
}

describe('isDue', () => {
  it('is true on and after the due day, false before', () => {
    expect(isDue(state(0, '2026-08-09'), TODAY)).toBe(true);
    expect(isDue(state(0, TODAY), TODAY)).toBe(true);
    expect(isDue(state(0, '2026-08-11'), TODAY)).toBe(false);
  });

  it('treats an unscheduled word as not due', () => {
    expect(isDue(state(0, null), TODAY)).toBe(false);
    expect(isDue(null, TODAY)).toBe(false);
    expect(isDue(undefined, TODAY)).toBe(false);
  });
});

describe('applyAnswer — joining the cycle', () => {
  it('schedules a first-time word at the bottom rung whether it was right or wrong', () => {
    expect(applyAnswer(null, true, L, TODAY)).toEqual({ level: 0, dueDay: '2026-08-13' });
    expect(applyAnswer(null, false, L, TODAY)).toEqual({ level: 0, dueDay: '2026-08-13' });
  });

  it('treats a row with no due day as not yet in the cycle', () => {
    expect(applyAnswer(state(3, null), true, L, TODAY)).toEqual({ level: 0, dueDay: '2026-08-13' });
  });
});

describe('applyAnswer — climbing', () => {
  it('advances one rung per correct review, stretching the gap each time', () => {
    // 3 → 5 → 7 → 14 → 30, each answered exactly on its due day.
    let s = applyAnswer(null, true, L, '2026-08-10');
    expect(s).toEqual({ level: 0, dueDay: '2026-08-13' });
    s = applyAnswer(s, true, L, '2026-08-13');
    expect(s).toEqual({ level: 1, dueDay: '2026-08-18' });
    s = applyAnswer(s, true, L, '2026-08-18');
    expect(s).toEqual({ level: 2, dueDay: '2026-08-25' });
    s = applyAnswer(s, true, L, '2026-08-25');
    expect(s).toEqual({ level: 3, dueDay: '2026-09-08' });
    s = applyAnswer(s, true, L, '2026-09-08');
    expect(s).toEqual({ level: 4, dueDay: '2026-10-08' });
  });

  it('holds at the top rung instead of graduating the word out of the cycle', () => {
    const top = state(L.length - 1, TODAY);
    expect(applyAnswer(top, true, L, TODAY)).toEqual({ level: 4, dueDay: '2026-09-09' });
  });

  it('advances an overdue word from today, not from the day it was due', () => {
    // Due three weeks ago, answered today: the next gap runs from today.
    expect(applyAnswer(state(0, '2026-07-20'), true, L, TODAY)).toEqual({
      level: 1,
      dueDay: '2026-08-15',
    });
  });
});

describe('applyAnswer — early practice', () => {
  it('leaves the schedule untouched when a not-yet-due word is answered correctly', () => {
    const early = state(2, '2026-08-20');
    expect(applyAnswer(early, true, L, TODAY)).toEqual(early);
  });

  it('still steps back when a not-yet-due word is answered wrong', () => {
    expect(applyAnswer(state(2, '2026-08-20'), false, L, TODAY)).toEqual({
      level: 1,
      dueDay: '2026-08-15',
    });
  });
});

describe('applyAnswer — slipping back', () => {
  it('drops one rung and reschedules from today', () => {
    expect(applyAnswer(state(3, TODAY), false, L, TODAY)).toEqual({
      level: 2,
      dueDay: '2026-08-17',
    });
  });

  it('floors at the bottom rung', () => {
    expect(applyAnswer(state(0, TODAY), false, L, TODAY)).toEqual({
      level: 0,
      dueDay: '2026-08-13',
    });
  });

  it('clamps a level left stranded above a shortened ladder', () => {
    const short = [1, 2, 3, 4, 5];
    expect(applyAnswer(state(9, TODAY), true, short, TODAY)).toEqual({
      level: 4,
      dueDay: '2026-08-15',
    });
  });
});

describe('applyAnswer — missed reviews', () => {
  it('leaves an unanswered word due where it was, however long it waits', () => {
    // Nothing to call: a skipped review is simply a due day in the past, so the backlog
    // survives untouched until the student actually plays.
    const overdue = state(1, '2026-06-01');
    expect(isDue(overdue, TODAY)).toBe(true);
    expect(overdue.dueDay).toBe('2026-06-01');
  });
});

describe('foldAnswers', () => {
  it('schedules every answered word off its own prior state', () => {
    const prior = new Map<string, ReviewState>([
      ['w1', state(1, '2026-08-05')], // due, correct → climbs
      ['w2', state(2, '2026-08-05')], // due, wrong → drops
    ]);
    const next = foldAnswers(
      [
        { wordId: 'w1', correct: true },
        { wordId: 'w2', correct: false },
        { wordId: 'w3', correct: true }, // never seen before
      ],
      prior,
      L,
      TODAY,
    );
    expect(next.get('w1')).toEqual({ level: 2, dueDay: '2026-08-17' });
    expect(next.get('w2')).toEqual({ level: 1, dueDay: '2026-08-15' });
    expect(next.get('w3')).toEqual({ level: 0, dueDay: '2026-08-13' });
  });

  it('counts a repeated word twice rather than keeping only the last answer', () => {
    const prior = new Map<string, ReviewState>([['w1', state(2, '2026-08-01')]]);
    const next = foldAnswers(
      [
        { wordId: 'w1', correct: true }, // due → level 3, due 2026-08-24
        { wordId: 'w1', correct: false }, // not due any more → drops to 2
      ],
      prior,
      L,
      TODAY,
    );
    expect(next.get('w1')).toEqual({ level: 2, dueDay: '2026-08-17' });
  });

  it('returns an empty map for an empty round', () => {
    expect(foldAnswers([], new Map(), L, TODAY).size).toBe(0);
  });
});

describe('groupDueByTopic', () => {
  const rows = [
    { wordId: 'a', topicId: 't1', dueDay: '2026-08-01' },
    { wordId: 'b', topicId: 't2', dueDay: TODAY },
    { wordId: 'c', topicId: 't1', dueDay: '2026-08-09' },
    { wordId: 'd', topicId: 't1', dueDay: '2026-09-01' }, // not yet due
    { wordId: 'e', topicId: 't3', dueDay: null }, // unscheduled
  ];

  it('keeps only due words, grouped by topic, biggest backlog first', () => {
    const groups = groupDueByTopic(rows, TODAY);
    expect(groups.map((g) => g.topicId)).toEqual(['t1', 't2']);
    expect(groups[0].words.map((w) => w.wordId)).toEqual(['a', 'c']);
    expect(groups[1].words.map((w) => w.wordId)).toEqual(['b']);
  });

  it('breaks ties on topic id so the card does not reshuffle between renders', () => {
    const tied = [
      { topicId: 'zebra', dueDay: TODAY },
      { topicId: 'apple', dueDay: TODAY },
    ];
    expect(groupDueByTopic(tied, TODAY).map((g) => g.topicId)).toEqual(['apple', 'zebra']);
  });

  it('returns nothing when the student is all caught up', () => {
    expect(groupDueByTopic([{ topicId: 't1', dueDay: '2026-12-01' }], TODAY)).toEqual([]);
  });
});

describe('isValidLadder', () => {
  it('accepts the default ladder', () => {
    expect(isValidLadder(DEFAULT_REVIEW_SETTINGS.intervals)).toBe(true);
  });

  it('accepts a same-day first rung — how the cycle is demoed and tested', () => {
    expect(isValidLadder([0, 5, 7, 14, 30])).toBe(true);
  });

  it('rejects a ladder that is the wrong length', () => {
    expect(isValidLadder([3, 5, 7])).toBe(false);
    expect(isValidLadder([3, 5, 7, 14, 30, 60])).toBe(false);
    expect(DEFAULT_REVIEW_SETTINGS.intervals.length).toBe(REVIEW_LADDER_LENGTH);
  });

  it('rejects non-integers, negatives, and anything past a year', () => {
    expect(isValidLadder([3, 5, 7, 14, 3.5])).toBe(false);
    expect(isValidLadder([-1, 5, 7, 14, 30])).toBe(false);
    expect(isValidLadder([3, 5, 7, 14, 366])).toBe(false);
  });

  it('rejects a ladder that shortens as you climb', () => {
    expect(isValidLadder([3, 5, 4, 14, 30])).toBe(false);
  });

  it('rejects anything that is not an array of numbers', () => {
    expect(isValidLadder(null)).toBe(false);
    expect(isValidLadder('3,5,7,14,30')).toBe(false);
    expect(isValidLadder(['3', '5', '7', '14', '30'])).toBe(false);
  });
});
