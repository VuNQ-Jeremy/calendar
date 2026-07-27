/**
 * Local-time date helpers, shared by web and mobile.
 *
 * Everything here works in the device's LOCAL timezone deliberately — the app stores dates as
 * bare `YYYY-MM-DD` strings with no zone, and a school day is a local-calendar concept. Using
 * UTC here would shift dates for the Vietnamese user base (UTC+7) every evening.
 *
 * No React, no DOM.
 */

/** `Date` -> `YYYY-MM-DD`, in local time. */
export function iso(d: Date | string | number): string {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

/** `YYYY-MM-DD` -> local midnight `Date`. Avoids `new Date(str)`, which parses as UTC. */
export function parseISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** A new `Date` shifted by n days. Does not mutate the input. */
export function addDays(d: Date | string | number, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Monday-based start of the week containing `d`, at local midnight. */
export function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** `HH:MM` -> minutes since midnight. */
export function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Shift an `HH:MM` time by a number of minutes, clamped to the same day. */
export function addMin(t: string, delta: number): string {
  let total = toMin(t) + delta;
  total = Math.max(0, Math.min(24 * 60 - 1, total));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
