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
| `/homework` | `(app)/homework/` | Phase 4 |
| `/assessments` | `(app)/assessments.tsx` | Phase 5. Tables → cards; same charts |
| `/flashcards` | `(app)/flashcards/` | Phase 3 |
| `/flashcards/:slug` | `(app)/flashcards/[slug]/` | Phase 3, plus offline study and the games |
| `/config` | `(app)/config.tsx` | Phase 5. Scrollbar pref dropped — see below |
| `/feedback` | `(app)/feedback.tsx` | Phase 5. Inbox and submit in one screen |
| `/profile` | `(app)/profile.tsx` | Phase 2 |
| `/login` | `app/login.tsx` | Phase 2 |

Mobile also has three screens with no web counterpart: `(app)/more.tsx` (the drawer the web app
never built), `(app)/language.tsx`, and `(app)/notifications.tsx` (phase 6).

## Shell features from `app/routes/_app.tsx`

| Feature | Mobile |
|---|---|
| Intro modal (`SEEN_INTRO_KEY` in localStorage) | **Omitted.** See below |
| Badge counts on nav items | Present as counts in the People and Feedback tab labels; not on the bottom tab bar |
| Feedback modal | The compose form on `/feedback?compose=1`, linked from More and from the version stamp |
| Dev inspector (`src/dev-inspector.tsx`) | **Omitted.** A web debugging tool; React Native has its own |
| 260px sidebar / 64px icon rail | **Omitted by design.** A phone gets bottom tabs plus More |

## Deliberate omissions, with reasons

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

**Parent invite codes** (web People → Generate invite → role "Parent").
A Parent invite creates an `accounts` row with a `parentId`, and `userFromToken` returns `null` for
exactly that shape (`server/services/auth.ts:118`, "parent accounts remain unsupported"). The code
redeems, a password is set, and the person can still never sign in. The mobile invite UI therefore
offers Student and Staff only, and says why. Parent *records* are fully manageable on the Parents
tab; Parent invites created on the web still list and revoke on the phone. **This is a server
capability gap, not a mobile one** — if parent login ships, delete the restriction in
`components/InvitesPanel.tsx` and the note in `people/parent/[id].tsx`.

**The intro modal.**
Six feature cards explaining a sidebar the mobile app does not have, keyed on a localStorage flag.
Porting it would mean rewriting the copy for a different navigation model, and a first-run modal on
a phone competes with the notification permission prompt for the user's one moment of goodwill. The
prompt is worth more.

**Week time-grid view** (phase 4, restated here).
`src/calendar/time-grid.tsx` reschedules events with `onMouseDown` plus a `window` mousemove
listener, in a 7×24 grid of 40px slots. Neither the interaction nor the density survives 360dp. The
mobile calendar offers Day, Month and Agenda, and rescheduling is a long-press that opens the
native date/time picker — buildable, and better than a 40dp drag target.

**Wide score tables** (web `/assessments`).
Replaced by per-student cards, filterable by class, date and assessment type. A five-column table at
360dp either scrolls sideways or is unreadable, and a page that scrolls sideways is a bug.

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
