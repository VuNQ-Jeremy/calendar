import { describe, it, expect } from 'vitest';
import {
  normalizeText,
  gradeAnswer,
  autoGradeAttempt,
  normalizeScore,
  ictDateOf,
  isWindowOpen,
  composeUtcFromIct,
  splitIctFromUtc,
  type AnswerValue,
} from '../shared/logic/tests';

describe('normalizeText()', () => {
  it('strips Vietnamese diacritics, case and trailing space', () => {
    expect(normalizeText('Hà Nội ')).toBe('ha noi');
  });

  it('folds đ/Đ, which NFD does not decompose', () => {
    expect(normalizeText('ĐÚNG')).toBe('dung');
    expect(normalizeText('đường')).toBe('duong');
  });

  it('collapses inner whitespace', () => {
    expect(normalizeText('  a   b ')).toBe('a b');
  });

  it('lowercases plain ASCII', () => {
    expect(normalizeText('PhOtOsYnThEsIs')).toBe('photosynthesis');
  });
});

describe('gradeAnswer() — mcq', () => {
  const q = { type: 'mcq' as const, answerKey: 'b' };

  it('marks the keyed option correct', () => {
    expect(gradeAnswer(q, 'b')).toBe(true);
  });

  it('marks another option wrong', () => {
    expect(gradeAnswer(q, 'a')).toBe(false);
  });

  it('marks a blank answer wrong, not ungradable', () => {
    expect(gradeAnswer(q, null)).toBe(false);
  });

  it('reports a missing answer key as not auto-gradable', () => {
    expect(gradeAnswer({ type: 'mcq', answerKey: null }, 'a')).toBe(null);
  });
});

describe('gradeAnswer() — multi', () => {
  const q = { type: 'multi' as const, answerKey: ['a', 'c'] };

  it('accepts the exact set', () => {
    expect(gradeAnswer(q, ['a', 'c'])).toBe(true);
  });

  it('ignores order', () => {
    expect(gradeAnswer(q, ['c', 'a'])).toBe(true);
  });

  it('is all-or-nothing: a subset fails', () => {
    expect(gradeAnswer(q, ['a'])).toBe(false);
  });

  it('rejects a superset', () => {
    expect(gradeAnswer(q, ['a', 'b', 'c'])).toBe(false);
  });

  it('rejects an empty selection and a string answer', () => {
    expect(gradeAnswer(q, [])).toBe(false);
    expect(gradeAnswer(q, 'a')).toBe(false);
  });
});

describe('gradeAnswer() — text', () => {
  const q = { type: 'text' as const, answerKey: ['Hà Nội', 'Thủ đô Hà Nội'] };

  it('accepts any listed answer, diacritics and case aside', () => {
    expect(gradeAnswer(q, 'ha noi')).toBe(true);
    expect(gradeAnswer(q, 'HÀ NỘI')).toBe(true);
    expect(gradeAnswer(q, '  thu do ha noi ')).toBe(true);
  });

  it('rejects a different answer', () => {
    expect(gradeAnswer(q, 'Sài Gòn')).toBe(false);
    expect(gradeAnswer(q, '')).toBe(false);
  });

  it('reports an empty accepted-answer list as not auto-gradable', () => {
    expect(gradeAnswer({ type: 'text', answerKey: [] }, 'ha noi')).toBe(null);
  });
});

describe('gradeAnswer() — essay', () => {
  it('always needs a human', () => {
    expect(gradeAnswer({ type: 'essay', answerKey: null }, 'A long answer.')).toBe(null);
  });
});

