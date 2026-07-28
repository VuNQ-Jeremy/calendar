import { parsePatchBody, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/ui-prefs';
import { UiPrefsInput } from '../../shared/schemas';

/**
 * Read at `user` level, write at `admin` — deliberately different levels.
 *
 * Every client READS this: `scrollbar` styles the web scrollbar and `mobileTabBar` styles the
 * phone's bottom tab bar, so a student's app needs the values as much as an admin's. But these
 * are school-WIDE settings in the shared `settings` table (see server/services/notif-prefs.ts on
 * why), and the only surfaces that edit them are both admin-gated: the web's /config route
 * (`requireAdmin`) and the phone's System Config screen. Leaving the write at `user` meant any
 * student token could restyle the whole school's UI over the API — a real hole, closed here.
 *
 * Note `scrollbar` is meaningless on Android and `mobileTabBar` is meaningless on the web; each
 * client reads the whole object and applies the half that concerns it.
 */
export const loader = withAuth('user', ({ db }) => svc.getUiPrefs(db));

export const action = withAuth('admin', async ({ request, db }) => {
  const patch = await parsePatchBody(request, UiPrefsInput);
  return svc.setUiPrefs(db, patch);
});
