import { parsePatchBody, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/notif-prefs';
import { NotifPrefsInput } from '../../shared/schemas';

/**
 * What the cron jobs may send. `user` level — a student's study nudges are their own business.
 *
 * Note these are school-wide today, not per-account; see the comment in
 * server/services/notif-prefs.ts.
 */
export const loader = withAuth('any', ({ db }) => svc.getNotifPrefs(db));

export const action = withAuth('any', async ({ request, db }) => {
  const patch = await parsePatchBody(request, NotifPrefsInput);
  return svc.setNotifPrefs(db, patch);
});
