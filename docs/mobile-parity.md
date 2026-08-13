# Mobile parity audit

Written at the end of phase 5 (task 5.6), updated at the end of phase 6.

The requirement was **full parity**: everything the web app does, the phone does. This is the
walk of the web app's routes and shell features, confirming each has a mobile equivalent or a
deliberate, reasoned omission. "Deliberate" means someone decided; anything not listed here as an
omission is built.

## Routes

| Web route | Mobile | Notes |
|---|---|---|
| `/dashboard` | `(app)/dashboard.tsx` | Phase 4 |
| `/calendar` | `(app)/calendar.tsx` | Phase 4. Week time-grid omitted — see below |
| `/classes` | `(app)/classes/` | Phase 4 |
| `/people` | `(app)/people/` | Phase 5. One web screen → a list plus three editors |
| `/materials` | `(app)/materials/` | Phase 5. `.docx` via the platform viewer, not `docx-preview` |
| `/assessments` | `(app)/assessments.tsx` | Phase 5. Tables → cards; same charts |
| `/rankings/:month?` | **Not built** | Added 2026-08, web-only for now — see below |
| `/tui-mu/:classId?/:month?` | **Not built** | Added 2026-08, web-only by design — see below |
| `/kiosk/:eventId/:date/:phase` | **Not built** | Added 2026-08, deliberate omission — see below |
| `/tuition/:month?` | **Not built** | Web-only by design — tuition is staff-only, see below |
| `/flashcards` | `(app)/vocabulary/` | Phase 3. The plant widget sits at the top for students, as on the web |
| `/garden/:classId?` | `(app)/vocabulary/garden/[classId]/` | Added 2026-08. Student view only — see below |
| `/garden/:classId/album/:month` | `(app)/vocabulary/garden/[classId]/album/[month].tsx` | Added 2026-08 |
| `/flashcards/:slug` | `(app)/vocabulary/[slug]/` | Phase 3, plus offline study and the games. All seven game modes have mobile twins in `mobile/games/` (flip, quiz, match, scramble, fill, type, picture — 2026-08) |
| `/config` | `(app)/config.tsx` | Phase 5. Scrollbar pref dropped — see below |
| `/feedback` | `(app)/feedback.tsx` | Phase 5. Inbox and submit in one screen |
| `/profile` | `(app)/profile.tsx` | Phase 2 |
| `/login` | `app/login.tsx` | Phase 2 |

Mobile also has three screens with no web counterpart: `(app)/more.tsx` (the drawer the web app
never built), `(app)/language.tsx`, and `(app)/notifications.tsx` (phase 6).

This table used to carry a `/homework` row. That module was dropped in favour of Tests
(`migrations/0018_drop_homework.sql`) and neither client has had the screen since.

## Shell features from `app/routes/_app.tsx`

| Feature | Mobile |
|---|---|
| Badge counts on nav items | Present as counts in the People and Feedback tab labels; not on the bottom tab bar |
| Feedback modal | The compose form on `/feedback?compose=1`, linked from More and from the version stamp |
| Dev inspector (`src/dev-inspector.tsx`) | **Omitted.** A web debugging tool; React Native has its own |
| 260px sidebar / 64px icon rail | **Omitted by design.** A phone gets bottom tabs plus More |

## Deliberate omissions, with reasons

**Admin diagnostics: /logs, both tabs** (the review schedule, added 2026-08; the notification
forecast, added 2026-08-11).

Web-admin-only on purpose, and unlikely to change. The page exists to answer "what does the database
actually say?" — it reads every student's review schedule and every family's Zalo pairing at once, and
the notification tab additionally offers a trigger per cron job. That is a desk activity: it is looked
at while fixing something, next to a terminal, not on a phone between classes. Porting it would mean
rebuilding two dense tables and four job cards in React Native for an audience of one admin who has a
laptop.

Nothing is blocked if that judgement changes: the forecast is `server/services/notify-plan.ts`
returning plain JSON (`planNotifications` / `listSentLog`), so a mobile version is one `/api/logs/...`
resource route plus a screen, with no logic to reimplement.

