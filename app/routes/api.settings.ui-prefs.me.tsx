import { parsePatchBody, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/ui-prefs';
import { UiPrefsInput } from '../../shared/schemas';

/**
 * The caller's personal UI-preference override (migration 0043).
 *
 * The sibling `/api/settings/ui-prefs` PATCH is admin-only because it writes the SCHOOL's look.
 * This one writes a single account's row, so `any` is the right level: the worst a student can
 * do here is restyle their own scrollbar. Reads stay on the sibling route, which already
 * resolves override → school → default for whoever is asking.
 *
 * DELETE removes the override rather than storing a copy of the school values — otherwise
 * "follow the school" would silently freeze at whatever the school looked like the day you
 * clicked it.
 */
export const action = withAuth(
  'any',
  async ({ request, db, user }) => {
    if (request.method === 'DELETE') {
      await svc.clearUiPrefsOverride(db, user.account.id);
      return svc.getUiPrefs(db, user.account.id);
    }
    const patch = await parsePatchBody(request, UiPrefsInput);
    return svc.setUiPrefs(db, user.account.id, patch);
  },
  { live: 'config' },
);
