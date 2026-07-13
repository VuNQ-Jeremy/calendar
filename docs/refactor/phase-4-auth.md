# Phase 4 — Real authentication (accounts, sessions, invites, reset)

**Goal:** close the two security holes — the login screen that accepts any password, and the
server that trusts every request. After this phase: PBKDF2-hashed passwords in `accounts`,
server-side sessions in `sessions`, an HttpOnly cookie, every loader/action gated, invite
redemption that actually creates accounts, and no user JSON in `localStorage`.

The `accounts` and `sessions` tables already exist (`migrations/0001_init.sql`):
`accounts(id, email UNIQUE, password_hash, staff_id → staff, created_at)`,
`sessions(token PK, account_id → accounts, expires_at)`.

---

## Task 1 — Migration 0004

`migrations/0004_auth.sql` (generate via `drizzle-kit generate` after editing `schema.ts`):

```sql
ALTER TABLE accounts ADD COLUMN student_id TEXT REFERENCES students(id) ON DELETE SET NULL;
ALTER TABLE accounts ADD COLUMN parent_id  TEXT REFERENCES parents(id)  ON DELETE SET NULL;
ALTER TABLE invites  ADD COLUMN used_by    TEXT REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE invites  ADD COLUMN used_at    TEXT;

CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0
);
```

(Student/parent account links are forward-compat for the backlogged parent portal; only staff
log in today, but invites carry all three roles.)

## Task 2 — Crypto primitives (`server/services/crypto.ts`)

PBKDF2-SHA256 via WebCrypto (built into Workers — no dependency). Storage format:
`pbkdf2$<iterations>$<salt_b64>$<hash_b64>`.

```ts
const ITERATIONS = 210_000; // OWASP recommendation for PBKDF2-SHA256

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'pbkdf2') return false;
  const expected = unb64(hashB64);
  const actual = await derive(password, unb64(saltB64), parseInt(iter, 10));
  return timingSafeEqual(actual, expected); // constant-time byte compare, length checked first
}

async function derive(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}
```

Session/reset tokens: 32 random bytes → base64url = the bearer token; **store only its SHA-256
hex digest** in `sessions.token` / `password_resets.token_hash` (a DB leak must not yield usable
tokens). Helper: `newToken(): { token, hash }` and `hashToken(token): string`.

## Task 3 — Session service + cookie (`server/services/auth.ts`, `server/session.ts`)

- Cookie via RR7's `createCookie('__mochi_session', { httpOnly: true, secure: true,
  sameSite: 'lax', path: '/' })`. Value = the raw session token only. `maxAge: 30 * 24 * 3600`
  **only when "remember me" is checked**; otherwise a browser-session cookie. (`secure: true` is
  fine in dev — localhost is exempt in browsers.)
- `createSession(db, accountId, remember)` → inserts `{ token: hash, account_id, expires_at }`
  (30 days remember / 24h not), returns raw token.
- `getUser(request, env)` → read cookie → hash token → join `sessions` → `accounts` → `staff` →
  return `{ account: {id, email}, user: {id, name, email, role, color, phone} }` or `null`.
  Expired row: delete it, return `null`.
- `requireUser(request, env)` → `getUser` or `throw redirect('/login?next=' +
  encodeURIComponent(pathname))`.
- `login(db, email, password)`: fetch account by lower-cased email; **always run verifyPassword
  even when no account exists** (verify against a static dummy hash — no user-enumeration timing
  oracle); on failure return a single generic error.
- `logout`: delete the session row, expire the cookie (`maxAge: 0`).
- `redeemInvite(db, code, {name, email, password})`: normalize code (strip dash, uppercase),
  find unused invite, then in one `db.batch`: create the role record (staff row for Staff —
  student/parent rows for those roles), create the account (hashed pw, role link), mark invite
  `used = 1, used_by, used_at`. Reject used/unknown codes with one generic message.
- `requestReset(db, email)`: always respond success (no enumeration). If the account exists,
  store a reset token (1h expiry). **No email service exists yet:** in dev
  (`import.meta.env.DEV`), log the reset URL to the console and return it in the action data so
  it can be shown for manual testing; in production return only the generic success message and
  leave a `// TODO: send via email provider` seam.