**Ôn tập / spaced-repetition review** (web: the "Ôn tập hôm nay" card on `/vocabulary`, the
`?review=1` deck on a topic, and the sidebar badge — added 2026-08).

Not built on the phone in v1, but the data gap is already closed: the schedule (`level`, `dueDay`)
rides in every mastery row of the topic bundle the app already downloads for offline study, and the
rules are pure functions in `shared/logic/review.ts` with no `server/` imports. So the mobile
version is a client-side filter and a screen, publishable as an OTA with no server change:

- `mobile/app/(app)/vocabulary/index.tsx` — the due section, counting with `isDue` across the
  bundles already cached.
- `mobile/app/play/[slug]/[mode].tsx` — accept `review=1` and narrow `bundle.words` the same way
  `src/flashcards/topic.tsx` does.
- `mobile/lib/endpoints.ts` — only if a cross-topic due list is wanted; per-topic needs nothing.

The reason it waits: the phone's vocabulary flow is offline-first, so "what is due today" has to be
answered from cached bundles rather than a query, and that is a design question about which topics
a student has downloaded — not a port. Recording a round already reschedules correctly from the
phone today, because the write path is shared.

**Check-in/check-out kiosk and the túi mù class board** (web `/kiosk/:eventId/:date/:phase` and
`/tui-mu/:classId?/:month?`, added 2026-08).

The kiosk is a deliberate omission on principle, not a "not yet": it is a *classroom-screen*
surface — a shared tablet or laptop a teacher leaves propped up at the front of the room, opened
from their own logged-in session, with kids tapping their own name on someone else's device. A
phone kiosk makes no sense — there is no "someone else's phone" in this flow, and the feature's
whole point is one shared screen the whole class sees.

The class board (`/tui-mu`) is web-only for the same reason `/rankings` and `/tuition` are: a
desk-side admin/teacher view of a roster and a month, not something built for one-hand phone use
in v1. Nothing here is blocked — `classMonthTallies`/`studentMonthTally`
(`server/services/checkin.ts`) are pure services with no route logic in them.

What DID ship for the phone: `GET /api/checkin/summary` — the student's own bag/miss/tier tally,
the mobile twin of the `/vocabulary` bag chip (`app/routes/flashcards.tsx`'s `loadTuiMu`). The RN
chip itself (next to `GardenWidget` in `mobile/app/(app)/vocabulary/index.tsx`) was not wired in
this pass — the endpoint exists and returns `{ disabled }` while `checkin-settings.showStudentView`
is off, exactly like the web loader, so the port is a fetch call and a `Text` node whenever the
mobile team picks it up.

**Student rankings** (web `/rankings/:month?`, added 2026-08).
Not an omission on principle — just not built yet. Everything that would be hard to port already
lives in the right place: the scoring is pure functions in `shared/logic/rankings.ts` (no React, no
`server/` imports, unit-tested in `test/rankings.test.ts`), and the configurable weights are a plain
`settings` row under `ranking-weights`. A mobile version is one screen plus an `/api/rankings`
endpoint, with no logic to reimplement.

**Tuition, all of it** (web `/tuition/:month?`: class prices, the month close/reopen, recording
payments and adjustments, the per-student fee table).

A student self-view shipped on the phone in Aug 2026 — a "Học phí" row in Profile, a list of closed
months, bank details with a VietQR code, a shareable slip PNG — and was **removed** the same month.
Fees are now staff-only end to end: nothing in the app tells a student or a family what they owe,
and the "Gửi thông báo" push that announced a closed month is gone with it. A family is told by the
printed slip (phiếu thu) and by the office.

What went with the removal, should it ever be rebuilt: `/api/tuition/me*`, the server-side slip
renderer (`server/slip/`, satori + resvg — the web's own slip is rasterized in the browser by
`html-to-image`, which needs a DOM neither a Worker nor React Native has), and the
`tuition_me_*` / `tuition_pay_*` / `tuition_notify_*` string keys. The bank details on `/config`
stayed: they are staff reference data now, not something a student is shown.

**The garden's staff half** (web: watering, assignment CRUD, the event history, admin dev tools,
"Save this month", the share card).

