# Login Methods Rework — Review

Reviewed 2026-08-21 by Claude Fable 5, against
`docs/superpowers/specs/2026-08-21-login-methods-design.md` and the Review Protocol in
`docs/superpowers/plans/2026-08-21-login-methods.md`. Implementation under review: commit
`fffb8f3` (plus `ed851fe` docs and `f9e6e7b` phone normalizer).

**Verdict: two findings should be fixed before this carries real traffic.** One breaks the
primary documented pairing route (and can strand a passwordless account with no way in at all);
one lets a school Admin delete accounts belonging to other schools. Everything else in the
security core — the enumeration decoy, the attempt ceiling, the picker ordering, the Google
claim checks — is implemented correctly and matches the spec.

---

## Findings

### F1 — `chatsFor` silently drops the student-target pairing route · HIGH · correctness + lockout

`server/services/login-otp.ts:186-225`. The `Promise.all([...])` holds **five** queries but only
**four** are destructured:

```ts
const [byAccount, byParent, viaChildrenOfParents, viaParentsOfStudents] = await Promise.all([
  /* 1 */ ...inArray(zaloChats.accountId, accountIds),
  /* 2 */ ...inArray(zaloChats.parentId, parentIds),
  /* 3 */ ...parentStudents join → children of those parents,
  /* 4 */ ...parentStudents join → parents of those students,
  /* 5 */ ...inArray(zaloChats.studentId, studentIds),   // ← computed, never named, never returned
]);
return [...new Set([byAccount, byParent, viaChildrenOfParents, viaParentsOfStudents].flat()...)];
```

Query 5 is a chat paired **directly to the student** — which `docs/zalo.md` calls the default
target, "works for every student", precisely because most students have no `parents` row. It is
executed and thrown away.

**Failure scenario A (silent non-delivery).** A family paired via the student target; the phone
sits on the student's account. `resolveAccounts` finds the account, `chatsFor` returns `[]`,
`requestLoginCode` falls through to the decoy branch — so no code is ever sent and the response
is byte-identical to "this phone isn't registered". The user sees "a code has been sent" forever.
Nothing logs an anomaly.

