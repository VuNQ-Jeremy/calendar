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
