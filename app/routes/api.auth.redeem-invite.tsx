import { fail, parseBody, withPublic } from '../../server/api/handler';
import { MOBILE_TTL_DAYS } from '../../server/api/auth';
import { createSession, redeemInvite, DAY_MS } from '../../server/services/auth';
import { RedeemInviteInput } from '../../shared/schemas';

/** Signup is invite-only. A successful redemption signs the device straight in. */
export const action = withPublic(async ({ request, db }) => {
  const input = await parseBody(request, RedeemInviteInput);
  const result = await redeemInvite(db, input.code, {
    name: input.name,
    email: input.email,
    password: input.password,
  });
  if (!result) throw fail('invalid_invite', 400);

  const token = await createSession(db, result.accountId, true, MOBILE_TTL_DAYS);
  return {
    token,
    expiresAt: new Date(Date.now() + MOBILE_TTL_DAYS * DAY_MS).toISOString(),
  };
});
