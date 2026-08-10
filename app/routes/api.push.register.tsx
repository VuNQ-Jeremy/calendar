import { parseBody, withAuth } from '../../server/api/handler';
import * as push from '../../server/services/push';
import { PushRegisterInput } from '../../shared/schemas';

/**
 * Register this device for notifications. Upserts on the Expo token, so signing in as a
 * different user on the same handset moves the token rather than leaving a stale row that
 * would deliver someone else's notifications here.
 */
export const action = withAuth('any', async ({ request, db, user }) => {
  const input = await parseBody(request, PushRegisterInput);
  await push.registerToken(db, user.account.id, input.expoToken, input.platform);
  return { ok: true };
});
