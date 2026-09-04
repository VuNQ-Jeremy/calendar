# Practice sheet — Implementation Plan

> **For the executor (Claude Opus 5, unattended):** This plan is ONE linear run for a single
> developer, start to finish — Build phase (Tasks 1–10, each with a LOCAL commit, no push) and then
> the Verification phase (V.0–V.10, which pushes twice: the feature, then the log). Tick the `- [ ]`
> boxes in THIS file as you go. Every decision is already made — do not re-open one, do not ask, do
> not stop to confirm, and do not assume anything this file does not state; when a step says "read
> file X first", do that before writing. **§0.2 is the whole authorization**: a command not listed
> there is not granted — tick the step `skipped — not authorized` and continue. If a step is
> impossible after 3 attempts, write what happened under **Execution log** and continue with the
> next step. The tree must pass `npm run typecheck` at every commit. Read §0 first, then the repo
> skill `.claude/skills/unattended-verification/` (`playwright.md`) before V.4 and V.7.

**Goal:** Replace the Practice week planner, review queue and ledger with ONE sheet-like screen per class-month — rows are the student's tasks grouped by date, every column is edited in place, and a blank row on each practice day adds tasks — so a teacher does the whole evening routine without leaving the page.

**Architecture:** A new route `/practice/:classId/:month?student=<id>` renders `PracticeSheetScreen` from one loader that already exists piece by piece in `server/services/practice.ts` (month-ranged reads + `classLedger`). Grouping is a pure function in `shared/logic/practice-sheet.ts`. Every write goes through the existing `/practice-actions` intents plus ONE new intent (`update-copy`) and one widened one (`quick-add` gains `studentId`). The three old screens are deleted; their routes become 301 redirects. No schema or API change; the mobile app is untouched.

**Tech Stack:** React Router 7 (SSR on Cloudflare Workers, `useLoaderData`/`useFetcher`/`useSearchParams`), Mochi DS (`src/ds`: Button, Card, IconButton, Tag, Tabs; `src/ui.tsx`: Modal, MSelect, PageHeader, Empty, useConfirm), Zod 4, vitest (`test/` jsdom; `test-worker/` cloudflare pool), Playwright (`e2e/`, calendar-test only).

