import { fail, parseBody, withPublic } from '../../server/api/handler';
import { MOBILE_TTL_DAYS } from '../../server/api/auth';
import { createSession, login, DAY_MS } from '../../server/services/auth';
import { LoginInput } from '../../shared/schemas';

// Resource route: no default export, or React Router treats GET as a document request.

export const action = withPublic(async ({ request, db }) => {
  const input = await parseBody(request, LoginInput);
  // login() runs a timing-safe verify and sleeps 1s on failure to prevent user enumeration.
  // Do not shortcut that.
  const result = await login(db, input.email, input.password);
  if (!result) throw fail('invalid_credentials', 401);

  const token = await createSession(db, result.accountId, true, MOBILE_TTL_DAYS);
  return {
    token,
    expiresAt: new Date(Date.now() + MOBILE_TTL_DAYS * DAY_MS).toISOString(),
  };
});
