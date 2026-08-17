import { fail, parseBody, withPublic } from '../../server/api/handler';
import { MOBILE_TTL_DAYS } from '../../server/api/auth';
import { createSession, login, DAY_MS } from '../../server/services/auth';
import { LoginInput } from '../../shared/schemas';
import { allow, loginKey, LOGIN_POLICY } from '../../server/services/rate-limit';

// Resource route: no default export, or React Router treats GET as a document request.

// tenant-unscoped by construction: `withPublic` hands out `rawDb` because a visitor signing in
// has no session yet, so there is no school to fence to — the account they authenticate as is
// what supplies one.
export const action = withPublic(async ({ request, rawDb, env }) => {
  const input = await parseBody(request, LoginInput);
  if (!(await allow(env, loginKey(input.email), LOGIN_POLICY))) throw fail('rate_limited', 429);
  // login() runs a timing-safe verify and sleeps 1s on failure to prevent user enumeration.
  // Do not shortcut that.
  const result = await login(rawDb, input.email, input.password);
  if (!result) throw fail('invalid_credentials', 401);

  const token = await createSession(rawDb, result.accountId, true, MOBILE_TTL_DAYS);
  return {
    token,
    expiresAt: new Date(Date.now() + MOBILE_TTL_DAYS * DAY_MS).toISOString(),
  };
});
