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

/** What the event modal edits: a full row when editing, a seeded shell when creating. */
export type EventDraft = Partial<EventRow> & { recurrence?: string };

/**
 * The event-modal write, shared by the calendar grid and the dashboard's today rows.
 *
 * `fromDate` is the occurrence the editor was opened at. Both screens open the modal from an
 * expanded instance, so for a recurring class `f.date` is that instance's date rather than the
 * stored anchor; sending the original lets the server move the row by the delta instead of
 * re-anchoring the whole series onto whichever week was on screen.
 */
export function eventFormData(f: EventDraft, fallbackTitle: string, fromDate?: string): FormData {
  const fd = new FormData();
  fd.set('intent', f.id ? 'update' : 'create');
  if (f.id) fd.set('id', f.id);
  fd.set('title', (f.title ?? '').trim() || fallbackTitle);
  if (f.date) fd.set('date', f.date);
  if (f.id && fromDate) fd.set('fromDate', fromDate);
  if (f.start) fd.set('start', f.start);
  if (f.end) fd.set('end', f.end);
  if (f.color) fd.set('color', f.color);
  if (f.classId) fd.set('classId', f.classId);
  if (f.location) fd.set('location', f.location);
  fd.set('recurrence', f.recurrence || 'none');
  fd.set('notes', f.notes ?? '');
  return fd;
}

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
