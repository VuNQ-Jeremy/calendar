# Phase 4 — Staff core: dashboard, calendar, classes, homework, attendance

**Depends on:** Phase 2 (can run in parallel with Phase 3)
**Touches:** `mobile/` only
**Risk:** medium-high — the calendar is the hardest redesign in the project
**Deliverable:** a teacher can run their teaching day from their phone.

## Why these five

They are what a teacher actually does **away from a desk**. Attendance in particular is done
standing up in a classroom, and is the single highest-value screen in the entire mobile app —
today it requires opening a laptop, finding the event, and clicking into a modal tab.

The rest of the staff surface (People, Materials, Assessments, Config, Feedback) is
administrative, done sitting down, and can wait for Phase 5.

## The governing principle

**Do not port the desktop layouts.** The web calendar is a 2-column grid with a 260px sidebar,
a 7-column month grid with no min-width handling, a `min(1100px, 100vw-32px)` split-pane modal,
and a toolbar carrying a 200px title plus four view tabs on one row. None of that survives a
375dp screen, and trying to shrink it produces something worse than a rethink.

Rebuild each screen for the phone. Same data, same tokens, same vocabulary — different layout.

---

## Task 4.1 — Dashboard

Port `app/routes/dashboard.tsx` + `src/screens-core.tsx`. Straightforward: today's events,
homework due, class list, counts.

Mobile shape: a vertical scroll of cards, pull-to-refresh, "Today" as the hero section. The
web's `.cols-3` / `.cols-4` grids (which already reflow to 1 column below 920px) become a
single column throughout.

Add a **"Take attendance" shortcut** on each of today's class events, deep-linking straight
into Task 4.5. Two taps from app launch to marking a register.

---

## Task 4.2 — Calendar

The hard one. Source: `src/calendar/` — `index.tsx` (234), `month-view.tsx` (80),
`time-grid.tsx` (203), `agenda-view.tsx` (74), `utils.ts` (`expandEvents`, moved to
`@shared/logic/recurrence` in Phase 0).

### View strategy — agenda first, deliberately

| View | Mobile treatment |
|---|---|
| **Agenda** | **The default and primary view.** A `SectionList` grouped by day, infinite-scrolling forward, with a sticky date header. This is what a phone calendar should be |
| **Month** | A compact 7×6 grid showing **dots**, not the web's `.mpill` event pills. Tapping a day scrolls/filters the agenda below it. Month is a *navigator*, not a reader |
| **Day** | A single-column time grid. Useful, buildable |
| **Week** | **Build last, or not at all.** Seven columns of time-grid on a 375dp screen is unreadable. If built, make it horizontally scrollable with one day snapped per page — which is really Day view with paging |

The web's four-tab Day/Week/Month/Agenda switcher becomes a segmented control with **Agenda /
Month / Day**.

### Recurrence

Use `expandEvents` from `@shared/logic/recurrence` — the exact function the web uses. Do not
reimplement. The `recurrence` field is `'none' | 'daily' | 'weekly'` (`shared/schemas.ts:37`).
If the two views disagree about which days a weekly class falls on, the app is broken in a way
users will not trust.

### Drag-to-reschedule does not port

`src/calendar/time-grid.tsx` uses `onMouseDown` (lines 154, 182) and
`window.addEventListener('mousemove'/'mouseup')` (112–116). **This is mouse-only and does not
fire on touch at all.**

Replace it with **long-press → "Move to…"** opening a date/time picker. Do not attempt a
drag-on-a-time-grid gesture on a phone — the target is ~40dp tall, a finger is ~9mm, and it
will fight the scroll view. The picker is better UX here, not a compromise.

### Theming

The calendar reads CSS vars `--cal-bg`, `--cal-grid`, `--cal-today`, `--cal-header` from the
`settings` table via `intent=theme` / `/api/settings/theme`. Read them and apply as inline
styles. The `bgImage` / `bgOpacity` fields exist too — support them or explicitly skip them and
say so in the UI; do not silently ignore a theme the user configured on the web.

---

## Task 4.3 — Event detail

Source: `src/calendar/event-modal.tsx` (506 lines). The web renders a
`.m-dialog--full` at `min(1100px, 100vw-32px)` × `88vh` with a 300px left pane. There is no
mobile fallback and it cannot be shrunk.

**Mobile:** a **full-screen pushed route** with top tabs:

| Tab | Source | Notes |
|---|---|---|
| Details | `event-modal.tsx` | Title, date, time, color, class, location, recurrence, notes |
| Homework | `homework-tab.tsx` | Uses `useCachedLoad('hw:modal', …)` on web → `useQuery(['homework'])` |
| Materials | `materials-tab.tsx` | `useCachedLoad('evmat:{eventId}')` → `['eventMaterials', eventId]` |
| Attendance | `attendance` resource route | `useCachedLoad('att:{eventId}:{date}')` → `['attendance', eventId, date]` |

**Material preview** (`material-preview.tsx`) uses `docx-preview`, which is DOM-only and does
not port. Instead, open `/materials/:id/view` (bearer-authenticated after Phase 1) via
`WebView` or hand off to the platform viewer with `Linking` / `expo-sharing`. Android has
capable document viewers; use them rather than shipping a renderer.

Save/delete/move on web go through `useFetcher().submit()` with an `intent`
(`src/calendar/index.tsx:89-124`). On mobile these are React Query mutations against
`/api/events`, invalidating per the Phase 2 key map.

---

## Task 4.4 — Classes and homework

