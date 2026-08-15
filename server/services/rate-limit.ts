import { requestMeta } from './audit';

/**
 * Throttling for the unauthenticated auth endpoints.
 *
 * Backed by Cloudflare's native Rate Limiting binding (`ratelimits` in wrangler.jsonc):
 * edge-local, in-memory, no storage. That choice is load-bearing — a D1-backed counter would
 * write a row per attempt, and the single most realistic attack here is exhausting the free
 * plan's daily request and row-read quotas. Throttling must not itself consume quota.
 *
 * Consequences of the binding's design, per Cloudflare's docs:
 *   - counters are PER COLOCATION, not global, so a distributed attacker gets one bucket per
 *     edge location they reach. This raises the cost of brute force by orders of magnitude
 *     without being an exact accounting system, which is the correct trade here;
 *   - `simple.period` accepts only 10 or 60 seconds.
 *
 * A WAF rate-limiting rule would be the complementary layer — it rejects before the Worker is
 * invoked at all, which is the only thing that protects the request quota itself. It is NOT
 * available on this deployment: WAF rules are configured per zone, and the app is served from
 * *.workers.dev, which is Cloudflare's zone rather than one this account owns. See
 * docs/security.md.
 */

/**
 * Structural type for the binding. Declared here rather than using the generated `RateLimit`
 * so tests can pass a stub — and so this module is honest that the value may be absent.
 */
export type Limiter = { limit(options: { key: string }): Promise<{ success: boolean }> };

/** One log line per isolate, not one per request — a missing binding would otherwise flood. */
let warnedMissing = false;

/**
 * Whether this attempt may proceed.
 *
 * FAILS OPEN in both degenerate cases — no binding, or a throwing binding. Locking every user
 * out of the app because a binding is misconfigured is a worse outcome than briefly losing
 * throttling, and it matches how every other optional dependency in this codebase degrades
 * (see globals.d.ts). The error log is what makes the degraded state visible.
 *
 * The test deployment (calendar-test) genuinely has no limiters bound, so this path runs there
 * on every login — see docs/security.md.
 */
export async function allow(limiter: Limiter | undefined, key: string): Promise<boolean> {
  if (!limiter) {
    if (!warnedMissing) {
      warnedMissing = true;
      console.error('[ratelimit] no binding — auth endpoints are UNTHROTTLED in this environment');
    }
    return true;
  }
  try {
    const { success } = await limiter.limit({ key });
    if (!success) console.log('[ratelimit] blocked', { key });
    return success;
  } catch (err) {
    console.error('[ratelimit] limiter threw — allowing', { err: String(err) });
    return true;
  }
}

/** Client IP from the ambient audit store (CF-Connecting-IP), or a shared fallback bucket. */
function ip(): string {
  return requestMeta().ip ?? 'noip';
}

/**
 * Credential attempts: scoped to the IP AND the account.
 *
 * Not IP-alone deliberately. Two reasons: hammering one account must not lock a colleague out
 * from the same school NAT, and the e2e suite signs in as one seeded account from many parallel
 * workers behind a single address.
 */
export function loginKey(email: string): string {
  return `login:${ip()}:${email.trim().toLowerCase()}`;
}

/**
 * Invite-code attempts: scoped to the IP alone, because trying many codes from one address is
 * exactly the brute force this exists to stop. Keying it by code would defeat the entire point.
 */
export function inviteKey(): string {
  return `invite:${ip()}`;
}
