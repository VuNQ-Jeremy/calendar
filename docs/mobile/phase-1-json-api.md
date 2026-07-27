# Phase 1 — JSON API on the Worker

**Depends on:** Phase 0
**Touches:** `server/services/auth.ts`, `server/services/crypto.ts` (read-only),
`server/db/schema.ts`, `migrations/`, `shared/schemas.ts`, new `server/api/`,
new `app/routes/api.*.tsx`, `app/routes.ts`, `test-worker/`
**Risk:** medium — new surface area, but purely additive
**Bar:** **zero web regression.** Nothing the browser does may change.

## Why

There is no JSON API. The `/api/*` Worker was deleted in refactor phase 3 — every byte of data
now moves through React Router loaders and actions, and every mutation is `FormData` with an
`intent` discriminator. A native client cannot use any of it:

- Loaders are reachable as `GET /calendar.data`, but that is React Router's **single-fetch
  turbo-stream protocol** — an undocumented private framework encoding that will break on
  upgrades. Not a contract.
- Auth throws `redirect('/login?next=…')`, which a native fetch client cannot follow
  meaningfully.
- Sessions are `httpOnly` cookies. A React Native app has no cookie jar by default.

The good news: `server/services/*.ts` are plain `(db, …)` functions with no HTTP awareness, and
`shared/schemas.ts` already validates every payload shape. **This phase writes no business
logic.** It is auth glue, routing glue, and tests.

---

## Task 1.1 — Bearer-token authentication

### The refactor

`getUser` at `server/services/auth.ts:45-105` does two things welded together: it reads the
cookie, and it resolves a raw token to a `SessionUser`. Split them.

```ts
// server/services/auth.ts — NEW export, extracted from the body of getUser()

/**
 * Resolve a RAW session token to a SessionUser. The token is hashed before lookup —
 * `sessions.token` stores the SHA-256 hash, never the raw value.
 * Deletes the row and returns null if the session has expired.
 */
export async function userFromToken(db: Db, rawToken: string): Promise<SessionUser | null> {
  const tokenHash = await hashToken(rawToken);
  const sessionRow = await db.query.sessions.findFirst({ where: eq(sessions.token, tokenHash) });
  if (!sessionRow) return null;
  if (new Date(sessionRow.expiresAt) < new Date()) {
    await db.delete(sessions).where(eq(sessions.token, tokenHash));
    return null;
  }
  // …accounts lookup, then the staffId / studentId branch, verbatim from getUser…
  // Parent accounts still return null — they remain unsupported.
}

// getUser() becomes:
export async function getUser(request: Request, env: Env): Promise<SessionUser | null> {
  const db = createDb(env);
  const rawToken = await sessionCookie.parse(request.headers.get('Cookie'));
  if (!rawToken || typeof rawToken !== 'string') return null;
  return userFromToken(db, rawToken);
}
```

This is a **behavior-preserving extraction**. `getUser`'s observable behavior must not change.

### Session TTL

`createSession(db, accountId, remember)` currently hardcodes 1 day / 30 days
(`auth.ts:36-43`). Add an optional override:

```ts
export async function createSession(
  db: Db, accountId: string, remember: boolean, ttlDays?: number,
): Promise<string> {
  const days = ttlDays ?? (remember ? 30 : 1);
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
  // …unchanged…
}
```

Mobile logins pass `ttlDays: 90`. Existing web callers pass nothing and behave identically.

### Sliding expiry

A phone app that logs you out every 90 days regardless of use is bad; one that never expires is
worse. Slide the window forward on use:

```ts
// server/services/api-auth.ts
const SLIDE_THRESHOLD_MS = 7 * 86_400_000;  // only write if <7 days of the window has been used
```

On each authenticated API request, if `expiresAt` is more than `SLIDE_THRESHOLD_MS` in the
past-relative sense (i.e. the session has been alive a while), issue a single
`UPDATE sessions SET expires_at = ?`. **Throttle this** — do not write to D1 on every request.
Compare `expiresAt` against `now + 83 days`; only extend when it has dropped below that.

### The API guards

Create `server/api/auth.ts` (or `server/services/api-auth.ts` — pick one and be consistent):

