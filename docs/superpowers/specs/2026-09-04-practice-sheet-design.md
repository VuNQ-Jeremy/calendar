# Practice sheet — design

**Date:** 2026-09-04 · **Status:** approved in chat (brainstorm + prototype) · **Prototype:**
https://claude.ai/code/artifact/3e218969-8c4f-435c-9830-0546509026a0 (left: wireframe, right:
clickable prototype in the Mochi tokens)

## Problem

The Practice (Nhiệm vụ) feature was built from the teacher's Google Sheet, where one grid per
student per month does everything: type a task into a row, watch the student's time and
"Hoàn thành" appear in the same row, write the grammar correction two cells to the right. The web
version spreads that one row across three pages and two dialogs:

| Sheet action | App (2026-09-04) |
|---|---|
| Add tomorrow's tasks | Practice → Open week → *Add tasks* dialog |
| See who did what | … → *Students on this day* dialog, per column |
| Read the student's time / note | Only on the Review queue |
| Write feedback / accept | Practice → **Review queue** (separate, school-wide page) |
| See misses / excuses | Practice → **Open ledger** (another page) |

The user's words: "I don't want to navigate too much to have CRUD operations." The sidebar is
fine; the in-feature flow is the problem.

## Decisions (from the 2026-09-04 clarification round)

| # | Question | Decision |
|---|---|---|
| 1 | Class size | 1–3 students (tutoring, like the sheet) — copy the sheet literally |
| 2 | Landing | Keep the class-card home; each card opens the sheet |
| 3 | Time window | One month, sheet-style, today scrolled into view |
| 4 | Review | Inline in the sheet only; `/practice/review` removed |
| 5 | Student layout | One tab per student |
| 6 | Ledger | Folded into a per-student standing strip + a miss line under the date; `/practice/:classId/ledger/:month` removed |
| 7 | Adding tasks | Inline blank row per practice day from today on; Enter saves, paste creates one task per line |
| 8 | Day controls | Day-off menu and pending excuse chip live in the date row header |
| 9 | Task scope default | Everyone in the class; a per-row toggle switches the blank row to "only <name>" |
| 10 | Row density | All columns always visible; horizontal scroll inside the table on narrow screens |

Everything in `practice-tracker-decisions` (the 49 locked rules) stands. This is a navigation
change, not a rules change.

## The screen

`/practice/:classId/:month?student=<id>` → **PracticeSheetScreen**.

The month is in the PATH because `cacheKeyForPath` (src/lib/route-cache.ts) only sees pathnames.
The student tab is a QUERY parameter on purpose: every tab of one class-month renders from the same
loader payload (1–3 students × ≤31 days × a handful of tasks), so all tabs sharing one cache entry
is correct, not a bug. One cache key, `practiceMonthKey(classId, month)`, replaces the week, ledger
and review keys.

Top to bottom:

1. **Header** — breadcrumb *Practice › class*, title = class name, subtitle = "Practice · <month> ·
   practice days <weekday list>", actions: `‹` `›` month links, a **Practice weekdays** button that
   opens the existing weekday dialog (same one the class card uses to enable).
2. **Filter chips** — **All · Needs review (n) · Misses (n)**. Local state; they narrow the sheet
   for the selected student. *Needs review* shows only `submitted` rows (days with none are
   hidden); *Misses* shows only days with a miss row. No blank rows while a filter is on.
3. **Standing strip** — one card per enrolled student: done/total · excused used/quota · unexcused
   · orange **×N on dd/MM** badge when a penalty is pending · violet **Warning level N** with **Clear
   warning** (confirm) · **No Zalo pairing** tag when no parent chat exists. This is the ledger
   table, turned sideways; its data is `classLedger()` plus `hasZalo`.
4. **Student tabs** — DS `Tabs`, one per roster entry, selected from `?student=`; missing or
   unknown → first roster entry. A tab shows a small orange count of its `submitted` rows.
5. **The sheet** — the selected student's copies, grouped by date, one sticky group header per day
   in the month, today's group scrolled into view on first render.

**Date group header:** weekday + dd/MM · **Today** tag · **Day off** tag when not a practice day ·
"n tasks · m done" · a miss line (**Missed — excused / unexcused**) with **Mark excused** on an
unexcused miss · **×N owed** when `summary.pendingForDate` is this date · a pending excuse request
as an inline chip with **Approve / Reject** · a `⋯` **Day menu** (Day off / Make practice day / Use
weekly default), identical to today's column menu.

**Task row** (one per student copy), all columns always visible:

