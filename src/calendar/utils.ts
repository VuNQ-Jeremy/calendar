import { iso, addDays } from '../lib/core.js';
import type { EventRow } from '../../server/services/events.js';

export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const HOURS = Array.from({ length: 14 }, (_, i) => i + 7); // 7am .. 8pm
export const HR_H = 56;

export const parseISO = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const toMin = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

export const fmtTime = (t: string): string => {
  let [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return m ? `${h}:${String(m).padStart(2, '0')}${ap}` : `${h}${ap}`;
};

export const addMin = (t: string, delta: number): string => {
  let total = toMin(t) + delta;
  total = Math.max(0, Math.min(24 * 60 - 1, total));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

export const startOfWeek = (d: Date): Date => {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
};

export type ExpandedEvent = EventRow & { _instance: boolean };

export function expandEvents(
  events: EventRow[],
  rangeStart: Date,
  rangeEnd: Date,
): ExpandedEvent[] {
  const out: ExpandedEvent[] = [];
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