```ts
function bearer(request: Request): string | null {
  const h = request.headers.get('Authorization');
  if (!h?.startsWith('Bearer ')) return null;
  return h.slice(7).trim() || null;
}

export async function requireApiUser(request: Request, env: Env): Promise<SessionUser> {
  const raw = bearer(request);
  const user = raw ? await userFromToken(createDb(env), raw) : null;
  if (!user) throw Response.json({ error: 'unauthorized' }, { status: 401 });
  return user;
}

export async function requireApiStaff(request: Request, env: Env): Promise<SessionUser> {
  const u = await requireApiUser(request, env);
  if (u.kind !== 'staff') throw Response.json({ error: 'forbidden' }, { status: 403 });
  return u;
}

export async function requireApiAdmin(request: Request, env: Env): Promise<SessionUser> {
  const u = await requireApiStaff(request, env);
  if (u.user.role !== 'Admin') throw Response.json({ error: 'forbidden' }, { status: 403 });
  return u;
}
```

> **Critical:** these throw **`Response`**, never `redirect`. The web guards throw
> `redirect('/login?next=…')` (`auth.ts:118`) and `redirect('/flashcards')` (`auth.ts:125`).
> A 302 to an HTML login page is useless to a native client and will present as a confusing
> parse error. The API must return machine-readable 401 / 403.
>
> Note `requireAdmin` already returns a 403 JSON rather than a redirect (`auth.ts:132`) — that
> one is fine as a model.

### Also accept bearer tokens on the existing file routes

`app/routes/materials.$id.download.tsx` and `materials.$id.view.tsx` stream R2 objects and
currently authenticate by cookie. Add a bearer fallback so the mobile app can fetch a material:
try the cookie, then the `Authorization` header. Same for `app/routes/translate.tsx` (staff-only
Anthropic proxy) — add the bearer branch rather than creating a duplicate route.

---

## Task 1.2 — Migration `migrations/0014_mobile.sql`

> **Numbered `0014`, not `0013`.** Phase 0 takes `0013_app_version.sql` for the `feedback`
> table's `app_version` column. Check `migrations/` before creating the file.

```sql
-- Expo push registration. One row per installed device.
CREATE TABLE push_tokens (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expo_token   TEXT NOT NULL UNIQUE,
  platform     TEXT NOT NULL DEFAULT 'android',
  created_at   TEXT NOT NULL,
  last_seen_at TEXT
);
CREATE INDEX idx_push_tokens_account ON push_tokens(account_id);

-- Idempotency key for offline flashcard results replayed from the mobile outbox.
ALTER TABLE flashcard_results ADD COLUMN client_id TEXT;
CREATE UNIQUE INDEX idx_flashcard_results_client_id
  ON flashcard_results(client_id) WHERE client_id IS NOT NULL;
```

**Mirror both in `server/db/schema.ts`.** The existing `flashcardResults` table
(`schema.ts:333-352`) has columns `id, studentId, staffId, topicId, mode, score, total,
durationMs, playedAt`. Add `clientId: text('client_id')` and the partial unique index.

> Note the existing shape: `studentId` and `staffId` are **both nullable** — staff plays are
> recorded too (commit `cdaee23`), and `flashcard_mastery` is keyed on `studentId` only, so
> staff plays produce a result row but no mastery row. Preserve this exactly.

**Add to `shared/schemas.ts`** — extend `FlashcardResultInput` (line 254):

```ts
export const FlashcardResultInput = z.object({
  clientId: z.string().uuid().optional(),   // ← NEW. Optional, so the web path is unaffected.
  topicId: z.string().min(1),
  // …everything else unchanged…
});

/** Batch envelope for the mobile offline outbox flush. */
export const FlashcardResultBatch = z.object({
  results: z.array(FlashcardResultInput).min(1).max(50),
});

export const PushRegisterInput = z.object({
  expoToken: z.string().min(1).max(500),
  platform: z.enum(['android', 'ios']).default('android'),
});
```

On insert, use `ON CONFLICT(client_id) DO NOTHING` so a replayed result is a silent no-op.
**Return the count actually inserted** so the client can log it.

**Apply:** `npm run db:migrate:local` if local D1 works, otherwise `npm run db:migrate` (remote).

---

## Task 1.3 — `server/api/handler.ts`

