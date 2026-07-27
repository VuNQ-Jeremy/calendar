import { withAuth } from '../../server/api/handler';
import { iso } from '../../shared/logic/dates';
import * as eventsSvc from '../../server/services/events';
import * as homeworkSvc from '../../server/services/homework';
import * as classesSvc from '../../server/services/classes';

/** Mirrors the /dashboard loader: today's events, homework due, and the class list. */
export const loader = withAuth('staff', async ({ db }) => {
  const today = iso(new Date());
  const [todayEvents, homeworkDueToday, classes] = await Promise.all([
    eventsSvc.listForToday(db, today),
    homeworkSvc.listDueToday(db, today),
    classesSvc.listLite(db),
  ]);
  return { today, todayEvents, homeworkDueToday, classes };
});
