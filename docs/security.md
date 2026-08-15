# Security posture

Hardening applied 2026-08-15 after a full read of the auth surface. What was already sound —
opaque hashed session tokens, PBKDF2 with a constant-time compare, Drizzle-only SQL, a guard on
every route, `portalChild` blocking parent IDOR — is not repeated here. This records what
changed, what is deliberately deferred, and the one layer we do not have.

## What changed

| Change | Closes |
| --- | --- |
| `makeInviteCode` draws from `crypto.getRandomValues` (`shared/logic/invite-code.ts`) | Predictable codes: V8's `Math.random` is xorshift128+ and its state is recoverable from a few observed outputs. Everyone handed a code has observed one. |
| `/login` no longer returns `hasOpenInvite` | The go/no-go signal telling an anonymous visitor that brute-forcing the redeem check is worth their time. |
| `server/services/rate-limit.ts` on all five unauthenticated intents | Invite brute force (a linked `Staff` invite mints an admin), credential stuffing, and quota exhaustion. |
| `workers/security-headers.ts` on every response | Clickjacking; no defence-in-depth if an XSS ever landed. |
| `NewPassword` (min 8) on the web redeem and reset paths | A one-character password was accepted through the browser while the mobile API refused it. |
| `src/auth.tsx` deleted | An unrouted legacy screen that rendered real invite codes as clickable buttons. |

## The layer we do not have: WAF rate limiting

`server/services/rate-limit.ts` throttles inside the Worker, but a rejected request has already
cost one invocation against the free plan's 100,000/day. A sustained brute-force run therefore
still takes the app down by quota exhaustion even while every attempt is correctly refused.
Only a WAF rate-limiting rule, which rejects at the edge before the Worker is invoked, prevents
that.

**It is unavailable on this deployment, and that is a property of the hostname, not an
oversight.** The app is served from `calendar.ngqv0712.workers.dev`. WAF rate-limiting rules
are configured per zone, and `workers.dev` is Cloudflare's own zone — this account has no zone
entry for it, so there is nowhere to create the rule. Cloudflare's own docs describe
`workers.dev` as "treated as a Free website… intended for personal or hobby projects that
aren't business-critical," and recommend a custom domain for production.

Unlocking it therefore means putting the Worker on a custom domain in a zone this account
controls. Once that exists, create the rule at **dashboard → the zone → Security → WAF → Rate
limiting rules**:

- **Name:** `auth-brute-force`
- **If incoming requests match:** `URI Path` `equals` `/login` `OR` `URI Path` `starts with` `/api/auth/`
- **And method is:** `POST`
- **Characteristics:** IP address
- **Rate:** 20 requests per 1 minute
- **Action:** Block, for 1 minute

20/minute sits well above any human sign-in and well below a useful attack rate. Keep it looser
than the in-Worker limiters (8 and 15) so the specific, better-keyed checks are what normally
fire and the WAF rule stays a volumetric backstop.

Moving hostnames is not free: `EXPO_PUBLIC_API_URL` is baked into mobile bundles at build time
in three places (`mobile/.env.example` and the `env` blocks of both the `development` and
`preview` profiles in `mobile/eas.json`), and `crudGuard()` in `e2e/crud-helpers.ts` skips the
entire CRUD suite unless `E2E_BASE_URL` contains `calendar-test`. Plan it as its own change.

## Why the native rate-limit binding was abandoned

The first implementation used Cloudflare's `ratelimits` binding. It was removed after measuring
it in production on 2026-08-15.

The binding was configured correctly and deployed: `AUTH_LIMITER` (namespace 1001) and
`INVITE_LIMITER` (1002) were both visible in the dashboard Bindings tab. It was also being
invoked without error — `allow()` logs `[ratelimit] no binding` when the binding is undefined and
`[ratelimit] limiter threw` when it errors, and **neither line appeared anywhere in the logs**
across 100+ requests. So `limit()` was called and returned `success: true` every time.

What it allowed:

