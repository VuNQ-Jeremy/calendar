import { fail, parseBody, withPublic } from '../../server/api/handler';
import { setPasswordViaOtp } from '../../server/services/login-otp';
import { OtpSetPasswordInput } from '../../shared/schemas';
import { allow, otpVerifyKey, OTP_VERIFY_POLICY } from '../../server/services/rate-limit';

/**
 * Finish the Zalo forgot-password flow: a verified `purpose: 'set-password'` challenge (from
 * otp-verify/otp-pick) is spent here to write a new password. Never mints a session — the caller
 * signs in afterward with the new password, same as the email-reset flow.
 */
export const action = withPublic(async ({ request, rawDb, env }) => {
  const input = await parseBody(request, OtpSetPasswordInput);
  if (!(await allow(env, otpVerifyKey(), OTP_VERIFY_POLICY))) throw fail('rate_limited', 429);
  const outcome = await setPasswordViaOtp(
    rawDb,
    input.challengeId,
    input.accountId,
    input.newPassword,
  );
  if (outcome !== 'ok') throw fail('invalid_code', 400);
  return { ok: true };
});
