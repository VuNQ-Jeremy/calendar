import { parseISO, toMin, addMin, startOfWeek } from '../../shared/logic/dates';
import { expandEvents, type Expanded } from '../../shared/logic/recurrence';
import type { EventRow } from '../../server/services/events.js';

/**
 * Date helpers and recurrence expansion moved to shared/logic/ so the mobile app and the
 * reminder cron use the identical implementations. Re-exported here so calendar components
 * need no changes.
 */
export { parseISO, toMin, addMin, startOfWeek, expandEvents };

export type ExpandedEvent = Expanded<EventRow>;

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

export const HOURS = Array.from({ length: 24 }, (_, i) => i); // midnight .. 11pm
export const HR_H = 56;

export const fmtTime = (t: string, full = false): string => {
  let [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  // full: uniform "h:mm am" (time-picker lists); default: compact "9am" pills
  if (full) return `${h}:${String(m).padStart(2, '0')} ${ap}`;
  return m ? `${h}:${String(m).padStart(2, '0')}${ap}` : `${h}${ap}`;
};
