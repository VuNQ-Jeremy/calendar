import { parseBody, withPublic } from '../../server/api/handler';
import { requestReset } from '../../server/services/auth';
import { RequestResetInput } from '../../shared/schemas';

/**
 * Always returns ok, whether or not the email exists — otherwise this endpoint becomes a
 * user-enumeration oracle. `devUrl` is only populated in dev builds.
 */
export const action = withPublic(async ({ request, db }) => {
  const input = await parseBody(request, RequestResetInput);
  const result = await requestReset(db, input.email);
  return { ok: true, ...result };
});