The garden shipped web-only on 2026-08-06 and the student half was ported on 2026-08-07: the plant
widget, the post-round note, harvest, rename/repaint, the class garden and the album. What stayed
behind is everything a *teacher* does with it. That is a scope decision, not a capability gap —
`/api/garden/water` and `/api/garden/assignments` exist and are staff-gated; nothing on the phone is
blocked from calling them. Two of the staff actions have no JSON endpoint at all (`snapshot-month`,
`dev-set`/`dev-reset` are route-action intents on `app/routes/garden.tsx`), so a future staff port
would add those first.

Reasoning: a teacher marking a class's plants sits at a laptop with the class list open; a student
studying vocabulary has a phone in their hand. The one thing the phone gains by having the staff
tools is the ability to water from the corridor, which is not worth a second implementation of the
history modal.

**The share card** (web `/garden/:classId/share`, a PNG for the class Zalo group) is a separate
reason: it is rasterized in the browser with `html-to-image`, which is DOM-only. The React Native
equivalent (`react-native-view-shot`) is a NEW native module, and adding one forces an APK rebuild
plus a `runtimeVersion` bump — every installed phone would have to update the APK before receiving
any further OTA update. The whole garden port was pure JS for exactly this reason. It can ride along
whenever the next APK build happens for another reason.

**Garden settings** (`freeMinScorePct`, `wiltAfterDays`, `dropAfterDays`, `dailyGrowthCap`, web
`/config`). `GET`/`PUT /api/settings/garden` exists and is admin-gated, so this is portable at any
time. It is left on the web because saving a half-typed field re-times every plant in the school —
a change worth making deliberately, at a desk, next to the other school-wide settings.

**Scrollbar style preference** (`uiPrefs.scrollbar`, web `/config`).
Android has no styleable scrollbar. The setting cannot do anything on a phone. The stored value is
left untouched so the web keeps working, and the More screen says the setting is web-only rather
than leaving someone hunting for it.

Its mirror image is a *web* omission rather than a mobile one: **`uiPrefs.mobileTabBar`** picks
between three bottom-tab-bar variants (`pill`, `dock`, `indicator` — rendered by
`mobile/components/TabBar.tsx`) and does nothing on the web, whose shell is a sidebar. Both live in
the one `ui-prefs` settings row and both are editable from either client's System Config screen, so
neither client hides a setting the other can change; each simply applies the half that concerns it.
GET on `/api/settings/ui-prefs` is `user`-level because every client renders from it; PATCH is
`admin`, because these are school-wide values.

**Parent invite codes.** No longer a capability gap: parents sign in (`userFromToken` resolves
`kind: 'parent'`), and with the parent portal switched on in System Config both clients give them
their children's schedule, attendance, report and fee slips — web at `/children`, mobile on the
Children tab.

What remains is a deliberate difference in WHERE a code is minted, not in what it can do. The web
attaches a Parent code to the parent row automatically when staff adds the parent, so the mobile
invite UI still offers Student and Staff only: a Parent code made there would be an *unlinked* one,
which is the legacy path the auto-minting replaced. Parent invites created on the web list and
revoke on the phone as normal.

**The intro modal.** No longer a parity question: the first-visit intro modal
(`src/instructions.tsx`, `SEEN_INTRO_KEY`) was deleted from the web app, so neither client has it.
Mobile had already skipped it — its feature cards described a sidebar a phone does not have, and a
first-run modal competes with the notification permission prompt for the user's one moment of
goodwill.

**Week time-grid view** (phase 4, restated here).
`src/calendar/time-grid.tsx` reschedules events with `onMouseDown` plus a `window` mousemove
listener, in a 7×24 grid of 40px slots. Neither the interaction nor the density survives 360dp. The
mobile calendar offers Day, Month and Agenda, and rescheduling is a long-press that opens the
native date/time picker — buildable, and better than a 40dp drag target.

