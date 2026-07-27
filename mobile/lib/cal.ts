import { addDays, addMin, iso, parseISO, startOfWeek, toMin } from '@mochi/shared/logic/dates';
import { expandEvents, type Expanded } from '@mochi/shared/logic/recurrence';
import type { EventRow } from './types';

/**
 * Calendar-and-register vocabulary shared by the staff screens.
 *
 * The date maths and recurrence expansion are NOT reimplemented here — they come from
 * `@mochi/shared/logic`, the exact modules the web calendar and the phase-6 reminder cron use.
 * If the phone and the web disagreed about which days a weekly class falls on, every other
 * screen in this phase would be untrustworthy.
 */

export { addDays, addMin, iso, parseISO, startOfWeek, toMin, expandEvents };

export type ExpandedEvent = Expanded<EventRow>;

/** Local midnight today. Recomputed per call — a long-lived app crosses midnight. */
export function todayDate(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * `09:00` -> `9am`, `13:30` -> `1:30pm`. Ported verbatim from `src/calendar/utils.ts` so an
 * event reads identically on both clients.
 */
export function fmtTime(t: string, full = false): string {
  const parts = t.split(':').map(Number);
  let h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  if (full) return `${h}:${String(m).padStart(2, '0')} ${ap}`;
  return m ? `${h}:${String(m).padStart(2, '0')}${ap}` : `${h}${ap}`;
}

/** Chronological within a day. Untimed events sort first, as they do on the web. */
export function byStart<T extends { start?: string | null }>(a: T, b: T): number {
  return toMin(a.start ?? '00:00') - toMin(b.start ?? '00:00');
}

/** Events falling on one day, expanded and sorted. */
export function eventsOn(events: EventRow[], day: Date): ExpandedEvent[] {
  const dk = iso(day);
  return expandEvents(events, day, day)
    .filter((e) => e.date === dk)
    .sort(byStart);
}

/**
 * The four attendance statuses, in the order the register shows them.
 *
 * Mirrors `ATTENDANCE_STATUSES` / `ATTENDANCE_META` in `src/lib/assess.ts`. Duplicated rather
 * than imported because that module reaches into `server/` types, which must not enter the
 * mobile graph — the DATA contract it encodes is `AttendanceStatus` in shared/schemas.ts, and
 * that is imported.
 */
export const ATTENDANCE_STATUSES = ['present', 'late', 'absent', 'excused'] as const;
export type AttendanceStatusId = (typeof ATTENDANCE_STATUSES)[number];

/** `tk` is an i18n key; `color` is a ColorId understood by the theme's category palette. */
export const ATTENDANCE_META: Record<AttendanceStatusId, { tk: string; color: string }> = {
  present: { tk: 'att_present', color: 'green' },
  late: { tk: 'att_late', color: 'orange' },
  absent: { tk: 'att_absent', color: 'rose' },
  excused: { tk: 'att_excused', color: 'blue' },
};

export const RECURRENCES = ['none', 'daily', 'weekly'] as const;

export const RECURRENCE_TK: Record<string, string> = {
  none: 'ev_repeat_none',
  daily: 'ev_repeat_daily',
  weekly: 'ev_repeat_weekly',
};
