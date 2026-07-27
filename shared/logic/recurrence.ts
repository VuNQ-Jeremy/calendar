import { iso, parseISO, addDays } from './dates';

/**
 * Expansion of recurring events into concrete dated instances, shared by web and mobile.
 *
 * Three consumers must agree on when a recurring class actually happens: the web calendar,
 * the mobile agenda (phase 4), and the class-reminder cron (phase 6). If they disagree, users
 * get notified for classes that aren't running. Hence one implementation, here.
 *
 * No React, no DOM, no server types.
 */

/** The minimum shape expandEvents needs. Callers keep their own richer row type. */
export type RecurringEvent = {
  date: string;
  recurrence: string;
};

/** `_instance: true` marks a generated occurrence, as opposed to the stored row's own date. */
export type Expanded<T> = T & { _instance: boolean };

/**
 * Expand `events` into every occurrence falling within [rangeStart, rangeEnd] inclusive.
 *
 * - `weekly` — walks back from the stored date in 7-day steps until before the range, then
 *   forward across it.
 * - `daily`  — every day in the range.
 * - anything else — the stored date, if it lands inside the range.
 */
export function expandEvents<T extends RecurringEvent>(
  events: T[],
  rangeStart: Date,
  rangeEnd: Date,
): Expanded<T>[] {
  const out: Expanded<T>[] = [];
  for (const ev of events) {
    const base = parseISO(ev.date);
    if (ev.recurrence === 'weekly') {
      let d = new Date(base);
      while (d > rangeStart) d = addDays(d, -7);
      while (d <= rangeEnd) {
        if (d >= rangeStart) out.push({ ...ev, _instance: iso(d) !== ev.date, date: iso(d) });
        d = addDays(d, 7);
      }
    } else if (ev.recurrence === 'daily') {
      let d = new Date(rangeStart);
      while (d <= rangeEnd) {
        out.push({ ...ev, _instance: iso(d) !== ev.date, date: iso(d) });
        d = addDays(d, 1);
      }
    } else {
      if (base >= rangeStart && base <= rangeEnd) out.push({ ...ev, _instance: false });
    }
  }
  return out;
}
