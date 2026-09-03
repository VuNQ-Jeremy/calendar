import { describe, it, expect } from 'vitest';
import {
  applyUnexcusedMiss,
  clearPending,
  dayIsComplete,
  defaultWeekdaysFromEvents,
  EMPTY_WARNING,
  excusedQuota,
  isPracticeDay,
  monthSummary,
  nextPracticeDay,
  parseQuickAddLines,
  parseWeekdays,
  practiceDaysInRange,
  undoMiss,
} from '../shared/logic/practice';

/**
 * The practice rules came from a real teacher's sheet and several are counter-intuitive on
 * purpose: an EXCUSED miss still spoils the "clean month" credit, and the escalation level never
 * resets by itself. These tests pin each rule so a future "fix" cannot quietly soften them.
 */
describe('practice — days', () => {
  const settings = { enabled: true, weekdays: '1,3,5,6' }; // Mon Wed Fri Sat

  it('parses and honours the weekday mask', () => {
    expect([...parseWeekdays('1,3,5,6')]).toEqual([1, 3, 5, 6]);
    expect(isPracticeDay(settings, [], '2031-03-03')).toBe(true); // Monday
    expect(isPracticeDay(settings, [], '2031-03-04')).toBe(false); // Tuesday
    expect(isPracticeDay(settings, [], '2031-03-09')).toBe(false); // Sunday
  });

  it('an override beats the mask in both directions', () => {
    expect(isPracticeDay(settings, [{ date: '2031-03-03', isPractice: false }], '2031-03-03')).toBe(
      false,
    );
    expect(isPracticeDay(settings, [{ date: '2031-03-04', isPractice: true }], '2031-03-04')).toBe(
      true,
    );
  });

  it('a disabled class has no practice days', () => {
    expect(isPracticeDay({ enabled: false, weekdays: '1,2,3,4,5,6' }, [], '2031-03-03')).toBe(
      false,
    );
  });

  it('lists and finds the next practice day', () => {
    expect(practiceDaysInRange(settings, [], '2031-03-03', '2031-03-09')).toEqual([
      '2031-03-03',
      '2031-03-05',
      '2031-03-07',
      '2031-03-08',
    ]);
    expect(nextPracticeDay(settings, [], '2031-03-03')).toBe('2031-03-05');
    expect(nextPracticeDay({ enabled: true, weekdays: '' }, [], '2031-03-03')).toBe(null);
  });

  it('defaults to Mon–Sat minus the class weekdays, Sunday never', () => {
    // Class meets Tue + Thu (weekly from a Tuesday).
    const events = [
      { date: '2031-03-04', recurrence: 'weekly' },
      { date: '2031-03-06', recurrence: 'weekly' },
    ];
    expect(defaultWeekdaysFromEvents(events, '2031-03-03')).toBe('1,3,5,6');
    expect(defaultWeekdaysFromEvents([], '2031-03-03')).toBe('1,2,3,4,5,6');
  });
});

describe('practice — quota', () => {
  it('is 3, plus 1 carried only after a month with zero misses of any kind', () => {
    expect(excusedQuota('2031-04', [], true)).toBe(4);
    expect(excusedQuota('2031-04', [], false)).toBe(3); // no practice days last month → nothing to carry
    expect(excusedQuota('2031-04', [{ date: '2031-03-10', excused: true }], true)).toBe(3); // excused still spoils it
    expect(excusedQuota('2031-04', [{ date: '2031-03-10', excused: false }], true)).toBe(3);
    expect(excusedQuota('2031-04', [{ date: '2031-02-10', excused: false }], true)).toBe(4); // two months back is irrelevant
  });
});

describe('practice — escalation', () => {
  it('first miss owes ×2, second ×3, and clearing the day keeps the level', () => {
    const w1 = applyUnexcusedMiss(EMPTY_WARNING, 'm1', '2031-03-05');
    expect(w1).toEqual({
      level: 1,
      pendingMultiplier: 2,
      pendingForDate: '2031-03-05',
      pendingFromMiss: 'm1',
    });
    const cleared = clearPending(w1);
    expect(cleared.level).toBe(1);
    expect(cleared.pendingMultiplier).toBe(0);
    const w2 = applyUnexcusedMiss(cleared, 'm2', '2031-03-12');
    expect(w2.pendingMultiplier).toBe(3);
  });

  it('missing the ×N day itself escalates again', () => {
    const w1 = applyUnexcusedMiss(EMPTY_WARNING, 'm1', '2031-03-05');
    const w2 = applyUnexcusedMiss(w1, 'm2', '2031-03-07');
    expect(w2).toEqual({
      level: 2,
      pendingMultiplier: 3,
      pendingForDate: '2031-03-07',
      pendingFromMiss: 'm2',
    });
  });

  it('excusing a miss after the fact undoes its step and its pending debt', () => {
    const w1 = applyUnexcusedMiss(EMPTY_WARNING, 'm1', '2031-03-05');
    expect(undoMiss(w1, 'm1')).toEqual(EMPTY_WARNING);
    const w2 = applyUnexcusedMiss(w1, 'm2', '2031-03-07');
    // Excusing the OLDER miss lowers the level but leaves the newer debt in place.
    expect(undoMiss(w2, 'm1')).toEqual({
      level: 1,
      pendingMultiplier: 3,
      pendingForDate: '2031-03-07',
      pendingFromMiss: 'm2',
    });
  });
});

describe('practice — completion and summary', () => {
  const tasks = [
    { date: '2031-03-03', status: 'accepted' },
    { date: '2031-03-03', status: 'submitted' },
    { date: '2031-03-05', status: 'open' },
    { date: '2031-03-05', status: 'teacher_done' },
  ];
  it('a day is complete only when every copy is done', () => {
    expect(dayIsComplete(tasks, '2031-03-03')).toBe(true);
    expect(dayIsComplete(tasks, '2031-03-05')).toBe(false);
    // No tasks → not complete (the caller decides it is not a miss either).
    expect(dayIsComplete(tasks, '2031-03-06')).toBe(false);
  });
  it('summarises a month', () => {
    const s = monthSummary(
      '2031-03',
      tasks,
      [{ date: '2031-03-05', excused: false }],
      EMPTY_WARNING,
      false,
    );
    expect(s).toMatchObject({
      doneTasks: 3,
      totalTasks: 4,
      excusedUsed: 0,
      excusedQuota: 3,
      unexcused: 1,
    });
  });
  it('quick add strips bullets and numbering', () => {
    expect(
      parseQuickAddLines('1. Workbook p.4-7\n- Grammar in Use unit 4\n\n• Quizlet unit 11'),
    ).toEqual(['Workbook p.4-7', 'Grammar in Use unit 4', 'Quizlet unit 11']);
  });
});