- `resetPassword(db, token, newPassword)`: valid unused unexpired token → update hash, mark token
  used, **delete all sessions for that account**.

## Task 4 — Routes

1. `routes/login.tsx` — rebuild the existing `AuthScreen` UI (same markup/classes/i18n keys —
   visual parity with today's login and invite-code modes) as RR `<Form>`s. Action intents:
   `login`, `redeem-check` (validates a code, returns invite info for the second step),
   `redeem`, `request-reset`, `reset`. On success: `redirect(next ?? '/dashboard')` with the
   session `Set-Cookie` header. Add "Forgot password?" (mode `forgot`) — it existed in the design
   (`README.md` §Auth) but was dropped; restore it with `t()` strings in **both** languages.
2. `routes/_app.tsx` loader: `const { user } = await requireUser(request, env);` return `user` —
   the sidebar/profile read it from the loader, **not** from `localStorage`. Delete the
   client-side auth gate, the `SESSION_KEY` logic, and the mock `doLogin` entirely.
3. Logout: a fetcher `<Form method="post" action="/logout">`; `routes/logout.tsx` action only.
4. Profile "save" updates the staff row via the profile action; the layout loader revalidates so
   the sidebar name/avatar update.
5. Sign-up stays **invite-only** (matches the invite-code product flow; open signup was
   prototype-only). The old open `signup` mode is removed — confirm with the operator if that's
   ever needed again.

## Task 5 — Guard everything + bootstrap admin

1. Every loader/action in `_app.tsx`'s subtree starts with `requireUser`. Any surviving `/api/*`
   route (should be none after Phase 3) gets the same check → 401.
2. Login throttling (minimal): after a failed attempt for an email, `await new Promise(r =>
   setTimeout(r, 1000))` before responding, and cap to 10 failures/hour per account via a
   `login_attempts` counter column or KV — keep it simple; note Cloudflare WAF rate rules as the
   production-grade follow-up.
3. Bootstrap: `scripts/hash-password.mjs` (Node has WebCrypto — reuse the same PBKDF2 code) that
   prints a hash for a given password; then insert the admin account for the seeded
   `admin@mochi.edu` staff row (`migrations/0003_admin.sql` created it) via
   `wrangler d1 execute mochi-class --remote --command "INSERT INTO accounts …"`.
   Document the exact commands in `BACKEND.md`.

## Task 6 — Tests

- Unit: hash/verify round-trip; wrong password false; tampered stored-format false; token hash
  stored ≠ raw token.
- Integration (workers pool): login with bad credentials → 400 + no cookie; good credentials →
  `Set-Cookie` HttpOnly; loader without cookie → 302 `/login`; with cookie → 200; expired
  session → 302 and row deleted; invite redemption → account created, invite marked used, second
  redemption fails; reset flow end-to-end; logout kills the session server-side (old cookie
  stops working).

---

## Acceptance criteria

- [ ] Wrong password is rejected. (The bar was low.)
- [ ] `curl` any app route or surviving endpoint without the cookie → redirect/401; nothing leaks.
- [ ] Cookie is `HttpOnly; Secure; SameSite=Lax`; raw session tokens appear nowhere in the DB.
- [ ] `grep -rn "SESSION_KEY\|localStorage" app/ src/ | grep -i session` → no session storage in
      the browser beyond the cookie.
- [ ] Invite redemption creates a working account and burns the code (re-use fails).
- [ ] "Remember me" unchecked → session cookie dies with the browser; checked → survives 30 days.
- [ ] Login/invite/forgot screens are visually faithful to the current auth card and fully
      bilingual (every new string in `STRINGS.en` **and** `STRINGS.vi`).
- [ ] All Phase 0–3 suites still green; new auth tests green; manual click-through incl.
      login → work → logout → verify locked out.
