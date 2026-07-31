# Mochi JSON API

The API the mobile app talks to. Added in [docs/mobile/phase-1-json-api.md](./mobile/phase-1-json-api.md).

It sits **alongside** the web app's React Router loaders and actions, not instead of them. Both
call the same `server/services/*.ts` functions and validate with the same `shared/schemas.ts`
Zod schemas, so the two clients cannot drift apart. The web app is unaffected by anything here.

Route files are `app/routes/api.*.tsx`, registered in `app/routes.ts` **outside** the `_app`
layout. They are resource routes: **no default export**, or React Router would serve the SSR
HTML shell instead of the loader's Response.

---

## Envelope

Every response is JSON. Success:

```json
{ "data": ... }
```

Failure:

```json
{ "error": "validation_failed", "issues": [ ... ] }
```

`issues` is present only for `validation_failed` and carries the Zod issue array.

| Status | `error` | Meaning |
|---|---|---|
| 400 | `invalid_json` | Body was not parseable JSON |
| 400 | `missing_id` | PATCH/DELETE without `:id` or `?id=` |
| 401 | `unauthorized` | Missing, unknown, or expired token |
| 403 | `forbidden` | Authenticated but wrong role |
| 404 | `not_found` | No such record |
| 405 | `method_not_allowed` | Verb not supported on this endpoint |
| 413 | `file_too_large` | Upload over the 20 MB cap |
| 422 | `validation_failed` | Body failed Zod validation |
| 500 | `internal_error` | Unhandled — details are logged server-side, never returned |

**The API never redirects.** The web guards throw `redirect('/login')`; these throw a JSON
Response. A native client cannot meaningfully follow a 302 to an HTML page.

CORS is open on `/api/*` (`Access-Control-Allow-Origin: *`, `Authorization` and `Content-Type`
allowed). Native `fetch` ignores CORS; this is for the Expo web target and browser debugging.

---

## Auth

Header on every authenticated request:

```
Authorization: Bearer <token>
```

`POST /api/auth/login` returns the token. It is the **raw** value; `sessions.token` stores only
its SHA-256 hash, so a database dump cannot be replayed.

- Mobile sessions last **90 days**, and slide forward on use (throttled: the row is only
  rewritten once a session has burned more than a week of its window).
- Sessions are per-device. A phone and a browser are two rows on one account.
- **Changing the password evicts every other session**, including the browser. The device that
  made the change keeps its token. Expect a 401 on other devices — present it as a re-login,
  not a crash.
- Signup is invite-only (`POST /api/auth/redeem-invite`).
- **Parent accounts cannot authenticate.** `userFromToken` returns null for them by design.

### Roles

| Level | Who |
|---|---|
| `user` | any authenticated staff member or student |
| `staff` | `Teacher`, `Admin`, `Assistant` |
| `admin` | `Admin` only |

Students can reach only `user`-level endpoints — mirroring the web, where they see just
`/flashcards` and `/profile`. Everything else returns **403**, not a redirect.

---

## Endpoints

`:id?` means the id may be a path segment or an `?id=` query param; both work.

### Auth

| Method | Path | Level | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | — | `{ email, password }` → `{ token, expiresAt }` |
| POST | `/api/auth/logout` | user | Ends only the calling device's session |
| GET | `/api/auth/me` | user | `{ user, account }` |
| POST | `/api/auth/redeem-invite` | — | `{ code, name, email?, password }` → `{ token, expiresAt }` |
| POST | `/api/auth/request-reset` | — | Always `{ ok: true }` — never reveals whether the email exists |
| POST | `/api/auth/change-password` | user | `{ currentPassword, newPassword }` |

### Bootstrap and dashboard

| Method | Path | Level | Notes |
|---|---|---|---|
| GET | `/api/bootstrap` | user | Everything a cold start needs in one round trip. **Students get only `{ user, account, uiPrefs, badgeCounts }`** — never the roster |
| GET | `/api/dashboard` | staff | Today's events and the class list |

### Collections

All support `GET` (list), `POST` (create), `PATCH` (update), `DELETE` (remove) unless noted.

| Path | Level | Schema |
|---|---|---|
| `/api/events/:id?` | staff | `EventInput` |
| `/api/classes/:id?` | staff | `ClassInput` |
| `/api/students/:id?` | staff | `StudentInput` |
| `/api/staff/:id?` | staff | `StaffInput` |
| `/api/parents/:id?` | staff | `ParentInput` |
| `/api/invites/:id?` | staff | `InviteInput` (no PATCH) |
| `/api/materials/:id?` | staff | `MaterialInput` — **multipart**, see below |
| `/api/assessments/scores/:id?` | staff | `ScoreRecordInput` |
| `/api/assessments/behavior/:id?` | staff | `BehaviorRecordInput` |
| `/api/assessment-types/:id?` | **admin** | `AssessmentTypeInput` |
| `/api/grade-levels/:id?` | **admin** | `GradeLevelInput` — managed Khối 6..9 list, categorizes questions and tests |
| `/api/feedback/:id?` | staff | `FeedbackInput` |

