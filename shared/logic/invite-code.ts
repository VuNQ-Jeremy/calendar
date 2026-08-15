/**
 * Invite code generation — `XXX-XXX`, seven characters including the dash.
 *
 * Shared rather than duplicated because the format is a contract, not a detail: `InviteInput.code`
 * is `min(7).max(7)`, and `redeemInvite` normalises by stripping the dash and upper-casing. A
 * second implementation on the phone that drifted by one character would fail validation on
 * creation, or — worse — create codes nobody can redeem.
 *
 * The alphabet omits I, O, 0 and 1 on purpose. These codes get read aloud down a phone and typed
 * from a photo of a whiteboard.
 */
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeInviteCode(): string {
  // crypto.getRandomValues, not Math.random: redeeming a linked `Staff` invite attaches an
  // account to an existing staff row, so a predictable code is a predictable admin login.
  // V8's Math.random is xorshift128+ and its state is recoverable from a few observed outputs —
  // and everyone who was legitimately handed a code has observed one.
  //
  // `% CHARS.length` is unbiased ONLY because 256 is a whole multiple of the alphabet size
  // (32). Changing CHARS to a length that does not divide 256 silently reintroduces modulo
  // bias toward the front of the alphabet; use rejection sampling if that ever happens.
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let s = '';
  for (let i = 0; i < 6; i++) s += CHARS[bytes[i] % CHARS.length];
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

/**
 * Fold whatever the visitor typed — lower case, spaces, a missing or doubled dash — back
 * into stored form, so a code can be looked up on its unique index instead of by scanning
 * every invite. Null when it cannot be a code at all.
 */
export function normalizeInviteCode(code: string): string | null {
  const bare = code.trim().toUpperCase().replace(/[-\s]/g, '');
  if (bare.length !== 6) return null;
  return `${bare.slice(0, 3)}-${bare.slice(3)}`;
}
