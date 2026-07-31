import { withAuth } from '../../server/api/handler';
import { iso } from '../../shared/logic/dates';
import * as eventsSvc from '../../server/services/events';
import * as classesSvc from '../../server/services/classes';

/**
 * Mirrors the /dashboard loader: today's events and the class list.
 *
 * `homeworkDueToday` is gone with the homework feature; installed mobile builds read it with
 * `?? []`, so its absence is harmless.
 */
export const loader = withAuth('staff', async ({ db }) => {
  const today = iso(new Date());
  const [todayEvents, classes] = await Promise.all([
    eventsSvc.listForToday(db, today),
    classesSvc.listLite(db),
  ]);
  return { today, todayEvents, classes };
});
