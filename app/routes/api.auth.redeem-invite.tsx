import { fail, parseBody, withPublic } from '../../server/api/handler';
import { MOBILE_TTL_DAYS } from '../../server/api/auth';
import { createSession, redeemInvite, DAY_MS } from '../../server/services/auth';
import { RedeemInviteInput } from '../../shared/schemas';
import { allow, inviteKey, INVITE_POLICY } from '../../server/services/rate-limit';

/**
 * Signup is invite-only. A successful redemption signs the device straight in.
 *
 * tenant-unscoped by construction: the visitor has no session, and the invite CODE is what
 * selects the school — `redeemInvite` reads it off the row it finds.
 */
export const action = withPublic(async ({ request, rawDb, env }) => {
  const input = await parseBody(request, RedeemInviteInput);
  if (!(await allow(env, inviteKey(), INVITE_POLICY))) throw fail('rate_limited', 429);
  const result = await redeemInvite(rawDb, input.code, {
    name: input.name,
    email: input.email,
    password: input.password,
    phone: input.phone,
  });
  if (result === 'no_login_method') throw fail('no_login_method', 400);
  if (!result) throw fail('invalid_invite', 400);

  const token = await createSession(rawDb, result.accountId, true, MOBILE_TTL_DAYS);
  return {
    token,
    expiresAt: new Date(Date.now() + MOBILE_TTL_DAYS * DAY_MS).toISOString(),
  };
});
