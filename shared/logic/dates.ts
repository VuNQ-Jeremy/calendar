/**
 * Local-time date helpers, shared by web and mobile.
 *
 * Everything here works in the device's LOCAL timezone deliberately — the app stores dates as
 * bare `YYYY-MM-DD` strings with no zone, and a school day is a local-calendar concept. Using
 * UTC here would shift dates for the Vietnamese user base (UTC+7) every evening.
 *
 * No React, no DOM.
 */

/**
 * 'YYYY-MM-DD' -> '04/05/2026'. What the paper receipts write, and unambiguous in Vietnam.
 *
 * Pure string surgery, so it is safe on the bare ICT day strings the garden compares — it never
 * constructs a `Date` and therefore cannot shift a day. Lives here rather than in ./tuition (where
 * it started) so both clients can reach it: ./tuition type-imports from `server/`.
 */
export function formatDmy(date: string): string {
  const [y, m, d] = date.split('-');
  return d && m && y ? `${d}/${m}/${y}` : date;
}

/**
 * `09:00` -> `9am`, `13:30` -> `1:30pm`; `full` gives the uniform `9:00 am` the time-picker lists
 * use, the compact form the calendar pills use.
 *
 * The single definition for both clients — `src/calendar/utils.ts` and `mobile/lib/cal.ts` now
 * re-export this rather than each keeping a copy, so an event and a deadline read identically
 * wherever they are printed.
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

/**
 * A deadline as it is printed: '04/05/2026', or '04/05/2026 6:00 pm' once a time is set.
 *
 * A null/absent time means the whole day is still the deadline, which is exactly what the bare
 * date already says — so it prints nothing extra rather than inventing a midnight.
 */
export function formatDmyTime(date: string, time?: string | null): string {
  return time ? `${formatDmy(date)} ${fmtTime(time, true)}` : formatDmy(date);
}

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

/**
 * A stored `createdAt` -> "4 thg 8, 15:54". The day is localised, the clock is not: a
 * hand-built 24-hour time is identical in the browser and in Hermes on Android, where Intl's
 * time formatting is not, and a stamp that reads differently on the two clients is a stamp
 * you cannot compare.
 *
 * Rows written before the server stamped a clock hold a bare 'YYYY-MM-DD'. Those get the day
 * alone — inventing a time for them would be a lie, and `parseISO` keeps them on the right
 * calendar day, where `new Date` would read them as UTC midnight and shift them a day west
 * of Greenwich.
 */
export function fmtStamp(value: string, localeStr: string): string {
  const dateOnly = value.length === 10;
  const d = dateOnly ? parseISO(value) : new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const day = d.toLocaleDateString(localeStr, { month: 'short', day: 'numeric' });
  if (dateOnly) return day;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${day}, ${hh}:${mm}`;
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
