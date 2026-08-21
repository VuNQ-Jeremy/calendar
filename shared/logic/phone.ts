/**
 * Phone normalization for the Zalo OTP login/recovery path.
 *
 * VN mobile numbers get full validation because they are what the resolution algorithm
 * (server/services/login-otp.ts) matches exactly against `accounts.phone_e164` /
 * `parents.phone_e164`. Other international numbers pass through with only a shape check —
 * a foreign staff or parent phone still needs to compare equal to itself on every later login,
 * but this app has no reason to validate a Vietnamese mobile prefix on it.
 */

/**
 * Fold whatever a user typed into E.164 (`+84XXXXXXXXX` for Vietnamese mobiles, or
 * `+<countrycode><digits>` passthrough for anything else that looks like a phone number).
 * Null when the input cannot be a phone number at all.
 */
export function normalizePhone(input: string): string | null {
  const raw = input.replace(/[\s().-]/g, '');
  if (!raw) return null;

  let rest: string;
  if (raw.startsWith('+84')) {
    rest = raw.slice(3);
  } else if (raw.startsWith('84') && raw.length === 11) {
    rest = raw.slice(2);
  } else if (raw.startsWith('0') && raw.length === 10) {
    rest = raw.slice(1);
  } else if (raw.startsWith('+')) {
    const digits = raw.slice(1);
    return /^\d{8,15}$/.test(digits) ? `+${digits}` : null;
  } else {
    return null;
  }

  // 9 digits, first digit a live VN mobile prefix (3/5/7/8/9). Legacy 11-digit 01xx forms
  // were retired by carriers in 2018 — reject rather than silently normalize them wrong.
  if (!/^[35789]\d{8}$/.test(rest)) return null;
  return `+84${rest}`;
}

/** Display form of a VN E.164 number ("+84901234567" -> "0901 234 567"). Passes through anything else. */
export function formatPhoneVN(e164: string): string {
  if (!e164.startsWith('+84')) return e164;
  const d = e164.slice(3);
  return `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
}