Write these helpers once. Every route file should then be ~15 lines.

```ts
/** Success envelope. Every 2xx response is { data: … }. */
export function ok<T>(data: T, status = 200): Response

/** Error envelope. Every non-2xx is { error: string, issues?: … }. */
export function fail(error: string, status: number, issues?: unknown): Response

/**
 * Wraps a handler with auth + uniform error handling. Catches thrown Responses (the guards)
 * and returns them; catches everything else as a 500 without leaking internals.
 */
export function withAuth<T>(
  level: 'user' | 'staff' | 'admin',
  handler: (ctx: { user: SessionUser; db: Db; env: Env; request: Request; params: Params }) => Promise<T>,
): (args: LoaderArgs | ActionArgs) => Promise<Response>

/** JSON body → Zod. Returns 422 { error: 'validation_failed', issues } on failure. */
export async function parseBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>>

/**
 * Factory for the standard collection shape. Returns { loader, action } implementing
 * GET (list), POST (create), PATCH (update via ?id= or :id), DELETE.
 * Uses parsePatch() from shared/schemas.ts for PATCH so absent keys are not overwritten
 * with defaults — see the doc comment at shared/schemas.ts:3-8, this is a real bug class.
 */
export function crud(cfg: {
  level: 'user' | 'staff' | 'admin';
  schema: z.ZodObject<z.ZodRawShape>;
  list:   (db: Db, user: SessionUser) => Promise<unknown>;
  create: (db: Db, input: unknown, user: SessionUser) => Promise<unknown>;
  update: (db: Db, id: string, patch: unknown, user: SessionUser) => Promise<unknown>;
  remove: (db: Db, id: string, user: SessionUser) => Promise<unknown>;
}): { loader: LoaderFunction; action: ActionFunction }
```

**CORS.** Add an `OPTIONS` responder and `Access-Control-Allow-Origin/Headers/Methods` on
`/api/*` only. Native `fetch` ignores CORS entirely, but this keeps the Expo **web** target and
browser-based debugging usable. Allow the `Authorization` and `Content-Type` headers.

**Rate limiting.** Keep the existing anti-enumeration behavior on the API login path: the
`await new Promise(r => setTimeout(r, 1000))` on failure at `auth.ts:163` is inside `login()`,
so it comes along for free. **Do not remove or shortcut it.**

---

## Task 1.4 — Route files

Register every one in `app/routes.ts` **outside** the `layout('routes/_app.tsx', …)` block —
they must not inherit the app shell loader.

```ts
route('api/auth/login', 'routes/api.auth.login.tsx'),
route('api/bootstrap',  'routes/api.bootstrap.tsx'),
route('api/events',     'routes/api.events.tsx'),
route('api/events/:id', 'routes/api.events.$id.tsx'),
// …etc
```

> **Resource routes must have no default export.** If a route module exports a component,
> React Router treats a GET as a document request and server-renders HTML. The existing
> `app/routes/materials.$id.view.tsx` carries this exact warning as a comment — read it.

### Endpoint surface

