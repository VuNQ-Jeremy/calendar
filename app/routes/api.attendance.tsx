import { fail, parseBody, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/attendance';
import { AttendanceSaveInput } from '../../shared/schemas';

/**
 * Attendance for one occurrence of an event. Recurring events have one row per (eventId,
 * date), hence both are required.
 *
 * Mirrors the existing /attendance resource route, which the web modal uses.
 */
export const loader = withAuth('staff', async ({ request, db }) => {
  const url = new URL(request.url);
  const eventId = url.searchParams.get('eventId');
  const date = url.searchParams.get('date');
  if (!eventId || !date) throw fail('missing_event_or_date', 400);
  return svc.listForOccurrence(db, eventId, date);
});

export const action = withAuth(
  'staff',
  async ({ request, db }) => {
    const input = await parseBody(request, AttendanceSaveInput);
    // Delete-then-insert: omitting a student unmarks them.
    return svc.saveOccurrence(db, input.eventId, input.date, input.records);
  },
  { live: 'attendance' },
);
