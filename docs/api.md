# Mochi JSON API

> **Interactive reference: [`/docs/api`](https://calendar.ngqv0712.workers.dev/docs/api)** (staff
> sign-in required), with the OpenAPI 3.1 document behind it at `/docs/openapi.json`.
>
> That page is generated from the code — the request schemas in `shared/schemas.ts`, the response
> schemas in `shared/api-contract.ts`, and the endpoint registry in `server/api/docs/registry.ts` —
> and a test fails if a route ships without an entry, so it cannot go stale the way a hand-written
> table can. Use it for **exact shapes, parameters and status codes**, and to try a call with your
> own token.
>
> This file is the other half: the **why**. Envelope semantics, the auth model, offline replay and
> idempotency, the garden rules, the Zalo channel — the things a schema cannot express. The tables
> below stay as an at-a-glance index.

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
- **Parents can authenticate.** `userFromToken` resolves `kind: 'parent'`. They always get
  `/profile`; the Children tab and `/api/parent/*` appear only once an admin switches on the
  parent portal in System Config (`/api/settings/parent-portal`).
- **Codes minted by the web are linked to a person.** Redeeming one attaches an account to
  the existing `students`/`staff`/`parents` row — it does not create a second one, and the
  name in the body is ignored (the school's spelling wins). Codes created through
  `POST /api/invites` carry no link and still create the person on redeem.

### Roles

| Level | Who |
|---|---|
| `any` | any authenticated caller, parents included |
| `user` | staff or student — **not** parents |
| `parent` | parents only — **not** staff or students |
| `staff` | `Teacher`, `Admin`, `Assistant` |
| `admin` | `Admin` only |

Students can reach only `user`-level endpoints — mirroring the web, where they see just
`/flashcards` and `/profile`. Everything else returns **403**, not a redirect.

Parents get `any` plus `parent`. `any` covers the endpoints about themselves (`/api/auth/me`,
`/api/auth/logout`, `/api/auth/change-password`, `/api/bootstrap`, `/api/profile`,
`/api/settings/ui-prefs`, `/api/settings/notifications`, `/api/settings/parent-portal`,
`/api/push/*`). `user`-level handlers branch `student ? own data : everything`, so a parent
reaching one would be served the teacher's view — they get **403** instead.

`parent` is the mirror image: those handlers scope everything to `parent_students`, so a staff
or student caller has no children to resolve and gets **403**. Every `parent`-level handler
additionally passes through `server/services/parent-portal.ts`, which **403**s when an admin has
the portal switched off or when the `studentId` in the path belongs to another family.

### Parent portal

| Method | Path | Level | Notes |
|---|---|---|---|
| GET | `/api/settings/parent-portal` | **any** | `{ enabled }` — the school-wide switch. A parent reads it to know whether their Children tab exists |
| PATCH | `/api/settings/parent-portal` | admin | `ParentPortalInput`. Never gates login; a parent always keeps `/profile` |
| GET | `/api/parent/home` | **parent** | Every linked child with `classNames` and the next `?days=` (default 7) of sessions, in one round trip. Server-clock derived, so `serverNow` rides along and clients must not cache it long |
| GET | `/api/parent/attendance/:studentId` | **parent** | `?month=YYYY-MM` (defaults to the ICT month). Session-by-session roll, newest first |
| GET | `/api/parent/report/:studentId/:month` | **parent** | The monthly report. Same payload as the printable document — both call `buildReportCard`. `remark: null` for a month the teacher has not written |
| GET | `/api/parent/tuition/:studentId/:month` | **parent** | The fee slip. Same payload as the printable document — both call `buildFeeSlip` |

The two document routes `/assessments/:month/:studentId/report` and
`/tuition/:month/:studentId/print` accept a parent cookie for their own child under the same
rule, so a parent on the web reads the identical slip staff print. Staff still need
`requireStaff` / `requireAdmin` respectively.

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
| `/api/invites/:id?` | staff | `InviteInput` (no PATCH) — creates an **unlinked** code; see Auth |
| `/api/materials/:id?` | staff | `MaterialInput` — **multipart**, see below |
| `/api/assessments/scores/:id?` | staff | `ScoreRecordInput` |
| `/api/assessments/behavior/:id?` | staff | `BehaviorRecordInput` |
| `/api/assessments/remarks/:id?` | staff | `MonthlyRemarkInput` — one row per (student, month); POST upserts on that pair. `ratings` is `{ criterionId: 1-5 }`, keyed by `/api/remark-criteria` ids. Rows also carry server-set `staffId` (last author), `createdAt`, `updatedAt`, `sentAt` (last Zalo delivery of the printed slip) — never accepted from the client |
| `/api/assessment-types/:id?` | **admin** | `AssessmentTypeInput` |
| `/api/remark-criteria/:id?` | **admin** (GET: staff) | `RemarkCriterionInput` — the monthly report's rating rows; teachers read them to render the remark form |
| `/api/grade-levels/:id?` | **admin** | `GradeLevelInput` — managed Khối 6..9 list, categorizes questions and tests |
| `/api/subjects/:id?` | **admin** (GET: staff) | `SubjectInput` — the managed subject list. `ClassInput.subjectId` points here; the legacy free-text `subject` is resolved against it by name |
| `/api/feedback/:id?` | staff | `FeedbackInput` |

**PATCH is a true partial.** It uses `parsePatch`, which strips keys absent from the request
body — otherwise Zod's `.default()` would silently overwrite columns the caller never
mentioned (e.g. toggling `favorite` resetting `type`). See `shared/schemas.ts:3-8`.

### Everything else

| Method | Path | Level | Notes |
|---|---|---|---|
| POST | `/api/assessment-types/reorder` | admin | `{ ids: string[] }` |
| POST | `/api/remark-criteria/reorder` | admin | `{ ids: string[] }` |
| POST | `/api/grade-levels/reorder` | admin | `{ ids: string[] }` |
| GET POST | `/api/attendance` | staff | GET needs `?eventId=&date=`. POST is delete-then-insert: omitting a student unmarks them |
| GET POST | `/api/event-materials` | staff | GET `?eventId=` for one event, omit for the whole join table |
| GET POST | `/api/event-previews` | staff | "Preview buổi sau" for one occurrence. GET needs `?eventId=&date=` and replies `{ preview, topics }` (the vocabulary topics feed the picker). POST takes `SessionPreviewInput` and upserts on (eventId, date) |
| GET | `/api/my-sessions` | **user** | Upcoming sessions with composed previews, `?days=` 1-14 (default 7). A student sees their own classes, staff see every class. Tests appear as title + window only. Computed against the server clock — do not cache |
| GET | `/api/flashcards/topics/:id?` | **user** | Students play games |
| POST PATCH DELETE | `/api/flashcards/topics/:id?` | staff | Replies with the refreshed topic list |
| GET | `/api/flashcards/topic/:slug` | **user** | `{ topic, words, results, mastery }` — one round trip, and exactly what an offline download stores. `results` is user-level because the web gives students the leaderboard too; `mastery` is empty for staff. Each mastery row carries `level` + `dueDay` (the spaced-repetition schedule — see the review section below), so a client can compute today's due words offline |
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
| POST | `/api/zalo/webhook` | **none** | Zalo's own delivery endpoint. Gated on the `X-Bot-Api-Secret-Token` header, not a session — Zalo's servers have neither cookie nor bearer. Always 200 on a verified update; 401 on a bad secret, 503 when `ZALO_WEBHOOK_SECRET` is unset |
| GET POST DELETE | `/api/zalo/pair` | staff | GET lists linked chats and outstanding codes. POST `ZaloPairInput` (`target: self\|parent\|class`) issues a single-use 6-character code, valid 24h. DELETE `?id=` unlinks |
| GET POST | `/api/zalo/admin` | **admin** | `?op=me\|webhook-info` (GET), `?op=set-webhook\|delete-webhook` (POST). `set-webhook` derives its URL from the request origin, so each deployment registers itself |
| POST | `/zalo-send-card` | staff | **multipart**: `file` (PNG, 5 MB cap), `target=class:<id>\|student:<id>`, `caption?`. 409 `not_linked` when the target has no chat. Returns per-chat results. **Not** under `/api/` on purpose — cookie-or-bearer, because every caller is a browser |
| GET | `/zalo-media/:key` | **none** | The uploaded card, fetched by Zalo's servers. A capability URL — unguessable UUID key, `zalo/` prefix only, pruned after 7 days |
| GET PATCH | `/api/garden/plant` | **user** | The caller's own plant, settled to today; staff may read anyone's with `?studentId=`. PATCH takes `PlantPatchInput` (`plantName`, `potColor`) and is students-only, on their own plant. Also returns `today` (the server's ICT day — compare every deadline against it, never the device clock), `hasPlant`, and `fruitMonth` |
| POST | `/api/garden/harvest` | **user** (student) | Banks a fruit and replants a seed. 409 `not_ripe` / `dead` when the plant is not at the fruit stage — including on a double tap |
| GET | `/api/garden/class/:id` | **user** | One class's garden plus its cooperative tree. A student may only read classes they are in (403 otherwise) |
| POST | `/api/garden/water` | staff | `WaterInput` (`studentId`, `note?`) — one stage, wilt cleared, daily cap bypassed. Logged against the staff member |
| GET POST PATCH DELETE | `/api/garden/assignments/:id?` | staff | `VocabAssignmentInput`. GET takes `?classId=`. `modes` is a CSV of game modes that count toward the assignment (`'scramble,type'`); null/'' = any mode. `deadlineTime` is an ICT `HH:MM` the deadline day expires at; null/'' = end of day |
| GET | `/api/garden/progress/:id` | staff | Who has finished one assignment. NOT under `/assignments`, whose `:id?` would swallow the segment |
| GET | `/api/garden/snapshots?classId=` | **user** | Saved album months; add `&month=` for one frozen garden. Same membership rule as the class garden |
| GET | `/api/garden/month/:id` | staff | One student's garden month for the report card — `?month=YYYY-MM` required. Never 404s: a student with no activity gets the zeroed tally. `/garden-month` is the cookie-authed twin the web report uses |
| GET PUT | `/api/settings/garden` | admin | `GardenSettingsInput` — school-wide, and it re-times every plant |
| GET | `/api/checkin/summary` | **user** | One student's túi mù month: `{ tally, tier }`. Students get their own; only staff may pass `?studentId=`. Replies `{ disabled: true }` — and nothing else — when an admin has switched the student view off, so check that flag first |

### Tuition

**No student-facing API.** `/api/tuition/me`, `/api/tuition/me/:month` and
`/api/tuition/me/:month/slip` existed until Aug 2026 and were removed with the phone screens they
served: a child is not told what their family owes. That still holds — there is no `user`-level
tuition endpoint. The bank details on `/config` (`paymentInfo`) are kept as staff-recorded
reference data.

**One parent-facing read, added with the parent portal.**
`GET /api/parent/tuition/:studentId/:month` deliberately revisits that removal, and only for
parents: they are the audience the printed slip was always for, and they already receive this
same document over Zalo. It is gated on the portal toggle and the `parent_students` link, and it
carries the payment and adjustment notes the printed slip carries. Staff amounts still live on the
web `/tuition` screen (`requireAdmin`).

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

`mode` is one of `flip | quiz | match | scramble | fill | type | picture`. Anything else is a
422, and the outbox deletes a 422'd result as permanently unacceptable — so when this enum grows,
the worker MUST deploy before the mobile bundle that posts the new mode publishes, never after.

Response:

```json
{ "data": { "received": 3, "recorded": 2, "duplicates": 1,
  "outcomes": [ { "clientId": "uuid", "garden": { "qualified": true, "grew": true, "stage": 3,
                  "harvestReady": false, "streak": 4, "thresholdPct": 70 } } ] } }
```

**`outcomes` says what each round did to the plant**, so a client can show the same end-of-round
note the web gets from its route action. One entry per submitted result, matched by the
`clientId` the device generated — never by position, since a flush sends whatever is due and the
round the student just finished may not be first. `garden` is `null` for a staff play, for a
replayed `clientId`, and when the garden write was skipped; all three mean "say nothing".

**`clientId` makes replay safe.** A flush that succeeds server-side but drops on the way back —
routine on mobile networks — gets retried. Without the key the student's score would be counted
twice; with it the retry is a no-op. A unique partial index on `flashcard_results.client_id`
enforces this even under concurrent flushes.

The *whole* write is skipped on replay, not just the result row: re-applying the mastery
increments would inflate the student's stats even if the result were deduped.

`clientId` is optional. The web omits it, and every web play is recorded.

**Staff vs student plays:** exactly one of `student_id` / `staff_id` is set. Staff plays produce
a result row but **no** `flashcard_mastery` row — a teacher testing a topic must not pollute
student stats. For the same reason they do not grow a garden plant.

---

## Ôn tập (spaced-repetition review)

**There is no review endpoint, and that is the design.** Every mastery row carries `level` and
`dueDay`, both already in the topic bundle above, and "due" is `dueDay <= today in ICT` — so a
client answers "what do I owe today?" from data it has. Nothing is swept, no cron runs, and the
badge, the due card and the review deck cannot drift apart because they all evaluate the same
comparison against the same server-supplied day.

Rescheduling happens inside the ordinary `POST /api/flashcards/results` write: answer a word
correctly on or after its due day and it climbs a rung of the interval ladder (3, 5, 7, 14, 30 days
by default, tunable school-wide by an admin); answer it wrong and it drops a rung and comes back
sooner; answer it early and nothing moves. The rules are pure functions in `shared/logic/review.ts`,
shared by both clients. `clientId` idempotency covers the schedule exactly as it covers the score —
a replayed offline flush cannot advance the ladder twice.

The phone does not yet show a review screen; it receives the schedule regardless. See
`docs/mobile-parity.md`.

---

## The garden (vườn cây từ vựng)

Each student has ONE plant, school-wide. A qualifying round grows it a stage (at most
`dailyGrowthCap` a day); after `wiltAfterDays` of silence it wilts, then loses a stage every
`dropAfterDays`, then dies. At the fruit stage the student harvests: the fruit is banked forever
and a new seed goes in the pot.

**A student round also returns what it did to the plant.** The web action for a finished round
replies with a `garden` field, and the same `GardenOutcome` is available to any client:

```json
{ "qualified": true, "grew": true, "stage": 3, "harvestReady": false,
  "streak": 4, "thresholdPct": 70 }
```

`qualified` is false when the round missed `thresholdPct`; `grew` is false when it qualified but
the day's growth was already spent. Either way the round is recorded — only the plant is unmoved.

**Everything time-based is derived, not stored.** `GET /api/garden/plant` and
`GET /api/garden/class/:id` settle the plant in memory and write nothing, so a wilt or a stage
drop takes effect at ICT midnight for every caller simultaneously, whether or not the daily cron
has run. A client must therefore not cache a plant across a day boundary, and must not try to
compute decay itself — read it.

**The garden never breaks a score.** The plant is written in a second batch after the result row
has committed, keyed on the result id. A garden failure loses at most one stage of growth, which
the next round earns back.

`POST /api/push/run?job=garden` (admin) runs the daily sweep on demand: it charges missed
assignment deadlines, writes down overdue decay, saves the previous month's album, and sends the
wilt/stage-drop pushes. It is idempotent — deadlines are charged at most once per student per
assignment, and the push ledger dedupes the messages.

## Zalo

> **[`docs/zalo.md`](./zalo.md) is the full picture** — pairing, the polling relay, configuration,
> and the traps. What follows is the endpoint-level summary only.

A second notification channel next to Expo push, using the **Zalo Bot Platform**
(`bot.zaloplatforms.com`) — not an Official Account and not ZNS, both of which need a verified
business. A bot is created from a personal Zalo account and may message any conversation that has
paired with it, unprompted, which is what makes cron delivery possible at all.

It exists because it reaches people push cannot: **parents**. Most have no account — an app login
is opt-in per family and the parent portal is opt-in per school, whereas every family is already on
Zalo. Zalo therefore stays the channel, not a fallback for it.

**Pairing is always two-sided.** Staff generate a code (`/api/zalo/pair`, or the Zalo card on
/config); the person messages that code to the bot from their own Zalo. Nothing can link a chat
from this side alone — Zalo does not reveal who anybody is until they talk to the bot. A code is
single-use and expires in 24 hours, and its kind must match the chat: a personal code sent in a
group is refused, and so is a class code sent privately. Both would be silent privacy failures.
A group is linked by adding the bot and sending `@Bot Mochi /link <code>` there — the **@mention
is mandatory**, since Zalo delivers no group message without one, and it stays in the text, so
commands are matched anywhere in a message rather than at its start. In a group only an explicit
`/link` or `/unlink` does anything; a bare code is ignored, because a class group is full of
ordinary conversation. In a private chat a bare code is enough.

**Delivery.** `runClassReminders` messages the parents of each class's students;
`runEveningPreview` messages the class group if one is linked and otherwise each parent
individually — never both, or a parent in the group is told twice. Staff get the same whole-day
summary they get on push. Zalo keeps its **own** ledger keys (`zalo-` prefixed): sharing push's
keys would mean that the day the channel is switched on, every occurrence push had already
handled is marked done and no parent ever hears anything.

**Configuration.** `ZALO_BOT_TOKEN` and `ZALO_WEBHOOK_SECRET`, both declared in `globals.d.ts`
and set with `wrangler secret put`. Each fails safe alone: no token and every send quietly
no-ops; no secret and the webhook rejects everything. Register the webhook once per deployment
with `POST /api/zalo/admin?op=set-webhook`. Webhook and long-polling are mutually exclusive on
one bot, so development wants a **second** bot rather than borrowing production's.

**Share cards.** `/api/zalo/send-card` posts a rendered card into a class group (or privately to
a student's parents), replacing the copy-open-paste routine. The PNG is uploaded by the browser
rather than rendered server-side, because every share card is drawn from live DOM by
`html-to-image` and a Worker has no DOM — which is also why the cron jobs only ever post **text**
to groups. The image lands in R2 under `zalo/` and is served by `/zalo-media/:key`, the one
unauthenticated R2 route in the app: `sendPhoto` takes a URL that Zalo fetches itself, with no
credential it could ever present. The copy button stays everywhere alongside it, as the fallback
for an unlinked group or a Zalo outage.

**Developing against it.** `node scripts/zalo-poll.mjs` prints everything the bot receives, and
`--forward` replays it into a local dev server — Zalo cannot reach localhost, so this is the only
way to exercise the webhook there. It is also how you find a group's `chat_id`. Note that
`getUpdates` has no `offset`: it is a live long-poll with no cursor, so a message sent while
nothing is listening is gone, and **bots do not receive plain group messages at all — only ones
that @mention them.** Both facts cost an afternoon to rediscover.

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