| Endpoint | Methods | Auth | Service / source | Mirrors |
|---|---|---|---|---|
| `/api/auth/login` | POST | — | `auth.login` + `createSession(…, ttlDays: 90)` | `login.tsx` |
| `/api/auth/logout` | POST | user | delete the session row | `logout.tsx` |
| `/api/auth/me` | GET | user | `userFromToken` | — |
| `/api/auth/redeem-invite` | POST | — | `auth.redeemInvite` | `login.tsx` |
| `/api/auth/request-reset` | POST | — | `auth.requestReset` | `login.tsx` |
| `/api/auth/change-password` | POST | user | `auth.changePassword` | `profile.tsx` |
| `/api/bootstrap` | GET | user | aggregate | **new** |
| `/api/dashboard` | GET | staff | mixed | `dashboard.tsx` |
| `/api/events` · `/api/events/:id` | GET POST PATCH DELETE | staff | `events.ts` | `calendar.tsx` |
| `/api/classes` · `/:id` | GET POST PATCH DELETE | staff | `classes.ts` | `classes.tsx` |
| `/api/students` · `/:id` | GET POST PATCH DELETE | staff | `people.ts` | `people.tsx` |
| `/api/staff` · `/:id` | GET POST PATCH DELETE | staff | `people.ts` | `people.tsx` |
| `/api/parents` · `/:id` | GET POST PATCH DELETE | staff | `people.ts` | `people.tsx` |
| `/api/invites` · `/:id` | GET POST DELETE | staff | `invites.ts` | `people.tsx` |
| `/api/homework` · `/:id` | GET POST PATCH DELETE | staff | `homework.ts` | `homework.tsx` |
| `/api/homework/:id/grades` | GET POST | staff | `homework.ts` | `intent=save-grades` |
| `/api/materials` · `/:id` | GET POST PATCH DELETE | staff | `materials.ts` | `materials.tsx` |
| `/api/assessments/scores` · `/:id` | GET POST PATCH DELETE | staff | `assessments.ts` | `assessments.tsx` |
| `/api/assessments/behavior` · `/:id` | GET POST PATCH DELETE | staff | `assessments.ts` | `assessments.tsx` |
| `/api/assessment-types` · `/:id` | GET POST PATCH DELETE | **admin** | `assessment-types.ts` | `config.tsx` |
| `/api/assessment-types/reorder` | POST | **admin** | `assessment-types.ts` | `config.tsx` |
| `/api/attendance` | GET POST | staff | `attendance.ts` | `attendance.tsx` |
| `/api/event-materials` | GET POST | staff | `event-materials.ts` | `event-materials.tsx` |
| `/api/flashcards/topics` · `/:id` | GET POST PATCH DELETE | GET **user**, writes staff | `flashcards.ts` | `flashcards.tsx` |
| `/api/flashcards/topics/:slug` | GET | user | `flashcards.ts` | `flashcards.$slug.tsx` |
| `/api/flashcards/words` · `/:id` | POST PATCH DELETE | staff | `flashcards.ts` | `flashcards.$slug.tsx` |
| `/api/flashcards/import` | POST | staff | `flashcards.ts` | bulk paste |
| `/api/flashcards/results` | POST | **user** | `flashcards.ts` | `intent=record-result` |
| `/api/feedback` · `/:id` | GET POST PATCH | staff | `feedback.ts` | `feedback.tsx` |
| `/api/profile` | GET PATCH | user | `people.ts` | `profile.tsx` |
| `/api/settings/theme` | GET PATCH | staff | `theme.ts` | `intent=theme` |
| `/api/settings/ui-prefs` | GET PATCH | user | `ui-prefs.ts` | `config.tsx` |
| `/api/push/register` · `/api/push/unregister` | POST | user | **new** `server/services/push.ts` | — |

### Auth-level rules (get these right)

- **`/api/flashcards/topics` GET and `/api/flashcards/results` POST are `user`, not `staff`.**
  Students play games. This mirrors `flashcards.tsx` and `flashcards.$slug.tsx`, which are the
  only two app routes students can reach.
- Everything else under `/api/flashcards/*` is **staff** (topic and word CRUD, import).
- `/api/assessment-types*` is **admin** — `config.tsx` is admin-only.
- `/api/profile` and `/api/settings/ui-prefs` are **user** — students have a profile.

### `/api/bootstrap` — the one new endpoint

Not a mirror of any web route. Mobile screens all need the same reference data, and doing five
round trips over a Vietnamese mobile connection on every cold start is the difference between a
fast app and a slow one. Return, in one response:

```ts
{ user, classes, students, assessmentTypes, uiPrefs, theme, badgeCounts }
```

For a **student**, return only `{ user, uiPrefs }` — they must not receive the roster.
`badgeCounts` mirrors what the `_app.tsx` layout loader computes for the sidebar.

### File upload

`/api/materials` POST keeps **multipart `FormData`**, not JSON. R2 upload is already multipart
in `materials.tsx`, and `expo-document-picker` yields a file URI that React Native's `FormData`
handles natively. Keep the existing 20 MB cap and the same `file_key` convention so
`/materials/:id/view` keeps working.

---

## Task 1.5 — Tests

Add to `test-worker/` (the `@cloudflare/vitest-pool-workers` suite, run by
`npm run test:worker`).

