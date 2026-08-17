import { describe, it, expect } from 'vitest';
import {
  ATTENDANCE_META,
  ATTENDANCE_STATUSES,
  byStart,
  eventsOn,
  todayDate,
  type ExpandedEvent,
} from '../lib/cal';
import type { EventRow } from '../lib/types';

/**
 * `lib/cal.ts` — the calendar vocabulary the staff screens share.
 *
 * The date maths is NOT reimplemented here; it comes from `@mochi/shared/logic`, the same modules
 * the web calendar and the reminder cron use, and those have their own tests at the repo root.
 * What is worth testing is this file's own contribution: that a weekly class expands onto the
 * right day, that untimed events sort first, and that the attendance vocabulary stays in step
 * with `src/lib/assess.ts` on the web — it is duplicated there rather than imported, so nothing
 * but a test connects the two.
 */

const event = (over: Partial<EventRow> = {}): EventRow =>
  ({
    id: 'e1',
    title: 'Biology 9A',
    date: '2026-01-05', // a Monday
    start: '09:00',
    end: '10:00',
    recurrence: 'none',
    ...over,
  }) as EventRow;

const titlesOn = (events: EventRow[], day: string) =>
  eventsOn(events, new Date(`${day}T00:00:00`)).map((e: ExpandedEvent) => e.title);

describe('eventsOn', () => {
  it('returns a one-off event on its own day and no other', () => {
    const events = [event()];
    expect(titlesOn(events, '2026-01-05')).toEqual(['Biology 9A']);
    expect(titlesOn(events, '2026-01-06')).toEqual([]);
  });

  it('expands a weekly class onto the same weekday, weeks later', () => {
    const events = [event({ recurrence: 'weekly' })];
    expect(titlesOn(events, '2026-01-12')).toEqual(['Biology 9A']); // +1 week
    expect(titlesOn(events, '2026-02-02')).toEqual(['Biology 9A']); // +4 weeks
    expect(titlesOn(events, '2026-01-13')).toEqual([]); // a Tuesday
  });

  it('stops a weekly series after its until date', () => {
    const events = [event({ recurrence: 'weekly', until: '2026-01-12' })];
    expect(titlesOn(events, '2026-01-12')).toEqual(['Biology 9A']);
    expect(titlesOn(events, '2026-01-19')).toEqual([]);
  });

  it('skips a cancelled occurrence without ending the series', () => {
    const events = [event({ recurrence: 'weekly', exdates: ['2026-01-12'] })];
    expect(titlesOn(events, '2026-01-12')).toEqual([]);
    expect(titlesOn(events, '2026-01-19')).toEqual(['Biology 9A']);
  });

  it('sorts a day chronologically, with untimed events first', () => {
    const events = [
      event({ id: 'c', title: 'Late', start: '15:00' }),
      event({ id: 'a', title: 'Untimed', start: null }),
      event({ id: 'b', title: 'Early', start: '08:00' }),
    ];
    expect(titlesOn(events, '2026-01-05')).toEqual(['Untimed', 'Early', 'Late']);
  });
});

describe('byStart', () => {
  it('treats a missing start as midnight', () => {
    expect(byStart({ start: null }, { start: '00:01' })).toBeLessThan(0);
    expect(byStart({ start: '10:00' }, { start: '09:59' })).toBeGreaterThan(0);
    expect(byStart({ start: '10:00' }, { start: '10:00' })).toBe(0);
  });
});

describe('todayDate', () => {
  it('is local midnight, so day comparisons do not drift across a timezone', () => {
    const d = todayDate();
    expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([
      0, 0, 0, 0,
    ]);
  });
});

describe('the attendance vocabulary', () => {
  it('lists the four statuses in the order the register shows them', () => {
    expect(ATTENDANCE_STATUSES).toEqual(['present', 'late', 'absent', 'excused']);
  });

  it('gives every status a label key and a colour', () => {
    for (const status of ATTENDANCE_STATUSES) {
      expect(ATTENDANCE_META[status]).toMatchObject({
        tk: expect.stringMatching(/^att_/),
        color: expect.any(String),
      });
    }
  });
});
