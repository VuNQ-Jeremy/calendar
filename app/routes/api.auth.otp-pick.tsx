import { fail, parseBody, withPublic } from '../../server/api/handler';
import { MOBILE_TTL_DAYS } from '../../server/api/auth';
import { pickAccount } from '../../server/services/login-otp';
import { OtpPickInput } from '../../shared/schemas';
import { allow, otpVerifyKey, OTP_VERIFY_POLICY } from '../../server/services/rate-limit';

/**
 * Complete an OTP login after `otp-verify` returned a `pick` list — the caller names which of
 * the candidate accounts they are. Replies `{ token, expiresAt }` like `api.auth.login`, or 401
 * when the challenge is not in the right state or the account is not one of its candidates.
 */
export const action = withPublic(async ({ request, rawDb, env }) => {
  const input = await parseBody(request, OtpPickInput);
  if (!(await allow(env, otpVerifyKey(), OTP_VERIFY_POLICY))) throw fail('rate_limited', 429);
  const outcome = await pickAccount(rawDb, input.challengeId, input.accountId, MOBILE_TTL_DAYS);
  if (!outcome.ok) throw fail('invalid_code', 401);
  return outcome.session;
});
