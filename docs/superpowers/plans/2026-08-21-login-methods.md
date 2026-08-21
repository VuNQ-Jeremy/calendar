# Login Methods Rework — Implementation Plan

> **For agentic workers:** This plan is written for **Sonnet 5 executing every task in ONE session** (inline execution per superpowers:executing-plans), followed by **Fable 5 running the Review Protocol (final section) in a SECOND session**. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add phone + Zalo-bot OTP login/recovery, a working email password reset, and web Google SSO to Mochi, while keeping password/invite login intact.

**Architecture:** All new login methods converge on the existing channel-agnostic `createSession()` — no guard changes anywhere. Zalo OTP is a new `login_codes` challenge table + a resolution algorithm (phone → accounts → paired chats) delivered through the existing Bot API `sendText`. Email is a new no-op-without-secret service (Brevo REST) wired into the existing dead `requestReset`. Google SSO is a dependency-free OAuth code flow (PKCE + state + nonce) on two new routes. Passwordless accounts use a `NO_PASSWORD='!'` sentinel — **no table rebuild** (project memory: DROP TABLE fires FK actions on D1; the 0045 rebuild lost child rows).

**Tech Stack:** Cloudflare Workers + React Router v7, D1/drizzle, Zod (`shared/schemas.ts`), Expo/React Native (`mobile/`), Playwright e2e, vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-login-methods-design.md`, and Appendix A of this document.

## Global Constraints (apply to EVERY task)

- **NEVER run test suites on your own**: no `npm test`, `npm run test:worker`, `npm run test:e2e`, `npm run test:e2e:staging`, `npm run test:env:setup`, `cd mobile && npm run test:device`. Write and commit the specs; the user runs suites. **Exceptions you may run freely:** `npm run typecheck`, `npm run lint`, `npm run check:i18n`, `cd mobile && npm test` (vitest, ~1s), `cd mobile && npm run test:bundle` only if packaging changes.
- **Never `tsc -b`** — it emits ~150 stray .js files. `npm run typecheck` only.
- **No paid API calls, ever** (Anthropic `/enrich-vocab`/`/generate-vocab`, Workers AI image gen, Azure Speech). Nothing in this plan needs one.
- **Push to `main` only.** Commit per task; push at each phase-end task. Every push needs `node scripts/changelog.mjs "…"` in the final commit (it stages CHANGELOG.md).
- **Prod D1 migrations are applied BY HAND, BEFORE the code push** (old code + new nullable columns is safe; new code + old schema is not). After every push also run `npx wrangler d1 migrations list mochi-class --remote` to confirm state.
- **Cloudflare account is ngqv0712@gmail.com** — use the project's `CLOUDFLARE_API_TOKEN` env var; never `wrangler login` (evicts the global entag login). Check `.wrangler/cache/wrangler-account.json` if a wrangler call hits the wrong account.
- **Every push must end with a published OTA update.** The EAS workflow is quota-broken (project memory), so after phase-end pushes that touch `mobile/` run: `cd mobile && npx eas-cli update --branch preview --platform android --environment preview --message "<summary>"` (NEVER drop `--environment preview`). Verify web deploy separately: the served page's `v{build}·{hash}` stamp / gitSha must match your commit.
- **Prettier CRLF caveat:** `prettier --check` false-flags the whole tree. Format only files you touched (`npx prettier --write <files>`); don't reformat the world.
- **i18n:** every new UI string gets EN + VI keys in `src/lib/i18n.tsx`; `npm run check:i18n` must pass.
- **e2e specs use `e2e/crud-helpers.ts` contract:** locate inputs by `.mochi-field` label (no `name=`), portalled menus located from `page` with exact names, always `await posted(path)` before asserting re-rendered state. CRUD specs skip unless `E2E_BASE_URL` contains `calendar-test`.
- **Any change under `mobile/lib/` ships a mobile vitest test in the same commit** (Node 24 required for `node:sqlite`).
- **Modification tasks: READ the target file region first** and match its conventions. Code blocks in this plan for *modified* files are reference implementations — adapt names/imports to what you find; code blocks for *new* files are near-final.
- Commit messages end with: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` (review-session commits: `Claude Fable 5`).

---

## Phase 1 — Zalo OTP login (Tasks 0–10)

### Task 0: Commit spec + plan into the repo

**Files:**
- Create: `docs/superpowers/specs/2026-08-21-login-methods-design.md`
- Create: `docs/superpowers/plans/2026-08-21-login-methods.md` (this whole document)

- [x] Write both files.
- [ ] `git add docs/superpowers && git commit -m "docs: login-methods design spec + implementation plan"`

### Task 1: Shared VN phone normalizer

**Files:**
- Create: `shared/logic/phone.ts`
- Test: `test-worker/phone.test.js` (written, NOT run), `mobile/` vitest test (run)

**Interfaces (Produces):** `normalizePhone(input: string): string | null` (canonical E.164 `+84XXXXXXXXX` or passthrough `+<8-15 digits>`), `formatPhoneVN(e164: string): string`.

- [ ] **Step 1:** Read `shared/logic/invite-code.ts` for module conventions, then create `shared/logic/phone.ts`:

```ts
// VN mobile numbers only get full validation; other international numbers
// pass through — matching is exact-string on the canonical form.
export function normalizePhone(input: string): string | null {
  const raw = input.replace(/[\s().\-]/g, '')
  if (!raw) return null
  let rest: string
  if (raw.startsWith('+84')) rest = raw.slice(3)
  else if (raw.startsWith('84') && raw.length === 11) rest = raw.slice(2)
  else if (raw.startsWith('0') && raw.length === 10) rest = raw.slice(1)
  else if (raw.startsWith('+')) {
    const digits = raw.slice(1)
    return /^\d{8,15}$/.test(digits) ? `+${digits}` : null
  } else return null
  // 9 digits, first digit a live VN mobile prefix (3/5/7/8/9). Legacy 11-digit
  // 01xx forms were retired by carriers in 2018 — reject.
  if (!/^[35789]\d{8}$/.test(rest)) return null
  return `+84${rest}`
}

export function formatPhoneVN(e164: string): string {
  if (!e164.startsWith('+84')) return e164
  const d = e164.slice(3)
  return `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`
}
```