- 12 sequential `POST /api/auth/login` against a limit of 8 → twelve 401s, no 429
- 22 sequential `POST /login` `intent=redeem-check` against a limit of 15 → twenty-two 400s
- **40 concurrent** requests, one key, one colo (HKG) against a limit of 15 → forty 400s

That is consistent with Cloudflare's own description of it as "permissive, eventually consistent,
and intentionally designed to not be used as an accurate accounting system". Fine for shedding
load; unfit for refusing a brute force.

It was replaced by the `RateLimiter` Durable Object (`workers/rate-limiter.ts`), which is
deterministic. `test-worker/rate-limit.test.js` asserts the Nth call is refused — an assertion
that could not be written against the native binding.

**Verified live on 2026-08-15**, same method that exposed the old one:

| Endpoint | Sent | Limit | Result |
| --- | --- | --- | --- |
| `POST /login` `intent=redeem-check` | 30 concurrent | 15 | 15 × 400, **15 × 429** |
| `POST /login` `intent=login` | 20 concurrent | 8 | 8 × 400, **12 × 429** |
| `POST /api/auth/login` | 20 concurrent | 8 | 8 × 401, **12 × 429** |

The 429 body carries `error: auth_rate_limited`, confirming it is this code refusing the request
and not an edge protection upstream. Real sign-in for `dev@mochi.edu` and `vunq@mochi.edu` was
unaffected throughout, because login keys on ip+account and the bursts used throwaway addresses.

One caveat when re-testing: allow a minute or two after a deploy. A burst run mid-rollout hits
the old bundle and reports a false negative — that happened once during this work.

## Deliberate gaps

**No `script-src` in the CSP.** `/docs/api` loads Scalar from `cdn.jsdelivr.net` and React
Router inlines its hydration payload, so a strict policy breaks both. The directives that do
ship (`frame-ancestors`, `base-uri`, `object-src`) cannot break a page. A nonce-based
`script-src` needs plumbing through the RR server entry plus live verification of every page —
worth doing, not worth blocking this work on.

**No `RATE_LIMITER` binding in `env.test`.** Playwright runs specs in parallel from one IP, all
signing in as the same seeded account, so a live limiter would flake the suite. `calendar-test`
therefore runs unthrottled and logs `[ratelimit] no binding` once per isolate. The counter itself
is covered by `test-worker/rate-limit.test.js`, which drives the **real** Durable Object through
`wrangler.test.jsonc` and asserts the Nth call is refused. This means **no e2e test exercises
throttling end to end** — verify it by hand against production with the command below after any
change to `rate-limit.ts` or `rate-limiter.ts`.

**Password reset still has no email delivery** (`server/services/auth.ts`, `requestReset`). The
endpoint is now throttled, but nobody can self-serve a reset in production. When that is wired
up, it becomes the most-attacked endpoint in the app — keep the limiter on it.

**The window is fixed, not sliding, and resets on eviction.** A caller can land up to `2 * limit`
across a window boundary, which is irrelevant at these volumes. More significantly, the counter
lives in Durable Object instance memory and writes nothing to storage, so an evicted instance
forgets its count and the next caller opens a fresh window. Both err permissive, deliberately —
the same direction every other failure here errs in.

Note this is *global* per key, not per colocation: `idFromName(key)` resolves to one object
worldwide, so an attacker rotating through edge locations shares a single counter. That is
strictly better than the native binding it replaced.

## Verifying, without a device

Security headers on the live deployment:

    curl -sI https://calendar.ngqv0712.workers.dev/login | grep -iE 'content-security|strict-transport|x-content-type|referrer'

All four must be present. Rate limiting, against a deliberately bogus account so no real one is
locked out:

    for i in $(seq 1 12); do \
      curl -s -o /dev/null -w "%{http_code}\n" -X POST \
        https://calendar.ngqv0712.workers.dev/api/auth/login \
        -H 'Content-Type: application/json' \
        -d '{"email":"nobody@example.invalid","password":"wrong-password"}'; \
    done

Expect `401` for roughly the first 8, then `429`. Both counters reset within a minute. Note the
limiter is per colocation, so run this from one machine — results from two networks at once will
look inconsistent and that is expected, not a bug.
