import { parseBody, withAuth } from '../../server/api/handler';
import * as push from '../../server/services/push';
import { PushRegisterInput } from '../../shared/schemas';

export const action = withAuth('any', async ({ request, db }) => {
  const input = await parseBody(request, PushRegisterInput);
  await push.unregisterToken(db, input.expoToken);
  return { ok: true };
});