`test-worker/api-auth.test.ts`:
- [ ] POST `/api/auth/login` with good credentials → 200, `{ data: { token, user, expiresAt } }`.
- [ ] The returned token is the **raw** token; the `sessions` row stores its **hash**.
- [ ] POST with a wrong password → 401 and **no** session row created.
- [ ] POST with an unknown email → 401, and the response time is comparable to the wrong-password
      case (the anti-enumeration delay still fires).
- [ ] GET `/api/bootstrap` with `Authorization: Bearer <token>` → 200.
- [ ] GET `/api/bootstrap` with no header → **401**, and the body is JSON — **assert it is not a
      302 and not HTML.** This is the single most important test in the phase.
- [ ] GET `/api/bootstrap` with a garbage token → 401.
- [ ] An expired session → 401, and the row is deleted.
- [ ] A **student** token against `/api/students` → **403**, not a redirect to `/flashcards`.
- [ ] A **Teacher** token against `/api/assessment-types` → 403.
- [ ] POST `/api/auth/change-password` invalidates every other session but keeps the caller's.

`test-worker/api-crud.test.ts`:
- [ ] Create → list → patch → delete an event, asserting the row in D1 at each step.
- [ ] PATCH with a partial body does **not** reset unspecified columns to their Zod defaults
      (this is exactly what `parsePatch` at `shared/schemas.ts:9` exists to prevent — test it).
- [ ] POST an invalid body → 422 with an `issues` array.
- [ ] POST `/api/flashcards/results` twice with the same `clientId` → one row, second call 200.
- [ ] POST `/api/flashcards/results` as a **student** → row has `student_id` set, `staff_id` null,
      and a `flashcard_mastery` row is created. As **staff** → `staff_id` set, `student_id` null,
      and **no** mastery row.

---

## Task 1.6 — Housekeeping

- Update the stale comment at `wrangler.jsonc:5-6` — it currently describes a deleted API.
- Delete or rewrite `BACKEND.md` and `APP.md`. They describe an architecture that has not
  existed since refactor phase 3 and will actively mislead the next agent.
- Write `docs/api.md`: the envelope shapes, the auth header, the endpoint table, and the error
  codes. Phase 2 reads this instead of the source.

---

## Acceptance criteria

- [ ] Migration `0014_mobile.sql` applied to remote D1; `push_tokens` exists and
      `flashcard_results.client_id` has its partial unique index.
- [ ] Every endpoint in the table above responds; every one requires the correct auth level.
- [ ] **No API route throws a redirect.** Grep the new files for `redirect(` — there should be
      zero hits.
- [ ] No new route module has a default export.
- [ ] `npm run lint && npm run typecheck && npm run test` green, including the new Workers tests.
- [ ] Deployed, and verified live:
  ```bash
  BASE=https://<your-worker>.workers.dev
  TOKEN=$(curl -s -X POST $BASE/api/auth/login -H 'content-type: application/json' \
    -d '{"email":"…","password":"…"}' | jq -r .data.token)
  curl -s $BASE/api/bootstrap -H "Authorization: Bearer $TOKEN" | jq
  curl -s -o /dev/null -w '%{http_code}\n' $BASE/api/bootstrap        # → 401
  curl -s -o /dev/null -w '%{http_code}\n' $BASE/api/events -H "Authorization: Bearer bogus"  # → 401
  ```
- [ ] **The web app is unchanged.** Log in through the browser and complete the full
      click-through from `README.md` rule 3. Cookie auth, all 13 routes, the client cache, and
      the flashcard game all behave exactly as before.
- [ ] Committed and pushed to `main`.

## Notes for the executor

- **Write no business logic here.** If you find yourself writing a Drizzle query in a route
  file, stop — the function you need already exists in `server/services/`. The only legitimate
  exception in the whole existing codebase is `materials.$id.view.tsx`, and it is a streaming
  edge case.
- The `intent`-based web actions stay exactly as they are. You are adding a second door to the
  same rooms, not moving the furniture.
- **On the original machine, `npm run test:worker` does not run** — it uses workerd and fails
  with `ERR_RUNTIME_FAILURE` (confirmed 2026-07-27). There is no local feedback loop there:
  write endpoints in batches, deploy, and verify a batch per deploy. Still **write** the tests —
  they run on any healthy machine and in CI. On a machine where `npm run dev` works, the pool
  works too and this phase goes much faster.
