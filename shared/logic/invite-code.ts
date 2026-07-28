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
  let s = '';
  for (let i = 0; i < 6; i++) s += CHARS[Math.floor(Math.random() * CHARS.length)];
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

/**
 * Stand-in for a code the viewer is not entitled to read. The login page tells an anonymous
 * visitor that an unused code exists; it must not tell them what it is, because redeeming one
 * creates an account — a `Staff` invite creates an admin.
 *
 * Masking belongs on the server. Anything a loader returns ships inside the page payload, so a
 * mask applied while rendering would still hand the real code to the browser.
 *
 * Every character goes. Revealing even the first half leaves 32³ = 32,768 candidates, which is
 * not a secret — it is an afternoon of guesses against the redeem check.
 */
export const MASKED_INVITE_CODE = '•••-•••';
