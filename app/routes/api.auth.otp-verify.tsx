import { fail, parseBody, withPublic } from '../../server/api/handler';
import { MOBILE_TTL_DAYS } from '../../server/api/auth';
import { verifyLoginCode } from '../../server/services/login-otp';
import { OtpVerifyInput } from '../../shared/schemas';
import { allow, otpVerifyKey, OTP_VERIFY_POLICY } from '../../server/services/rate-limit';

/**
 * Verify a Zalo OTP code. Replies `{ token, expiresAt }` (90-day bearer, like `api.auth.login`)
 * when exactly one account matched, `{ pick: [...] }` when the phone reaches more than one, or
 * a 401 for anything wrong — a bad code, an expired or already-used challenge, or an unknown
 * challenge id (the decoy path from otp-request lands here too, and fails identically).
 */
export const action = withPublic(async ({ request, rawDb, env }) => {
  const input = await parseBody(request, OtpVerifyInput);
  if (!(await allow(env, otpVerifyKey(), OTP_VERIFY_POLICY))) throw fail('rate_limited', 429);
  const outcome = await verifyLoginCode(rawDb, input.challengeId, input.code, MOBILE_TTL_DAYS);
  if (!outcome.ok) throw fail('invalid_code', 401);
  if ('pick' in outcome) return { pick: outcome.pick };
  return outcome.session;
});
