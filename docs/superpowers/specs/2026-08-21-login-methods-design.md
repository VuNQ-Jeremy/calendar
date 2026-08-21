# Login Methods Rework — Design Spec

Approved 2026-08-21.

## Context

Mochi targets 1000+ MAU, mostly parents and students. Today the only credential is
email+password minted via invite codes; password reset is dead in production (no email
provider — the only reset is `scripts/reset-password.mjs` against D1), and many accounts
carry unroutable synthetic `invite-<uuid>@mochi.local` emails. The audience is Zalo-native;
the repo has a mature outbound Zalo Bot integration with pairing codes, but chat links mean
"this chat belongs to this family", not "this chat is this person".

## Decisions (user-approved)

- Audience: parents + students. Staff keep email+password (staff OTP allowed — harmless).
- Student Zalo ownership varies by school → password/invite paths survive; Zalo is additive.
- Zalo mechanism: existing Bot API only. **Phone + 6-digit code only — never links inside
  Zalo** — for login AND recovery. A young student types the family phone; the code lands
  in the parent's chat (built-in parental consent).
- **Code first, picker second** (enumeration safety): phone probing always yields the same
  generic "sent if registered" screen; names appear only after a correct code.
- **Passwordless allowed** — implemented as the `NO_PASSWORD='!'` sentinel (NOT a nullable
  rebuild; D1 `DROP TABLE` fires FK actions, which is why migration 0045's rebuild is the
  scary precedent, not the template, for `accounts`). Invite redeem may skip password when
  the family has a reachable Zalo chat.
- **Email: third-party free tier (Brevo)** — no domain purchase. Reset links by email are
  fine. Pull-based email verification (`email_verified_at`), cleared on email change.
  `sendEmail` unconditionally refuses synthetics.
- **Google SSO for everyone, web only, login-only.** Redirect flow, PKCE+state+nonce, no
  JWKS dependency (TLS token endpoint per OIDC §3.1.3.7). Sub pinned on first use;
  email-matching requires Google-verified AND our-side-verified email (closes
  pre-planted-email hijack). Profile explicit link/unlink; unlink guarded by
  another-method-exists. Signup-via-Google: out.
- **Staff "reset login" action in People** (admin-only): clears password, purges sessions,
  mints a fresh linked invite code.

## Mechanism summary

- `login_codes` challenges: id-salted SHA-256 code hash, 5-min TTL, 5-attempt DB counter
  (the rate limiter fails open by design — the DB counter is the backstop), single live
  challenge per phone, `purpose: 'login' | 'set-password'`.
- Resolution: phone → accounts (direct `phone_e164` + family path parents→children) →
  paired chats (account-level preferred, family-level fallback), user chats only, deduped;
  re-resolved at verify and pick.
- Rate limits: request 3/5min/IP + 5/hr/phone; verify 10/min/IP.
- Sessions: all methods call the existing `createSession()`; OTP sessions
  `remember=true`; mobile twins return 90-day bearer tokens like `api.auth.login`.
- Phases ship independently: 1 Zalo OTP → 2 Email → 3 Google → 4 passwordless polish.
  Email/Google code no-ops until secrets are supplied (Brevo key, Google OAuth client).

## Current-state facts this design builds on

- `accounts` (server/db/schema.ts:395): globally unique `email`, `passwordHash NOT NULL`,
  exactly one of staffId/studentId/parentId. No phone column today.
- Sessions are server-side rows keyed by SHA-256 of a random token; `createSession()` is
  channel-agnostic — every new login method calls it and needs no guard changes.
- `login()` already falls back to a static `DUMMY_HASH` for timing safety
  (`account?.passwordHash ?? DUMMY_HASH`) — extended here to also treat the `NO_PASSWORD`
  sentinel as "never matches, same timing".
- `zalo_chats` links a conversation to `accountId`/`parentId`/`studentId`/`classId`
  (exactly one set); `account_id` is the one person-accurate edge today, via staff
  self-pairing. The OTP resolution algorithm unions the account-level and family-level
  routes exactly the way `chatsForParentsOfStudents` already does for notifications.
- `zalo_pair_codes` and `invites` are the two existing examples of the "globally unique,
  single-use, expiring code selects the school" pattern `login_codes` follows as a third.
- No email provider exists anywhere in the repo; `requestReset` has a literal
  `// TODO: send via email provider` at server/services/auth.ts:576.
- No OAuth/OIDC/SSO code exists anywhere in the repo today.

See the implementation plan (`docs/superpowers/plans/2026-08-21-login-methods.md`) for the
concrete task breakdown, file-by-file interfaces, and phasing.