- [ ] **Step 2:** Write `test-worker/phone.test.js` (match an existing test-worker file's harness style — read `test-worker/zalo.test.js` first). Table-driven cases: `('0901234567','+84901234567')`, `('090 123-4567','+84901234567')`, `('84901234567','+84901234567')`, `('+84901234567','+84901234567')`, `('0121234567', null)` (legacy 01xx), `('012345', null)`, `('+15551234567','+15551234567')`, `('hello', null)`, `('', null)`; `formatPhoneVN('+84901234567') === '0901 234 567'`. Do NOT run the suite.
- [ ] **Step 3:** Find the mobile vitest test directory (`ls mobile`, look for existing `*.test.ts` — memory says vitest, plain Node). Add a mirror test importing from the shared path the mobile bundle uses (check how `mobile/` imports `shared/schemas` today and copy that import style).
- [ ] **Step 4:** Run `cd mobile && npm test` — expect PASS. Run `npm run typecheck` at repo root — expect clean.
- [ ] **Step 5:** `git add -A && git commit -m "feat(auth): shared VN phone normalizer"`

### Task 2: Migration 0051 — additive columns + login_codes

**Files:**
- Create: `migrations/0051_login_methods.sql`
- Modify: `server/db/schema.ts` (accounts, parents, new loginCodes)
- Modify: `server/services/crypto.ts` (NO_PASSWORD sentinel)
- Modify: `scripts/test-accounts.sql` (sweep + fixtures)

**Interfaces (Produces):** `accounts.phoneE164 | googleSub | emailVerifiedAt`, `parents.phoneE164`, `loginCodes` table, `NO_PASSWORD` constant. `password_hash` stays NOT NULL — passwordless rows store `NO_PASSWORD` (`'!'`), which `verifyPassword` can never match.

- [ ] **Step 1:** Confirm current column spellings: `npx wrangler d1 execute mochi-class-test --remote --command "SELECT sql FROM sqlite_master WHERE name IN ('accounts','parents')"` (test DB — read-only query). Adjust the SQL below to the exact existing names if they differ.
- [ ] **Step 2:** Create `migrations/0051_login_methods.sql`:

```sql
-- Additive only. NO table rebuild: DROP TABLE fires FK actions on D1
-- (see docs note on 0045). password_hash keeps NOT NULL; passwordless
-- accounts store the sentinel '!' which can never verify.
ALTER TABLE accounts ADD COLUMN phone_e164 TEXT;
ALTER TABLE accounts ADD COLUMN google_sub TEXT;
ALTER TABLE accounts ADD COLUMN email_verified_at TEXT;
CREATE INDEX idx_accounts_phone ON accounts(phone_e164);
CREATE UNIQUE INDEX idx_accounts_google_sub ON accounts(google_sub);

ALTER TABLE parents ADD COLUMN phone_e164 TEXT;
CREATE INDEX idx_parents_phone ON parents(phone_e164);

-- Best-effort backfill of common VN formats; unparseable rows stay NULL and
-- self-heal on the next people-screen edit (people.ts hook, Task 5).
UPDATE parents SET phone_e164 = '+84' || substr(replace(replace(replace(phone,' ',''),'.',''),'-',''), 2)
 WHERE phone IS NOT NULL
   AND length(replace(replace(replace(phone,' ',''),'.',''),'-','')) = 10
   AND replace(replace(replace(phone,' ',''),'.',''),'-','') LIKE '0%';
UPDATE accounts SET phone_e164 = (SELECT p.phone_e164 FROM parents p WHERE p.id = accounts.parent_id)
 WHERE parent_id IS NOT NULL;
UPDATE accounts SET phone_e164 = (
   SELECT '+84' || substr(replace(replace(replace(s.phone,' ',''),'.',''),'-',''), 2)
   FROM staff s WHERE s.id = accounts.staff_id
     AND s.phone IS NOT NULL
     AND length(replace(replace(replace(s.phone,' ',''),'.',''),'-','')) = 10
     AND replace(replace(replace(s.phone,' ',''),'.',''),'-','') LIKE '0%')
 WHERE staff_id IS NOT NULL;

CREATE TABLE login_codes (
  id          TEXT PRIMARY KEY,
  phone_e164  TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  purpose     TEXT NOT NULL DEFAULT 'login',
  account_id  TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  chat_ids    TEXT NOT NULL DEFAULT '[]',
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  verified_at TEXT,
  consumed_at TEXT
);
CREATE INDEX idx_login_codes_phone ON login_codes(phone_e164);
CREATE INDEX idx_login_codes_expires ON login_codes(expires_at);
```

- [ ] **Step 3:** Update drizzle `server/db/schema.ts`: add `phoneE164: text('phone_e164')`, `googleSub: text('google_sub')`, `emailVerifiedAt: text('email_verified_at')` to `accounts` (match the file's column-builder style exactly — read the `accounts` block at `:395` first); `phoneE164` on `parents`; new `loginCodes` table mirroring `passwordResets`' style (`:436`). This repo does not regenerate drizzle-kit meta snapshots per migration (only `migrations/meta/0000_snapshot.json` exists) — migrations are hand-written SQL and `schema.ts` is kept in sync by hand; no meta regeneration step is needed.
- [ ] **Step 4:** In `server/services/crypto.ts` add and export:

```ts
// Sentinel stored in accounts.password_hash for passwordless accounts.
// verifyPassword only accepts 'pbkdf2$…' strings, so '!' can never match,
// and login() swaps it for DUMMY_HASH to keep failure timing identical.
export const NO_PASSWORD = '!'
```

- [ ] **Step 5:** In `server/services/auth.ts` `login()` (read `:311-350` first): where the hash is chosen (`account?.passwordHash ?? DUMMY_HASH` shape), also route the sentinel to the dummy:

```ts
const hash = !account || account.passwordHash === NO_PASSWORD ? DUMMY_HASH : account.passwordHash
```

Same treatment in `changePassword` (`:604`): an account whose stored hash is `NO_PASSWORD` must fail current-password verification the same way a wrong password does (Phase 4 adds the explicit no-current path).
- [ ] **Step 6:** `scripts/test-accounts.sql`: add `DELETE FROM login_codes;` to the sweep; give the seeded e2e student account a fixed phone `+84900000001`, and insert/upsert a seeded parent (e.g. `acc-e2e-parent-0001` / a `parents` row linked to `s1` via `parent_students`) whose `phone_e164` is the SAME `+84900000001` so the picker path (one phone, two accounts) is reachable; read the file first to match its UPDATE/INSERT idioms. Note: no parent account exists in this fixture file today — add one, following the `dev@mochi.edu` / `vunq@mochi.edu` insert pattern already there, and using `ON CONFLICT` the same way.
- [ ] **Step 7:** Apply to the test DB and sanity-check: `npx wrangler d1 migrations apply mochi-class-test --remote` then `npx wrangler d1 execute mochi-class-test --remote --command "PRAGMA foreign_key_check; SELECT count(*) FROM accounts; SELECT count(*) FROM login_codes"`. Expect: no FK rows, unchanged account count, 0 codes. (Heads-up: another session may share calendar-test — if state looks alien, say so and continue; the migration is additive.)
- [ ] **Step 8:** `npm run typecheck` → clean. Commit: `feat(auth): login_codes table + phone/google/email-verified columns (migration 0051)`

### Task 3: OTP service + rate-limit policies

**Files:**
- Create: `server/services/login-otp.ts`
- Modify: `server/services/rate-limit.ts` (three policies)
- Test: `test-worker/auth-otp.test.js` (written, NOT run)

**Interfaces (Produces):**
- `requestLoginCode(rawDb, env, phoneInput: string): Promise<{ challengeId: string }>` — ALWAYS returns this shape (decoy on no-match).
- `verifyLoginCode(rawDb, env, challengeId, code): Promise<{ ok: false } | { ok: true, session: { token, expiresAt } } | { ok: true, pick: Array<{ accountId, name, kind, schoolName }> }>`
- `pickAccount(rawDb, env, challengeId, accountId): Promise<{ ok: false } | { ok: true, session }>`
- Constants: `OTP_TTL_MS = 5*60_000`, `MAX_ATTEMPTS = 5`.

- [ ] **Step 1:** Read `server/services/zalo.ts` fully (query shapes for `zaloChats`, `sendText`, `createPairCode`) and `server/services/auth.ts:61-200` (`createSession`, audit `record` usage). Then create `server/services/login-otp.ts`. Reference implementation (adapt drizzle helpers/imports to repo style):

```ts
import { normalizePhone } from '../../shared/logic/phone'
import { sendText } from './zalo'
// + drizzle imports matching repo style (eq, and, inArray, isNull, sql …)

const OTP_TTL_MS = 5 * 60_000
const MAX_ATTEMPTS = 5

function randomCode(): string {
  // rejection-sample to avoid modulo bias
  const buf = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(buf)
    if (buf[0] < 4_294_000_000) return String(buf[0] % 1_000_000).padStart(6, '0')
  }
}

async function codeHash(id: string, code: string): Promise<string> {
  const data = new TextEncoder().encode(`${id}:${code}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Candidates: (a) accounts.phone_e164 = p (any kind, suspended tenants excluded)
//             (b) parents with phone_e164 = p -> parent_students -> children's
//                 student accounts (family-phone path; parent may have no account)
// Chats per account (kind='user' only, NEVER class groups), deduped by chat_id:
//   - zalo_chats.account_id = account.id            (person-accurate, preferred)
//   - parent account: chats by parent_id, plus their children's student_id chats
//   - student account: chats by student_id, plus their parents' parent_id chats
async function resolve(rawDb, phone: string): Promise<{
  accounts: Array<{ accountId: string; name: string; kind: string; schoolName: string }>
  chatIds: string[]
}> { /* implement with the query shapes read from zalo.ts / auth.ts */ }

export async function requestLoginCode(rawDb, env, phoneInput: string) {
  const decoy = { challengeId: crypto.randomUUID() }
  const phone = normalizePhone(phoneInput)
  if (!phone) return decoy
  const { accounts, chatIds } = await resolve(rawDb, phone)
  if (accounts.length === 0 || chatIds.length === 0) return decoy
  // one live challenge per phone
  await rawDb.delete(loginCodes).where(and(eq(loginCodes.phoneE164, phone), isNull(loginCodes.consumedAt)))
  const id = crypto.randomUUID()
  const code = randomCode()
  const now = Date.now()
  await rawDb.insert(loginCodes).values({
    id, phoneE164: phone, codeHash: await codeHash(id, code), purpose: 'login',
    chatIds: JSON.stringify(chatIds), attempts: 0,
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + OTP_TTL_MS).toISOString(),
  })
  const text = accounts.length === 1
    ? `Mã đăng nhập Mochi cho ${accounts[0].name}: ${code} (hiệu lực 5 phút). Không chia sẻ mã này.`
    : `Mã đăng nhập Mochi: ${code} (hiệu lực 5 phút). Không chia sẻ mã này.`
  for (const chatId of chatIds) await sendText(env, chatId, text)
  // audit: record({ action: 'login_code_requested', meta: { phone } }) via the
  // same store/actor pattern the login intent uses
  return { challengeId: id }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function verifyLoginCode(rawDb, env, challengeId: string, code: string) {
  const row = await rawDb.query/*…*/ // load by id
  const fail = async () => { await sleep(1000); return { ok: false as const } }
  if (!row) { await codeHash(challengeId, code); return fail() }        // decoy path: same work
  if (row.consumedAt || row.attempts >= MAX_ATTEMPTS || Date.parse(row.expiresAt) < Date.now()) return fail()
  // increment BEFORE comparing — closes the parallel-guess race
  await rawDb.update(loginCodes).set({ attempts: row.attempts + 1 }).where(eq(loginCodes.id, row.id))
  if ((await codeHash(row.id, code)) !== row.codeHash) return fail()
  await rawDb.update(loginCodes).set({ verifiedAt: new Date().toISOString() }).where(eq(loginCodes.id, row.id))
  const { accounts } = await resolve(rawDb, row.phoneE164) // fresh — membership may have changed
  if (accounts.length === 0) return fail()
  if (accounts.length === 1) return consume(rawDb, env, row, accounts[0].accountId)
  return { ok: true as const, pick: accounts }
}

export async function pickAccount(rawDb, env, challengeId: string, accountId: string) {
  const row = /* load */; 
  if (!row || !row.verifiedAt || row.consumedAt || Date.parse(row.expiresAt) < Date.now()) return { ok: false as const }
  const { accounts } = await resolve(rawDb, row.phoneE164)
  if (!accounts.some((a) => a.accountId === accountId)) return { ok: false as const }
  return consume(rawDb, env, row, accountId)
}

async function consume(rawDb, env, row, accountId: string) {
  await rawDb.update(loginCodes).set({ consumedAt: new Date().toISOString() }).where(eq(loginCodes.id, row.id))
  const session = await createSession(rawDb, accountId, true) // remember=true for OTP
  // audit: record login with meta.method = 'zalo_otp'
  return { ok: true as const, session }
}
```

Key invariants (verify each is true in your implementation): decoy response byte-identical to real; attempts incremented before compare; no remaining-attempts disclosure; `kind='user'` chats only; re-resolution on verify AND pick; single live challenge per phone; suspended tenants excluded.
- [ ] **Step 2:** Read `server/services/rate-limit.ts:20-60`, add in its exact style:

```ts
export const OTP_REQUEST_POLICY = { limit: 3, periodMs: 5 * 60_000 }   // per IP — each request costs Zalo sends
export const OTP_PHONE_POLICY   = { limit: 5, periodMs: 60 * 60_000 }  // per phone — anti-harassment of a family chat
export const OTP_VERIFY_POLICY  = { limit: 10, periodMs: 60_000 }      // per IP
```

(The DO limiter fails open — `login_codes.attempts` is the real backstop; that's deliberate.)
- [ ] **Step 3:** Write `test-worker/auth-otp.test.js` covering: resolution union (a)+(b); decoy indistinguishability (shape equality of no-match vs real request response); attempts ceiling kills challenge; expiry; single-use; re-request deletes prior challenge; pick outside candidate set refused; group chats never targeted. Do NOT run.
- [ ] **Step 4:** `npm run typecheck` → clean. Commit: `feat(auth): Zalo OTP login service + rate-limit policies`

### Task 4: OTP endpoints — web intents + /api twins

**Files:**
- Modify: `shared/schemas.ts` (three inputs), `app/routes/login.tsx` (three intents), `app/routes.ts` (register three new resource routes)
- Create: `app/routes/api.auth.otp-request.tsx`, `app/routes/api.auth.otp-verify.tsx`, `app/routes/api.auth.otp-pick.tsx`
- Check: `server/api/docs/registry.ts` — if auth endpoints are documented there (they are: `/api/auth/login`, `/api/auth/redeem-invite`, `/api/auth/request-reset` all have entries), add matching entries for the three new routes and check whether any test files assert the registry/spec shape (search `test-worker` and `e2e` for `registry` or `openapi`).

**Interfaces (Consumes):** Task 3 service. **(Produces):** intents `otp-request|otp-verify|otp-pick` on `/login`; `POST /api/auth/otp-request|otp-verify|otp-pick` returning `{ challengeId }` / `{ token, expiresAt }` / `{ pick: [...] }`.

- [ ] **Step 1:** `shared/schemas.ts`:

```ts
export const OtpRequestInput = z.object({ phone: z.string().min(8).max(24) })
export const OtpVerifyInput = z.object({ challengeId: z.string().min(10), code: z.string().regex(/^\d{6}$/) })
export const OtpPickInput = z.object({ challengeId: z.string().min(10), accountId: z.string().min(1) })
```

- [ ] **Step 2:** `app/routes/login.tsx` action: read intents `login` (`:72`) and `request-reset` (`:149`) first; add `otp-request` (rate-limit `OTP_REQUEST_POLICY` by ip AND `OTP_PHONE_POLICY` by normalized phone BEFORE calling the service, mirroring the `:81` limiter-before-work ordering), `otp-verify` (limit `OTP_VERIFY_POLICY`; on `session` result set the cookie exactly as the `login` intent does with `remember=true`), `otp-pick` (same cookie mint). Non-ok results return a single generic error message key (no distinction between wrong/expired/dead).
- [ ] **Step 3:** Create the three `/api/auth/otp-*.tsx` resource routes cloned from `app/routes/api.auth.login.tsx`'s structure (`withPublic`, Zod parse, same limiter calls, `ttlDays: 90` via the same mechanism `api.auth.login` uses — `MOBILE_TTL_DAYS` from `server/api/auth.ts`). Response bodies: request → `{ challengeId }`; verify → `{ token, expiresAt }` or `{ pick }` or 401 `{ error: 'invalid_code' }`; pick → `{ token, expiresAt }` or 401. Register all three in `app/routes.ts` next to the other `api/auth/*` entries.
- [ ] **Step 4:** Add registry entries in `server/api/docs/registry.ts` for the three routes, matching the shape/style of the existing `/api/auth/login` entry.
- [ ] **Step 5:** `npm run typecheck && npm run lint` → clean. Commit: `feat(auth): OTP login endpoints (web intents + bearer twins)`

### Task 5: Self-service Zalo pairing + phone mirror hook

**Files:**
- Modify: `app/routes/profile.tsx` (new intent `zalo-pair`), `server/services/people.ts` (phone mirror)

**Interfaces (Produces):** profile intent `zalo-pair` → `{ code, expiresAt }` (a `zalo_pair_codes` row targeting `{ accountId: user.account.id }` via existing `createPairCode` in `server/services/zalo.ts:372`). people.ts: whenever staff/parent `phone` changes, person row gets `phoneE164 = normalizePhone(phone)` and the linked account (by `accounts.staffId/parentId`) mirrors it.

- [ ] **Step 1:** Read `app/routes/api.zalo.pair.tsx` (how it calls `createPairCode` — do NOT loosen that staff-only route) and `profile.tsx`'s `actionImpl` (the existing `update-profile`/`change-password` intents at lines 24 and 54). Add the `zalo-pair` intent calling `createPairCode(db, { accountId: account.id })`. Any signed-in kind may call it (no extra guard needed — `requireUser` already ran).
- [ ] **Step 2:** In `server/services/people.ts` `updateParent`/`updateStaff` (and the create paths), after writing `phone`, also write `phoneE164` on the person row and mirror onto the linked account (look up the account by `eq(accounts.parentId, id)` / `eq(accounts.staffId, id)`). One helper, called from both.
- [ ] **Step 3:** Extend `test-worker/auth-otp.test.js` (or a people test file if one exists) with: phone edit mirrors to account; unparseable phone → NULL e164, no crash. Written, not run.
- [ ] **Step 4:** `npm run typecheck` → clean. Commit: `feat(auth): self-service Zalo pairing from profile + phone mirroring`

### Task 6: Web login UI — method tabs + OTP modes

**Files:**
- Modify: `app/routes/login.tsx` (component), `src/lib/i18n.tsx`

- [ ] **Step 1:** Read the login.tsx component (modes machinery, `.mochi-field` structure, existing mode switching for reset/redeem). Add two tabs above the form: **"Zalo (SĐT)"** (default) and **"Email"**. Email tab renders today's form untouched (password login + quên mật khẩu + invite + signup links stay). Zalo tab modes:
  - `otp-phone`: one phone field + submit → intent `otp-request` → store returned `challengeId` in component state, switch to `otp-code`.
  - `otp-code`: 6-digit input (numeric keyboard: `inputMode="numeric"`, `autoComplete="one-time-code"`), generic copy "Nếu số này đã đăng ký, mã đã được gửi qua Zalo.", resend link with 60s countdown (re-posts `otp-request`), submit → `otp-verify`. On `pick` response switch to `otp-pick`; on session the action already redirected.
  - `otp-pick`: list of `{name, schoolName, kind}` buttons → `otp-pick` intent.
- [ ] **Step 2:** Add EN/VI i18n keys for every new string (tab labels, placeholders, generic-sent copy, resend, error "Mã không đúng hoặc đã hết hạn.").
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm run check:i18n` → all clean.
- [ ] **Step 4:** Commit: `feat(auth): login page Zalo OTP tab`

### Task 7: Profile "Đăng nhập & bảo mật" section (web)

**Files:**
- Modify: `app/routes/profile.tsx` (+ `src/screens-extra.jsx` `ProfileScreen`)

- [ ] **Step 1:** Loader additions (`profile.tsx` currently has no loader — check whether it needs one added, or whether `AppContext`'s `user` from `_app.tsx` already carries enough; if not, add a small loader reading paired-chat status (`zalo_chats` where `account_id = user.account.id`), `phoneE164`, `hasPassword` (`passwordHash !== NO_PASSWORD`)).
- [ ] **Step 2:** UI section in `ProfileScreen`: Zalo pairing status; "Kết nối Zalo" button → `zalo-pair` intent → show the code + instruction "Gửi mã này cho bot Mochi trên Zalo trong 24 giờ." ; login phone display (sourced from person row); password row "Đã đặt" / "Chưa đặt" (management actions land in Phase 4, keep the row informational for now). i18n keys EN/VI.
- [ ] **Step 3:** `npm run typecheck && npm run check:i18n` → clean. Commit: `feat(auth): profile login & security section`

### Task 8: Mobile OTP login

**Files:**
- Modify: `mobile/lib/endpoints.ts`, `mobile/lib/auth.tsx`, `mobile/app/login.tsx`
- Test: mobile vitest (contract additions) — RUN this one

- [ ] **Step 1:** Read the three files. `endpoints.ts`: add `otpRequest(phone)`, `otpVerify(challengeId, code)`, `otpPick(challengeId, accountId)` following the existing wrapper style for `login`/`redeemInvite` (`auth: false`, `apiFetch`).
- [ ] **Step 2:** `auth.tsx`: add `loginWithOtp` (verify + pick as two steps returning either a session or a pick list) finishing via the same `finishSignIn(token)` path `doLogin` uses.
- [ ] **Step 3:** `mobile/app/login.tsx`: add the same three OTP modes (phone → code → pick) with the Zalo tab default, mirroring the web copy. Match the existing mode-state idiom of the file.
- [ ] **Step 4:** Add/extend a mobile vitest test (`mobile/lib/contract-check.ts` or its sibling test file) covering the three new endpoint wrappers + reuse the phone normalizer test from Task 1.
- [ ] **Step 5:** Run `cd mobile && npm test` → PASS. Repo root `npm run typecheck` → clean.
- [ ] **Step 6:** Commit: `feat(mobile): Zalo OTP login`

### Task 9: AUTH_DEV_CODES escape + e2e spec

**Files:**
- Modify: `globals.d.ts` (optional `AUTH_DEV_CODES?: string`), `wrangler.jsonc` (env.test.vars ONLY)
- Create: `e2e/crud-login-otp.spec.ts` (written, NOT run)

- [ ] **Step 1:** Declare `AUTH_DEV_CODES` in `globals.d.ts` (memory: secrets/vars live there because cf-typegen drops them). In `login-otp.ts` `requestLoginCode`, when `env.AUTH_DEV_CODES` is truthy AND the challenge is real, include `devCode: code` in the return (mirrors `requestReset`'s dev-only `devUrl` at `auth.ts:572-577`). Both the web intent and the api route pass it through only when set. Add it to `wrangler.jsonc` under the test env's vars block ONLY (read how `CLOUDFLARE_ENV=test` selects config; NEVER add to top-level vars).
- [ ] **Step 2:** Write `e2e/crud-login-otp.spec.ts` guarded like other crud specs (`crud-helpers.ts`): logged-out page → Zalo tab → seeded phone `+84900000001` → `posted('/login')` → read `devCode` from the response JSON → enter code → picker shows both seeded names → pick student → lands on student home. Second test: 5 wrong codes → 6th correct code still refused (challenge dead). Third: unknown phone `0999999999` → identical generic screen, no devCode field distinction visible in UI. Do NOT run.
- [ ] **Step 3:** `npm run typecheck` → clean. Commit: `test(auth): OTP e2e spec + dev-code escape for test env`

### Task 10: Phase-1 docs, prod migration, push, OTA, live-verify

**Files:**
- Modify: `docs/security.md` (OTP threat notes: decoy indistinguishability, attempts-before-compare, AUTH_DEV_CODES only in env.test, DB counter vs fail-open limiter), `docs/zalo.md` (bot's second consumer: login codes; message formats)

- [ ] **Step 1:** Write the doc updates.
- [ ] **Step 2:** **Apply migration to prod FIRST:** `npx wrangler d1 export mochi-class --remote --output <scratchpad>/pre-0051.sql` (snapshot), then `npx wrangler d1 migrations apply mochi-class --remote`, then `npx wrangler d1 execute mochi-class --remote --command "PRAGMA foreign_key_check"` → empty.
- [ ] **Step 3:** `node scripts/changelog.mjs "Zalo OTP login: phone + code sign-in and recovery for parents/students (web + mobile)"` then commit remaining changes and `git push origin main`. (403 on push → memory `calendar-repo-github-creds`: clear stale GCM cred, retry.)
- [ ] **Step 4:** Verify deploy + migration state: `npx wrangler d1 migrations list mochi-class --remote` shows 0051 applied; fetch the prod login page and confirm the `v{build}·{hash}` stamp matches HEAD (Workers Builds is the deployer — local `wrangler deploy` would lose the race; don't run it).
- [ ] **Step 5:** Publish OTA manually (workflow is quota-broken): `cd mobile && npx eas-cli update --branch preview --platform android --environment preview --message "Zalo OTP login"`. Verify with the curl-manifest check from CLAUDE.md (read runtimeVersion from `shared/version.json`), grep `gitSha` = HEAD.
- [ ] **Step 6:** Live-verify enumeration safety on prod: `curl -s -X POST https://<prod>/api/auth/otp-request -H 'content-type: application/json' -d '{"phone":"0999999999"}'` → generic `{ challengeId }`, **no `devCode` field**. Same for a plausible-but-unknown second number; compare shapes.

---

## Phase 2 — Email provider + working reset (Tasks 11–13)

### Task 11: Email service + migration 0052

**Files:**
- Create: `server/services/email.ts`, `migrations/0052_email_verifications.sql`
- Modify: `server/db/schema.ts`, `globals.d.ts` (`EMAIL_API_KEY?`, `EMAIL_FROM?`, `EMAIL_FROM_NAME?`), `scripts/test-accounts.sql` (`DELETE FROM email_verifications;`)
- Test: `test-worker/email.test.js` (written, NOT run)

**Interfaces (Produces):** `isEmailEnabled(env)`, `isRealEmail(email): boolean` (rejects null/malformed/`*@mochi.local`), `sendEmail(env, {to, subject, text}): Promise<boolean>` — never throws, no-ops disabled/synthetic. Provider: **Brevo** REST (`POST https://api.brevo.com/v3/smtp/email`, header `api-key`), chosen because its free tier (~300/day) allows single-sender verification without owning a domain.

- [ ] **Step 1:** Migration 0052:

```sql
CREATE TABLE email_verifications (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0
);
```

- [ ] **Step 2:** `server/services/email.ts` (the `zalo.ts` isEnabled/no-op pattern):

```ts
export function isEmailEnabled(env: Env): boolean {
  return Boolean(env.EMAIL_API_KEY?.trim() && env.EMAIL_FROM?.trim())
}

export function isRealEmail(email: string | null | undefined): email is string {
  if (!email) return false
  const e = email.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !e.endsWith('@mochi.local')
}

// The synthetic-address guard lives HERE, in the sender — not in callers.
export async function sendEmail(env: Env, opts: { to: string; subject: string; text: string }): Promise<boolean> {
  if (!isEmailEnabled(env) || !isRealEmail(opts.to)) return false
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.EMAIL_API_KEY!.trim(), 'content-type': 'application/json' },
      body: JSON.stringify({
        sender: { email: env.EMAIL_FROM!.trim(), name: env.EMAIL_FROM_NAME?.trim() || 'Mochi' },
        to: [{ email: opts.to.trim() }],
        subject: opts.subject,
        textContent: opts.text,
      }),
    })
    return res.ok
  } catch {
    return false
  }
}
```

- [ ] **Step 3:** drizzle `emailVerifications` table; sweep DELETE; `test-worker/email.test.js` (synthetic refused, disabled no-op, malformed refused). Written, not run.
- [ ] **Step 4:** `npm run typecheck` → clean. Commit: `feat(auth): email service (Brevo, no-op without secret) + email_verifications table`

### Task 12: Wire reset mail + verify-email flow

**Files:**
- Modify: `server/services/auth.ts` (`requestReset` :556 — replace the `// TODO: send via email provider`), `app/routes/login.tsx` (pass origin/env through to requestReset call site), `app/routes/api.auth.request-reset.tsx`, `app/routes/profile.tsx` (verify-email intent + status), `src/lib/i18n.tsx`
- Create: `app/routes/verify-email.tsx`

- [ ] **Step 1:** `requestReset` currently takes `(db, email)` — add an `env: Env` parameter (both call sites, `login.tsx` and `api.auth.request-reset.tsx`, already have `env` in scope) and, after the existing token insert: if `isRealEmail(account.email)`, `await sendEmail(env, { to: account.email, subject: 'Đặt lại mật khẩu Mochi', text: 'Đặt lại mật khẩu Mochi: <origin>/login?mode=reset&token=… (hết hạn sau 1 giờ). Nếu không phải bạn yêu cầu, hãy bỏ qua email này.' })` — derive origin from `new URL(request.url).origin` at the call site and pass it in, since `requestReset` itself has no `Request`. Response stays enumeration-safe `{}` (web) / `{ ok: true }` (api) regardless of send outcome.
- [ ] **Step 2:** Profile: "Xác minh email" button (shown for real, unverified emails) → intent creates an `email_verifications` row (hash-at-rest like `password_resets`, 24h TTL) and mails `<origin>/verify-email?token=…`. Under `AUTH_DEV_CODES` return `devUrl` for e2e.
- [ ] **Step 3:** `app/routes/verify-email.tsx`: GET renders a confirm button (never mutate on GET); POST consumes the token → sets `accounts.email_verified_at`. Also: wherever `accounts.email` is updated (grep for `.set({ email` across `server/services/`), clear `email_verified_at` in the same statement.
- [ ] **Step 4:** e2e: extend the profile spec (or create `e2e/crud-verify-email.spec.ts`) driving verify via `devUrl`. Written, not run. i18n keys EN/VI.
- [ ] **Step 5:** `npm run typecheck && npm run check:i18n` → clean. Commit: `feat(auth): password-reset email + pull-based email verification`

### Task 13: Phase-2 push

- [ ] **Step 1:** Apply 0052 to test DB, then prod (same choreography as Task 10 Step 2 — snapshot, apply, fk_check).
- [ ] **Step 2:** `node scripts/changelog.mjs "Email password reset + email verification (Brevo; inactive until EMAIL_API_KEY is set)"`, commit, push, verify deploy + migrations list.
- [ ] **Step 3:** No mobile changes this phase → no OTA needed; state that in your report. **USER STEP (report, don't wait):** create a free Brevo account, verify a sender address, then `npx wrangler secret put EMAIL_API_KEY` + set `EMAIL_FROM`/`EMAIL_FROM_NAME` vars. Until then email paths no-op safely.

---

## Phase 3 — Google SSO, web only (Tasks 14–16)

### Task 14: google-auth service + oauth cookie

**Files:**
- Create: `server/services/google-auth.ts`
- Modify: `server/session.ts` (oauth cookie), `globals.d.ts` (`GOOGLE_CLIENT_ID?`, `GOOGLE_CLIENT_SECRET?`)
- Test: `test-worker/google-auth.test.js` (written, NOT run)

**Interfaces (Produces):**
- `oauthCookie` in `server/session.ts`: httpOnly, secure, `sameSite: 'lax'`, `maxAge: 600`, path `/`, name `__mochi_oauth` (sibling of the session cookie; unsigned is fine — it only stores our own random values).
- `googleEnabled(env): boolean` (both secrets present).
- `beginGoogleAuth(env, { next, link }): { redirectUrl, cookiePayload: { state, nonce, verifier, next, link } }` — PKCE S256 (`base64url(sha256(verifier))`), authorize URL `https://accounts.google.com/o/oauth2/v2/auth` with `response_type=code&scope=openid email profile&prompt=select_account`.
- `exchangeAndValidate(env, { code, verifier, nonce, redirectUri }): Promise<{ sub, email, emailVerified } | null>` — POST `https://oauth2.googleapis.com/token` (code flow with client secret over TLS; per OIDC Core §3.1.3.7 signature verification is not required in this flow), decode id_token payload (base64url middle segment), validate `iss` ∈ {`https://accounts.google.com`,`accounts.google.com`}, `aud === GOOGLE_CLIENT_ID`, `exp` in future, `nonce` matches. Null on any failure.
- `matchGoogleAccount(rawDb, { sub, email, emailVerified }): Promise<{ accountId } | { error: 'no_account' | 'unverified' }>` — (1) `google_sub` match → in; (2) else `emailVerified && accounts.email === lower(email) && isRealEmail && email_verified_at IS NOT NULL` → pin sub, in; (3) else `no_account`. Suspended-tenant check like `login()`.

- [ ] **Step 1:** Implement the service (pure functions, `fetch` only in `exchangeAndValidate`). Base64url helpers via `btoa`/manual, WebCrypto for SHA-256.
- [ ] **Step 2:** Add the cookie to `server/session.ts` following the existing `createCookie` usage for `sessionCookie`.
- [ ] **Step 3:** `test-worker/google-auth.test.js`: `matchGoogleAccount` all three branches + unverified-Google-email refused + synthetic-account-email refused + our-side-unverified refused; id_token validation rejects wrong iss/aud/expired/nonce (feed hand-built JWTs — no network). Written, not run.
- [ ] **Step 4:** `npm run typecheck` → clean. Commit: `feat(auth): google oauth service (PKCE code flow, verified-email matching)`

### Task 15: Google routes + UI + profile linking

**Files:**
- Create: `app/routes/auth.google.tsx`, `app/routes/auth.google.callback.tsx`
- Modify: `app/routes/login.tsx` (button under Email tab, `?error=` copy), `app/routes/profile.tsx` (link/unlink intents + row), `src/lib/i18n.tsx`, `app/routes.ts` (register the two new routes, outside the `_app` layout like `/login`)

- [ ] **Step 1:** `auth.google.tsx` loader: 404 (or redirect `/login`) when `!googleEnabled(env)`; else `beginGoogleAuth`, set `__mochi_oauth`, 302 to Google. Accept `?next=` (sanitize: same-origin path only) and `?link=1` (requires a live session — `requireUser`).
- [ ] **Step 2:** `auth.google.callback.tsx` loader: read cookie; state mismatch/expired → `/login?error=google_state`; exchange+validate → null → `/login?error=google_failed`. If `link` flag: pin `google_sub` to the signed-in account (explicit action replaces email-match; refuse with `?error=google_sub_taken` if the sub is pinned elsewhere), also set `email_verified_at` when addresses match, redirect `/profile`. Else `matchGoogleAccount` → session cookie exactly like the login intent (`remember=true`) → redirect to `next`/home; `no_account` → `/login?error=google_no_account`. Clear the oauth cookie in every branch. Rate-limit callback per-IP with a `LOGIN_POLICY`-shaped policy.
- [ ] **Step 3:** Login page: "Đăng nhập bằng Google" — plain anchor to `/auth/google`, rendered only when the loader says `googleEnabled`; error-code → friendly VI/EN copy ("Email Google này chưa liên kết với tài khoản Mochi — đăng nhập bằng mật khẩu rồi liên kết trong Hồ sơ.").
- [ ] **Step 4:** Profile: "Liên kết Google" (anchor `/auth/google?link=1`) / "Hủy liên kết" intent — unlink **guarded**: refuse if no password (`NO_PASSWORD`) AND no account-paired Zalo chat.
- [ ] **Step 5:** e2e additions (written, not run): button hidden without secrets (calendar-test has none → assert absent there), `/auth/google` 302s to `accounts.google.com` when enabled (skip if env lacks secrets — guard in spec).
- [ ] **Step 6:** `npm run typecheck && npm run lint && npm run check:i18n` → clean. Commit: `feat(auth): Sign in with Google (web)`

### Task 16: Phase-3 push

- [ ] `node scripts/changelog.mjs "Sign in with Google on web (inactive until OAuth client configured)"`, commit, push, verify deploy. No migration, no mobile → no OTA. **USER STEP (report):** create the OAuth client in Google Cloud console (redirect URI `https://<prod-host>/auth/google/callback`), then `npx wrangler secret put GOOGLE_CLIENT_SECRET` and set `GOOGLE_CLIENT_ID` var.

---

## Phase 4 — Passwordless invites + method management (Tasks 17–20)

### Task 17: Passwordless invite redeem

**Files:**
- Modify: `shared/schemas.ts` (`RedeemInviteInput`: `password` optional, add optional `phone`), `server/services/auth.ts` (`redeemInvite` :393-544), `app/routes/login.tsx` (redeem UI toggle), `app/routes/api.auth.redeem-invite.tsx`, `mobile/app/login.tsx` invite mode, i18n

- [ ] **Step 1:** Server rule in `redeemInvite`: accept iff (valid password) OR (invite is student/parent-linked AND `normalizePhone(phone)` succeeds AND the Phase-1 `resolve()` for that phone — scoped to this invite's person/family — finds ≥1 reachable chat). Staff invites keep password mandatory. Passwordless insert: `passwordHash: NO_PASSWORD`, `phoneE164`. Refusal error key: `no_login_method`.
- [ ] **Step 2:** Web redeem mode: "Dùng Zalo, không cần mật khẩu" toggle swaps password field for phone field, hint copy "Bạn sẽ đăng nhập bằng mã gửi qua Zalo." Mobile invite mode mirrors it. i18n both.
- [ ] **Step 3:** Extend `e2e/crud-invite-redeem.spec.ts` (find exact spec name via `ls e2e/`, may be `crud-invites.spec.ts` or similar — check first): passwordless happy path + refused-no-method. Extend test-worker redeem tests. Written, not run. Mobile change → extend mobile vitest contract test, RUN `cd mobile && npm test` → PASS.
- [ ] **Step 4:** `npm run typecheck && npm run check:i18n` → clean. Commit: `feat(auth): passwordless invite redeem via Zalo phone`

### Task 18: Method management + forgot-password via Zalo

**Files:**
- Modify: `server/services/auth.ts` (`changePassword` :604), `server/services/login-otp.ts` (purpose `set-password`), `app/routes/login.tsx` ("Quên mật khẩu?" gains a Zalo path), `app/routes/profile.tsx` (set/remove password), i18n

- [ ] **Step 1:** `changePassword`: add an `allowNoCurrent` branch — when stored hash is `NO_PASSWORD`, skip current-password verification; keep the purge-other-sessions behavior (`:629-631`).
- [ ] **Step 2:** Profile: "Đặt mật khẩu" (no current required when sentinel) / "Đổi mật khẩu" (current required) / "Xóa mật khẩu" — remove sets `NO_PASSWORD`, **guarded** by another-method-exists (account-paired chat OR `google_sub`), and purges other sessions.
- [ ] **Step 3:** Forgot-via-Zalo on login page: the reset entry offers "Qua email" (existing) and "Qua Zalo": `otp-request` with `purpose: 'set-password'` (service stores it; message copy "Mã đặt lại mật khẩu Mochi…"), then `otp-verify`; a verified `set-password` challenge does NOT mint a session — instead new intent `otp-set-password { challengeId, accountId?, newPassword }` (accountId required when the phone matched several): validates verified+unconsumed+unexpired+candidate, writes the new hash, consumes, purges ALL sessions like `resetPassword` (`:594`). `NewPassword` Zod floor applies.
- [ ] **Step 4:** Tests written (test-worker: set-password purpose can't mint a session, otp-set-password purges sessions, remove-password guard refuses last method; e2e `e2e/crud-profile-auth.spec.ts`: set → remove → refused-when-last). i18n keys.
- [ ] **Step 5:** `npm run typecheck && npm run check:i18n` → clean. Commit: `feat(auth): password set/remove + forgot-password via Zalo code`

### Task 19: Staff "reset login" action in People

**Files:**
- Modify: `server/services/people.ts` (or `server/services/invites.ts` — put it beside `createInvite`'s targets), the People screen (`src/screens-manage/people.tsx`), its route action, `app/routes/api.invites.tsx` area if the action belongs there, i18n

- [ ] **Step 1:** Admin-only action `reset-login` on a person (staff/student/parent): sets the linked account's hash to `NO_PASSWORD`, deletes all its sessions, mints a fresh **linked** invite code via the existing invite-minting path (`server/services/invites.ts` — check the exact export name for issuing a linked invite before assuming `createLinkedInvite`), returns the code for on-screen display ("Đưa mã này cho phụ huynh/học sinh"). No-op with clear error when the person has no account. Audit-logged like other admin mutations (the `withAuth` auto-log likely covers it — verify).
- [ ] **Step 2:** People UI: the action in the person's row menu (follow the existing card-action pattern — beware memory `card-actions-swallow-the-click`: attach per-button, not container-level). Confirm dialog before firing (destructive: kills sessions).
- [ ] **Step 3:** e2e: extend the people/invites spec with reset-login lifecycle (create person+invite → redeem → reset-login → old session dead is not e2e-visible, assert new code issued). test-worker: sessions purged, hash sentinel set. Written, not run.
- [ ] **Step 4:** `npm run typecheck && npm run check:i18n` → clean. Commit: `feat(people): admin reset-login action`

### Task 20: Final sweep + Phase-4 push

- [ ] **Step 1:** Fix the two stale comments asserting parents can't log in: `server/db/schema.ts:821-822`, `app/routes/api.zalo.pair.tsx:12-13`.
- [ ] **Step 2:** Docs: `docs/security.md` (Phase 2–4 additions: sendEmail choke point, oauth cookie, last-method guards, otp-set-password), `docs/zalo.md` (set-password codes), any backend-overview doc's auth section if one exists.
- [ ] **Step 3:** Self-review pass: grep your diff for TODO/TBD; re-check every invariant listed in Task 3 Step 1; `npm run typecheck && npm run lint && npm run check:i18n && cd mobile && npm test`.
- [ ] **Step 4:** `node scripts/changelog.mjs "Passwordless invites, password management, forgot-password via Zalo, admin reset-login"`, commit, push, verify deploy + `d1 migrations list` still clean.
- [ ] **Step 5:** OTA publish (mobile changed in Task 17): `cd mobile && npx eas-cli update --branch preview --platform android --environment preview --message "Passwordless invite redeem"` + gitSha verify.
- [ ] **Step 6:** Final report to the user, including the **handoff checklist**:
  1. Run suites when convenient: `npm run test:worker`, `npm run test:e2e:staging` (~4 min, resets calendar-test), `cd mobile && npm test` (already green).
  2. Brevo: create account → verify sender → `wrangler secret put EMAIL_API_KEY`, set `EMAIL_FROM`.
  3. Google: create OAuth client → `wrangler secret put GOOGLE_CLIENT_SECRET`, set `GOOGLE_CLIENT_ID`.
  4. Real-device smoke: pair a Zalo chat to a test account, request a code on prod, confirm delivery + login.
  5. Then launch the Fable 5 review session (section below).

---

## Review Protocol — Fable 5, separate session, AFTER execution completes

> Run this as its own conversation. You are reviewing Sonnet 5's implementation of this plan against the spec (`docs/superpowers/specs/2026-08-21-login-methods-design.md`). Deliverable: a written review report (post as `docs/superpowers/reviews/2026-08-21-login-methods-review.md`, committed), findings ranked by severity, each with file:line and a concrete failure scenario. Fix nothing without the user's go-ahead — report first.

**R1 — Scope + diff inventory.** `git log --oneline` since the commit before Task 0; read the full diff (`git diff <base>..HEAD`). Confirm every plan task has a commit and no unplanned surface changed (especially: `api.zalo.pair.tsx` still staff-only; no paid-API code paths added; `AUTH_DEV_CODES` absent from top-level `wrangler.jsonc` vars).

**R2 — Security invariants (the core of this review).** Verify in code, not by trusting commit messages:
- Decoy path: no-match `otp-request` returns the same shape/status; verify-against-decoy does equivalent work + 1s sleep. Diff the two code paths line by line.
- `attempts` incremented via UPDATE **before** hash comparison; challenge dead at 5; no remaining-attempts leak in any response or i18n string.
- Picker only reachable post-verification; `pickAccount` re-validates candidate membership; group chats (`kind='group'`) can never receive codes.
- `otp-set-password` cannot mint a session; consuming purges all sessions.
- `sendEmail` refuses `@mochi.local` inside the sender (grep for any caller that emails directly via fetch, bypassing it).
- Google: sub pinned once (unique index); email-match branch requires all four conditions (Google-verified, exact email, isRealEmail, our `email_verified_at`); state+nonce+PKCE all actually checked in the callback (common miss: nonce validated against the cookie, not just present); oauth cookie cleared on every branch; `next` sanitized to same-origin path.
- Unlink/remove-password last-method guards can't be raced into a methodless account (two tabs).
- Rate-limit calls precede service work in every new intent/route (the `:81` ordering).
- `login()` timing: sentinel hash routes to `DUMMY_HASH`; 1s failure sleep intact.

**R3 — Live prod probes** (read-only, no state mutation beyond throwaway challenges):
- `otp-request` with unknown vs known-but-unpaired phone → byte-compatible generic responses, no `devCode`.
- `verify-email` GET does not consume (fetch it twice).
- `/auth/google` 302s (or cleanly 404s if secrets unset) — never 500.
- `d1 migrations list mochi-class --remote` → 0051+0052 applied; OTA manifest gitSha == HEAD.

**R4 — Suites.** Ask the user for permission to run `npm run test:worker` and `npm run test:e2e:staging` in this session (baseline is ZERO failures — memory; any failure is real). With permission: run, triage every failure to root cause (memory `test-env-calendar-test`: migrate + redeploy calendar-test as a PAIR first via `npm run test:env:setup`, and beware a concurrent session sharing staging). Without permission: mark R4 skipped in the report.

**R5 — Spec + quality review.** Compare implementation to the design spec section by section (spec-coverage table in the report: requirement → file:line → ✓/✗). Then a quality pass: dead code, duplicated resolution logic between verify/pick, i18n parity, mobile/web copy drift, missing sweep DELETEs for new tables, stale-comment fixes actually done.

**R6 — Report + memory.** Write the review file, commit + changelog + push (review-only commit is fine). Save a memory note if a durable trap was found. Summarize findings to the user with a fix/no-fix recommendation per item.

---

## Appendix A — Design Spec (approved 2026-08-21)

See `docs/superpowers/specs/2026-08-21-login-methods-design.md` for the full text (context, decisions, mechanism summary, current-state facts). Duplicated here only as a quick-reference:

- Audience: parents + students; staff keep password. Zalo mechanism: Bot API phone+6-digit code only, never links inside Zalo. Code-first/picker-second for enumeration safety. Passwordless via `NO_PASSWORD='!'` sentinel. Email via Brevo free tier, pull-based verification. Google SSO web-only login-only with verified-email matching. Admin "reset login" action in People.