**PATCH is a true partial.** It uses `parsePatch`, which strips keys absent from the request
body — otherwise Zod's `.default()` would silently overwrite columns the caller never
mentioned (e.g. toggling `favorite` resetting `type`). See `shared/schemas.ts:3-8`.

### Everything else

| Method | Path | Level | Notes |
|---|---|---|---|
| POST | `/api/assessment-types/reorder` | admin | `{ ids: string[] }` |
| POST | `/api/grade-levels/reorder` | admin | `{ ids: string[] }` |
| GET POST | `/api/attendance` | staff | GET needs `?eventId=&date=`. POST is delete-then-insert: omitting a student unmarks them |
| GET POST | `/api/event-materials` | staff | GET `?eventId=` for one event, omit for the whole join table |
| GET | `/api/flashcards/topics/:id?` | **user** | Students play games |
| POST PATCH DELETE | `/api/flashcards/topics/:id?` | staff | Replies with the refreshed topic list |
| GET | `/api/flashcards/topic/:slug` | **user** | `{ topic, words, results, mastery }` — one round trip, and exactly what an offline download stores. `results` is user-level because the web gives students the leaderboard too; `mastery` is empty for staff |
| GET POST PATCH DELETE | `/api/flashcards/words/:id?` | staff | `?topicId=` required on GET and POST |
| POST | `/api/flashcards/import?topicId=` | staff | `{ words: [...] }`, max 200 |
| POST | `/api/flashcards/generate-topic` | staff | `{ name, description?, color?, words: [...] }` — creates a topic and its words in one write; replies with the new topic (incl. `slug`). NOT under `/topics`, whose `:id?` would swallow the segment |
| POST | `/api/flashcards/results` | **user** | See idempotency below |
| GET | `/api/flashcards/stats` | staff | `?topicId=` for one topic's results, else per-student stats |
| GET PATCH | `/api/profile` | user | `ProfileInput` — deliberately cannot change `role` |
| GET PATCH | `/api/settings/theme` | staff | `ThemeInput`; nulls mean "leave unchanged" |
| GET PATCH | `/api/settings/ui-prefs` | GET user, PATCH **admin** | `UiPrefsInput` — school-wide, so every client reads it but only an admin writes it. `scrollbar` is web-only, `mobileTabBar` phone-only |
| POST | `/api/push/register` | user | `{ expoToken, platform }` — upserts, moving the token between accounts |
| POST | `/api/push/unregister` | user | `{ expoToken }` |

Also bearer-aware (they accept either a cookie or a token): `/materials/:id/view`,
`/materials/:id/download`, `/enrich-vocab`, `/generate-vocab`.

`POST /generate-vocab` (staff) takes `{ topic, count?, level?, exclude? }` and answers
`{ data: { words: [{ word, meaningVi, definitionEn }] } }` — proposed words only; the client
saves the ones the user keeps — through `POST /api/flashcards/import` when adding to an existing
topic, or `POST /api/flashcards/generate-topic` when creating a new one. Returns 503 when the
server has no `ANTHROPIC_API_KEY`. The model call takes 5-20s, so clients need a raised
timeout.

Note the naming split: the vocabulary **pages** live at `/vocabulary` (renamed from
`/flashcards`), but these API paths, the DB tables, and the client cache keys all kept the
original `flashcards` name — only the user-visible URL moved. `/flashcards` and
`/flashcards/:slug` still 301-redirect to their `/vocabulary` equivalents for old bookmarks and
for push notifications sent before the rename.

---

## Flashcard results and offline replay

`POST /api/flashcards/results` always takes a batch, so the mobile outbox can flush several at
once:

```json
{ "results": [
  { "clientId": "uuid", "topicId": "...", "mode": "flip", "score": 8, "total": 10,
    "durationMs": 42000, "answers": [ { "wordId": "...", "correct": true } ] }
] }
```

Response:

```json
{ "data": { "received": 3, "recorded": 2, "duplicates": 1 } }
```

**`clientId` makes replay safe.** A flush that succeeds server-side but drops on the way back —
routine on mobile networks — gets retried. Without the key the student's score would be counted
twice; with it the retry is a no-op. A unique partial index on `flashcard_results.client_id`
enforces this even under concurrent flushes.

The *whole* write is skipped on replay, not just the result row: re-applying the mastery
increments would inflate the student's stats even if the result were deduped.

`clientId` is optional. The web omits it, and every web play is recorded.

**Staff vs student plays:** exactly one of `student_id` / `staff_id` is set. Staff plays produce
a result row but **no** `flashcard_mastery` row — a teacher testing a topic must not pollute
student stats.

## File upload

`/api/materials` accepts **multipart/form-data** with a `file` part (20 MB cap, 413 over it),
or plain JSON for link-only materials. Files go to R2 and are served back through
`/materials/:id/view` and `/materials/:id/download`.

## Example

```bash
BASE=https://calendar.ngqv0712.workers.dev

TOKEN=$(curl -s -X POST $BASE/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"..."}' | jq -r .data.token)

curl -s $BASE/api/bootstrap -H "Authorization: Bearer $TOKEN" | jq

# Must be 401 with a JSON body — never a 302.
curl -s -i $BASE/api/bootstrap | head -1
```