| Task | Material | Link | Time | Status & proof | Student note | Feedback | |
|---|---|---|---|---|---|---|---|
| in-place text (saves on blur/Enter, Esc reverts) | select | in-place URL | `19:30–20:10`, read-only | open: proof-type select + **Mark done**; submitted: **Submitted** tag · thumbnail · **Accept / Reject**; accepted / rejected / teacher done: tag · thumbnail | read-only | textarea, saves on blur, flashes **Saved** | scope marker (*everyone* / *only <name>*) · **Delete task** |

Proof thumbnail (`<img>`/`<video>` from `/practice-media/:key`) opens the full media in a Modal.
**Reject** reveals an inline reason field and a confirming **Reject** button, as the review card did.

**Blank row** — at the end of every practice-day group with `date >= today` while the filter is
*All*. A one-line textarea: **Enter** saves, Shift+Enter is a newline, a paste with several lines
creates one task per line (`quick-add` semantics). Material select defaults to the day's last row's
material; proof-type select defaults to *Photo or video*; the **scope** pill toggles **Everyone** ↔
**Only <name>**. Everyone → `quick-add`; only-<name> → one `create-task` with `studentId` per line.

**Scope and editing rules** (unchanged server semantics, made visible): a row whose copy has a
`taskId` is a class task — editing its title/material/link/proof posts `update-task` and propagates
to every student's still-`open` copy; deleting posts `delete-task` (submitted copies survive with
`taskId = null`, as today). A row with `taskId = null` is a per-student task — editing posts the new
`update-copy` intent, deleting posts `remove-copy`. The detach/"this student only" prompt floated in
brainstorming is dropped (YAGNI): the blank-row toggle covers per-student tasks.

**Not enabled:** the sheet shows the existing Empty state with **Enable Practice**, like the week
screen did.

## Data flow

One loader (`app/routes/practice.$classId.$month.tsx`): class, settings, practice days for the
month, class tasks, student copies, roster, materials, pending excuses for the month, and
`classLedger()` rows with `hasZalo`. Every function exists in `server/services/practice.ts`; the
only range change is week → month.

Writes reuse `/practice-actions` intents: `settings`, `day-override`, `quick-add`, `create-task`,
`update-task`, `delete-task`, `remove-copy`, `review` (accept / reject / feedback / teacher_done),
`excuse-decide`, `excuse-miss`, `clear-warning`. **One new intent, `update-copy`** (title,
materialId, url, proofType on an `open` per-student copy), backed by a new
`updateStudentTask(db, id, patch)` service function — the one thing the sheet can do that no old
screen could (edit a per-student task in place). **One widened intent:** `quick-add` accepts an
optional `studentId`, so the "only <name>" blank row is a single post — `useFetcher` aborts an
in-flight submit when the next one starts, and a per-line `create-task` loop would lose lines.

`usePracticeSubmit` rule stands: the fetcher is owned by the screen and passed down; a cell that may
unmount never owns one.

No schema change. No API change. The student's mobile app is untouched.

## Removed

- Screens `src/practice/practice-week.tsx`, `practice-ledger.tsx`, `practice-review.tsx` and their
  `.pr-week__* / .pr-review__* / .pr-ledger__*` CSS.
- The three route files stay as **301 redirects**: `/practice/review` → `/practice`;
  `/practice/:classId/week/:monday` → `/practice/:classId/<monday's month>`;
  `/practice/:classId/ledger/:month` → `/practice/:classId/:month`.
- `practiceWeekKey`, `practiceLedgerKey`, `PRACTICE_REVIEW_KEY` and their `cacheKeyForPath`
  branches; the `/practice/review` page-title entry.
- i18n keys with no remaining caller.
- The class card's **Open week / Open ledger** buttons and the header's **Review queue** button →
  one **Open sheet** link.

## Testing and catalogue (same commit — CLAUDE.md)

- `e2e/crud-practice.spec.ts` rewritten around the sheet: enable → type into the blank row → edit a
  cell → mark done → feedback → standing strip + Zalo indicator → tab switch → filter → delete →
  disable.
- Walkthrough stories `practice-plan-week` and `practice-review-ledger` become
  `practice-sheet-plan` and `practice-sheet-review` (count stays 29).
- Unit tests: `shared/logic/practice-sheet.ts` (month dates, grouping, filters, blank-row rule);
  `test/cache.test.ts` (new key, old paths no longer matched).
- Free checks before the commit: `npm run typecheck`, `npm run lint`, `npm run check:i18n`,
  `npx prettier --write <changed files>`. Suites are the user's to run.
