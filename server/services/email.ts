/**
 * Email delivery — Brevo REST, no-op without a key.
 *
 * **Disabled by default**, the same posture as `server/services/zalo.ts`: no `EMAIL_API_KEY`
 * means `sendEmail` quietly returns `false` and callers (password reset, email verification)
 * treat that exactly like a delivery failure — the caller-facing response stays enumeration-safe
 * either way, because it never depended on whether the send actually happened.
 *
 * **Brevo, not Cloudflare Email Sending**, because the latter needs a verified domain in a zone
 * this Cloudflare account controls, and the app currently lives on a bare `workers.dev` subdomain
 * with no zone at all. Brevo's free tier (~300/day) verifies a single sender address instead.
 *
 * **The synthetic-address guard lives HERE, in the sender, not in callers.** `redeemInvite`
 * writes `invite-<uuid>@mochi.local` for anyone who skips the optional email field on redeem;
 * mailing that address is not just pointless; it is very slightly a bug (a wasted external call
 * where a bug in the DB should never invoke one). One choke point means every future caller gets
 * the guard for free instead of having to remember it.
 */

const BREVO_API = 'https://api.brevo.com/v3/smtp/email';

export function isEmailEnabled(env: Env): boolean {
  return Boolean(env.EMAIL_API_KEY?.trim() && env.EMAIL_FROM?.trim());
}

/** Rejects null/empty, malformed addresses, and the synthetic `@mochi.local` domain. */
export function isRealEmail(email: string | null | undefined): email is string {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !e.endsWith('@mochi.local');
}

/**
 * Send a plain-text email. Never throws — a delivery failure degrades to `false`, exactly like
 * `zalo.sendText` degrades to `false` when the bot channel is off; callers already treat "we
 * couldn't confirm delivery" as the safe, non-committal outcome, so there is nothing to catch
 * further up.
 */
export async function sendEmail(
  env: Env,
  opts: { to: string; subject: string; text: string },
): Promise<boolean> {
  if (!isEmailEnabled(env) || !isRealEmail(opts.to)) return false;
  try {
    const res = await fetch(BREVO_API, {
      method: 'POST',
      headers: {
        'api-key': env.EMAIL_API_KEY!.trim(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { email: env.EMAIL_FROM!.trim(), name: env.EMAIL_FROM_NAME?.trim() || 'Mochi' },
        to: [{ email: opts.to.trim() }],
        subject: opts.subject,
        textContent: opts.text,
      }),
    });
    if (!res.ok) {
      console.error('[email] send failed', { status: res.status });
    }
    return res.ok;
  } catch (err) {
    console.error('[email] send threw', { err: String(err) });
    return false;
  }
}
