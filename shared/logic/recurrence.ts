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
  /**
   * Inclusive last day ('YYYY-MM-DD') the series generates occurrences. Absent/null = open-ended.
   * Inclusive because the app compares bare day strings everywhere; a split writes
   * `until = occurrence - 1 day`, so the two halves touch without overlapping.
   */
  until?: string | null;
  /** Days ('YYYY-MM-DD') excluded from the series — detached or deleted occurrences. */
  exdates?: readonly string[] | null;
};

/** `_instance: true` marks a generated occurrence, as opposed to the stored row's own date. */
export type Expanded<T> = T & { _instance: boolean };

/**
 * Expand `events` into every occurrence falling within [rangeStart, rangeEnd] inclusive.
 *
 * - `weekly` — 7-day steps from the stored date across the range.
 * - `daily`  — every day from the stored date across the range.
 * - anything else — the stored date, if it lands inside the range.
 *
 * A series never generates occurrences before its own `date` (the anchor is its first
 * occurrence), after its `until`, or on a day listed in `exdates`. The anchor floor is what
 * makes splitting a series safe: the tail row of a split would otherwise back-expand across
 * the head row's window and every view would show the occurrence twice.
 */
export function expandEvents<T extends RecurringEvent>(
  events: T[],
  rangeStart: Date,
  rangeEnd: Date,
): Expanded<T>[] {
  const out: Expanded<T>[] = [];
  for (const ev of events) {
    const base = parseISO(ev.date);
    const until = ev.until ?? null; // 'YYYY-MM-DD' compares correctly as a string
    const ex = ev.exdates && ev.exdates.length ? new Set(ev.exdates) : null;
    /** Emit one occurrence; false means the cap is passed and the walk should stop. */
    const emit = (d: Date): boolean => {
      const day = iso(d);
      if (until !== null && day > until) return false;
      if (!ex?.has(day)) out.push({ ...ev, _instance: day !== ev.date, date: day });
      return true; // an exdate skips a single day, it does not end the series
    };
    if (ev.recurrence === 'weekly') {
      let d = new Date(base);
      while (d > rangeStart) d = addDays(d, -7);
      while (d < base) d = addDays(d, 7);
      while (d <= rangeEnd) {
        if (d >= rangeStart && !emit(d)) break;
        d = addDays(d, 7);
      }
    } else if (ev.recurrence === 'daily') {
      let d = rangeStart < base ? new Date(base) : new Date(rangeStart);
      while (d <= rangeEnd) {
        if (!emit(d)) break;
        d = addDays(d, 1);
      }
    } else {
      if (base >= rangeStart && base <= rangeEnd) out.push({ ...ev, _instance: false });
    }
  }
  return out;
}