describe('autoGradeAttempt()', () => {
  const items = [
    { questionId: 'q1', type: 'mcq' as const, answerKey: 'b', points: 2 },
    { questionId: 'q2', type: 'text' as const, answerKey: ['Hà Nội'], points: 3 },
    { questionId: 'q3', type: 'essay' as const, answerKey: null, points: 5 },
  ];

  const answers = new Map<string, AnswerValue>([
    ['q1', 'b'],
    ['q2', 'ha noi'],
    ['q3', 'Because the river floods.'],
  ]);

  const result = autoGradeAttempt(items, answers);

  it('sums the auto-gradable points earned', () => {
    expect(result.autoScore).toBe(5);
  });

  it('excludes the essay from maxAutoPoints but not from maxTotalPoints', () => {
    expect(result.maxAutoPoints).toBe(5);
    expect(result.maxTotalPoints).toBe(10);
  });

  it('flags that a human is still needed', () => {
    expect(result.hasEssay).toBe(true);
  });

  it('reports each question', () => {
    expect(result.perQuestion.get('q1')).toEqual({ correct: true, autoPoints: 2 });
    expect(result.perQuestion.get('q2')).toEqual({ correct: true, autoPoints: 3 });
    expect(result.perQuestion.get('q3')).toEqual({ correct: null, autoPoints: null });
  });

  it('scores a wrong answer at zero without shrinking the denominator', () => {
    const wrong = autoGradeAttempt(items, new Map<string, AnswerValue>([['q1', 'a']]));
    expect(wrong.autoScore).toBe(0);
    expect(wrong.maxAutoPoints).toBe(5);
    expect(wrong.perQuestion.get('q2')).toEqual({ correct: false, autoPoints: 0 });
  });

  it('has no essay when every question is auto-gradable', () => {
    expect(autoGradeAttempt(items.slice(0, 2), answers).hasEssay).toBe(false);
  });
});

describe('normalizeScore()', () => {
  it('scales onto 0-10', () => {
    expect(normalizeScore(7.5, 10)).toBe(7.5);
    expect(normalizeScore(2, 3)).toBe(6.67);
  });

  it('returns 0 for a test worth no points', () => {
    expect(normalizeScore(0, 0)).toBe(0);
    expect(normalizeScore(5, 0)).toBe(0);
  });

  it('clamps into range', () => {
    expect(normalizeScore(15, 10)).toBe(10);
    expect(normalizeScore(-3, 10)).toBe(0);
  });
});

describe('isWindowOpen()', () => {
  const open = '2026-08-01T01:00:00.000Z';
  const close = '2026-08-01T03:00:00.000Z';

  it('is upcoming before the window', () => {
    expect(isWindowOpen(open, close, new Date('2026-08-01T00:59:00.000Z'))).toBe('upcoming');
  });

  it('is open inside the window', () => {
    expect(isWindowOpen(open, close, new Date('2026-08-01T02:00:00.000Z'))).toBe('open');
  });

  it('is closed at and after closeAt', () => {
    expect(isWindowOpen(open, close, new Date('2026-08-01T03:00:00.000Z'))).toBe('closed');
    expect(isWindowOpen(open, close, new Date('2026-08-02T00:00:00.000Z'))).toBe('closed');
  });

  it('treats a null openAt as already open', () => {
    expect(isWindowOpen(null, close, new Date('2026-07-01T00:00:00.000Z'))).toBe('open');
  });

  it('treats a null closeAt as never closing', () => {
    expect(isWindowOpen(open, null, new Date('2030-01-01T00:00:00.000Z'))).toBe('open');
  });

  it('is always open with no window at all', () => {
    expect(isWindowOpen(null, null, new Date('2026-08-01T02:00:00.000Z'))).toBe('open');
  });
});

describe('ICT <-> UTC', () => {
  it('round-trips a mid-morning slot', () => {
    const utc = composeUtcFromIct('2026-08-01', '08:30');
    expect(utc).toBe('2026-08-01T01:30:00.000Z');
    expect(splitIctFromUtc(utc)).toEqual({ date: '2026-08-01', time: '08:30' });
  });

  it('rolls the date back: 01:00 ICT is 18:00 UTC the previous day', () => {
    const utc = composeUtcFromIct('2026-08-01', '01:00');
    expect(utc).toBe('2026-07-31T18:00:00.000Z');
    expect(splitIctFromUtc(utc)).toEqual({ date: '2026-08-01', time: '01:00' });
  });

  it('reports the ICT calendar day of an instant that falls on the previous UTC day', () => {
    expect(ictDateOf('2026-07-31T18:00:00.000Z')).toBe('2026-08-01');
    expect(ictDateOf('2026-07-31T16:59:00.000Z')).toBe('2026-07-31');
  });
});
