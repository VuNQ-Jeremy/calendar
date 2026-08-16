import { parsePatchBody, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/notif-prefs';
import { NotifPrefsInput } from '../../shared/schemas';

/**
 * What the cron jobs may send YOU. `any` level — a student's study nudges are their own business.
 *
 * Per account since migration 0043, which is also what makes this level correct: the same `any`
 * write used to land on one school-wide row, so a single student could silence the whole
 * school's reminders. Now it stores that account's own row and falls back to the school default.
 * `classLeadMinutes` is the exception and stays school-wide — see server/services/notif-prefs.ts.
 */
export const loader = withAuth('any', ({ db, user }) => svc.getNotifPrefs(db, user.account.id));

export const action = withAuth('any', async ({ request, db, user }) => {
  const patch = await parsePatchBody(request, NotifPrefsInput);
  return svc.setNotifPrefs(db, user.account.id, patch);
});
