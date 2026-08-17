import { fail, parseBody, withPublic } from '../../server/api/handler';
import { requestReset } from '../../server/services/auth';
import { RequestResetInput } from '../../shared/schemas';
import { allow, loginKey, LOGIN_POLICY } from '../../server/services/rate-limit';

/**
 * Always returns ok, whether or not the email exists — otherwise this endpoint becomes a
 * user-enumeration oracle. `devUrl` is only populated in dev builds.
 *
 * tenant-unscoped by construction: the caller has no session, and `password_resets` carries no
 * tenant_id — the email is matched against the auth-owned `accounts` table.
 */
export const action = withPublic(async ({ request, rawDb, env }) => {
  const input = await parseBody(request, RequestResetInput);
  if (!(await allow(env, loginKey(input.email), LOGIN_POLICY))) throw fail('rate_limited', 429);
  const result = await requestReset(rawDb, input.email);
  return { ok: true, ...result };
});
