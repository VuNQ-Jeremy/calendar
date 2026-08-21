import { fail, parseBody, withPublic } from '../../server/api/handler';
import { requestLoginCode } from '../../server/services/login-otp';
import { OtpRequestInput } from '../../shared/schemas';
import { normalizePhone } from '../../shared/logic/phone';
import {
  allow,
  otpRequestKey,
  otpPhoneKey,
  OTP_REQUEST_POLICY,
  OTP_PHONE_POLICY,
} from '../../server/services/rate-limit';

// Resource route: no default export, or React Router treats GET as a document request.

/**
 * ALWAYS returns `{ challengeId }`, whether or not the phone matched anything real — an
 * unstored decoy id for a non-match, a real one otherwise. See server/services/login-otp.ts for
 * why that indistinguishability is load-bearing.
 *
 * tenant-unscoped by construction: the caller has no session, and a phone number may match
 * accounts in more than one school (the eventual picker's `schoolName` disambiguates that).
 */
export const action = withPublic(async ({ request, rawDb, env }) => {
  const input = await parseBody(request, OtpRequestInput);
  if (!(await allow(env, otpRequestKey(), OTP_REQUEST_POLICY))) throw fail('rate_limited', 429);
  const normalized = normalizePhone(input.phone);
  if (normalized && !(await allow(env, otpPhoneKey(normalized), OTP_PHONE_POLICY))) {
    throw fail('rate_limited', 429);
  }
  const result = await requestLoginCode(rawDb, env, input.phone, input.purpose);
  return result;
});
