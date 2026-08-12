import { parseISO, toMin, addMin, startOfWeek, fmtTime } from '../../shared/logic/dates';
import { expandEvents, type Expanded } from '../../shared/logic/recurrence';
import type { EventRow } from '../../server/services/events.js';

/**
 * Date helpers and recurrence expansion moved to shared/logic/ so the mobile app and the
 * reminder cron use the identical implementations. Re-exported here so calendar components
 * need no changes.
 */
export { parseISO, toMin, addMin, startOfWeek, expandEvents, fmtTime };

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

// `fmtTime` moved to shared/logic/dates.ts (re-exported above) — the deadline chips in the garden
// are rendered by shared code that cannot reach into src/.
