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

## ⚠️ Status: the in-Worker limiter is NOT active in production

Measured against `calendar.ngqv0712.workers.dev` on 2026-08-15, immediately after deploying
`d38fcb3`:

- 12 consecutive `POST /api/auth/login` with bad credentials → **twelve 401s, no 429**
  (`AUTH_LIMITER`, limit 8).
- 22 consecutive `POST /login` with `intent=redeem-check` → **twenty-two 400s, no 429**
  (`INVITE_LIMITER`, limit 15).

Two independently-keyed limiters, neither trips. The security headers from the same commit range
*are* live, so the deploy definitely carried this code — `allow()` is falling open, which is its
designed behaviour when `env.AUTH_LIMITER` / `env.INVITE_LIMITER` are undefined.

What has been ruled out:

- The config key is correct. wrangler 4.110.0 compiles it (`case "ratelimit"` →
  `configObj.ratelimits`), and `ratelimits` is in its config schema.
- It is not an env-inheritance mistake in prod. `ratelimits` is `notInheritable`, which only
  affects named environments; `env.test` omits it deliberately.
- It is not a stale deploy. `cf29405` added the bindings and predates the header commit that is
  demonstrably live.

Still to check — needs an authenticated look at the deployed Worker:

1. Whether Cloudflare Workers Builds (which performs the actual deploy — see the note in
   `.github/workflows/main.yml`) emitted the two bindings, i.e. whether
   `build/server/wrangler.json` from a **prod** build has a populated `ratelimits`. The only
   copy on disk is a stale `CLOUDFLARE_ENV=test` build, where `ratelimits: []` is correct.
2. Whether `namespace_id` 1001/1002 are accepted for this account.
3. Failing both, switch to the `unsafe.bindings` form
   (`{ "name": …, "type": "ratelimit", "namespace_id": …, "simple": {…} }`), which wrangler
   also accepts, and redeploy.

The Worker logs the exact cause once per isolate — `[ratelimit] no binding — auth endpoints are
UNTHROTTLED in this environment`. `npx wrangler tail` while hitting `/login` will confirm it
immediately.

**Until this is resolved, the auth endpoints have no throttling at all** and the brute-force
findings this work set out to close remain open. Nothing is broken for users — failing open was
the deliberate choice — but the protection is not yet real.

## Deliberate gaps

**No `script-src` in the CSP.** `/docs/api` loads Scalar from `cdn.jsdelivr.net` and React
Router inlines its hydration payload, so a strict policy breaks both. The directives that do
ship (`frame-ancestors`, `base-uri`, `object-src`) cannot break a page. A nonce-based
`script-src` needs plumbing through the RR server entry plus live verification of every page —
worth doing, not worth blocking this work on.

**No rate limiters in `env.test`.** Playwright runs specs in parallel from one IP, all signing
in as the same seeded account, so a live limiter would flake the suite. `calendar-test`
therefore runs unthrottled and logs `[ratelimit] no binding` once per isolate. The logic is
covered by `test-worker/rate-limit.test.js` with a stub limiter instead. This means **no e2e
test exercises real throttling** — verify it by hand against production with the command below
after any change to `rate-limit.ts`.

**Password reset still has no email delivery** (`server/services/auth.ts`, `requestReset`). The
endpoint is now throttled, but nobody can self-serve a reset in production. When that is wired
up, it becomes the most-attacked endpoint in the app — keep the limiter on it.

**Rate limiting is per colocation.** Cloudflare's binding is explicitly "permissive, eventually
consistent, and intentionally designed to not be used as an accurate accounting system." A
distributed attacker gets one bucket per edge location they reach. This raises the cost of
brute force by orders of magnitude; it is not an exact quota.

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
