import { describe, it, expect } from 'vitest';
import { expandEvents } from '../src/calendar.js';

// 2026-01-05 is a Monday
const MON_2026_01_05 = new Date(2026, 0, 5);
// 4-week window: Jan 5 – Feb 1
const RANGE_START = new Date(2026, 0, 5);
const RANGE_END = new Date(2026, 1, 1);

const BASE_EVENT = {
  id: 'ev-1',
  title: 'Weekly Math',
  color: 'blue',
  start: '09:00',
  end: '10:00',
  classId: 'cls-1',
};

describe('expandEvents() — weekly recurrence', () => {
  it('expands a weekly event to every Monday within a 4-week window', () => {
    const events = [{ ...BASE_EVENT, date: '2026-01-05', recurrence: 'weekly' }];
    const result = expandEvents(events, RANGE_START, RANGE_END);

    const dates = result.map((e) => e.date).sort();
    expect(dates).toEqual(['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26']);
  });

  it('produces no instances outside the range', () => {
    const events = [{ ...BASE_EVENT, date: '2026-01-05', recurrence: 'weekly' }];
    const result = expandEvents(events, RANGE_START, RANGE_END);

    for (const ev of result) {
      const d = new Date(ev.date);
      expect(d >= RANGE_START).toBe(true);
      expect(d <= RANGE_END).toBe(true);
    }
  });

  it('preserves title, color, and times on instances', () => {
    const events = [{ ...BASE_EVENT, date: '2026-01-05', recurrence: 'weekly' }];
    const result = expandEvents(events, RANGE_START, RANGE_END);

    for (const ev of result) {
      expect(ev.title).toBe('Weekly Math');
      expect(ev.color).toBe('blue');
      expect(ev.start).toBe('09:00');
      expect(ev.end).toBe('10:00');
      expect(ev.classId).toBe('cls-1');
    }
  });

  it('marks generated instances with _instance: true and the original with _instance: false', () => {
    const events = [{ ...BASE_EVENT, date: '2026-01-05', recurrence: 'weekly' }];
    const result = expandEvents(events, RANGE_START, RANGE_END);

    const original = result.find((e) => e.date === '2026-01-05');
    const instance = result.find((e) => e.date === '2026-01-12');

    expect(original._instance).toBe(false);
    expect(instance._instance).toBe(true);
  });
});

describe('expandEvents() — no recurrence', () => {
  it('yields exactly one instance when event date is within range', () => {
    const events = [{ ...BASE_EVENT, date: '2026-01-10', recurrence: 'none' }];
    const result = expandEvents(events, RANGE_START, RANGE_END);

    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-01-10');
  });

  it('yields no instances when event date is outside range', () => {
    const events = [{ ...BASE_EVENT, date: '2026-02-05', recurrence: 'none' }];
    const result = expandEvents(events, RANGE_START, RANGE_END);

    expect(result).toHaveLength(0);
  });
});

describe('expandEvents() — daily recurrence', () => {
  // small window to keep output manageable
  const dayStart = new Date(2026, 0, 5);
  const dayEnd = new Date(2026, 0, 7);

  it('fills every day in the range', () => {
    const events = [{ ...BASE_EVENT, date: '2026-01-01', recurrence: 'daily' }];
    const result = expandEvents(events, dayStart, dayEnd);

    const dates = result.map((e) => e.date).sort();
    expect(dates).toEqual(['2026-01-05', '2026-01-06', '2026-01-07']);
  });
});
