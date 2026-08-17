import { requestMeta } from './audit';

/**
 * Throttling for the unauthenticated auth endpoints.
 *
 * Backed by the RateLimiter Durable Object (workers/rate-limiter.ts), one instance per key.
 *
 * **Why not Cloudflare's native rate limiting binding.** It was tried first and removed. The
 * binding deployed correctly (visible in the dashboard, `AUTH_LIMITER` / `INVITE_LIMITER`) and
 * `limit()` was called on every request without throwing — yet 40 concurrent requests against a
 * limit of 15, all landing on one colo with one key, were every one of them allowed. Cloudflare
 * documents it as "permissive, eventually consistent, and intentionally designed to not be used
 * as an accurate accounting system", which makes it unfit for refusing a brute force. The DO is
 * deterministic and test-worker/rate-limit.test.js proves the Nth call is refused.
 *
 * **Why not D1.** A counter table writes a row per attempt, so the busier the attack the faster
 * it burns the free plan's daily row quota — the limiter would amplify the exact denial of
 * service it exists to prevent. The DO holds its count in instance memory and writes nothing.
 */

/** How many attempts are allowed, and over what window. */
export type LimitPolicy = { limit: number; periodMs: number };

const MINUTE = 60_000;

/**
 * Credential attempts, keyed ip+email (see loginKey): a person fumbling their own password gets
 * eight tries a minute. Comfortably above human error, far below anything useful to an attacker.
 */
export const LOGIN_POLICY: LimitPolicy = { limit: 8, periodMs: MINUTE };

/**
 * Invite-code checks, keyed by IP alone (see inviteKey). Generous for the one legitimate use — a
 * family typing a code off a photo of a whiteboard — and ruinous for enumerating a 32^6 space.
 */
export const INVITE_POLICY: LimitPolicy = { limit: 15, periodMs: MINUTE };

/**
 * School creation, keyed by IP. A person creates one school; three an hour absorbs typos and
 * retries while stopping a script cold.
 */
export const SIGNUP_POLICY: LimitPolicy = { limit: 3, periodMs: 60 * MINUTE };

/**
 * The whole platform, one key, one day. This deliberately breaks the shard-by-key rule the rest
 * of this file follows, and the trade is worth stating: a per-IP cap does nothing against a
 * botnet with a thousand addresses, and a global ceiling is the only thing that does. Legitimate
 * signup volume is a handful a week, so the serialisation a single Durable Object imposes costs
 * nothing here — unlike on login, where it would queue every sign-in in the school.
 *
 * The limiter is memory-only, so an eviction resets the window early. That is the same
 * fail-permissive posture as everything else here: this is a circuit breaker, not a quota.
 */
export const SIGNUP_GLOBAL_POLICY: LimitPolicy = { limit: 30, periodMs: 24 * 60 * MINUTE };

/** One log line per isolate, not one per request — a missing binding would otherwise flood. */
let warnedMissing = false;

/**
 * Whether this attempt may proceed.
 *
 * FAILS OPEN in both degenerate cases — no binding, or a throwing stub. Locking every user out
 * of the app because a binding is misconfigured is a worse outcome than briefly losing
 * throttling, and it matches how every other optional dependency here degrades (globals.d.ts).
 * The error log is what makes the degraded state visible; its absence was what proved the native
 * binding was being called and simply not refusing anything.
 *
 * The e2e deployment (calendar-test) deliberately has no RATE_LIMITER bound, so it takes this
 * path on every login — see docs/security.md.
 */
export async function allow(env: Env, key: string, policy: LimitPolicy): Promise<boolean> {
  const ns = env.RATE_LIMITER;
  if (!ns) {
    if (!warnedMissing) {
      warnedMissing = true;
      console.error('[ratelimit] no binding — auth endpoints are UNTHROTTLED in this environment');
    }
    return true;
  }
  try {
    // idFromName(key), so each IP (and each ip+account pair) gets its own instance. A single
    // global object would serialise every sign-in in the school and be a cheaper target than
    // the endpoints it guards.
    const ok = await ns.get(ns.idFromName(key)).check(policy.limit, policy.periodMs);
    if (!ok) console.log('[ratelimit] blocked', { key });
    return ok;
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

/** School creation, per IP. Pair it with the global key below — neither is sufficient alone. */
export function signupKey(): string {
  return `signup:${ip()}`;
}

/** The one intentionally global limiter key. See SIGNUP_GLOBAL_POLICY for why. */
export const SIGNUP_GLOBAL_KEY = 'signup:all';