**Spec:** `docs/superpowers/specs/2026-09-04-practice-sheet-design.md` (read it first; the prototype it links — https://claude.ai/code/artifact/3e218969-8c4f-435c-9830-0546509026a0 — is the visual reference, but the code in Task 7 is the contract).

## Global Constraints

- Work on `main`. Commit after every Build task with the exact message given (LOCAL commits); the ONLY pushes are V.5 (the feature) and V.10 (the log). One push = one `node scripts/changelog.mjs "…"` entry, per CLAUDE.md.
- Test suites run ONLY where §0.2 grants them, at the steps that name them. `npx vitest run test/<one file>` for a test you just wrote is covered by the unit grant. Never run `npm run test:device`.
- Free checks, run as often as you like: `npm run typecheck`, `npm run lint`, `npm run check:i18n`, `npx prettier --write <the files you changed>` (never `npm run format` — the tree is CRLF and it would rewrite hundreds of files).
- No paid API calls (none are needed). No `wrangler deploy`, no `wrangler login`, no `eas login`, no `git add -A` / `git add .`, no `git push --force`, no `git reset --hard`, no `git checkout -- <file>` on a file you did not create, no `npx tsc -b`.
- Every new file starts with a doc comment saying WHY it exists (house style).
- Every new i18n key goes in BOTH blocks of `shared/i18n/strings.ts`: the `en` block (`const en_strings = { … } as const;`) and the `vi` block (`vi: { … }`). English strings are also the e2e/walkthrough/smoke selectors — copy them exactly as written here.
- Every tenant-table write uses `db.update(table, set, ...where)` / `db.delete(table, ...where)`; reads use `db.raw.select().from(t).where(db.own(t, …))`.
- CSS selectors are namespaced `pr-sheet__…` (app.css is global; see the `.month` incident note at the top of the Practice CSS block).
- Dates are ICT `YYYY-MM-DD`; "today" is `ictDateOf(new Date().toISOString())` from `shared/logic/tests`, never `new Date()` math. In a scratch script, today's ICT date is `new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)`.
- Scratch scripts live in `C:\Users\ADMIN\AppData\Local\Temp\claude\f--code-calendar\<session>\scratchpad\` (whatever scratchpad the session reports), never in the repo; they import Playwright by `file:///F:/code/calendar/node_modules/playwright/index.mjs`.
- No foreground `sleep`. Long processes start with `run_in_background`; polls use the Monitor tool or a bounded background loop.

---

## 0. Session survival kit — read before the first step

### 0.1 Machine facts (verified 2026-09-04)

| Thing | Value | Verify with |
|---|---|---|
| Shells | Windows 11. Bash tool for git/curl/grep/heredocs; PowerShell only where a step says so (`curl` there is `Invoke-WebRequest` — write `curl.exe`). `cd` does not persist: every command starts `cd f:/code/calendar && …`. | — |
| Node | v24.16.0 | `node -v` |
| Repo | `f:\code\calendar`, branch `main`. Other worktree: `.worktrees/vocab` (branch `vocab-games`) — **exclude `.worktrees/**` from every grep** or every hit doubles. | `git worktree list` |
| Head at plan time | `44de481` — `main` is **ahead 1** of `origin/main` (a one-line spec fix that rides with the V.5 push). Starting from a different sha is fine; record it in V.0. | `git rev-parse --short HEAD`, `git status -sb` |
| adb / emulator / APK | **Not used by this run** (web-only change; no `runtimeVersion` bump, no native code). Java is not installed. | — |
| runtimeVersion | unchanged by this plan | `node -p "require('./shared/version.json').runtimeVersion"` |
| EAS | `npx eas-cli` from `mobile/`, logged in as `vu-nguyen` (owner of `vu-nguyens-team`, project `mochi-class`). Never `eas login`. | `cd mobile && npx eas-cli whoami` |
| Cloudflare | account `ngqv0712@gmail.com` (OAuth token). Never `wrangler login`, never `wrangler deploy` — Workers Builds deploys on push. | `npx wrangler whoami` |
| GitHub | no `gh`; Actions via `curl -s "https://api.github.com/repos/VuNQ-Jeremy/calendar/actions/runs?per_page=3"`. Push 403 → see §0.5. | — |
| Accounts | staff/admin `dev@mochi.edu` / `mochi123`; student `vunq@mochi.edu` / `mochi123`. On **calendar-test** the student is `s1` "Leo Park" in class `c1` "Biology 9A" (with "Mia Chen"; only Leo's mother `p1` has a Zalo chat). On **prod** the student account is "Moon" (`975c53c0-5400-4d29-90d9-1f0a964f7ef6`). | seed.sql / `scripts/test-accounts.sql`; prod by the D1 query in V.0 |
| Prod smoke class | **Bamblebee**, id `7ab211f5-9702-4b72-b7a8-a33a7a4dbfc7` — its ONLY student is Moon, Practice is already enabled, it has no tasks. The other enabled class, "Viết chữ đẹp" (`80da975f-…`), holds the user's `seedtest-` demo rows: **never touch it.** | V.0 query |
| Prod practice rows at plan time (N0, 2026-09-04) | `practice_tasks` 3 · `practice_student_tasks` 6 · `practice_excuses` 2 · `practice_misses` 2 (all `seedtest-…`, all on Viết chữ đẹp) · `practice_settings` enabled 2 · WALKTHROUGH-titled rows 0 · `practice_day_overrides` for Bamblebee: record in V.0 | V.0 query |
| URLs | prod `https://calendar.ngqv0712.workers.dev`; test `https://calendar-test.ngqv0712.workers.dev`; manifest `https://u.expo.dev/83251f6c-1fa9-4724-ba61-39a9eb806aab` | — |
| Playwright | `playwright.config.ts`: 1 worker, 1 retry, 90 s timeout, viewport 1400×900, channel `msedge`. `scripts/test-e2e-staging.mjs` supplies `MOCHI_EMAIL`/`MOCHI_PASSWORD` defaults. | — |

### 0.2 Authorizations granted for THIS run (user, 2026-09-04) — and what stays forbidden

Granted (manual-trigger only per CLAUDE.md; the user ticked exactly these):
- `npm test` and `npm run test:worker` — and their single-file forms `npx vitest run test/<file>` and `npx vitest run --config vitest.workers.config.js test-worker/practice.test.js`.
- `npm run test:env:setup` then `npm run test:e2e:staging` (and `npm run test:e2e:staging -- e2e/crud-practice.spec.ts` for one spec). Setup and suite run as a pair.
- **Prod smoke on Bamblebee only:** a scratchpad Playwright script signs in as `dev@mochi.edu` and, on class Bamblebee, adds `WALKTHROUGH sheet smoke <stamp>` task rows through the sheet, edits/feedbacks/screenshots them, deletes them through the sheet, and — if today was a day off — may set today to a practice day and MUST put it back to the weekly default. Cleanup runs unconditionally and ends with the zero-count query in V.9. Fallback if the UI delete fails: `npx wrangler d1 execute mochi-class --remote --command "DELETE FROM practice_student_tasks WHERE title LIKE 'WALKTHROUGH%'"` then the same for `practice_tasks`, and `DELETE FROM practice_day_overrides WHERE class_id='7ab211f5-9702-4b72-b7a8-a33a7a4dbfc7' AND date='<today ICT>'`.
- Read-only prod D1 `SELECT`s (counts) via `npx wrangler d1 execute mochi-class --remote --json --command "SELECT …"`.
- Two pushes to `main` (V.5 feature, V.10 log), each with a changelog entry.
- **Fix commits: max 3** after the Build phase, only for defects V.1–V.9 prove; each is `fix(practice): <what V.x proved>`.

NOT granted (tick `skipped — not authorized` if a step would need it):
- The manual OTA publish `npx eas-cli update …`. V.8 only RECORDS the workflow status (the change is web-only; the served bundle is unchanged either way).
- Any emulator / adb / `eas build` work. Any prod D1 migration (none exists in this plan). Any write on a prod class other than Bamblebee. Removing the `seedtest-` demo rows.

Forbidden, no exceptions: paid API routes (`/enrich-vocab`, `/generate-vocab`, `/vocab-image-generate`, `/speech-assess`); `wrangler deploy` in any form; `wrangler login`; `eas login`; `npm run format` / `prettier --write .`; `git add -A`, `git add .`, `git push --force`, `git reset --hard`, `git checkout -- <file>` on a file you did not create; `npx tsc -b` at the root; `npm run test:device`; new feature code beyond Tasks 1–10.

### 0.3 Names this run depends on — confirm from the tree at V.0

| Name | Expected | Confirm with |
|---|---|---|
| Migration | **none** (no schema change) | `ls migrations \| tail -2` still ends at `0057_practice.sql` |
| Sheet route | `route('practice/:classId/:month', 'routes/practice.$classId.$month.tsx')` | `grep -n "practice" app/routes.ts` |
| Redirect routes | `practice.review.tsx`, `practice.$classId.week.$monday.tsx`, `practice.$classId.ledger.$month.tsx` each `throw redirect(…, 301)` | `grep -ln "redirect(" app/routes/practice.*` |
| Action route + intents | `app/routes/practice-actions.tsx` cases: `settings day-override quick-add create-task update-task update-copy delete-task remove-copy review excuse-decide excuse-miss clear-warning` | `grep -n "case '" app/routes/practice-actions.tsx` |
| English UI strings (selectors) | `Open sheet` · `Practice weekdays` · `All` · `Needs review` · `Misses` · `Day menu` · `Day off` · `Make practice day` · `Use weekly default` · `Task` · `Feedback` · `Mark done` · `Accept` · `Reject` · `Approve` · `Mark excused` · `Delete task` · `Clear warning` · `Saved` · `Done (teacher)` · `Recorded by teacher` · `No Zalo pairing` · `Nothing to review for {name}` | `grep -n "pr_" shared/i18n/strings.ts` |
| e2e spec | `e2e/crud-practice.spec.ts` (rewritten, Task 9) | `ls e2e` |
| Reset sweep | unchanged — the seven `DELETE FROM practice_*;` lines already exist | `grep -n practice scripts/test-accounts.sql` |
| Walkthrough story count | stays **29** (two stories replaced) | `grep -n toHaveLength test/walkthrough.test.ts` |
| Cache key | `practiceMonthKey` in `src/lib/route-cache.ts`; `practiceWeekKey`/`practiceLedgerKey`/`PRACTICE_REVIEW_KEY` gone | `grep -n "practice" src/lib/route-cache.ts` |
| Deleted screens | `src/practice/practice-week.tsx`, `practice-review.tsx`, `practice-ledger.tsx` absent | `ls src/practice` |

### 0.4 Baselines — already red, not yours

- **Web unit (`test/`)**: expected green (the cascade failure was fixed 2026-07-31). Record the exact `N passed` line.
- **Worker unit (`test-worker/`)**: expected green. Record the line.
- **e2e (2026-09-01, main@7976464: 140 passed / 5 skipped / 4 known failures)** — compare by spec file + test title:
  1. `pvp.spec.ts` › "room battle" (180 s timeout; multi-context spec invisible to the trace)
  2. `crud-feedback-profile.spec.ts` › "changelog: hide" (`waitForResponse` timeout despite a 200)
  3. `sidebar-collapse.spec.ts` › "hairline scrollbar" (3 px vs ≤ 2 px cap)
  4. `crud-vocab-curriculum.spec.ts` › "grade filter"
  The two zalo specs skip without `ZALO_BOT_TOKEN`. `crud-tests3.spec.ts:27` has been flaky-then-green; a retry pass is not a failure. Anything else red is yours.
- **lint**: 2 pre-existing warnings (`src/screens-activity.tsx:197` no-underscore-dangle, `src/ui.tsx:354` no-shadow), 0 errors.

### 0.5 Traps

See `.claude/skills/unattended-verification/playwright.md` (spec recipe, staging run, deploy probe, authed curl) — read it before V.4 and V.7. Feature-specific, on top of that:

1. **`useFetcher` aborts an in-flight submit when the next one starts.** That is why the blank row posts ONE `quick-add` (with `studentId` for the "only <name>" scope) and never loops `create-task`. Do not "simplify" it back.
2. **The sheet's own fetcher is owned by the screen** (`usePracticeSubmit` in `practice-sheet.tsx`) and passed down. A row unmounts when a filter hides it; a fetcher created inside the row would abort its own write.
3. **A new route needs `npm run typecheck`** (it runs `react-router typegen`) before `.react-router/types` knows `params.month`. A red typecheck right after Task 6 Step 1 is the stale types, not your code.
4. **`import type { SheetLoaderData } from '../../app/routes/practice.$classId.$month.js'`** — type-only, so the `$` in the path is fine and there is no runtime cycle. Quote the path in shell commands: `"app/routes/practice.\$classId.\$month.tsx"`.
5. **DS `Tabs` renders `role="tablist"` / `role="tab"`**; Playwright reaches a tab with `getByRole('tab', { name: 'Leo Park' })` (substring, so a `· 1` count suffix is fine).
6. **`MSelect` in a cell has no label**, so the e2e kit's `pickSel(label, …)` cannot reach it. The spec never picks a material/proof in a cell; the blank-row defaults are what get saved.
7. **Row handles**: `[data-testid="pr-row"][data-title="<exact title>"]`; the title input and the blank textarea both carry `aria-label="Task"` (`getByRole('textbox', { name: 'Task' })`), the feedback textarea `aria-label="Feedback"`.
8. **A `teacher_done` copy survives `delete-task`** (task_id → NULL). The staging spec relies on it; the **prod smoke must therefore never Mark done** — a surviving WALKTHROUGH copy would break the zero count.
9. **`/practice-actions` is posted by the fetcher to `/practice-actions.data`** (turbo-stream); `k.posted('/practice-actions')` checks status only. Never `.json()` it.
10. **Deploy-live probe for the new bundle**: anonymous `curl -sI https://calendar.ngqv0712.workers.dev/practice/review` — old bundle answers `302` (to `/login`), new bundle `301` with `location: /practice`.
11. **Another session may redeploy calendar-test or main.** Before diagnosing a red spec, read the sidebar stamp `v0.NNNN · <sha>` in `test-results/<spec>/error-context.md`; not your sha → rerun setup + spec, do not debug.
12. **Push 403** → `printf "protocol=https\nhost=github.com\n\n" | git credential fill`; if it names `tech-entag`, `printf "protocol=https\nhost=github.com\nusername=tech-entag\n\n" | git credential reject`, retry.
13. **CRLF tree**: `prettier --check` flags almost every file. Format only files you changed, by name.
14. **`test-worker/*.test.js` must stay `.js`** (the workers vitest project is configured for JS).

### 0.6 Time budget and hard stop

| Phase | Budget |
|---|---|
| Build Tasks 1–6 | 75 min |
| Task 7 (the screen) | 60 min |
| Tasks 8–10 | 30 min |
| V.0–V.2 (static + unit) | 20 min |
| V.3–V.4 (staging + e2e, incl. ≤ 3 red laps) | 60 min |
| V.5–V.8 (push, deploy probe, prod smoke, OTA record) | 45 min |
| V.9–V.10 (cleanup, log, push) | 20 min |
| Slack | 50 min |
| **Total / hard stop** | **6 h after the V.0 start time written in the Execution log.** At the hard stop: abandon the open step, run V.9 then V.10 whatever state things are in. |

---

## File map

| Action | Path | Responsibility |
|---|---|---|
| Create | `shared/logic/practice-sheet.ts` | Pure: month dates, group one student's copies by date, apply filter, blank-row rule |
| Create | `test/practice-sheet-logic.test.ts` | Pins the above |
| Modify | `src/lib/route-cache.ts` | `practiceMonthKey`; drop week/ledger/review keys; `cacheKeyForPath` branch |
| Modify | `test/cache.test.ts` | New key mapping, old paths → null |
| Modify | `shared/schemas.ts` | `PracticeQuickAddInput.studentId` |
| Modify | `server/services/practice.ts` | `updateStudentTask`; `quickAdd` passes `studentId` |
| Modify | `test-worker/practice.test.js` | Two cases for the above (written, not run) |
| Modify | `app/routes/practice-actions.tsx` | `update-copy` intent |
| Modify | `shared/i18n/strings.ts` | New keys; remove orphaned keys |
| Create | `src/practice/weekdays-dialog.tsx` | The weekday-mask Modal, shared by home card (enable) and sheet (edit) |
| Modify | `src/practice/practice-home.tsx` | One **Open sheet** link per card; uses `WeekdaysDialog`; header loses Review queue |
| Modify | `src/practice/common.tsx` | `weekdayLabels`, `NO_MATERIAL`, `materialOptions` move here |
| Create | `app/routes/practice.$classId.$month.tsx` | The sheet's loader |
| Rewrite | `app/routes/practice.review.tsx`, `practice.$classId.week.$monday.tsx`, `practice.$classId.ledger.$month.tsx` | 301 redirects |
| Modify | `app/routes.ts` | Register the sheet route |
| Modify | `src/lib/page-title.ts` | Drop the `/practice/review` entry |
| Create | `src/practice/practice-sheet.tsx` | The screen: header, filters, standing strip, tabs, the grid |
| Create | `src/practice/standing-strip.tsx` | Per-student standing cards (the old ledger) |
| Create | `src/practice/sheet-day.tsx` | Date group header: tags, miss line, excuse chip, day menu |
| Create | `src/practice/sheet-row.tsx` | `TaskRow`, `BlankRow`, in-place cells, proof thumbnail |
| Modify | `src/styles/app.css` | Replace `.pr-week__* .pr-review__* .pr-ledger__*` with `.pr-sheet__*` |
| Delete | `src/practice/practice-week.tsx`, `practice-review.tsx`, `practice-ledger.tsx` | Replaced |
| Rewrite | `e2e/crud-practice.spec.ts` | Sheet lifecycle |
| Modify | `shared/walkthrough.ts` | Two stories rewritten |
| Modify | `CHANGELOG.md` (via script) | Entry for the push |

---

## Build phase

### Task 1: Pure sheet grouping

**Files:**
- Create: `shared/logic/practice-sheet.ts`
- Test: `test/practice-sheet-logic.test.ts`

**Interfaces:**
- Consumes: `monthOf` from `shared/logic/practice.ts` (not needed — dates carry the month), nothing else.
- Produces (used by Tasks 6 and 7):
  ```ts
  export type SheetFilter = 'all' | 'review' | 'misses';
  export function lastDayOfMonth(month: string): string;            // '2026-09' → '2026-09-30'
  export function monthDates(month: string): string[];              // every 'YYYY-MM-DD' of the month, ascending
  export function buildSheet<C extends SheetCopy, M extends SheetMiss, E extends SheetExcuse>(input: SheetInput<C, M, E>): SheetDay<C, M, E>[];
  export function needsReviewCount(copies: readonly SheetCopy[]): number;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// test/practice-sheet-logic.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildSheet,
  lastDayOfMonth,
  monthDates,
  needsReviewCount,
} from '../shared/logic/practice-sheet';

/**
 * The sheet shows one student's month as date groups. These pin the three things a teacher
 * would notice if they broke: a day missing from the month, a blank row on a past or off day,
 * and a filter that hides the wrong rows.
 */
const copy = (id: string, date: string, status: string, taskId: string | null = 'T') => ({
  id,
  taskId,
  date,
  status,
});

describe('practice sheet — month dates', () => {
  it('knows month lengths, leap years included', () => {
    expect(lastDayOfMonth('2026-09')).toBe('2026-09-30');
    expect(lastDayOfMonth('2028-02')).toBe('2028-02-29');
    expect(lastDayOfMonth('2027-02')).toBe('2027-02-28');
    expect(monthDates('2028-02')).toHaveLength(29);
    expect(monthDates('2026-09')[0]).toBe('2026-09-01');
    expect(monthDates('2026-09').at(-1)).toBe('2026-09-30');
  });
});

describe('practice sheet — grouping', () => {
  const base = {
    month: '2026-09',
    today: '2026-09-04',
    practiceDays: ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'],
    misses: [{ id: 'm1', date: '2026-09-03', excused: false }],
    excuses: [{ id: 'e1', date: '2026-09-04', status: 'pending', reason: 'sick' }],
    copies: [
      copy('c1', '2026-09-02', 'accepted'),
      copy('c2', '2026-09-02', 'submitted'),
      copy('c3', '2026-09-02', 'open', null),
      copy('c4', '2026-09-04', 'open'),
    ],
  };

  it('emits every day of the month in order with its rows, miss and excuse attached', () => {
    const days = buildSheet({ ...base, filter: 'all' });
    expect(days).toHaveLength(30);
    expect(days[1].date).toBe('2026-09-02');
    expect(days[1].rows.map((r) => r.copy.id)).toEqual(['c1', 'c2', 'c3']);
    expect(days[1].rows.map((r) => r.scope)).toEqual(['class', 'class', 'student']);
    expect(days[2].miss?.id).toBe('m1');
    expect(days[3].excuse?.id).toBe('e1');
    expect(days[3].isToday).toBe(true);
    expect(days[5].isPractice).toBe(false); // 06/09 not in practiceDays
  });

  it('shows a blank row only on practice days from today on, and only unfiltered', () => {
    const all = buildSheet({ ...base, filter: 'all' });
    expect(all[1].showBlank).toBe(false); // 02/09 is past
    expect(all[3].showBlank).toBe(true); // today
    expect(all[4].showBlank).toBe(true); // 05/09 practice day
    expect(all[5].showBlank).toBe(false); // 06/09 day off
    expect(buildSheet({ ...base, filter: 'review' }).every((d) => !d.showBlank)).toBe(true);
  });

  it('review filter keeps only submitted rows and drops days without one', () => {
    const days = buildSheet({ ...base, filter: 'review' });
    expect(days.map((d) => d.date)).toEqual(['2026-09-02']);
    expect(days[0].rows.map((r) => r.copy.id)).toEqual(['c2']);
  });

  it('misses filter keeps only days with a miss row', () => {
    const days = buildSheet({ ...base, filter: 'misses' });
    expect(days.map((d) => d.date)).toEqual(['2026-09-03']);
    expect(days[0].rows).toEqual([]);
  });

  it('counts submitted copies for the tab badge', () => {
    expect(needsReviewCount(base.copies)).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd f:/code/calendar && npx vitest run test/practice-sheet-logic.test.ts`
Expected: FAIL — cannot resolve `../shared/logic/practice-sheet`.

- [ ] **Step 3: Write the implementation**

```ts
// shared/logic/practice-sheet.ts
/**
 * Pure grouping for the Practice sheet (src/practice/practice-sheet.tsx): one student's month,
 * split into date groups with the per-day extras a teacher acts on (a miss, a pending excuse, the
 * blank row). No React, no server imports — testable like shared/logic/practice.ts, and the one
 * place the "blank row from today on, practice days only, unfiltered only" rule is written down.
 */

export type SheetFilter = 'all' | 'review' | 'misses';

export type SheetCopy = { id: string; taskId: string | null; date: string; status: string };
export type SheetMiss = { id: string; date: string; excused: boolean };
export type SheetExcuse = { id: string; date: string; status: string };

/** `scope` is what the row's edit/delete post to: a class task, or this student's own copy. */
export type SheetRow<C extends SheetCopy> = { copy: C; scope: 'class' | 'student' };

export type SheetDay<C extends SheetCopy, M extends SheetMiss, E extends SheetExcuse> = {
  date: string;
  isPractice: boolean;
  isToday: boolean;
  rows: SheetRow<C>[];
  miss: M | null;
  excuse: E | null;
  showBlank: boolean;
};

export type SheetInput<C extends SheetCopy, M extends SheetMiss, E extends SheetExcuse> = {
  month: string;
  today: string;
  filter: SheetFilter;
  practiceDays: readonly string[];
  /** Already narrowed to ONE student, in the service's (date, sortOrder) order. */
  copies: readonly C[];
  misses: readonly M[];
  /** Pending requests only — the loader filters status; this module does not. */
  excuses: readonly E[];
};

/** '2026-09' → '2026-09-30'. UTC arithmetic on a fixed noon so no DST can shift the day. */
export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}

export function monthDates(month: string): string[] {
  const last = Number(lastDayOfMonth(month).slice(8, 10));
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

export function needsReviewCount(copies: readonly SheetCopy[]): number {
  return copies.filter((c) => c.status === 'submitted').length;
}

export function buildSheet<C extends SheetCopy, M extends SheetMiss, E extends SheetExcuse>(
  input: SheetInput<C, M, E>,
): SheetDay<C, M, E>[] {
  const practice = new Set(input.practiceDays);
  const out: SheetDay<C, M, E>[] = [];
  for (const date of monthDates(input.month)) {
    let rows: SheetRow<C>[] = input.copies
      .filter((c) => c.date === date)
      .map((c) => ({ copy: c, scope: c.taskId ? 'class' : 'student' }));
    const miss = input.misses.find((m) => m.date === date) ?? null;
    const excuse = input.excuses.find((e) => e.date === date) ?? null;
    if (input.filter === 'review') {
      rows = rows.filter((r) => r.copy.status === 'submitted');
      if (rows.length === 0) continue;
    }
    if (input.filter === 'misses' && !miss) continue;
    const isPractice = practice.has(date);
    out.push({
      date,
      isPractice,
      isToday: date === input.today,
      rows,
      miss,
      excuse,
      showBlank: input.filter === 'all' && isPractice && date >= input.today,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd f:/code/calendar && npx vitest run test/practice-sheet-logic.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
cd f:/code/calendar && npx prettier --write shared/logic/practice-sheet.ts test/practice-sheet-logic.test.ts
git add shared/logic/practice-sheet.ts test/practice-sheet-logic.test.ts
git commit -m "feat(practice): pure month grouping for the sheet"
```

---

### Task 2: One cache key per class-month

**Files:**
- Modify: `src/lib/route-cache.ts` (lines ~91–102 the three exports; lines ~354–361 in `cacheKeyForPath`)
- Test: `test/cache.test.ts` (inside `describe('cacheKeyForPath')`)

**Interfaces:**
- Produces: `export const practiceMonthKey = (classId: string, month: string) => string` — used by Task 6's `clientLoader`.
- Removes: `practiceWeekKey`, `practiceLedgerKey`, `PRACTICE_REVIEW_KEY` (their only importers are the three route files rewritten in Task 6 and `cacheKeyForPath` itself).

- [ ] **Step 1: Write the failing test** — add to `describe('cacheKeyForPath', …)` in `test/cache.test.ts`, and add `practiceMonthKey` to the import list at the top of the file:

```ts
  it('gives each practice class-month its own key, and forgets the pre-sheet pages', () => {
    expect(cacheKeyForPath('/practice')).toBe(K.practice);
    expect(cacheKeyForPath('/practice/c1/2026-09')).toBe(practiceMonthKey('c1', '2026-09'));
    expect(practiceMonthKey('c1', '2026-09').startsWith(K.practice)).toBe(true);
    // The old pages are 301 redirects now; a redirect has nothing to cache.
    expect(cacheKeyForPath('/practice/review')).toBeNull();
    expect(cacheKeyForPath('/practice/c1/week/2026-09-07')).toBeNull();
    expect(cacheKeyForPath('/practice/c1/ledger/2026-09')).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd f:/code/calendar && npx vitest run test/cache.test.ts`
Expected: FAIL — `practiceMonthKey` is not exported.

- [ ] **Step 3: Implement** — in `src/lib/route-cache.ts` replace the block from the `/** Practice keys. …` comment through `export const PRACTICE_REVIEW_KEY = …;` with:

```ts
/**
 * Practice sheet key. Same prefix trick as tuition/garden — K.practice ('route:practice') is a
 * prefix of it, so one `invalidate(K.practice)` after any practice mutation drops the landing page
 * and every cached class-month together.
 *
 * ONLY the pathname is in the key: the student tab lives in `?student=` and every tab of a
 * class-month renders from the same loader payload, so sharing one entry is correct here.
 */
export const practiceMonthKey = (classId: string, month: string) =>
  `route:practice:${classId}:${month}`;
```

and in `cacheKeyForPath` replace the four practice lines (the `pw` / `pl` / `/practice/review` branches and their comment) with:

```ts
  // Practice: the sheet is one key per class-month under the 'route:practice' prefix. The old
  // /practice/review, /week and /ledger URLs are redirects and deliberately fall through to null.
  const pm = pathname.match(/^\/practice\/([^/]+)\/(\d{4}-\d{2})\/?$/);
  if (pm) return practiceMonthKey(decodeURIComponent(pm[1]), pm[2]);
  if (pathname === '/practice' || pathname === '/practice/') return K.practice;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd f:/code/calendar && npx vitest run test/cache.test.ts`
Expected: PASS. (`npm run typecheck` will fail until Task 6 rewrites the three route files that import the removed keys — that is expected at this point; do not run it yet.)

- [ ] **Step 5: Commit**

```bash
cd f:/code/calendar && npx prettier --write src/lib/route-cache.ts test/cache.test.ts
git add src/lib/route-cache.ts test/cache.test.ts
git commit -m "feat(practice): one cache key per class-month"
```

---

### Task 3: `update-copy` intent and per-student quick add

**Files:**
- Modify: `shared/schemas.ts` (`PracticeQuickAddInput`, ~line 1652)
- Modify: `server/services/practice.ts` (`quickAdd` ~line 490; add `updateStudentTask` after `updateTask` ~line 537)
- Modify: `app/routes/practice-actions.tsx` (new `case 'update-copy'` after `case 'update-task'`)
- Test: `test-worker/practice.test.js` (append to `describe('practice — tasks fan out to the roster')`) — **write it, do not run it** (miniflare pool; the user runs `npm run test:worker`).

**Interfaces:**
- Produces: intent `update-copy` with form fields `id` (student copy id) and any of `title`, `materialId`, `url`, `proofType` — same patch shape as `update-task`; intent `quick-add` accepts an optional `studentId` and then creates per-student copies (no class row) for every line.
- `export async function updateStudentTask(db: TenantDb, id: string, patch: Partial<Pick<PracticeTaskInput, 'title' | 'materialId' | 'url' | 'proofType'>>): Promise<void>`

- [ ] **Step 1: Write the failing tests** — append inside the `describe('practice — tasks fan out to the roster', …)` block of `test-worker/practice.test.js`:

```js
  it('quick add with a studentId makes copies for that student only, and update-copy edits one open copy', async () => {
    const d = db();
    const { a, b, cls } = await fixture(d);
    const made = await practiceSvc.quickAdd(
      d,
      {
        classId: cls.id,
        date: '2031-03-03',
        lines: 'Only A line 1\nOnly A line 2',
        materialId: null,
        proofType: 'none',
        studentId: a.id,
      },
      await someStaffId(d),
    );
    expect(made).toHaveLength(2);
    const classTasks = await practiceSvc.listTasks(d, cls.id, '2031-03-03', '2031-03-03');
    expect(classTasks).toHaveLength(0); // no class-level row
    const forA = await practiceSvc.listStudentTasksFor(d, a.id, '2031-03-03', '2031-03-03');
    const forB = await practiceSvc.listStudentTasksFor(d, b.id, '2031-03-03', '2031-03-03');
    expect(forA.map((t) => t.title)).toEqual(['Only A line 1', 'Only A line 2']);
    expect(forB).toHaveLength(0);
    expect(forA[0].taskId).toBeNull();

    await practiceSvc.updateStudentTask(d, forA[0].id, { title: 'Only A renamed', proofType: 'photo' });
    const after = await practiceSvc.getStudentTask(d, forA[0].id);
    expect(after.title).toBe('Only A renamed');
    expect(after.proofType).toBe('photo');
  });

  it('update-copy leaves a submitted copy alone', async () => {
    const d = db();
    const { a, cls } = await fixture(d);
    const [made] = await practiceSvc.quickAdd(
      d,
      { classId: cls.id, date: '2031-03-03', lines: 'Submitted one', materialId: null, proofType: 'none', studentId: a.id },
      await someStaffId(d),
    );
    await practiceSvc.review(
      d,
      { studentTaskId: made.id, decision: 'teacher_done', feedback: null, rejectReason: null },
      await someStaffId(d),
    );
    await practiceSvc.updateStudentTask(d, made.id, { title: 'Should not apply' });
    expect((await practiceSvc.getStudentTask(d, made.id)).title).toBe('Submitted one');
  });
```

- [ ] **Step 2: Run the file to verify the new cases fail** (granted, §0.2)

Run: `cd f:/code/calendar && npx vitest run --config vitest.workers.config.js test-worker/practice.test.js`
Expected: the two new cases FAIL (`updateStudentTask is not a function`; `studentId` ignored so `classTasks` has length 1). Re-run after Step 5 — expected PASS.

- [ ] **Step 3: Schema** — in `shared/schemas.ts`, `PracticeQuickAddInput` becomes:

```ts
/** Multi-line quick add: one task per non-empty line, all sharing material + proof type.
 *  With `studentId` every line becomes that student's own copy (no class-level row) — the sheet's
 *  "only <name>" blank row; without it, class tasks fan out to the roster as before. */
export const PracticeQuickAddInput = z.object({
  classId: z.string().min(1),
  date: PracticeDate,
  lines: z.string().min(1).max(10_000),
  materialId: z.string().nullish(),
  proofType: PracticeProofType.default('either'),
  studentId: z.string().nullish(),
});
```

- [ ] **Step 4: Service** — in `server/services/practice.ts`:

Change `quickAdd`'s signature and body so the return type is `Promise<(PracticeTaskRow | StudentTaskRow)[]>` and the inner `createTask` call passes `studentId: input.studentId ?? null` instead of `studentId: null`; drop the `as PracticeTaskRow` cast:

```ts
export async function quickAdd(
  db: TenantDb,
  input: PracticeQuickAddInput,
  staffId: string | null,
): Promise<(PracticeTaskRow | StudentTaskRow)[]> {
  const out: (PracticeTaskRow | StudentTaskRow)[] = [];
  for (const title of parseQuickAddLines(input.lines)) {
    out.push(
      await createTask(
        db,
        {
          classId: input.classId,
          date: input.date,
          title,
          materialId: input.materialId,
          url: null,
          proofType: input.proofType,
          studentId: input.studentId ?? null,
        },
        staffId,
      ),
    );
  }
  return out;
}
```

Then add, directly after `updateTask`:

```ts
/**
 * Edit a per-student task — a copy with no class task behind it (`taskId` null), created from the
 * sheet's "only <name>" blank row. Only an `open` copy changes: once the student has submitted,
 * the title they worked against is part of the record, exactly as updateTask leaves submitted
 * copies alone.
 */
export async function updateStudentTask(
  db: TenantDb,
  id: string,
  patch: Partial<Pick<PracticeTaskInput, 'title' | 'materialId' | 'url' | 'proofType'>>,
): Promise<void> {
  const set: Partial<typeof practiceStudentTasks.$inferInsert> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.materialId !== undefined) set.materialId = patch.materialId ?? null;
  if (patch.url !== undefined) set.url = patch.url ?? null;
  if (patch.proofType !== undefined) set.proofType = patch.proofType;
  if (!Object.keys(set).length) return;
  await db.update(
    practiceStudentTasks,
    set,
    eq(practiceStudentTasks.id, id),
    eq(practiceStudentTasks.status, 'open'),
  );
  record({ action: 'update', entityType: 'practice_task', entityId: id, after: { ...set, kind: 'copy' } });
}
```

Check nothing else consumed `quickAdd`'s old return type: `grep -rn "quickAdd(" app server --include=*.ts --include=*.tsx`. The only caller is `practice-actions.tsx` (`{ ok: true, tasks: await practiceSvc.quickAdd(...) }`), which is fine with the union.

- [ ] **Step 5: Action** — in `app/routes/practice-actions.tsx`, after the `case 'update-task': { … }` block add:

```ts
    case 'update-copy': {
      // A per-student task (copy with no class row) edited in place on the sheet. Same patch shape
      // as update-task; the service only touches an `open` copy.
      const id = String(fd.get('id') ?? '');
      if (!id) return bad('missing_id');
      const p = parsePatch(
        PracticeTaskInput.pick({ title: true, materialId: true, url: true, proofType: true }),
        nullBlanks(body, ['materialId', 'url']),
      );
      if (!p.success) return bad('validation_failed', 422);
      await practiceSvc.updateStudentTask(db, id, p.data);
      return { ok: true };
    }
```

Also in `case 'quick-add'` change `nullBlanks(body, ['materialId'])` to `nullBlanks(body, ['materialId', 'studentId'])` so an empty `studentId` field posts as null.

- [ ] **Step 6: Static checks**

Run: `cd f:/code/calendar && npm run lint`
Expected: clean. (`typecheck` still fails on the route files removed keys — Task 6.)

- [ ] **Step 7: Commit**

```bash
cd f:/code/calendar && npx prettier --write shared/schemas.ts server/services/practice.ts app/routes/practice-actions.tsx test-worker/practice.test.js
git add shared/schemas.ts server/services/practice.ts app/routes/practice-actions.tsx test-worker/practice.test.js
git commit -m "feat(practice): update-copy intent and per-student quick add"
```

---

### Task 4: i18n keys

**Files:**
- Modify: `shared/i18n/strings.ts` — the `pr_*` region of the `en` block (~line 2138) and of the `vi` block (~line 4302)

**Interfaces:**
- Produces the keys used verbatim by Tasks 5, 7, 9, 10. English values are e2e/walkthrough selectors.

- [ ] **Step 1: Add these keys to the `en` block**, right after `pr_week_next`:

```ts
  pr_open_sheet: 'Open sheet',
  pr_sheet_sub: 'Practice · {month} · practice days {days}',
  pr_month_prev: 'Previous month',
  pr_month_next: 'Next month',
  pr_filter_all: 'All',
  pr_filter_review: 'Needs review',
  pr_today: 'Today',
  pr_day_menu: 'Day menu',
  pr_day_meta: '{n} tasks · {done} done',
  pr_miss_excused: 'Missed — excused',
  pr_miss_unexcused: 'Missed — unexcused',
  pr_penalty_owed: '×{n} owed',
  pr_excuse_request: 'Excuse request',
  pr_col_status: 'Status & proof',
  pr_blank_ph: 'Add a task… Enter saves, paste several lines for several tasks',
  pr_scope_everyone: 'Everyone',
  pr_scope_only: 'Only {name}',
  pr_delete_everyone: 'Delete for everyone',
  pr_open_proof: 'Open proof',
  pr_saved: 'Saved',
  pr_no_warning: 'No warning',
  pr_empty_review: 'Nothing to review for {name}',
  pr_empty_misses: 'No misses for {name} this month',
  pr_no_students: 'No students enrolled in this class yet',
```

- [ ] **Step 2: Add the Vietnamese twins to the `vi` block**, right after `pr_this_week`:

```ts
    pr_open_sheet: 'Mở bảng',
    pr_sheet_sub: 'Nhiệm vụ · {month} · ngày làm {days}',
    pr_month_prev: 'Tháng trước',
    pr_month_next: 'Tháng sau',
    pr_filter_all: 'Tất cả',
    pr_filter_review: 'Cần duyệt',
    pr_today: 'Hôm nay',
    pr_day_menu: 'Menu ngày',
    pr_day_meta: '{n} nhiệm vụ · {done} đã làm',
    pr_miss_excused: 'Thiếu bài — có phép',
    pr_miss_unexcused: 'Thiếu bài — không phép',
    pr_penalty_owed: 'Nợ ×{n}',
    pr_excuse_request: 'Đơn xin phép',
    pr_col_status: 'Trạng thái & minh chứng',
    pr_blank_ph: 'Thêm nhiệm vụ… Enter để lưu, dán nhiều dòng để thêm nhiều',
    pr_scope_everyone: 'Cả lớp',
    pr_scope_only: 'Chỉ {name}',
    pr_delete_everyone: 'Xoá cho cả lớp',
    pr_open_proof: 'Xem minh chứng',
    pr_saved: 'Đã lưu',
    pr_no_warning: 'Không có cảnh báo',
    pr_empty_review: 'Không có gì cần duyệt cho {name}',
    pr_empty_misses: '{name} không thiếu bài tháng này',
    pr_no_students: 'Lớp chưa có học sinh',
```

- [ ] **Step 3: Leave the orphan removal for Task 8** (the keys `pr_open_week`, `pr_open_ledger`, `pr_review_queue`, `pr_add_tasks`, `pr_add_task_for`, `pr_lines`, `pr_lines_ph`, `pr_students_on_day`, `pr_edit_task`, `pr_save_feedback`, `pr_queue_empty`, `pr_excuses_pending`, `pr_ledger`, `pr_week_prev`, `pr_week_next`, `pr_this_week` still have callers until the old screens are deleted).

- [ ] **Step 4: Check**

Run: `cd f:/code/calendar && npm run check:i18n`
Expected: exit 0 (a key present in `en` and `vi` and not yet referenced is fine — the script only reports referenced-but-undefined and en-without-vi).

- [ ] **Step 5: Commit**

```bash
cd f:/code/calendar && npx prettier --write shared/i18n/strings.ts
git add shared/i18n/strings.ts
git commit -m "feat(practice): sheet strings (en/vi)"
```

---

### Task 5: Shared weekday dialog + home card

**Files:**
- Create: `src/practice/weekdays-dialog.tsx`
- Modify: `src/practice/common.tsx` (append `weekdayLabels`, `NO_MATERIAL`, `materialOptions`)
- Modify: `src/practice/practice-home.tsx`

**Interfaces:**
- Produces:
  ```ts
  // weekdays-dialog.tsx
  export function WeekdaysDialog(props: {
    open: boolean;
    title: string;
    subtitle?: string;
    /** Current mask, or null on a first enable (then an untouched dialog saves null = "derive"). */
    initial: string | null;
    onClose: () => void;
    onSave: (weekdays: string | null) => void;
  }): React.ReactElement;
  // common.tsx
  export const NO_MATERIAL = '__none__';
  export function materialOptions(materials: { id: string; title: string }[], t: (k: string) => string): { value: string; label: string }[];
  export const weekdayLabels: (mask: string, lang: string) => string;   // moved from practice-home.tsx
  ```
- Consumes: `parseWeekdays`, `formatWeekdays` from `shared/logic/practice`; `getCal` from `shared/i18n/strings`; `Modal` from `src/ui`.

- [ ] **Step 1: `src/practice/weekdays-dialog.tsx`**

```tsx
import React from 'react';
import { DS } from '../ds/index.js';
import { Modal } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { getCal } from '../../shared/i18n/strings.js';
import { formatWeekdays, parseWeekdays } from '../../shared/logic/practice.js';

const { Button, Checkbox } = DS;

/**
 * The weekday-mask dialog, shared by the class card (first enable) and the sheet header (edit).
 *
 * On a FIRST enable it opens with nothing ticked and, if the teacher never touches a box, saves
 * `null` — the signal the server uses to derive Mon–Sat minus this class's own lesson days
 * (decision #5). Ticking anything opts into an explicit mask. When editing an existing mask the
 * boxes start from it and the save is always explicit.
 */
export function WeekdaysDialog({
  open,
  title,
  subtitle,
  initial,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  initial: string | null;
  onClose: () => void;
  onSave: (weekdays: string | null) => void;
}) {
  const { t, lang } = useLang();
  const cal = getCal(lang);
  const [picked, setPicked] = React.useState<Set<number>>(new Set());
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setPicked(initial ? parseWeekdays(initial) : new Set());
    setTouched(false);
  }, [open, initial]);

  const toggle = (wd: number) => {
    const next = new Set(picked);
    if (next.has(wd)) next.delete(wd);
    else next.add(wd);
    setPicked(next);
    setTouched(true);
  };

  const save = () => {
    onClose(); // optimistic close, house pattern
    onSave(initial === null && !touched ? null : formatWeekdays(picked));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      width={460}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={save}>{t('save')}</Button>
        </>
      }
    >
      <div className="mochi-field">
        <label className="mochi-field__label">{t('pr_weekdays')}</label>
        <div className="pr-home__days">
          {[1, 2, 3, 4, 5, 6, 0].map((wd) => (
            <Checkbox
              key={wd}
              label={cal.dow[wd]}
              checked={picked.has(wd)}
              onChange={() => toggle(wd)}
            />
          ))}
        </div>
        <span className="mochi-field__hint">{t('pr_weekdays_help')}</span>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Append to `src/practice/common.tsx`** (and add `import { getCal } from '../../shared/i18n/strings.js'; import { parseWeekdays } from '../../shared/logic/practice.js';` at the top):

```tsx
/** Sentinel for "no material" in the material selects — a `<select>` cannot hold null. */
export const NO_MATERIAL = '__none__';

export function materialOptions(
  materials: { id: string; title: string }[],
  t: (k: string) => string,
): { value: string; label: string }[] {
  return [
    { value: NO_MATERIAL, label: t('pr_material_none') },
    ...materials.map((m) => ({ value: m.id, label: m.title })),
  ];
}

/** '1,3,5' → 'Mon, Wed, Fri' in the UI language, Monday first. */
export const weekdayLabels = (mask: string, lang: string) => {
  const cal = getCal(lang);
  return [...parseWeekdays(mask)]
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((wd) => cal.dow[wd])
    .join(', ');
};
```

- [ ] **Step 3: Rewrite `src/practice/practice-home.tsx`** as:

```tsx
import React from 'react';
import { Link, useLoaderData } from 'react-router';
import { DS } from '../ds/index.js';
import { PageHeader, useConfirm } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import type { PracticeSettingsRow } from '../../server/services/practice.js';
import type { ClassLite } from '../../server/services/classes.js';
import { usePracticeSubmit } from './common.jsx';
import { WeekdaysDialog } from './weekdays-dialog.jsx';

const { Card, Button, Tag } = DS;

interface HomeLoaderData {
  classes: ClassLite[];
  settings: PracticeSettingsRow[];
  today: string;
}

/**
 * Practice landing: one card per class, its opt-in switch, and ONE way in — the sheet for the
 * current month. Week planner, review queue and ledger all live inside the sheet now.
 */
export function PracticeHomeScreen() {
  const { classes, settings, today } = useLoaderData() as HomeLoaderData;
  const { t } = useLang();
  const submit = usePracticeSubmit();
  const [confirm, confirmNode] = useConfirm();
  const [enabling, setEnabling] = React.useState<ClassLite | null>(null);

  const byClass = new Map(settings.map((s) => [s.classId, s]));
  const month = today.slice(0, 7);

  const enable = (cls: ClassLite, weekdays: string | null) => {
    const fields: Record<string, string> = { intent: 'settings', classId: cls.id, enabled: 'true' };
    if (weekdays) fields.weekdays = weekdays;
    submit(fields);
  };

  const disable = async (cls: ClassLite, current: PracticeSettingsRow) => {
    const ok = await confirm({
      title: t('pr_disable'),
      message: t('pr_disable_confirm'),
      confirmLabel: t('pr_disable'),
      danger: true,
    });
    if (!ok) return;
    submit({ intent: 'settings', classId: cls.id, enabled: 'false', weekdays: current.weekdays });
  };

  return (
    <div className="content pr-home">
      <PageHeader title={t('pr_title')} subtitle={t('pr_sub')} />

      <div className="pr-home__list">
        {classes.map((cls) => {
          const s = byClass.get(cls.id);
          const on = !!s?.enabled;
          return (
            <Card key={cls.id} className="pr-home__card">
              <div className="pr-home__name">
                <Tag color={(cls.color as 'violet') ?? 'neutral'}>{cls.name}</Tag>
                {on && <Tag color="green">{t('pr_enabled_badge')}</Tag>}
              </div>
              <div className="pr-home__actions">
                {on ? (
                  <>
                    <Link to={`/practice/${cls.id}/${month}`}>
                      <Button>{t('pr_open_sheet')}</Button>
                    </Link>
                    <Button variant="ghost" onClick={() => void disable(cls, s!)}>
                      {t('pr_disable')}
                    </Button>
                  </>
                ) : (
                  <Button variant="secondary" onClick={() => setEnabling(cls)}>
                    {t('pr_enable')}
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <WeekdaysDialog
        open={!!enabling}
        title={t('pr_enable')}
        subtitle={enabling?.name}
        initial={null}
        onClose={() => setEnabling(null)}
        onSave={(weekdays) => enabling && enable(enabling, weekdays)}
      />

      {confirmNode}
    </div>
  );
}
```

Note the old `weekdayLabels` export at the bottom of this file is gone — it now lives in `common.tsx` (Step 2). `grep -rn "weekdayLabels" src app` must show only `common.tsx` and (after Task 7) `practice-sheet.tsx`.

- [ ] **Step 4: Lint**

Run: `cd f:/code/calendar && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
cd f:/code/calendar && npx prettier --write src/practice/weekdays-dialog.tsx src/practice/common.tsx src/practice/practice-home.tsx
git add src/practice/weekdays-dialog.tsx src/practice/common.tsx src/practice/practice-home.tsx
git commit -m "feat(practice): class card opens the sheet; shared weekday dialog"
```

---

### Task 6: The sheet route, and the old URLs as redirects

**Files:**
- Create: `app/routes/practice.$classId.$month.tsx`
- Rewrite: `app/routes/practice.review.tsx`, `app/routes/practice.$classId.week.$monday.tsx`, `app/routes/practice.$classId.ledger.$month.tsx`
- Modify: `app/routes.ts` (the practice block inside `layout('routes/_app.tsx', …)`)
- Modify: `src/lib/page-title.ts` (remove `'/practice/review': 'pr_review_queue',`)

**Interfaces:**
- Consumes: `practiceMonthKey` (Task 2), `lastDayOfMonth` (Task 1), services listed below.
- Produces: `export interface SheetLoaderData` — imported by Task 7's screen (the route file imports the screen component; the screen imports the TYPE from the route file — a type-only import, so no runtime cycle):

```ts
export interface SheetLoaderData {
  classId: string;
  month: string;
  today: string;
  cls: ClassRow;
  settings: PracticeSettingsRow | null;
  practiceDays: string[];
  copies: StudentTaskRow[];
  roster: { classId: string; id: string; name: string }[];
  materials: MaterialRow[];
  /** Pending requests for this class and month, every student. */
  excuses: ExcuseRow[];
  /** One per enrolled student: month summary, misses, Zalo pairing. */
  ledger: LedgerRow[];
}
```

- [ ] **Step 1: Create `app/routes/practice.$classId.$month.tsx`**

```tsx
import type { ClientLoaderFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { PracticeSheetScreen } from '../../src/practice/practice-sheet.js';
import { tenantDbFor } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as classesSvc from '../../server/services/classes';
import * as materialsSvc from '../../server/services/materials';
import * as practiceSvc from '../../server/services/practice';
import * as zalo from '../../server/services/zalo';
import type { ClassRow } from '../../server/services/classes';
import type { MaterialRow } from '../../server/services/materials';
import type {
  ExcuseRow,
  LedgerRow,
  PracticeSettingsRow,
  StudentTaskRow,
} from '../../server/services/practice';
import { TuitionMonth } from '../../shared/schemas';
import { lastDayOfMonth } from '../../shared/logic/practice-sheet';
import { ictDateOf } from '../../shared/logic/tests';
import { practiceMonthKey, swrLoad } from '../../src/lib/route-cache.js';

export interface SheetLoaderData {
  classId: string;
  month: string;
  today: string;
  cls: ClassRow;
  settings: PracticeSettingsRow | null;
  practiceDays: string[];
  copies: StudentTaskRow[];
  roster: { classId: string; id: string; name: string }[];
  materials: MaterialRow[];
  /** Pending requests for this class and month, every student. */
  excuses: ExcuseRow[];
  /** One per enrolled student: month summary, misses, Zalo pairing. */
  ledger: LedgerRow[];
}

/**
 * The Practice sheet: one class, one month, every student's copies — the week planner, the review
 * queue and the ledger folded into a single screen (spec: docs/superpowers/specs/2026-09-04-…).
 *
 * The month is in the PATH because cacheKeyForPath only sees pathnames. The student tab is a query
 * parameter on purpose: every tab renders from THIS payload, so one cache entry per class-month is
 * right. `TuitionMonth` is reused for the YYYY-MM shape; it is a plain regex with no fee meaning.
 *
 * `hasZalo` is resolved here (one lookup per student — a class is 1–3 people) because "no pairing"
 * is the difference between a miss the family heard about and one they did not (decision #25).
 */
export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const staff = await requireStaff(request, env);
  const db = tenantDbFor(env, staff);

  const classId = params.classId!;
  const parsed = TuitionMonth.safeParse(params.month ?? '');
  if (!parsed.success) throw Response.json({ error: 'bad_month' }, { status: 400 });
  const month = parsed.data;
  const from = `${month}-01`;
  const to = lastDayOfMonth(month);

  const cls = await classesSvc.get(db, classId);
  if (!cls) throw new Response(null, { status: 404 });

  const [settings, practiceDays, copies, roster, materials, excuses, base] = await Promise.all([
    practiceSvc.getSettings(db, classId),
    practiceSvc.practiceDays(db, classId, from, to),
    practiceSvc.listStudentTasks(db, classId, from, to),
    classesSvc.listRosterNames(db).then((r) => r.filter((x) => x.classId === classId)),
    materialsSvc.list(db),
    practiceSvc.listExcuses(db, { classId, status: 'pending', from, to }),
    practiceSvc.classLedger(db, classId, month),
  ]);
  const ledger: LedgerRow[] = await Promise.all(
    base.map(async (r) => ({
      ...r,
      hasZalo: (await zalo.chatsForParentsOfStudents(db, [r.studentId])).length > 0,
    })),
  );

  const data: SheetLoaderData = {
    classId,
    month,
    today: ictDateOf(new Date().toISOString()),
    cls,
    settings,
    practiceDays,
    copies,
    roster,
    materials,
    excuses,
    ledger,
  };
  return data;
}

export async function clientLoader({ params, serverLoader }: ClientLoaderFunctionArgs) {
  return swrLoad(
    practiceMonthKey(params.classId!, params.month!),
    () => serverLoader() as Promise<SheetLoaderData>,
  );
}
clientLoader.hydrate = true as const;

export default PracticeSheetScreen;
```

- [ ] **Step 2: Rewrite the three old route files as redirects**

`app/routes/practice.review.tsx`:

```tsx
import { redirect } from 'react-router';

// Legacy URL. Reviewing moved INTO the class sheet (filter "Needs review"); a teacher landing here
// from a bookmark picks the class on the landing page. 301: the move is permanent.
export function loader() {
  throw redirect('/practice', 301);
}
```

`app/routes/practice.$classId.week.$monday.tsx`:

```tsx
import type { LoaderFunctionArgs } from 'react-router';
import { redirect } from 'react-router';

// Legacy URL. The week planner became the month sheet; a Monday maps to its month. 301: permanent.
export function loader({ params }: LoaderFunctionArgs) {
  const month = (params.monday ?? '').slice(0, 7);
  throw redirect(/^\d{4}-\d{2}$/.test(month) ? `/practice/${params.classId}/${month}` : '/practice', 301);
}
```

`app/routes/practice.$classId.ledger.$month.tsx`:

```tsx
import type { LoaderFunctionArgs } from 'react-router';
import { redirect } from 'react-router';

// Legacy URL. The ledger is the sheet's standing strip now; same class, same month. 301: permanent.
export function loader({ params }: LoaderFunctionArgs) {
  throw redirect(`/practice/${params.classId}/${params.month}`, 301);
}
```

- [ ] **Step 3: `app/routes.ts`** — replace the four practice lines inside the `_app` layout with:

```ts
    // Practice (Nhiệm vụ). The sheet is `/practice/:classId/:month` (month in the PATH for the
    // cache key; the student tab is `?student=`). The three older URLs stay as 301s for bookmarks —
    // static `review` first, and the 4-segment week/ledger shapes cannot collide with the sheet's 3.
    route('practice', 'routes/practice.tsx'),
    route('practice/review', 'routes/practice.review.tsx'),
    route('practice/:classId/week/:monday', 'routes/practice.$classId.week.$monday.tsx'),
    route('practice/:classId/ledger/:month', 'routes/practice.$classId.ledger.$month.tsx'),
    route('practice/:classId/:month', 'routes/practice.$classId.$month.tsx'),
```

- [ ] **Step 4: `src/lib/page-title.ts`** — delete the line `'/practice/review': 'pr_review_queue',` from `EXTRA`. (The sheet inherits the nav row's title, "Practice", through `PATH_KEYS` prefix matching — same as every other sub-page.)

- [ ] **Step 5: Stub the screen so typecheck can run** — create `src/practice/practice-sheet.tsx` with just:

```tsx
import React from 'react';
export function PracticeSheetScreen() {
  return <div className="content pr-sheet" />;
}
```

(Task 7 replaces it.)

- [ ] **Step 6: Typecheck**

Run: `cd f:/code/calendar && npm run typecheck`
Expected: PASS (this also regenerates `.react-router/types` for the new route). If it complains about `practiceWeekKey`/`practiceLedgerKey`/`PRACTICE_REVIEW_KEY`, some importer was missed: `grep -rn "practiceWeekKey\|practiceLedgerKey\|PRACTICE_REVIEW_KEY" src app test` and fix it.

- [ ] **Step 7: Commit**

```bash
cd f:/code/calendar && npx prettier --write "app/routes/practice.\$classId.\$month.tsx" app/routes/practice.review.tsx "app/routes/practice.\$classId.week.\$monday.tsx" "app/routes/practice.\$classId.ledger.\$month.tsx" app/routes.ts src/lib/page-title.ts src/practice/practice-sheet.tsx
git add "app/routes/practice.\$classId.\$month.tsx" app/routes/practice.review.tsx "app/routes/practice.\$classId.week.\$monday.tsx" "app/routes/practice.\$classId.ledger.\$month.tsx" app/routes.ts src/lib/page-title.ts src/practice/practice-sheet.tsx
git commit -m "feat(practice): sheet route; old week/ledger/review URLs redirect"
```

---

### Task 7: The screen

**Files:**
- Create: `src/practice/standing-strip.tsx`, `src/practice/sheet-day.tsx`, `src/practice/sheet-row.tsx`
- Rewrite: `src/practice/practice-sheet.tsx` (the Task 6 stub)
- Modify: `src/styles/app.css` — replace everything from `.pr-week__grid {` through the end of the `@media (max-width: 640px) { .pr-week__grid … }` block (the `.pr-home__*` rules above it stay)

**Interfaces:**
- Consumes: `SheetLoaderData` (Task 6), `buildSheet`/`needsReviewCount`/`SheetDay`/`SheetRow`/`SheetFilter` (Task 1), `NO_MATERIAL`/`materialOptions`/`weekdayLabels`/`proofOptions`/`StatusTag`/`dm`/`usePracticeSubmit`/`PracticeSubmit` (common.tsx), `WeekdaysDialog` (Task 5), `monthLabel`/`shiftMonth` from `shared/logic/month`, `DONE_STATUSES`/`weekdayOf` from `shared/logic/practice`, `getCal` from `shared/i18n/strings`.
- Every `data-testid` / accessible name below is an e2e handle (Task 9) — do not rename:
  `pr-day` (+ `data-date`, `data-today`), `pr-row` (+ `data-title`, `data-copy`), `pr-blank`, `pr-standing` (+ `data-student`); buttons **Day menu**, **Mark done**, **Accept**, **Reject**, **Approve**, **Mark excused**, **Delete task**, **Clear warning**; menu items **Day off**, **Make practice day**, **Use weekly default**; tabs by student name; input `aria-label="Task"`, textarea `aria-label="Feedback"`.

- [ ] **Step 1: `src/practice/standing-strip.tsx`**

```tsx
import React from 'react';
import { DS } from '../ds/index.js';
import { useLang } from '../lib/i18n.jsx';
import type { LedgerRow } from '../../server/services/practice.js';
import { dm, type PracticeSubmit } from './common.jsx';

const { Card, Button, Tag } = DS;

/**
 * The month's standing per student — the old ledger table turned sideways so it can sit above the
 * sheet. "No Zalo pairing" is shown rather than hidden because an unpaired family is the one case
 * where the whole miss economy is invisible to the people it is meant to inform (decision #25).
 */
export function StandingStrip({
  rows,
  classId,
  submit,
  confirm,
}: {
  rows: LedgerRow[];
  classId: string;
  submit: PracticeSubmit;
  confirm: (o: { title: string; message: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
}) {
  const { t } = useLang();

  const clear = async (studentId: string) => {
    const ok = await confirm({
      title: t('pr_clear_warning'),
      message: t('pr_clear_warning_confirm'),
      confirmLabel: t('pr_clear_warning'),
      danger: true,
    });
    if (!ok) return;
    submit({ intent: 'clear-warning', classId, studentId });
  };

  return (
    <div className="pr-sheet__standing">
      {rows.map((r) => (
        <Card
          key={r.studentId}
          flat
          className="pr-sheet__stand"
          data-testid="pr-standing"
          data-student={r.studentId}
        >
          <div className="pr-sheet__stand-head">
            <strong>{r.studentName}</strong>
            {!r.hasZalo && <Tag>{t('pr_no_zalo')}</Tag>}
          </div>
          <div className="pr-sheet__stand-nums">
            <span>
              {t('pr_done_total')} <b>{`${r.summary.doneTasks} / ${r.summary.totalTasks}`}</b>
            </span>
            <span>
              {t('pr_excused')} <b>{`${r.summary.excusedUsed} / ${r.summary.excusedQuota}`}</b>
            </span>
            <span>
              {t('pr_unexcused')} <b>{r.summary.unexcused}</b>
            </span>
          </div>
          <div className="pr-sheet__stand-flags">
            {r.summary.pendingMultiplier > 0 && r.summary.pendingForDate && (
              <Tag color="orange">
                {t('pr_penalty_badge', {
                  n: r.summary.pendingMultiplier,
                  date: dm(r.summary.pendingForDate),
                })}
              </Tag>
            )}
            {r.summary.level > 0 ? (
              <>
                <Tag color="violet">{t('pr_warning_level', { n: r.summary.level })}</Tag>
                <Button size="sm" variant="ghost" onClick={() => void clear(r.studentId)}>
                  {t('pr_clear_warning')}
                </Button>
              </>
            ) : (
              <span className="pr-sheet__muted">{t('pr_no_warning')}</span>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: `src/practice/sheet-day.tsx`**

```tsx
import React from 'react';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { useLang } from '../lib/i18n.jsx';
import { getCal } from '../../shared/i18n/strings.js';
import { DONE_STATUSES, weekdayOf } from '../../shared/logic/practice.js';
import type { SheetDay } from '../../shared/logic/practice-sheet.js';
import type { ExcuseRow, MissRow, StudentTaskRow } from '../../server/services/practice.js';
import { dm, type PracticeSubmit } from './common.jsx';

const { Button, IconButton, Tag } = DS;

export type Day = SheetDay<StudentTaskRow, MissRow, ExcuseRow>;

/**
 * One date group's header row: the sheet's annotated date cell. Everything a teacher used to reach
 * through the week column's menu, the review page's excuse block and the ledger's miss list sits on
 * this one line — day-off menu, the miss with Mark excused, the ×N owed, the pending excuse request.
 *
 * `data-testid`/`aria-label` strings are e2e handles (e2e/crud-practice.spec.ts).
 */
export function DayHeader({
  day,
  classId,
  penalty,
  menuOpen,
  onToggleMenu,
  submit,
}: {
  day: Day;
  classId: string;
  /** The student's pending ×N when it falls on this date, else 0. */
  penalty: number;
  menuOpen: boolean;
  onToggleMenu: () => void;
  submit: PracticeSubmit;
}) {
  const { t, lang } = useLang();
  const cal = getCal(lang);
  const done = day.rows.filter((r) => DONE_STATUSES.has(r.copy.status)).length;

  const override = (value: 'true' | 'false' | 'null') => {
    onToggleMenu();
    submit({ intent: 'day-override', classId, date: day.date, isPractice: value });
  };

  return (
    <div
      className={`pr-sheet__dayhead${day.isToday ? ' is-today' : ''}${day.isPractice ? '' : ' is-off'}`}
      data-testid="pr-day"
      data-date={day.date}
      data-today={day.isToday ? 'true' : 'false'}
    >
      <span className="pr-sheet__date">{`${cal.dow[weekdayOf(day.date)]} ${dm(day.date)}`}</span>
      {day.isToday && <Tag color="orange">{t('pr_today')}</Tag>}
      {!day.isPractice && <Tag>{t('pr_day_off')}</Tag>}
      {day.rows.length > 0 && (
        <span className="pr-sheet__meta">{t('pr_day_meta', { n: day.rows.length, done })}</span>
      )}
      {day.miss && (
        <span className="pr-sheet__miss">
          <Tag color={day.miss.excused ? 'green' : 'orange'}>
            {t(day.miss.excused ? 'pr_miss_excused' : 'pr_miss_unexcused')}
          </Tag>
          {!day.miss.excused && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => submit({ intent: 'excuse-miss', missId: day.miss!.id })}
            >
              {t('pr_excuse_miss')}
            </Button>
          )}
        </span>
      )}
      {penalty > 0 && <Tag color="orange">{t('pr_penalty_owed', { n: penalty })}</Tag>}
      {day.excuse && (
        <span className="pr-sheet__excuse">
          <span>{t('pr_excuse_request')}</span>
          <em>{`“${day.excuse.reason}”`}</em>
          <Button
            size="sm"
            onClick={() =>
              submit({ intent: 'excuse-decide', excuseId: day.excuse!.id, decision: 'approve' })
            }
          >
            {t('pr_approve')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              submit({ intent: 'excuse-decide', excuseId: day.excuse!.id, decision: 'reject' })
            }
          >
            {t('pr_reject')}
          </Button>
        </span>
      )}
      <span className="pr-sheet__spacer" />
      <span className="pr-sheet__menu">
        <IconButton
          label={t('pr_day_menu')}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={onToggleMenu}
        >
          <MIcon name="more" size={16} />
        </IconButton>
        {menuOpen && (
          <div className="pr-sheet__menu-pop" role="menu">
            <button type="button" role="menuitem" className="pr-sheet__menu-item" onClick={() => override('false')}>
              {t('pr_day_off')}
            </button>
            <button type="button" role="menuitem" className="pr-sheet__menu-item" onClick={() => override('true')}>
              {t('pr_make_practice_day')}
            </button>
            <button type="button" role="menuitem" className="pr-sheet__menu-item" onClick={() => override('null')}>
              {t('pr_remove_override')}
            </button>
          </div>
        )}
      </span>
    </div>
  );
}
```

- [ ] **Step 3: `src/practice/sheet-row.tsx`**

```tsx
import React from 'react';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { Modal, MSelect } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { parseQuickAddLines } from '../../shared/logic/practice.js';
import type { SheetRow } from '../../shared/logic/practice-sheet.js';
import type { StudentTaskRow } from '../../server/services/practice.js';
import type { MaterialRow } from '../../server/services/materials.js';
import {
  materialOptions,
  NO_MATERIAL,
  proofOptions,
  StatusTag,
  type PracticeSubmit,
} from './common.jsx';

const { Button, IconButton, Tag } = DS;

/**
 * The sheet's rows. A TaskRow is one student copy with every column edited in place — the whole
 * point of the redesign is that assign / check / comment happen on one line, as they did in the
 * teacher's spreadsheet. A BlankRow is the "next empty line" of that spreadsheet.
 *
 * Rules made visible here rather than in a dialog:
 * - title / material / link / proof are editable only while the copy is `open` (the server only
 *   propagates to open copies, and a submitted title is part of the record);
 * - a `class` row posts update-task / delete-task (touches every student's open copy), a
 *   `student` row posts update-copy / remove-copy (this student only);
 * - feedback saves on blur, any status.
 *
 * `data-testid` / `aria-label` strings are e2e handles (e2e/crud-practice.spec.ts).
 */

type Confirm = (o: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}) => Promise<boolean>;

/** A text cell that looks like text until hovered; commits on blur/Enter, reverts on Escape. */
function CellInput({
  value,
  onCommit,
  disabled,
  placeholder,
  ariaLabel,
  type = 'text',
  className = '',
  allowEmpty = false,
}: {
  value: string;
  onCommit: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel: string;
  type?: 'text' | 'url';
  className?: string;
  allowEmpty?: boolean;
}) {
  const [draft, setDraft] = React.useState(value);
  const cancel = React.useRef(false);
  React.useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (cancel.current) {
      cancel.current = false;
      return;
    }
    const v = draft.trim();
    if (v === value || (!v && !allowEmpty)) {
      setDraft(value);
      return;
    }
    onCommit(v);
  };

  return (
    <input
      className={`mochi-input pr-sheet__cell ${className}`}
      type={type}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          cancel.current = true;
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** Feedback textarea: saves on blur when changed and flashes "Saved" for a moment. */
function FeedbackCell({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const { t } = useLang();
  const [draft, setDraft] = React.useState(value);
  const [saved, setSaved] = React.useState(false);
  React.useEffect(() => setDraft(value), [value]);
  React.useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), 1500);
    return () => clearTimeout(id);
  }, [saved]);

  const commit = () => {
    if (draft.trim() === (value ?? '').trim()) return;
    onCommit(draft.trim());
    setSaved(true);
  };

  return (
    <div>
      <textarea
        className="mochi-input pr-sheet__cell pr-sheet__feedback"
        rows={1}
        value={draft}
        aria-label={t('pr_feedback')}
        placeholder={t('pr_feedback')}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
      />
      {saved && <div className="pr-sheet__saved">{t('pr_saved')}</div>}
    </div>
  );
}

/** Proof thumbnail; click opens the full photo/video in a Modal. */
function ProofThumb({ copy }: { copy: StudentTaskRow }) {
  const { t } = useLang();
  const [open, setOpen] = React.useState(false);
  if (!copy.mediaKey) return null;
  // The key contains slashes; the route matches a single `:key` segment, so it must be encoded.
  const src = `/practice-media/${encodeURIComponent(copy.mediaKey)}`;
  const isVideo = (copy.mediaType ?? '').startsWith('video/');
  return (
    <>
      <button type="button" className="pr-sheet__thumb" aria-label={t('pr_open_proof')} onClick={() => setOpen(true)}>
        {isVideo ? <video src={src} preload="metadata" muted /> : <img src={src} alt="" />}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={copy.title} width={820}>
        {isVideo ? (
          <video className="pr-sheet__media" src={src} controls autoPlay />
        ) : (
          <img className="pr-sheet__media" src={src} alt={copy.title} />
        )}
      </Modal>
    </>
  );
}

export function TaskRow({
  row,
  studentName,
  materials,
  submit,
  confirm,
}: {
  row: SheetRow<StudentTaskRow>;
  studentName: string;
  materials: MaterialRow[];
  submit: PracticeSubmit;
  confirm: Confirm;
}) {
  const { t } = useLang();
  const { copy, scope } = row;
  const editable = copy.status === 'open';
  const [rejecting, setRejecting] = React.useState(false);
  const [reason, setReason] = React.useState('');

  const patch = (fields: Record<string, string>) =>
    submit(
      scope === 'class'
        ? { intent: 'update-task', id: copy.taskId!, ...fields }
        : { intent: 'update-copy', id: copy.id, ...fields },
    );

  const review = (decision: 'accept' | 'reject' | 'teacher_done', extra: Record<string, string> = {}) =>
    submit({ intent: 'review', studentTaskId: copy.id, decision, ...extra });

  const remove = async () => {
    const ok = await confirm({
      title: t('pr_delete_task'),
      message: t('pr_delete_task_confirm'),
      confirmLabel: t('delete'),
      danger: true,
    });
    if (!ok) return;
    submit(
      scope === 'class' ? { intent: 'delete-task', id: copy.taskId! } : { intent: 'remove-copy', id: copy.id },
    );
  };

  const materialTitle = copy.materialId
    ? (materials.find((m) => m.id === copy.materialId)?.title ?? null)
    : null;

  return (
    <div
      className={`pr-sheet__row${copy.status === 'submitted' ? ' is-review' : ''}`}
      data-testid="pr-row"
      data-copy={copy.id}
      data-title={copy.title}
    >
      <div className="pr-sheet__c">
        <CellInput
          value={copy.title}
          disabled={!editable}
          ariaLabel={t('pr_task_title')}
          className="pr-sheet__title"
          onCommit={(v) => patch({ title: v })}
        />
      </div>
      <div className="pr-sheet__c">
        {editable ? (
          <MSelect
            value={copy.materialId ?? NO_MATERIAL}
            onChange={(v) => patch({ materialId: v === NO_MATERIAL ? '' : v })}
            options={materialOptions(materials, t)}
          />
        ) : materialTitle ? (
          <Tag>{materialTitle}</Tag>
        ) : (
          <span className="pr-sheet__muted">—</span>
        )}
      </div>
      <div className="pr-sheet__c pr-sheet__link">
        {editable ? (
          <CellInput
            value={copy.url ?? ''}
            type="url"
            allowEmpty
            placeholder="https://"
            ariaLabel={t('pr_url')}
            onCommit={(v) => patch({ url: v })}
          />
        ) : null}
        {copy.url && (
          <a href={copy.url} target="_blank" rel="noreferrer" aria-label={t('pr_url')}>
            <MIcon name="link" size={16} />
          </a>
        )}
        {!editable && !copy.url && <span className="pr-sheet__muted">—</span>}
      </div>
      <div className="pr-sheet__c pr-sheet__time">
        {copy.timeFrom ? `${copy.timeFrom}–${copy.timeTo ?? '—'}` : <span className="pr-sheet__muted">—</span>}
      </div>
      <div className="pr-sheet__c">
        <div className="pr-sheet__status">
          {editable ? (
            <>
              <MSelect
                value={copy.proofType}
                onChange={(v) => patch({ proofType: v })}
                options={proofOptions(t)}
              />
              <Button size="sm" variant="secondary" onClick={() => review('teacher_done')}>
                {t('pr_mark_done')}
              </Button>
            </>
          ) : (
            <>
              <StatusTag status={copy.status} t={t} />
              <ProofThumb copy={copy} />
              {copy.recordedByTeacher && <Tag>{t('pr_recorded_by_teacher')}</Tag>}
              {copy.status === 'rejected' && copy.rejectReason && (
                <span className="pr-sheet__muted">{copy.rejectReason}</span>
              )}
            </>
          )}
          {copy.status === 'submitted' && !rejecting && (
            <>
              <Button size="sm" onClick={() => review('accept')}>
                {t('pr_accept')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRejecting(true)}>
                {t('pr_reject')}
              </Button>
            </>
          )}
          {copy.status === 'submitted' && rejecting && (
            <div className="pr-sheet__reason">
              <DS.Input
                label={t('pr_reject_reason')}
                value={reason}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReason(e.target.value)}
              />
              <Button size="sm" variant="danger" onClick={() => review('reject', { rejectReason: reason })}>
                {t('pr_reject')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
                {t('cancel')}
              </Button>
            </div>
          )}
        </div>
      </div>
      <div className="pr-sheet__c">
        {copy.note ? copy.note : <span className="pr-sheet__muted">—</span>}
      </div>
      <div className="pr-sheet__c">
        <FeedbackCell
          value={copy.feedback ?? ''}
          onCommit={(v) =>
            submit({ intent: 'review', studentTaskId: copy.id, decision: 'feedback', feedback: v })
          }
        />
      </div>
      <div className="pr-sheet__c pr-sheet__actions">
        <span className="pr-sheet__scope">
          {scope === 'class' ? t('pr_scope_everyone') : t('pr_scope_only', { name: studentName })}
        </span>
        {(scope === 'class' || editable) && (
          <IconButton
            label={t('pr_delete_task')}
            title={scope === 'class' ? t('pr_delete_everyone') : t('pr_remove_copy')}
            onClick={() => void remove()}
          >
            <MIcon name="trash" size={15} />
          </IconButton>
        )}
      </div>
    </div>
  );
}

export function BlankRow({
  classId,
  date,
  studentId,
  studentName,
  materials,
  defaultMaterialId,
  submit,
}: {
  classId: string;
  date: string;
  studentId: string;
  studentName: string;
  materials: MaterialRow[];
  /** The day's last row's material, so consecutive lines inherit it like the sheet did. */
  defaultMaterialId: string | null;
  submit: PracticeSubmit;
}) {
  const { t } = useLang();
  const [text, setText] = React.useState('');
  const [materialId, setMaterialId] = React.useState(defaultMaterialId ?? NO_MATERIAL);
  const [proofType, setProofType] = React.useState('either');
  const [only, setOnly] = React.useState(false);

  const save = () => {
    if (!parseQuickAddLines(text).length) return;
    // ONE post whichever scope: useFetcher aborts an in-flight submit when the next one starts, so
    // several create-task posts in a loop would lose all but the last line.
    const fields: Record<string, string> = { intent: 'quick-add', classId, date, lines: text, proofType };
    if (materialId !== NO_MATERIAL) fields.materialId = materialId;
    if (only) fields.studentId = studentId;
    submit(fields);
    setText('');
  };

  return (
    <div className="pr-sheet__row is-blank" data-testid="pr-blank" data-date={date}>
      <div className="pr-sheet__c">
        <textarea
          className="mochi-input pr-sheet__cell pr-sheet__blank"
          rows={1}
          value={text}
          placeholder={t('pr_blank_ph')}
          aria-label={t('pr_task_title')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              save();
            }
          }}
        />
      </div>
      <div className="pr-sheet__c">
        <MSelect value={materialId} onChange={setMaterialId} options={materialOptions(materials, t)} />
      </div>
      <div className="pr-sheet__c" />
      <div className="pr-sheet__c" />
      <div className="pr-sheet__c">
        <MSelect value={proofType} onChange={setProofType} options={proofOptions(t)} />
      </div>
      <div className="pr-sheet__c" />
      <div className="pr-sheet__c" />
      <div className="pr-sheet__c pr-sheet__actions">
        <Button size="sm" variant="ghost" aria-pressed={only} onClick={() => setOnly(!only)}>
          {only ? t('pr_scope_only', { name: studentName }) : t('pr_scope_everyone')}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `src/practice/practice-sheet.tsx`** (replace the stub)

```tsx
import React from 'react';
import { Link, useLoaderData, useSearchParams } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { Empty, PageHeader, useConfirm } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { monthLabel, shiftMonth } from '../../shared/logic/month.js';
import { buildSheet, needsReviewCount, type SheetFilter } from '../../shared/logic/practice-sheet.js';
import type { SheetLoaderData } from '../../app/routes/practice.$classId.$month.js';
import { usePracticeSubmit, weekdayLabels } from './common.jsx';
import { WeekdaysDialog } from './weekdays-dialog.jsx';
import { StandingStrip } from './standing-strip.jsx';
import { DayHeader } from './sheet-day.jsx';
import { BlankRow, TaskRow } from './sheet-row.jsx';

const { Button, Tabs } = DS;

/**
 * The Practice sheet: one class-month, one tab per student, the student's tasks grouped by date
 * with every column editable in place. Replaces the week planner, the review queue and the ledger
 * (docs/superpowers/specs/2026-09-04-practice-sheet-design.md).
 *
 * The fetcher is owned HERE and passed down: a row unmounts the moment its copy leaves a filtered
 * view, and `useFetcher`'s cleanup aborts whatever it had in flight (see usePracticeSubmit).
 */
export function PracticeSheetScreen() {
  const data = useLoaderData() as SheetLoaderData;
  const { classId, month, today, cls, settings, practiceDays, copies, roster, materials, excuses, ledger } =
    data;
  const { t, lang } = useLang();
  const submit = usePracticeSubmit();
  const [confirm, confirmNode] = useConfirm();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = React.useState<SheetFilter>('all');
  const [editingDays, setEditingDays] = React.useState(false);
  const [menuFor, setMenuFor] = React.useState<string | null>(null);

  const requested = params.get('student');
  const student = roster.find((s) => s.id === requested) ?? roster[0] ?? null;
  const standing = student ? (ledger.find((r) => r.studentId === student.id) ?? null) : null;

  const pickStudent = (id: string) =>
    setParams(
      (p) => {
        p.set('student', id);
        return p;
      },
      { replace: true },
    );

  // Today into view once per class-month, after the first paint of the grid.
  const scrolled = React.useRef<string | null>(null);
  React.useEffect(() => {
    const key = `${classId}:${month}`;
    if (scrolled.current === key) return;
    scrolled.current = key;
    document
      .querySelector('[data-testid="pr-day"][data-today="true"]')
      ?.scrollIntoView({ block: 'start' });
  }, [classId, month]);

  const crumbs = [{ label: t('pr_title'), to: '/practice' }, { label: cls.name }];

  if (!settings?.enabled) {
    return (
      <div className="content pr-sheet">
        <PageHeader breadcrumbs={crumbs} title={cls.name} subtitle={t('pr_title')} />
        <Empty
          icon="repeat"
          title={t('pr_not_enabled')}
          action={
            <Link to="/practice">
              <Button>{t('pr_enable')}</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const mine = student ? copies.filter((c) => c.studentId === student.id) : [];
  const days = student
    ? buildSheet({
        month,
        today,
        filter,
        practiceDays,
        copies: mine,
        misses: standing?.misses ?? [],
        excuses: excuses.filter((e) => e.studentId === student.id),
      })
    : [];
  const reviewFor = (sid: string) => needsReviewCount(copies.filter((c) => c.studentId === sid));

  const chips: { id: SheetFilter; label: string; count: number | null }[] = [
    { id: 'all', label: t('pr_filter_all'), count: null },
    { id: 'review', label: t('pr_filter_review'), count: student ? reviewFor(student.id) : 0 },
    { id: 'misses', label: t('pr_misses'), count: standing?.misses.length ?? 0 },
  ];

  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);

  return (
    <div className="content pr-sheet">
      <PageHeader
        breadcrumbs={crumbs}
        title={cls.name}
        subtitle={t('pr_sheet_sub', {
          month: monthLabel(month, lang),
          days: weekdayLabels(settings.weekdays, lang),
        })}
        actions={
          <>
            <Link to={`/practice/${classId}/${prev}`} aria-label={t('pr_month_prev')}>
              <Button variant="secondary" iconLeft={<MIcon name="chevronLeft" size={16} />}>
                {monthLabel(prev, lang)}
              </Button>
            </Link>
            <Link to={`/practice/${classId}/${next}`} aria-label={t('pr_month_next')}>
              <Button variant="secondary" iconRight={<MIcon name="chevronRight" size={16} />}>
                {monthLabel(next, lang)}
              </Button>
            </Link>
            <Button
              variant="secondary"
              iconLeft={<MIcon name="settings" size={16} />}
              onClick={() => setEditingDays(true)}
            >
              {t('pr_weekdays')}
            </Button>
          </>
        }
      />

      <div className="pr-sheet__bar">
        <div className="pr-sheet__filters" role="group" aria-label={t('pr_filter_all')}>
          {chips.map((c) => (
            <Button
              key={c.id}
              size="sm"
              variant={filter === c.id ? 'soft' : 'secondary'}
              aria-pressed={filter === c.id}
              onClick={() => setFilter(c.id)}
            >
              {c.count === null ? c.label : `${c.label} · ${c.count}`}
            </Button>
          ))}
        </div>
        <StandingStrip rows={ledger} classId={classId} submit={submit} confirm={confirm} />
      </div>

      {!student ? (
        <Empty icon="users" title={t('pr_no_students')} />
      ) : (
        <>
          <Tabs
            tabs={roster.map((s) => {
              const n = reviewFor(s.id);
              return { id: s.id, label: n ? `${s.name} · ${n}` : s.name };
            })}
            value={student.id}
            onChange={pickStudent}
          />
          <div className="pr-sheet__table">
            <div className="pr-sheet__head">
              <div className="pr-sheet__c">{t('pr_task_title')}</div>
              <div className="pr-sheet__c">{t('pr_material')}</div>
              <div className="pr-sheet__c">{t('pr_url')}</div>
              <div className="pr-sheet__c">{t('pr_time')}</div>
              <div className="pr-sheet__c">{t('pr_col_status')}</div>
              <div className="pr-sheet__c">{t('pr_note')}</div>
              <div className="pr-sheet__c">{t('pr_feedback')}</div>
              <div className="pr-sheet__c" />
            </div>
            {days.map((day) => (
              <React.Fragment key={day.date}>
                <DayHeader
                  day={day}
                  classId={classId}
                  penalty={
                    standing && standing.summary.pendingForDate === day.date
                      ? standing.summary.pendingMultiplier
                      : 0
                  }
                  menuOpen={menuFor === day.date}
                  onToggleMenu={() => setMenuFor(menuFor === day.date ? null : day.date)}
                  submit={submit}
                />
                {day.rows.map((row) => (
                  <TaskRow
                    key={row.copy.id}
                    row={row}
                    studentName={student.name}
                    materials={materials}
                    submit={submit}
                    confirm={confirm}
                  />
                ))}
                {day.showBlank && (
                  <BlankRow
                    classId={classId}
                    date={day.date}
                    studentId={student.id}
                    studentName={student.name}
                    materials={materials}
                    defaultMaterialId={day.rows.at(-1)?.copy.materialId ?? null}
                    submit={submit}
                  />
                )}
              </React.Fragment>
            ))}
            {days.length === 0 && (
              <div className="pr-sheet__empty">
                {t(filter === 'review' ? 'pr_empty_review' : 'pr_empty_misses', { name: student.name })}
              </div>
            )}
          </div>
        </>
      )}

      <WeekdaysDialog
        open={editingDays}
        title={t('pr_weekdays')}
        subtitle={cls.name}
        initial={settings.weekdays}
        onClose={() => setEditingDays(false)}
        onSave={(weekdays) =>
          submit({ intent: 'settings', classId, enabled: 'true', weekdays: weekdays ?? settings.weekdays })
        }
      />
      {confirmNode}
    </div>
  );
}
```

Verified against the DS on 2026-09-04: `BtnVariant` includes `'soft'` (`src/ds/bundle.d.ts:4`), `ButtonProps` has `iconRight`, and `users`, `repeat`, `settings`, `chevronLeft`, `chevronRight`, `more`, `trash`, `link` are all in `M_ICONS` (`src/icons.tsx`).

- [ ] **Step 5: CSS** — in `src/styles/app.css` delete every rule from `.pr-week__grid {` down to and including the `@media (max-width: 640px) { … .pr-week__grid … }` block (keep the `.pr-home__*` rules and the block comment above them), then append:

```css
/* The sheet. A CSS grid rather than <table> so day headers, rows and the blank row share one
   column template and the header can be sticky without table-layout quirks. min-width keeps the
   columns readable on a laptop; the wrapper scrolls sideways instead of crushing them. */
.pr-sheet__bar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-6);
  flex-wrap: wrap;
}
.pr-sheet__filters {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
  padding-top: var(--space-1);
}
.pr-sheet__standing {
  display: flex;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.pr-sheet__stand {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 320px;
  padding: var(--space-3) var(--space-4);
}
.pr-sheet__stand-head,
.pr-sheet__stand-nums,
.pr-sheet__stand-flags {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.pr-sheet__stand-nums {
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.pr-sheet__stand-nums b {
  color: var(--text-strong);
  font-family: var(--font-mono);
  font-weight: 700;
}
.pr-sheet__muted {
  color: var(--text-disabled);
  font-size: var(--text-sm);
}
.pr-sheet .mochi-tabs {
  margin-top: var(--space-2);
}
.pr-sheet__table {
  background: var(--surface-card);
  border: var(--border-width) solid var(--border-subtle);
  border-radius: 0 var(--radius-lg) var(--radius-lg) var(--radius-lg);
  overflow-x: auto;
}
.pr-sheet__head,
.pr-sheet__row {
  display: grid;
  grid-template-columns:
    minmax(220px, 27fr) 170px 150px 110px 280px minmax(120px, 15fr) minmax(160px, 22fr) 120px;
  align-items: center;
  min-width: 1240px;
}
.pr-sheet__head {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--surface-raised);
  border-bottom: var(--border-width) solid var(--border-subtle);
}
.pr-sheet__head .pr-sheet__c {
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--text-muted);
  padding: var(--space-3);
}
.pr-sheet__c {
  padding: var(--space-2) var(--space-3);
  min-width: 0;
  font-size: var(--text-sm);
}
.pr-sheet__row {
  border-bottom: 1px solid var(--border-subtle);
}
.pr-sheet__row:hover {
  background: var(--bg-page);
}
.pr-sheet__row.is-review {
  background: var(--orange-50);
}
.pr-sheet__dayhead {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding: var(--space-2) var(--space-3);
  min-width: 1240px;
  box-sizing: border-box;
  background: var(--surface-raised);
  border-top: var(--border-width) solid var(--border-subtle);
  border-bottom: var(--border-width) solid var(--border-subtle);
  position: sticky;
  top: 44px;
  z-index: 1;
}
.pr-sheet__dayhead.is-today {
  background: var(--brand-soft);
}
.pr-sheet__dayhead.is-off {
  color: var(--text-disabled);
}
.pr-sheet__date {
  font-family: var(--font-display);
  font-weight: 600;
  color: var(--text-strong);
  min-width: 110px;
}
.pr-sheet__dayhead.is-off .pr-sheet__date {
  color: var(--text-disabled);
}
.pr-sheet__meta {
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.pr-sheet__miss,
.pr-sheet__excuse {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.pr-sheet__excuse {
  padding: 2px 6px 2px var(--space-3);
  border-radius: var(--radius-pill);
  background: var(--cat-blue-soft);
  color: var(--cat-blue-ink);
  font-size: var(--text-sm);
}
.pr-sheet__excuse em {
  color: var(--text-body);
}
.pr-sheet__spacer {
  flex: 1;
}
.pr-sheet__menu {
  position: relative;
}
.pr-sheet__menu-pop {
  position: absolute;
  right: 0;
  top: 100%;
  z-index: 20;
  min-width: 190px;
  display: flex;
  flex-direction: column;
  background: var(--surface-raised, #fff);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md, 10px);
  box-shadow: var(--shadow-md, 0 6px 18px rgb(0 0 0 / 12%));
  padding: var(--space-1);
}
.pr-sheet__menu-item {
  background: none;
  border: 0;
  text-align: left;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm, 8px);
  cursor: pointer;
  font: inherit;
  color: var(--text-body);
}
.pr-sheet__menu-item:hover {
  background: var(--surface-hover);
}

/* In-place cells: plain text until hovered, an input when focused. */
.pr-sheet__cell {
  border-color: transparent;
  background: transparent;
  padding: 6px 8px;
  font-size: var(--text-sm);
  border-radius: var(--radius-sm);
  width: 100%;
  box-sizing: border-box;
}
.pr-sheet__cell:hover:not(:disabled):not(:focus) {
  border-color: var(--border-subtle);
  background: var(--surface-card);
}
.pr-sheet__cell:disabled {
  background: transparent;
  color: var(--text-body);
  cursor: default;
  opacity: 1;
}
textarea.pr-sheet__cell {
  resize: none;
  min-height: 34px;
  line-height: 1.4;
}
.pr-sheet__row.is-blank .pr-sheet__cell {
  border-style: dashed;
  border-color: var(--border-subtle);
}
.pr-sheet__row.is-blank .pr-sheet__cell:focus {
  border-style: solid;
}
.pr-sheet__link {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.pr-sheet__time {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  white-space: nowrap;
}
.pr-sheet__status {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.pr-sheet__reason {
  display: flex;
  align-items: flex-end;
  gap: var(--space-2);
  width: 100%;
}
.pr-sheet__thumb {
  width: 56px;
  height: 40px;
  border-radius: var(--radius-xs);
  border: var(--border-width) solid var(--border-subtle);
  background: var(--surface-sunken);
  overflow: hidden;
  padding: 0;
  cursor: zoom-in;
  flex: none;
}
.pr-sheet__thumb img,
.pr-sheet__thumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.pr-sheet__media {
  display: block;
  max-width: 100%;
  max-height: 70vh;
  margin: 0 auto;
  border-radius: var(--radius-md);
}
.pr-sheet__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-1);
}
.pr-sheet__scope {
  font-size: var(--text-xs);
  color: var(--text-disabled);
  white-space: nowrap;
}
.pr-sheet__saved {
  font-size: var(--text-xs);
  color: var(--cat-green-ink);
  margin-top: 2px;
}
.pr-sheet__empty {
  padding: var(--space-12) var(--space-6);
  text-align: center;
  color: var(--text-muted);
}
```

Also delete the `.pr-review__*` and `.pr-ledger__*` rules — they sit between `.pr-week__addone h4` and the `@media` block, so the deletion in the first sentence already covers them; confirm with `grep -n "pr-week\|pr-review\|pr-ledger" src/styles/app.css` → no output.

- [ ] **Step 6: Static checks**

Run: `cd f:/code/calendar && npm run typecheck && npm run lint && npm run check:i18n`
Expected: all clean. Common fixes: `variant="soft"` (see Step 4 note), `MSelect` prop names (`value`, `onChange`, `options`), the `iconRight` prop exists on `ButtonProps` (it does — `src/ds/bundle.d.ts:30`).

- [ ] **Step 7: Look at it** — this is the one visual step. Use the file-based Playwright harness the repo already relies on (memory: *Verify CSS without deploying* / *Live-verify authed pages*) only if a quick look is cheap; otherwise skip — the e2e spec in Task 9 is the real check and the user runs it. Never deploy to look.

- [ ] **Step 8: Commit**

```bash
cd f:/code/calendar && npx prettier --write src/practice/practice-sheet.tsx src/practice/standing-strip.tsx src/practice/sheet-day.tsx src/practice/sheet-row.tsx src/styles/app.css
git add src/practice/practice-sheet.tsx src/practice/standing-strip.tsx src/practice/sheet-day.tsx src/practice/sheet-row.tsx src/styles/app.css
git commit -m "feat(practice): the sheet — one screen for planning, review and the ledger"
```

---

### Task 8: Remove the old screens and orphaned strings

**Files:**
- Delete: `src/practice/practice-week.tsx`, `src/practice/practice-review.tsx`, `src/practice/practice-ledger.tsx`
- Modify: `shared/i18n/strings.ts` (both blocks)

- [ ] **Step 1: Delete the screens**

```bash
cd f:/code/calendar && git rm src/practice/practice-week.tsx src/practice/practice-review.tsx src/practice/practice-ledger.tsx
```

- [ ] **Step 2: Remove orphaned keys** — for EACH of `pr_open_week pr_open_ledger pr_review_queue pr_add_tasks pr_add_task_for pr_lines pr_lines_ph pr_students_on_day pr_edit_task pr_save_feedback pr_queue_empty pr_excuses_pending pr_ledger pr_week_prev pr_week_next pr_this_week pr_no_tasks_day`, run

```bash
cd f:/code/calendar && grep -rn "<key>" src app mobile shared --include=*.ts --include=*.tsx | grep -v "shared/i18n/strings.ts"
```

and delete the key from BOTH blocks only when that grep prints nothing. (`pr_no_tasks_day` may still be referenced — the mobile app or the sheet's empty state; keep any key with a live caller.)

- [ ] **Step 3: Checks**

Run: `cd f:/code/calendar && npm run typecheck && npm run lint && npm run check:i18n`
Expected: clean. `typecheck` catches a `vi` key whose `en` twin was removed (the `satisfies` clause).

- [ ] **Step 4: Commit**

```bash
cd f:/code/calendar && npx prettier --write shared/i18n/strings.ts
git add shared/i18n/strings.ts
git commit -m "chore(practice): drop the week, review and ledger screens"
```

---

### Task 9: e2e — the sheet lifecycle

**Files:**
- Rewrite: `e2e/crud-practice.spec.ts`

**Interfaces:**
- Consumes the handles fixed in Task 7 and the seed facts: staff `dev@mochi.edu`, class **Biology 9A** (`c1`) with **Leo Park** (paired parent → no "No Zalo pairing" tag) and **Mia Chen** (unpaired). Runs only on calendar-test (`crudGuard`).

- [ ] **Step 1: Write the spec** (it runs in V.4, after `npm run test:env:setup`)

```ts
import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * Practice (Nhiệm vụ): the teacher's whole loop on the SHEET — enable a class, type tasks into the
 * blank row, edit a cell in place, mark one student done, write feedback, read the standing strip,
 * switch tabs, filter, delete, disable. Runs on calendar-test only (crudGuard); every fixture is
 * prefixed E2E and the class is put back the way the seed left it.
 *
 * The Zalo assertion is split across two students on purpose: seed.sql pairs Leo Park's mother
 * (p1) to a chat and nobody else, so "No Zalo pairing" on Mia Chen and NOT on Leo proves the
 * indicator reads the pairing rather than defaulting.
 */
test.describe('CRUD: practice', () => {
  crudGuard();

  test('enable → blank row → edit cell → mark done → feedback → standing → filter → delete → disable', async ({
    page,
  }) => {
    const k = ui(page);
    const stamp = Date.now();
    const line1 = `E2E practice task A ${stamp}`;
    const line2 = `E2E practice task B ${stamp}`;
    const row = (title: string) => page.locator(`[data-testid="pr-row"][data-title="${title}"]`);

    await signInStaff(page);
    await page.goto('/practice');
    await expect(page.getByRole('heading', { name: 'Practice' })).toBeVisible();

    // Enable for Biology 9A (seeded class c1). Guarded: a retry inherits the failed attempt's state.
    const bio = page.locator('.mochi-card', { hasText: 'Biology 9A' });
    if (await bio.getByRole('button', { name: 'Enable Practice' }).count()) {
      await bio.getByRole('button', { name: 'Enable Practice' }).click();
      const enabled = k.posted('/practice-actions');
      await k.dlgOf('Enable Practice').getByRole('button', { name: 'Save' }).click();
      await enabled;
    }
    await expect(bio.getByText('Practice on', { exact: true })).toBeVisible();

    // One way in.
    await bio.getByRole('link', { name: 'Open sheet' }).click();
    await page.waitForURL(/\/practice\/[^/]+\/\d{4}-\d{2}/);
    await page.getByRole('tab', { name: 'Leo Park' }).click();
    const today = page.locator('[data-testid="pr-day"][data-today="true"]');
    await expect(today).toBeVisible();

    // Today may be a day off by default (the derived mask skips this class's own lesson days).
    let forcedPracticeDay = false;
    if (await today.getByText('Day off', { exact: true }).count()) {
      await today.getByRole('button', { name: 'Day menu' }).click();
      const ov = k.posted('/practice-actions');
      await page.getByRole('menuitem', { name: 'Make practice day' }).click();
      await ov;
      forcedPracticeDay = true;
      await expect(today.getByText('Day off', { exact: true })).toHaveCount(0);
    }

    // The blank row is the row right after today's header. Two lines, Enter → two class tasks.
    const todayDate = await today.getAttribute('data-date');
    const blank = page.locator(`[data-testid="pr-blank"][data-date="${todayDate}"]`);
    await blank.getByRole('textbox', { name: 'Task' }).fill(`${line1}\n${line2}`);
    const added = k.posted('/practice-actions');
    await blank.getByRole('textbox', { name: 'Task' }).press('Enter');
    await added;
    await expect(row(line1)).toBeVisible();
    await expect(row(line2)).toBeVisible();

    // Edit task A's title in place: type, Enter commits.
    const titleA = row(line1).getByRole('textbox', { name: 'Task' });
    await titleA.fill(`${line1} edited`);
    const edited = k.posted('/practice-actions');
    await titleA.press('Enter');
    await edited;
    await expect(row(`${line1} edited`)).toBeVisible();

    // Mark Leo done on task B, right in the row.
    const done = k.posted('/practice-actions');
    await row(line2).getByRole('button', { name: 'Mark done' }).click();
    await done;
    await expect(row(line2).getByText('Done (teacher)', { exact: true })).toBeVisible();
    await expect(row(line2).getByText('Recorded by teacher', { exact: true })).toBeVisible();

    // Feedback saves on blur.
    const fb = row(line2).getByRole('textbox', { name: 'Feedback' });
    await fb.fill(`E2E feedback ${stamp}`);
    const saved = k.posted('/practice-actions');
    await fb.press('Tab');
    await saved;
    await expect(row(line2).getByText('Saved', { exact: true })).toBeVisible();

    // Standing strip: 1 of 2 for Leo, 0 of 2 for Mia, and the pairing indicator only on Mia.
    const leo = page.locator('[data-testid="pr-standing"]', { hasText: 'Leo Park' });
    const mia = page.locator('[data-testid="pr-standing"]', { hasText: 'Mia Chen' });
    await expect(leo.getByText('1 / 2', { exact: true })).toBeVisible();
    await expect(leo.getByText('No Zalo pairing', { exact: true })).toHaveCount(0);
    await expect(mia.getByText('0 / 2', { exact: true })).toBeVisible();
    await expect(mia.getByText('No Zalo pairing', { exact: true })).toBeVisible();

    // Mia's tab shows the same two class tasks, still open; the review filter has nothing for her.
    await page.getByRole('tab', { name: 'Mia Chen' }).click();
    await expect(row(`${line1} edited`)).toBeVisible();
    await expect(row(line2).getByRole('button', { name: 'Mark done' })).toBeVisible();
    await page.getByRole('button', { name: /^Needs review/ }).click();
    await expect(page.getByText('Nothing to review for Mia Chen', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(row(line2)).toBeVisible();

    // The breadcrumb trail is the way back to the class list. Scoped to .m-crumbs because the
    // sidebar carries its own "Practice" link.
    await expect(page.locator('.m-crumbs').getByRole('link', { name: 'Practice' })).toBeVisible();

    // Delete both class tasks (Leo's teacher_done copy of B survives by design; the row goes).
    for (const title of [`${line1} edited`, line2]) {
      await row(title).getByRole('button', { name: 'Delete task' }).click();
      const del = k.posted('/practice-actions');
      await k.confirmDanger('Delete task').click();
      await del;
      await expect(row(title)).toHaveCount(0);
    }

    // Put the day back on the weekly default if this run overrode it.
    if (forcedPracticeDay) {
      await today.getByRole('button', { name: 'Day menu' }).click();
      const reset = k.posted('/practice-actions');
      await page.getByRole('menuitem', { name: 'Use weekly default' }).click();
      await reset;
    }

    // Disable Practice again so other specs see the seeded state.
    await page.goto('/practice');
    await bio.getByRole('button', { name: 'Disable Practice' }).click();
    const disabled = k.posted('/practice-actions');
    await k.confirmDanger('Disable Practice').click();
    await disabled;
    await expect(bio.getByRole('button', { name: 'Enable Practice' })).toBeVisible();
  });
});
```

Notes for whoever runs it: (1) `getByRole('textbox', { name: 'Task' })` resolves through the `aria-label` on both the blank textarea and the title input — inside `blank` there is exactly one, inside a row exactly one. (2) After Task B is `teacher_done` on Leo's tab, `row(line2)` on Mia's tab is Mia's copy — still `open`, hence **Mark done** visible. (3) Deleting from Mia's tab posts `delete-task` (class scope) which removes both students' open copies and the class row; Leo's done copy keeps `taskId = null` and stays in his history, exactly as the old spec asserted.

- [ ] **Step 2: Lint the spec**

Run: `cd f:/code/calendar && npx prettier --write e2e/crud-practice.spec.ts && npx tsc --noEmit -p tsconfig.json`
Expected: clean (the e2e folder is in the root tsconfig; if it is not, `npx eslint e2e/crud-practice.spec.ts` is enough).

- [ ] **Step 3: Commit**

```bash
cd f:/code/calendar && git add e2e/crud-practice.spec.ts
git commit -m "test(e2e): practice sheet lifecycle"
```

---

### Task 10: Walkthrough stories

**Files:**
- Modify: `shared/walkthrough.ts` (replace the `practice-plan-week` and `practice-review-ledger` stories, ~lines 729–810)
- Test: `test/walkthrough.test.ts` (count stays 29 — 2 out, 2 in; `npx vitest run test/walkthrough.test.ts` is allowed)

- [ ] **Step 1: Replace both stories with**

```ts
  {
    id: 'practice-sheet-plan',
    journey: 'content',
    title: 'Enable Practice for a class and plan a day on the sheet',
    tag: 'write',
    route: '/practice',
    account: 'staff',
    specs: ['crud-practice.spec.ts'],
    steps: [
      { kind: 'goto', text: 'Open Practice', route: '/practice' },
      {
        kind: 'click',
        text: 'On a class card click Enable Practice',
        target: { button: 'Enable Practice' },
        opensDialog: 'Enable Practice',
      },
      {
        kind: 'check',
        text: 'Leave the weekdays untouched the first time — Mochi derives Mon–Sat minus the days this class meets, Sunday off',
      },
      { kind: 'submit', text: 'Press Save', target: { button: 'Save' }, post: '/practice-actions' },
      { kind: 'click', text: 'Click Open sheet', target: { button: 'Open sheet' } },
      {
        kind: 'check',
        text: 'The sheet shows this month for the first student: a standing card per student above, one tab per student, and the days of the month as sticky group headers with today highlighted',
      },
      {
        kind: 'check',
        text: "In today's blank row type 'WALKTHROUGH Workbook p.4-7', then Shift+Enter, then 'WALKTHROUGH Grammar in Use unit 4', then Enter — two rows appear, marked Everyone",
      },
      {
        kind: 'check',
        text: 'Click the first title and add a word — Enter saves it in place; pick a material and a proof type from the selects on the same row',
      },
      {
        kind: 'check',
        text: 'Flip the blank row\u2019s Everyone pill to Only <student> and add a third line — it appears marked Only <name> and is missing from the other student\u2019s tab',
      },
      {
        kind: 'check',
        text: 'Cleanup: delete all three WALKTHROUGH rows with the trash icon (Delete task), then Disable Practice on the class card',
      },
    ],
  },
  {
    id: 'practice-sheet-review',
    journey: 'content',
    title: 'Review submissions and read the standing on the sheet',
    tag: 'read',
    route: '/practice',
    account: 'staff',
    specs: ['crud-practice.spec.ts'],
    steps: [
      { kind: 'goto', text: 'Open Practice', route: '/practice' },
      { kind: 'click', text: 'Click Open sheet on an enabled class', target: { button: 'Open sheet' } },
      {
        kind: 'check',
        text: 'Click the Needs review chip — only submitted rows remain, each with time worked, the student note, a proof thumbnail (click to enlarge), Accept and Reject; feedback typed into the last column saves when you leave the cell and flashes Saved',
      },
      {
        kind: 'check',
        text: 'Click the Misses chip — only days with a miss remain; the date header reads Missed — excused / unexcused with Mark excused on an unexcused one, and a pending excuse request shows as a chip with Approve / Reject',
      },
      {
        kind: 'check',
        text: 'The standing cards above show done/total, excused used out of quota, unexcused, the ×N badge and warning level with Clear warning, and "No Zalo pairing" when parents cannot be messaged',
      },
      {
        kind: 'check',
        text: 'Above the title a breadcrumb trail reads Practice › class — click Practice to go back to the class list; ‹ › in the header move months',
      },
    ],
  },
```

- [ ] **Step 2: Run the story-shape test**

Run: `cd f:/code/calendar && npx vitest run test/walkthrough.test.ts`
Expected: PASS (29 stories; both stories start with `goto` to their own `route`; no `fill` steps so no prefix rule fires, but the write story still ends with a "Cleanup" step).

- [ ] **Step 3: Commit**

```bash
cd f:/code/calendar && npx prettier --write shared/walkthrough.ts
git add shared/walkthrough.ts
git commit -m "docs(walkthrough): practice sheet stories"
```

---

## Verification phase

Order matters: unit → staging (setup then suite, as a pair) → push → prod deploy probe → prod smoke →
OTA record → cleanup → log. Cleanup (V.9) and the log commit (V.10) run **unconditionally** — after a
failure, after the hard stop, after a skipped step.

### V.0 Preflight

- [ ] Write the start time (local clock, `date`) and `HARD STOP = start + 6 h` at the top of the Execution log.
- [ ] `cd f:/code/calendar && git status -sb && git rev-parse --short HEAD && node -v` — expected: `## main...origin/main [ahead N]` where N = the number of Build commits + 1 (the pre-existing docs commit), no untracked files except this plan's own edits; Node v24.
- [ ] Confirm every row of §0.3 with its command; paste the results into the log.
- [ ] Record N0 on prod (read-only, granted):

```bash
cd f:/code/calendar && npx wrangler d1 execute mochi-class --remote --json --command "SELECT (SELECT COUNT(*) FROM practice_tasks) AS tasks, (SELECT COUNT(*) FROM practice_student_tasks) AS copies, (SELECT COUNT(*) FROM practice_excuses) AS excuses, (SELECT COUNT(*) FROM practice_misses) AS misses, (SELECT COUNT(*) FROM practice_tasks WHERE title LIKE 'WALKTHROUGH%') AS wt, (SELECT COUNT(*) FROM practice_student_tasks WHERE title LIKE 'WALKTHROUGH%') AS wc, (SELECT COUNT(*) FROM practice_day_overrides WHERE class_id='7ab211f5-9702-4b72-b7a8-a33a7a4dbfc7') AS bb_overrides, (SELECT COUNT(*) FROM class_students WHERE class_id='7ab211f5-9702-4b72-b7a8-a33a7a4dbfc7') AS bb_students" | grep -A10 '"results"'
```

Expected on 2026-09-04: `tasks 3, copies 6, excuses 2, misses 2, wt 0, wc 0, bb_students 1`; `bb_overrides` whatever it is — write all eight numbers into the log as **N0**. If `wt` or `wc` is not 0, a previous run left rows: run the V.9 fallback deletes FIRST and re-record.

### V.1 Static (free)

- [ ] `cd f:/code/calendar && npm run typecheck && npm run lint && npm run check:i18n` — 0 errors; lint shows only the 2 baseline warnings; check:i18n exits 0.
- [ ] Leftover sweep:

```bash
cd f:/code/calendar && grep -rn "practice/review\|/week/\|/ledger/\|pr-week\|pr-review\|pr-ledger\|practiceWeekKey\|practiceLedgerKey\|PRACTICE_REVIEW_KEY\|Open week\|Open ledger\|Review queue" src app shared e2e test --include=*.ts --include=*.tsx --include=*.css
```

Expected: hits only inside the three redirect route files' comments. Anything else → fix (counts against the 3 fix commits only if it needs a code change beyond the current uncommitted Build task).

### V.2 Unit (granted)

- [ ] `cd f:/code/calendar && npm test` (runs `test/` then `test-worker/`). Expected: both green; `test/practice-sheet-logic.test.ts` (6), `test/cache.test.ts` and `test/walkthrough.test.ts` pass; `test-worker/practice.test.js` includes the two new cases green. Paste both summary lines into the log. A failure outside the files this plan touched: compare with §0.4, record, do not fix.

### V.3 Test env (granted)

- [ ] `cd f:/code/calendar && npm run test:env:setup` (deploys calendar-test with `CLOUDFLARE_ENV=test` at build time; ~3–5 min; `run_in_background` + Monitor).
- [ ] Probe the new bundle on calendar-test: `curl -sI https://calendar-test.ngqv0712.workers.dev/practice/review | head -3` → `HTTP/2 301` and `location: /practice`. A `302` means the old bundle is still serving — wait for the setup to finish, do not debug.

### V.4 e2e (granted)

- [ ] `cd f:/code/calendar && npm run test:e2e:staging -- e2e/crud-practice.spec.ts` → 1 passed. Red → `playwright.md` §C: stamp check first, then trace, fix, `npm run test:env:setup` again if server code changed, rerun the spec; three laps max, then `test.fixme` with a one-line reason and log it.
- [ ] `cd f:/code/calendar && npm run test:e2e:staging` (full; ~4–13 min; background + Monitor). Paste the summary line. Every failure must be in §0.4 by spec + title; anything else is yours → same lap rule. Never rerun the full suite to "confirm" a count.

### V.5 Ship the feature (push #1)

- [ ] Fix commits so far ≤ 3; `npm run typecheck && npm run lint` green.

```bash
cd f:/code/calendar && node scripts/changelog.mjs "Practice is one sheet per class-month: tasks grouped by date with every column edited in place, a blank row to add tasks, review and the ledger folded in. Week planner, review queue and ledger URLs redirect."
git add CHANGELOG.md docs/superpowers/plans/2026-09-04-practice-sheet.md
git commit -m "feat(practice): one-screen sheet replaces week planner, review queue and ledger

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin main
git rev-parse --short HEAD
```

Write the pushed sha into the log as **SHA1**. (The Build tasks' commits and the pre-existing docs commit ride along.) Push 403 → §0.5 #12.

### V.6 Prod deploy probe

- [ ] Workers Builds deploys on push (10–15 min). Poll — background loop, never a foreground sleep:

```bash
cd f:/code/calendar && for i in $(seq 1 30); do s=$(curl -s -o /dev/null -w "%{http_code}" https://calendar.ngqv0712.workers.dev/practice/review); echo "$(date +%T) $s"; [ "$s" = "301" ] && break; sleep 30; done
```

(run with `run_in_background`; read its output when it finishes). Expected: ends on `301` within 15 min. Then `curl -sI https://calendar.ngqv0712.workers.dev/practice/review | grep -i location` → `location: /practice`. If still `302` after 15 min: check `curl -s "https://api.github.com/repos/VuNQ-Jeremy/calendar/actions/runs?per_page=3"` and the Cloudflare build in the dashboard is not reachable from here — skip V.7 (nothing new to smoke), record, continue with V.8.

### V.7 Prod smoke on Bamblebee (granted, write-scoped) — read `playwright.md` §B first

- [ ] Write the script to the scratchpad as `practice-sheet-smoke.mjs` **exactly** as below (the cleanup half is part of the same run and runs even when an earlier step throws):

```js
// practice-sheet-smoke.mjs — prod smoke of the Practice sheet on class Bamblebee.
// Usage: node practice-sheet-smoke.mjs [run|cleanup]
import { chromium } from 'file:///F:/code/calendar/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const BASE = 'https://calendar.ngqv0712.workers.dev';
const OUT = 'F:/code/calendar/docs/superpowers/reviews/2026-09-04-practice-sheet-smoke/';
const CLASS_NAME = 'Bamblebee';
const MODE = process.argv[2] ?? 'run';
const STAMP = Date.now();
const TITLE = `WALKTHROUGH sheet smoke ${STAMP}`;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript(() => localStorage.setItem('mochi_lang_v1', 'en'));
const posted = () =>
  page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/practice-actions.data' && r.ok(),
  );
const shot = async (name) => {
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: false });
  console.log('shot', name);
};
const rows = () => page.locator('[data-testid="pr-row"][data-title^="WALKTHROUGH"]');
let forcedPracticeDay = false;

async function openSheet() {
  await page.goto(`${BASE}/practice`);
  const card = page.locator('.mochi-card', { hasText: CLASS_NAME });
  await card.getByRole('link', { name: 'Open sheet' }).click();
  await page.waitForURL(/\/practice\/[^/]+\/\d{4}-\d{2}/);
  await page.getByRole('tab', { name: 'Moon' }).click();
  await page.locator('[data-testid="pr-day"][data-today="true"]').waitFor();
}

async function cleanup() {
  console.log('cleanup: start');
  try {
    await openSheet();
    // Delete every WALKTHROUGH row that exists, one confirm each.
    while ((await rows().count()) > 0) {
      await rows().first().getByRole('button', { name: 'Delete task' }).click();
      const p = posted();
      await page.locator('.m-dialog').last().locator('.mochi-btn.is-danger').click();
      await p;
      await page.waitForTimeout(500);
    }
    if (forcedPracticeDay) {
      const today = page.locator('[data-testid="pr-day"][data-today="true"]');
      await today.getByRole('button', { name: 'Day menu' }).click();
      const p = posted();
      await page.getByRole('menuitem', { name: 'Use weekly default' }).click();
      await p;
    }
    await shot('09-after-cleanup');
    console.log('cleanup: rows left', await rows().count());
  } catch (e) {
    console.log('cleanup: FAILED', String(e).slice(0, 300), '→ use the D1 fallback in V.9');
  }
}

try {
  await page.goto(`${BASE}/login`);
  await page.getByRole('button', { name: 'Email', exact: true }).click();
  await page.fill('input[name="email"]', 'dev@mochi.edu');
  await page.fill('input[name="password"]', 'mochi123');
  await page.click('form[action="/login"] button[type="submit"]');
  await page.waitForURL(/\/(dashboard|vocabulary)/, { timeout: 30_000 });
  console.log('stamp', await page.locator('.sb__version').innerText());

  if (MODE === 'cleanup') {
    await cleanup();
  } else {
    await openSheet();
    await shot('01-sheet');

    const today = page.locator('[data-testid="pr-day"][data-today="true"]');
    if (await today.getByText('Day off', { exact: true }).count()) {
      await today.getByRole('button', { name: 'Day menu' }).click();
      const p = posted();
      await page.getByRole('menuitem', { name: 'Make practice day' }).click();
      await p;
      forcedPracticeDay = true;
      console.log('today was a day off → forced practice day (will reset)');
    }
    const todayDate = await today.getAttribute('data-date');
    const blank = page.locator(`[data-testid="pr-blank"][data-date="${todayDate}"]`);
    await blank.getByRole('textbox', { name: 'Task' }).fill(`${TITLE}\n${TITLE} B`);
    let p = posted();
    await blank.getByRole('textbox', { name: 'Task' }).press('Enter');
    await p;
    await page.locator(`[data-testid="pr-row"][data-title="${TITLE}"]`).waitFor();
    console.log('rows after add', await rows().count()); // 2
    await shot('02-two-rows-added');

    const rowA = page.locator(`[data-testid="pr-row"][data-title="${TITLE}"]`);
    await rowA.getByRole('textbox', { name: 'Task' }).fill(`${TITLE} edited`);
    p = posted();
    await rowA.getByRole('textbox', { name: 'Task' }).press('Enter');
    await p;
    await page.locator(`[data-testid="pr-row"][data-title="${TITLE} edited"]`).waitFor();
    await shot('03-title-edited');

    const rowB = page.locator(`[data-testid="pr-row"][data-title="${TITLE} B"]`);
    await rowB.getByRole('textbox', { name: 'Feedback' }).fill('WALKTHROUGH feedback');
    p = posted();
    await rowB.getByRole('textbox', { name: 'Feedback' }).press('Tab');
    await p;
    await rowB.getByText('Saved', { exact: true }).waitFor();
    await shot('04-feedback-saved');

    await page.getByRole('button', { name: /^Needs review/ }).click();
    await page.getByText('Nothing to review for Moon', { exact: true }).waitFor();
    await shot('05-filter-review-empty');
    await page.getByRole('button', { name: /^Misses/ }).click();
    await shot('06-filter-misses');
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await rowB.waitFor();

    const standing = page.locator('[data-testid="pr-standing"]', { hasText: 'Moon' });
    console.log('standing text', (await standing.innerText()).replace(/\s+/g, ' '));
    await shot('07-standing');

    await page.evaluate(() => localStorage.setItem('mochi_lang_v1', 'vi'));
    await page.reload();
    await page.locator('[data-testid="pr-day"]').first().waitFor();
    await shot('08-vi');
    const raw = await page.locator('body').innerText();
    console.log('raw i18n keys visible?', /\bpr_[a-z_]+\b/.test(raw) ? 'YES — BUG' : 'no');
    await page.evaluate(() => localStorage.setItem('mochi_lang_v1', 'en'));
    await page.reload();

    await cleanup();
  }
} catch (e) {
  console.log('RUN FAILED', String(e).slice(0, 500));
  await cleanup();
} finally {
  await browser.close();
}
```

- [ ] Run it: `cd <scratchpad> && node practice-sheet-smoke.mjs run` (background + Monitor; ~2 min). Expected console: `stamp v0.NNNN · <SHA1>` (must be SHA1 — else another session redeployed: stop, log, skip to V.8), `rows after add 2`, `raw i18n keys visible? no`, `cleanup: rows left 0`.
- [ ] **Read every PNG** in `docs/superpowers/reviews/2026-09-04-practice-sheet-smoke/` with the Read tool and write one line per image into the log: 01 header/standing/tabs/day headers present and today highlighted; 02 two rows under today with Everyone markers; 03 edited title; 04 "Saved" under the feedback cell; 05 empty-state text; 06 misses filter (empty or the miss line); 07 standing card numbers; 08 Vietnamese labels, no `pr_…` keys; 09 no WALKTHROUGH rows. A dialog or row cut off by the viewport, a raw key, or a missing element is a finding — log it; it is a fix only if it fits within the 3-commit cap and is a code defect (not a data condition).

### V.8 OTA — record only (manual publish NOT granted)

- [ ] `cd f:/code/calendar/mobile && npx eas-cli workflow:runs | head -12`. Expected top run: `Trigger refs/heads/main@<SHA1>`. Record `Status`. `FAILURE` within ~1 s is the exhausted free CI quota (known); the change is web-only so phones are not missing anything — write `open issue: OTA workflow FAILURE for <SHA1>; manual publish not authorized for this run` and continue. Do **not** run `eas update`.

### V.9 Cleanup (unconditional — runs after a failure or the hard stop too)

- [ ] If V.7's `cleanup: rows left` was not `0`, or V.7 aborted before its cleanup: `cd <scratchpad> && node practice-sheet-smoke.mjs cleanup`.
- [ ] Zero-count query (read-only):

```bash
cd f:/code/calendar && npx wrangler d1 execute mochi-class --remote --json --command "SELECT (SELECT COUNT(*) FROM practice_tasks WHERE title LIKE 'WALKTHROUGH%') AS wt, (SELECT COUNT(*) FROM practice_student_tasks WHERE title LIKE 'WALKTHROUGH%') AS wc, (SELECT COUNT(*) FROM practice_tasks) AS tasks, (SELECT COUNT(*) FROM practice_student_tasks) AS copies, (SELECT COUNT(*) FROM practice_day_overrides WHERE class_id='7ab211f5-9702-4b72-b7a8-a33a7a4dbfc7') AS bb_overrides" | grep -A8 '"results"'
```

Expected: `wt 0, wc 0`, `tasks`/`copies`/`bb_overrides` equal to N0. Not zero → the granted fallback, in this order, then re-run the query:

```bash
cd f:/code/calendar && npx wrangler d1 execute mochi-class --remote --command "DELETE FROM practice_student_tasks WHERE title LIKE 'WALKTHROUGH%'"
npx wrangler d1 execute mochi-class --remote --command "DELETE FROM practice_tasks WHERE title LIKE 'WALKTHROUGH%'"
# only if bb_overrides > N0 (the smoke forced today and could not reset it):
npx wrangler d1 execute mochi-class --remote --command "DELETE FROM practice_day_overrides WHERE class_id='7ab211f5-9702-4b72-b7a8-a33a7a4dbfc7' AND date='<today ICT, YYYY-MM-DD>'"
```

- [ ] `cd f:/code/calendar && git status --short` — only this plan and the PNGs under `docs/superpowers/reviews/2026-09-04-practice-sheet-smoke/` may be modified/untracked. Anything else (a stray `.mjs`, a formatted file you did not intend) → move it out or unstage it; never `git add -A`.

### V.10 Log + docs commit (push #2)

- [ ] Fill the **Execution log** below: start/end time, SHA1, N0 and the V.9 counts, every suite's summary line, path taken per step (`done` / `skipped — not authorized` / `skipped — <why>`), one line per PNG, fix commits made (≤ 3) with shas, **Decisions taken by the executor**, **Open issues for the morning** (at least: OTA workflow status; any `test.fixme`).
- [ ] Memory: append to `C:\Users\ADMIN\.claude\projects\f--code-calendar\memory\practice-tracker-decisions.md`, after the implementation-plan paragraph: `2026-09-04: teacher web UI collapsed into one sheet per class-month (/practice/:classId/:month?student=); week/review/ledger URLs 301. Spec docs/superpowers/specs/2026-09-04-practice-sheet-design.md, plan docs/superpowers/plans/2026-09-04-practice-sheet.md (execution log at the bottom).`
- [ ] Commit and push, staging by name:

```bash
cd f:/code/calendar && node scripts/changelog.mjs "docs(practice): overnight verification log and prod smoke screenshots for the Practice sheet"
git add CHANGELOG.md docs/superpowers/plans/2026-09-04-practice-sheet.md docs/superpowers/reviews/2026-09-04-practice-sheet-smoke
git commit -m "docs(practice): sheet verification log + smoke screenshots

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin main
```

- [ ] `cd f:/code/calendar/mobile && npx eas-cli workflow:runs | head -6` once more for this sha; record the status (no manual publish).

### If something blocks

| Situation | Do |
|---|---|
| §0.2 does not list the step's command | tick `skipped — not authorized`, continue |
| A Build task cannot pass `npm run typecheck` after 3 attempts | Never leave the tree red and never stash (shared tree). Reduce the task to what compiles, commit that, log the gap under Open issues |
| A test stays red after 3 laps | `test.fixme` with a one-line reason; never delete a test |
| calendar-test stamp is not your sha mid-run | another session deployed; rerun `npm run test:env:setup` + the spec, do not debug |
| Prod never reaches 301 in 15 min | skip V.7; still V.8, V.9, V.10 |
| The smoke's `cleanup: rows left` ≠ 0 | V.9 fallback deletes, then the count query again |
| Hard stop reached | V.9 then V.10, whatever step was open |
| A decision is needed | choose the option touching the fewest files; record it under **Decisions taken by the executor** |

---

## Self-review (author, 2026-09-04)

- **Spec coverage:** header/month nav/weekday gear → T7 §4; filter chips → T7 §4; standing strip → T7 §1; tabs via `?student=` → T7 §4 + T2 key comment; date header (today/day off/meta/miss/×N/excuse/menu) → T7 §2 + T1 rule; task row columns, editable-only-while-open, class vs student scope → T7 §3 + T3; proof thumbnail modal → T7 §3; blank row rule + scope pill + one post → T1 + T7 §3 + T3 (`quick-add.studentId`); not-enabled Empty → T7 §4; redirects → T6; removed screens/keys/CSS → T7 §5 + T8; e2e → T9; walkthrough → T10; static/unit/staging/prod/OTA/cleanup/log → V.1–V.10.
- **Placeholder scan:** none; every code step is full code; the smoke script is complete including its cleanup half.
- **Type consistency:** `SheetLoaderData` (T6) is what T7 imports type-only; `buildSheet`'s generic `SheetDay<StudentTaskRow, MissRow, ExcuseRow>` is aliased `Day` in `sheet-day.tsx`; `PracticeSubmit` from `common.tsx` is the one submit type everywhere; `updateStudentTask` (T3) is what `update-copy` (T3) calls and `TaskRow` (T7) posts; `practiceMonthKey` (T2) is what T6's `clientLoader` uses; `needsReviewCount` (T1) feeds tabs and chips (T7); the e2e (T9) and the smoke (V.7) use the same handles listed in T7's Interfaces and §0.3.
- **Deviation from the spec, called out:** the spec says "one new intent"; this plan also widens `quick-add` with an optional `studentId` because `useFetcher` aborts an in-flight submit when the next starts — a per-line `create-task` loop would lose lines. Same user-visible behaviour, one post. Recorded in the spec's Data flow section.
- **Unattended-run facts verified 2026-09-04:** Node v24.16.0; HEAD `44de481` ahead 1; worktree `.worktrees/vocab`; EAS `vu-nguyen`; Cloudflare `ngqv0712@gmail.com`; lint 2 warnings / 0 errors; prod Bamblebee = 1 student (Moon), Practice on, 0 tasks; prod practice rows 3/6/2/2 all `seedtest-`; Java absent; EAS workflow for today's docs push already `FAILURE` in 1 s (quota).

## Execution log
_(filled by the executor — see V.10)_

### Decisions taken by the executor

### Open issues for the morning