**Wide score tables** (web `/assessments`).
Replaced by per-student cards, filterable by class, date and assessment type. A five-column table at
360dp either scrolls sideways or is unreadable, and a page that scrolls sideways is a bug.

**Garden progress on the monthly report** (web `/assessments` → Monthly report, added 2026-08).
Not an omission on principle — scoped to the web surface and not built yet. The mobile report tab
(`app/(app)/assessments.tsx`, the `remark_stats_title` card) still shows the four academic tiles
only. Nothing hard is left: the fold is a pure function in `shared/logic/garden.ts`
(`tallyGardenMonth`, unit-tested), the read is `GET /api/garden/month/:id?month=YYYY-MM`, and the
i18n keys are in the shared `strings.ts` both clients read. A mobile version is one endpoint entry
plus six existing `CountTile`s. Step-by-step in `docs/plans/garden-on-monthly-report.md`.

**`docx-preview` rendering.**
DOM-only. Materials open in a `WebView` when the platform can render them inline (images, text,
SVG) and are handed to Android's document viewers otherwise — including PDFs, which Android's
WebView cannot display at all. See the comment at the top of `app/(app)/material/[id].tsx`.

**Per-user notification preferences** (phase 6.5).
The preferences are stored in the school-wide `settings` table, alongside the calendar theme and
UI prefs, because that table is keyed by a single string. Per-account preferences need a
`user_settings` table — a migration and a service, not a screen. Noted in
`server/services/notif-prefs.ts` so the boundary is findable.

## Things the phone does that the web cannot

Not parity, but worth recording, because they are why the app is native:

- **Push notifications** — class starting soon, homework due tomorrow, study nudges (phase 6).
- **Offline flashcard study** with a durable outbox that survives a restart (phase 3).
- **Native share sheet for invite codes** — a code reaches a student over Zalo or SMS, which is
  how these actually travel. The web can only copy to the clipboard.
- **Camera capture as a material** — photograph the whiteboard, attach it to the class.
- **Swipe gestures** in the flashcard games.

## Knowingly not built

- **Class weekly schedules, and the class Room field, are gone from both clients.** Both were
  phone-only: the schedule editor existed nowhere on the web, and although `classes.room` was in
  `ClassInput`, the web modal had no input for it and merely displayed it. The 2026-07-29 audit
  (`docs/audit-2026-07-29.md`, phases 2 and 3) removed both rather than building each twice. The
  `class_schedule` table and the `classes.room` column are left in place and dormant, so the
  decision is reversible without a migration and the existing values survive. The class-reminder
  push now shows the **event's** own "Room or place" instead of the class room.

- **Class reminders reach students only, not staff.** The phase-6 plan says "notify the enrolled
  students and the class's staff", and `runClassReminders` does the first half. The second half has
  no data behind it: nothing in the schema links a staff member to a class. `classes` is
  `(id, name, subject, color)` — plus the dormant `room` column noted above — `events` carries a
  `classId` but no staff, and there is no
  `class_staff` join table. `push.accountIdsForStaff` exists and is currently called by nothing —
  it maps staff records to accounts, which is the second half of the lookup; the missing first half
  is "which staff teach this class".

  Closing it means a `class_staff` table, an assignment control on the class editor in both
  clients, and one extra token lookup in `runClassReminders`. It is a feature, not a patch, so it
  is recorded here rather than half-built.

  **Consequence for testing:** a staff or admin account receives nothing from any job. Test push
  from a student account.

## Not verified in this session

These acceptance criteria need a physical device and a deployed Worker, and are honestly
outstanding rather than done:

- Full click-through of every screen at 360dp (no horizontal scroll, no clipped text, no touch
  target under 48dp). Every control in the new code is built against the 48dp floor
  (`theme.TOUCH`), but that is construction, not observation.
- Push delivery to a device with the app closed, the three channels appearing separately in system
  settings, and the deep links from each notification type.
- The class-reminder cron firing exactly once across three or more ticks. The idempotency ledger
  (`sent_notifications`) is written for this, and `POST /api/push/run?job=class` re-runs the job on
  demand so the check does not take 45 minutes — but it has not been run against production.
