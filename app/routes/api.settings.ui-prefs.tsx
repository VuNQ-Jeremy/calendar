import { parsePatchBody, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/ui-prefs';
import { UiPrefsInput } from '../../shared/schemas';

/**
 * `user` level — students have prefs too.
 * Note `scrollbar` is meaningless on Android; the mobile app reads but does not surface it.
 */
export const loader = withAuth('user', ({ db }) => svc.getUiPrefs(db));

export const action = withAuth('user', async ({ request, db }) => {
  const patch = await parsePatchBody(request, UiPrefsInput);
  return svc.setUiPrefs(db, patch);
});
