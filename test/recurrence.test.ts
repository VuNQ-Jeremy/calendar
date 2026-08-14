import { describe, it, expect } from 'vitest';
import { expandEvents } from '../src/calendar/index.jsx';
import type { EventRow } from '../server/services/events.js';

// 2026-01-05 is a Monday
const RANGE_START = new Date(2026, 0, 5);
const RANGE_END = new Date(2026, 1, 1);

const BASE_EVENT: Omit<EventRow, 'date' | 'recurrence'> = {
  id: 'ev-1',
  title: 'Weekly Math',
  color: 'blue',
  start: '09:00',
  end: '10:00',
  classId: 'cls-1',
  location: null,
  notes: null,
  until: null,
  exdates: [],
};

describe('expandEvents() — weekly recurrence', () => {
  it('expands a weekly event to every Monday within a 4-week window', () => {
    const events: EventRow[] = [{ ...BASE_EVENT, date: '2026-01-05', recurrence: 'weekly' }];
    const result = expandEvents(events, RANGE_START, RANGE_END);

    const dates = result.map((e) => e.date).sort();
    expect(dates).toEqual(['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26']);
  });

  it('produces no instances outside the range', () => {
    const events: EventRow[] = [{ ...BASE_EVENT, date: '2026-01-05', recurrence: 'weekly' }];
    const result = expandEvents(events, RANGE_START, RANGE_END);

    for (const ev of result) {
      const d = new Date(ev.date);
      expect(d >= RANGE_START).toBe(true);
      expect(d <= RANGE_END).toBe(true);
    }
  });

  it('preserves title, color, and times on instances', () => {
    const events: EventRow[] = [{ ...BASE_EVENT, date: '2026-01-05', recurrence: 'weekly' }];
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
    const events: EventRow[] = [{ ...BASE_EVENT, date: '2026-01-05', recurrence: 'weekly' }];
    const result = expandEvents(events, RANGE_START, RANGE_END);

    const original = result.find((e) => e.date === '2026-01-05')!;
    const instance = result.find((e) => e.date === '2026-01-12')!;

    expect(original._instance).toBe(false);
    expect(instance._instance).toBe(true);
  });
});

describe('expandEvents() — no recurrence', () => {
  it('yields exactly one instance when event date is within range', () => {
    const events: EventRow[] = [{ ...BASE_EVENT, date: '2026-01-10', recurrence: 'none' }];
    const result = expandEvents(events, RANGE_START, RANGE_END);

    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-01-10');
  });

  it('yields no instances when event date is outside range', () => {
    const events: EventRow[] = [{ ...BASE_EVENT, date: '2026-02-05', recurrence: 'none' }];
    const result = expandEvents(events, RANGE_START, RANGE_END);

    expect(result).toHaveLength(0);
  });
});

describe('expandEvents() — daily recurrence', () => {
  const dayStart = new Date(2026, 0, 5);
  const dayEnd = new Date(2026, 0, 7);

  it('fills every day in the range', () => {
    const events: EventRow[] = [{ ...BASE_EVENT, date: '2026-01-01', recurrence: 'daily' }];
    const result = expandEvents(events, dayStart, dayEnd);

    const dates = result.map((e) => e.date).sort();
    expect(dates).toEqual(['2026-01-05', '2026-01-06', '2026-01-07']);
  });

  it('does not start before its own anchor', () => {
    const events: EventRow[] = [{ ...BASE_EVENT, date: '2026-01-06', recurrence: 'daily' }];
    const result = expandEvents(events, dayStart, dayEnd);

    expect(result.map((e) => e.date)).toEqual(['2026-01-06', '2026-01-07']);
  });

  it('honors until and exdates', () => {
    const events: EventRow[] = [
      { ...BASE_EVENT, date: '2026-01-01', recurrence: 'daily', until: '2026-01-06' },
      {
        ...BASE_EVENT,
        id: 'ev-2',
        date: '2026-01-01',
        recurrence: 'daily',
        exdates: ['2026-01-06'],
      },
    ];
    const result = expandEvents(events, dayStart, dayEnd);

    expect(result.filter((e) => e.id === 'ev-1').map((e) => e.date)).toEqual([
      '2026-01-05',
      '2026-01-06',
    ]);
    expect(result.filter((e) => e.id === 'ev-2').map((e) => e.date)).toEqual([
      '2026-01-05',
      '2026-01-07',
    ]);
  });
});

// A split series is one row capped with `until` plus a second row anchored at the boundary; a
// detached occurrence is a hole in `exdates` plus a standalone row. Expansion is what makes
// those two shapes render as one continuous, non-overlapping timeline.
describe('expandEvents() — series bounds and holes', () => {
  it('stops at until, inclusively', () => {
    const events: EventRow[] = [
      { ...BASE_EVENT, date: '2026-01-05', recurrence: 'weekly', until: '2026-01-19' },
    ];
    const result = expandEvents(events, RANGE_START, RANGE_END);

    expect(result.map((e) => e.date)).toEqual(['2026-01-05', '2026-01-12', '2026-01-19']);
  });

  it('yields nothing when until precedes the range', () => {
    const events: EventRow[] = [
      { ...BASE_EVENT, date: '2025-12-01', recurrence: 'weekly', until: '2025-12-29' },
    ];
    expect(expandEvents(events, RANGE_START, RANGE_END)).toHaveLength(0);
  });

  it('skips an exdate but keeps generating after it', () => {
    const events: EventRow[] = [
      { ...BASE_EVENT, date: '2026-01-05', recurrence: 'weekly', exdates: ['2026-01-12'] },
    ];
    const result = expandEvents(events, RANGE_START, RANGE_END);

    expect(result.map((e) => e.date)).toEqual(['2026-01-05', '2026-01-19', '2026-01-26']);
  });

  it('never generates occurrences before the anchor', () => {
    // Without the anchor floor, a split's tail row would back-expand across the head row's
    // window and every occurrence in the past would render twice.
    const events: EventRow[] = [{ ...BASE_EVENT, date: '2026-01-19', recurrence: 'weekly' }];
    const result = expandEvents(events, RANGE_START, RANGE_END);

    expect(result.map((e) => e.date)).toEqual(['2026-01-19', '2026-01-26']);
  });

  it('renders a split series as one unbroken, non-overlapping timeline', () => {
    const head: EventRow = {
      ...BASE_EVENT,
      date: '2026-01-05',
      recurrence: 'weekly',
      until: '2026-01-11',
    };
    const tail: EventRow = {
      ...BASE_EVENT,
      id: 'ev-2',
      title: 'Weekly Math (moved)',
      date: '2026-01-13',
      recurrence: 'weekly',
    };
    const result = expandEvents([head, tail], RANGE_START, RANGE_END);

    expect(result.map((e) => `${e.date} ${e.title}`)).toEqual([
      '2026-01-05 Weekly Math',
      '2026-01-13 Weekly Math (moved)',
      '2026-01-20 Weekly Math (moved)',
      '2026-01-27 Weekly Math (moved)',
    ]);
  });
});