**Classes** (`src/screens-manage/classes.tsx`): list → detail. Detail carries the schedule
editor (`class_schedule`: `day` 0–6, `start_time`, `end_time` — validated by `ScheduleItem` at
`shared/schemas.ts:42`) and the roster (`class_students`). The roster is a searchable
multi-select of students; on a phone that is a pushed picker screen, not an inline list.

**Homework** (`app/routes/homework.tsx`, `src/screens-core.tsx`): list with a done toggle,
create/edit, and the grading screen.

**Grading** — the web's `GradeModal` maps to `intent=save-grades` /
`POST /api/homework/:id/grades`, taking `{ studentId, score (0–10, nullable), comment }` per
`HomeworkGradesSaveInput` (`shared/schemas.ts:194`). On mobile: one row per student, a numeric
keypad for the score, comment behind a tap. Save the whole set in one request, as the web does.

Note `homework_grades` has a `unique(homeworkId, studentId)` constraint and an optional
`scoreRecordId` linking a grade to a `score_records` row — grading may create an assessment
record. Read `server/services/homework.ts` before touching this; do not infer the behavior.

---

## Task 4.5 — Attendance

**The highest-value screen in the mobile app.** Build it properly.

Data: `attendance_records`, PK `(event_id, date, student_id)`, `status` ∈
`present | absent | late | excused` (`AttendanceStatus`, `shared/schemas.ts:178`).
API: `GET /api/attendance?eventId&date`, `POST` with `AttendanceSaveInput`.

Requirements:

- Reachable in **two taps from app launch** — dashboard → today's class → attendance.
- One row per student: avatar, name, and a four-way status control. Use large segmented
  buttons, ≥48dp, not a dropdown. A teacher is doing this while standing and talking.
- **"Mark all present"** as the primary action, then correct the exceptions. That is the real
  workflow — most days most students are present.
- Show a live count: "22 present · 2 absent · 1 late".
- Autosave on change with an optimistic update, or an explicit Save with a clear dirty state.
  **Pick one and be unambiguous** — a half-saved register is worse than no register.
- The date defaults to today but must be changeable (marking a missed day retroactively).

Attendance is **not** in the offline scope for this phase (that was scoped to flashcards). But
do handle a failed save gracefully: keep the local state, show a retry, never silently drop it.

---

## Acceptance criteria

- [ ] Dashboard shows today's events, homework due, and class counts, matching the web.
- [ ] Agenda view is the calendar default and correctly expands daily and weekly recurring
      events — **cross-check a recurring class against the web month view**.
- [ ] Month view navigates; tapping a day reveals that day's events.
- [ ] Create, edit, and delete an event on mobile → verify each on the web.
- [ ] Long-press → "Move to…" reschedules an event.
- [ ] Event detail's four tabs all load and save.
- [ ] A `.docx` material opens in a viewer from the event detail.
- [ ] Class schedule and roster editable; changes appear on the web.
- [ ] Homework create, done-toggle, and grade-save all work; grades appear on the web.
- [ ] Attendance: two taps from launch, mark-all-present works, statuses persist, and the
      records appear on the web.
- [ ] Every screen respects safe-area insets and has ≥48dp touch targets.
- [ ] No horizontal scrolling anywhere. No clipped text. Test at 360dp width.
- [ ] Every string translated in both EN and VI.
- [ ] Committed and pushed to `main`; `eas update --branch preview` shipped.

## Pre-flight, done 2026-07-28 (read this first)

Phase 4 has **not** been started. What has been done is the setup it needs:

- **`react-native-webview` (13.16.1)** and **`@react-native-community/datetimepicker` (9.1.0)** are
  installed, and the datetimepicker config plugin is registered in `mobile/app.config.ts`. The
  WebView is for task 4.3's material viewer specifically because it can send the
  `Authorization: Bearer` header that `/materials/:id/view` requires — `expo-web-browser` cannot.
  The picker is for event date/time and the long-press "Move to…" reschedule.
- Installed **before the first APK exists**, deliberately: a native module added after one ships
  requires a `runtimeVersion` bump in `shared/version.json` and a reinstall on every phone.
  `runtimeVersion` is still **1** and must NOT be bumped for these — nothing has shipped to orphan.
- With these two, the native surface is complete through phase 6. Phases 5 and 6 need no further
  native modules (checked: materials use the already-installed document/image pickers, assessment
  charts use `react-native-svg`, push uses `expo-notifications`). **If you find yourself adding
  another native module, stop and check whether an APK has shipped first.**
- Verified after installing: `tsc --noEmit` clean, full production Metro bundle (3,817 modules),
  `expo config` resolves.

**Decision already taken, so don't re-open it:** task 4.5's autosave-vs-explicit-save question is
settled as **autosave, optimistic, with a visible saved/retrying state**. A teacher marking a
register is standing up and talking and will walk away mid-list; an explicit Save button loses the
register to a locked screen. Keep local state and offer a retry on failure, as the task requires.

**Also still true:** no part of the mobile app has ever been run on a device. Phases 2 and 3 are
verified only by typecheck, a full bundle, and route registration. Attendance and the calendar are
where a layout or gesture problem is most likely to be hiding.

## Notes for the executor

- Build in this order: **Attendance → Dashboard → Agenda → Event detail → Classes → Homework →
  Month → Day.** Attendance first because it is the highest value and the simplest; Month and
  Day last because they are the most layout work for the least benefit.
- Resist rebuilding the week time-grid. If you find yourself fighting seven columns on a phone,
  that is the design telling you the answer.
- `src/calendar/index.tsx` is only 234 lines and is a good map of the whole feature. Read it end
  to end before starting.
