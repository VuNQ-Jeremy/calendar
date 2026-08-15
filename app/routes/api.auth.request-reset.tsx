import { fail, parseBody, withPublic } from '../../server/api/handler';
import { requestReset } from '../../server/services/auth';
import { RequestResetInput } from '../../shared/schemas';
import { allow, loginKey, LOGIN_POLICY } from '../../server/services/rate-limit';

/**
 * Always returns ok, whether or not the email exists — otherwise this endpoint becomes a
 * user-enumeration oracle. `devUrl` is only populated in dev builds.
 */
export const action = withPublic(async ({ request, db, env }) => {
  const input = await parseBody(request, RequestResetInput);
  if (!(await allow(env, loginKey(input.email), LOGIN_POLICY))) throw fail('rate_limited', 429);
  const result = await requestReset(db, input.email);
  return { ok: true, ...result };
});
