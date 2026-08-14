import { withAuth } from '../../server/api/handler';
import { ictDateOf } from '../../shared/logic/tests';
import * as eventsSvc from '../../server/services/events';
import * as classesSvc from '../../server/services/classes';

/**
 * Mirrors the /dashboard loader: today's events and the class list.
 *
 * `homeworkDueToday` is gone with the homework feature; installed mobile builds read it with
 * `?? []`, so its absence is harmless.
 */
export const loader = withAuth('staff', async ({ db }) => {
  // The ICT day, never `iso(new Date())`. The helpers in shared/logic/dates work in the LOCAL
  // zone by design, and a Worker's local zone is UTC — so before 07:00 in Vietnam this dated
  // "today" to yesterday and `listForToday` dropped every one-off event on the real school day.
  // The phone then filtered what was left against its own (correct) date and rendered nothing.
  const today = ictDateOf(new Date().toISOString());
  const [todayEvents, classes] = await Promise.all([
    eventsSvc.listForToday(db, today),
    classesSvc.listLite(db),
  ]);
  return { today, todayEvents, classes };
});
