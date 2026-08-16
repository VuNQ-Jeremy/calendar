import { parsePatchBody, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/ui-prefs';
import { UiPrefsInput } from '../../shared/schemas';

/**
 * Read at `user` level, write at `admin` — deliberately different levels.
 *
 * Every client READS this: `scrollbar` styles the web scrollbar and `mobileTabBar` styles the
 * phone's bottom tab bar, so a student's app needs the values as much as an admin's. The GET
 * answers with what the CALLER should apply — their own override if they have one, otherwise the
 * school default (see server/services/ui-prefs.ts for the resolution order).
 *
 * The PATCH stays admin-only and stays school-wide. It is what the web's /config route and the
 * phone's System Config screen call, and both are meant to set the school's look; opening it up
 * would let any student token restyle the whole school, which is the hole this level closed.
 * A personal override is a different operation with a different blast radius, and lives on
 * `/api/settings/ui-prefs/me`.
 *
 * Note `scrollbar` is meaningless on Android and `mobileTabBar` is meaningless on the web; each
 * client reads the whole object and applies the half that concerns it.
 */
export const loader = withAuth('any', ({ db, user }) => svc.getUiPrefs(db, user.account.id));

export const action = withAuth(
  'admin',
  async ({ request, db }) => {
    const patch = await parsePatchBody(request, UiPrefsInput);
    return svc.setSchoolUiPrefs(db, patch);
  },
  { live: 'config' },
);