**Failure scenario B (permanent lockout — worse).** `redeemInvite`'s passwordless path gates on
`zalo.hasFamilyChat`, which *does* check the student-target route correctly
(`server/services/zalo.ts`). So a student invite redeemed passwordless is accepted, the account
is written with `passwordHash = NO_PASSWORD`, and then OTP login can never reach them. The
account has literally no way in — the exact outcome `redeemInvite`'s own comment says it is
preventing ("The family must be reachable BEFORE the account is created, or a passwordless
account would have no way in at all"). Recovery requires admin reset-login.

**Why the tests missed it.** `test-worker/auth-otp.test.js` seeds `zalo_chats` only via
`accountId` (route 1) and `parentId` (route 2). No test pairs via `studentId`. The e2e fixture
in `scripts/test-accounts.sql` also pairs to `parent_id = 'p1'`. The bug is invisible to the
whole new suite.

**Fix:** name and include the fifth result. Worth adding a unit test that seeds
`zalo_chats.studentId` and asserts a code is delivered, since that is the common production shape.

### F2 — `reset-login` deletes accounts across tenant boundaries · HIGH · multi-tenancy

`app/routes/people.tsx` (reset-login branch) → `server/services/invites.ts` `resetLogin`.

The person `id` is taken straight from `formData` and never checked against the caller's school:

```ts
const [account] = await db.raw.select().from(accounts).where(eq(accountCol, personId)); // unscoped
await db.raw.delete(accounts).where(eq(accounts.id, account.id));                      // unscoped
```

Every other destructive intent in this route goes through `TenantDb` — `peopleSvc.removeStudent`
issues `db.delete(students, …)`, which adds `own()`, so a cross-tenant id matches zero rows. This
new action is the only unfenced destructive path in the file.

**Failure scenario.** An Admin of *any* school (self-serve `/signup` makes Admin trivially
obtainable) posts `entity=staff&intent=reset-login&id=<a staff UUID from another school>`. That
person's account is deleted, cascading their sessions, push tokens, `user_settings` and their
account-level Zalo pairing. `createLinked` then writes the replacement invite into the
**attacker's** school linked to the victim's person row, so redeeming it would attach a
cross-tenant account. `dev@mochi.edu` has a staff row in `tnt_mochi_0001`, so the platform-admin
account is in range.

**Mitigating:** person ids are UUIDs, so this needs a leaked or otherwise known id — it is not
mass-exploitable. But the tenant fence is this repo's stated core invariant, and this is the one
new path that steps around it.

**The tripwire will not catch this.** `test/tenant-scope.test.ts` only inspects `.from(...)` —
reads — so `db.raw.delete(accounts)` is invisible to it, and the `SELECT` carries a
`// tenant-unscoped:` excuse comment that waves it through. The escape hatch was used to
authorise an unscoped delete; that is exactly the case it was not designed for.

**Fix:** resolve the person through the scoped handle first (confirm the `students`/`staff`/
`parents` row is `db.own(...)` in the caller's tenant), then key the account delete off that.

### F3 — open redirect via `?next=//host` on the Google flow · MEDIUM · pre-existing, propagated

`app/routes/auth.google.tsx:23` and `auth.google.callback.tsx:83` sanitize with
`startsWith('/')`, which `//evil.com` satisfies — browsers resolve a protocol-relative Location
against the current scheme, so `redirect('//evil.com')` leaves the origin.

`/auth/google?next=//evil.com` therefore authenticates the victim successfully and *then* bounces
them to an attacker's page — a good phishing primitive precisely because the Google step is real.

This check is **pre-existing**: `login.tsx:70` (before this work) already had the identical
pattern, so the new routes replicated it rather than introducing it. Reporting it because the
work put it on more auth paths and one shared helper fixes all of them: reject `next` unless it
starts with `/` **and not** `//` (and not `/\`).

### F4 — last-method guards are read-then-write and raceable · LOW · self-inflicted lockout

`removePassword` (`server/services/auth.ts`) and the `unlink-google` intent
(`app/routes/profile.tsx`) each read the account's other methods, then write. Two concurrent
requests — two tabs, one removing the password and one unlinking Google — both observe a
surviving method and both proceed, leaving `NO_PASSWORD` + no `googleSub` + no account chat.

The plan's R2 asked about this specifically. It is raceable. Narrow: self-inflicted, needs
concurrency, and recovery is admin-only (OTP cannot help an account with no reachable chat).

**Fix:** make the write conditional in the same statement (`UPDATE … WHERE id = ? AND google_sub
IS NOT NULL`) rather than guarding with a prior read.

### F5 — `otp-request` wall-clock differs on a match · LOW · side channel, not demonstrated

The match path awaits N sequential Zalo HTTP POSTs inside the request; the decoy path makes none.
Response *shape* is identical (verified on prod), but duration cannot be.

I could not demonstrate this: there is no registered phone on prod I can test against, and my
samples on unknown numbers (0.93s–1.32s) are dominated by network noise. So this is a
code-structure observation, not a measurement. If it matters, move the sends to
`ctx.waitUntil` or floor the response to a constant.

### F6 — minor

- **`pick` leaks internal `tenantId`.** `otp-verify` returns `tenantId` alongside `accountId`;
  the UI renders only `name`/`kind`/`schoolName`, and only `accountId` is needed for `otp-pick`.
  Trim it from the payload.
- **`reset-login` has no self-guard.** An Admin resetting their own login deletes their own
  account mid-session, invalidating their session immediately; the replacement code is shown once
  in the response. Recoverable, but worth refusing or warning.
- **`login_code_requested` logs the full phone** with no comment justifying it. Consistent with
  `login`'s full-email precedent (admin-only, 90-day purge) — that precedent carries an explicit
  comment; this one should too.

---

## What was verified correct

Security invariants (R2), all confirmed by reading the code rather than the commit message:

- **Decoy indistinguishability (shape).** Malformed and unknown-but-well-formed phones both
  return `{"data":{"challengeId":"…"}}` on prod, with no `devCode`. Verified live.
- **`attempts` incremented via a separate `UPDATE` before the hash compare** — closes the
  parallel-guess race. Challenge dead at 5; no remaining-attempts count in any response or i18n
  string.
- **Picker only post-verification.** `pickAccount` re-resolves candidates and rejects an
  `accountId` outside the set, and rejects a `set-password` challenge outright.
- **`setPasswordViaOtp`** is purpose-gated, requires `verifiedAt`, is single-use via
  `consumedAt`, and purges *every* session for the account.
- **Group chats can never receive a code** — every `chatsFor` query carries
  `eq(zaloChats.kind, 'user')`, and a test asserts it.
- **Google:** `state`, `nonce` and PKCE are all genuinely checked, and the nonce is compared
  against the cookie value rather than merely tested for presence. `iss`/`aud`/`exp` validated.
  The oauth cookie is cleared on every exit branch. The email-match branch requires all four
  conditions (Google-verified, exact address, `isRealEmail`, our own `email_verified_at`), which
  closes the pre-planted-email hijack.
- **`sendEmail` synthetic guard lives in the sender**, and no caller reaches Brevo directly
  (grepped).
- **`AUTH_DEV_CODES` exists only in `env.test`** — one occurrence, in the only `vars` block.
- **`NO_PASSWORD` routes to `DUMMY_HASH`** in `login()`, and the 1s failure sleep is intact.
- **Rate-limit calls precede service work** in every new intent and route.
- **`verify-email` GET does not mutate** — the loader only reads `searchParams`; the POST consumes.

Deployment (R3): prod `d1 migrations list` reports nothing pending (0051 + 0052 applied),
`PRAGMA foreign_key_check` clean, account count unchanged at 6, both new tables empty. Served OTA
manifest `gitSha` matches `origin/main`. `/auth/google` 302s to `/login` while unconfigured rather
than erroring.

Spec coverage (R5): every decision in the design doc is implemented — phone+code only with no
links in Zalo, code-then-picker, `NO_PASSWORD` sentinel instead of a nullable rebuild, additive
migrations, Brevo with no domain purchase, Google web-only and login-only, admin reset-login. The
two stale "parents cannot log in" comments were corrected. Docs updated in `docs/security.md` and
`docs/zalo.md`.

## R4 — suites not run

`npm run test:worker` and `npm run test:e2e:staging` were **not** run: CLAUDE.md restricts them to
an explicit in-session request, and none was given. Note F1 in particular would pass the new
suite anyway — the coverage gap is described above.
