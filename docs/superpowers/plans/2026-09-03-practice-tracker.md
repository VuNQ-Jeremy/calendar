# Practice (Nhiệm vụ) tracker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. This plan is ONE
> linear sequence for a single developer, start to finish — **not** task-by-task with per-task
> commits. Do the steps in order, tick the `- [ ]` boxes in THIS file as you go, commit ONCE at
> Step 32 (code + this plan) and push at Step 33, then run Phases 4c–4d (prod migration, OTA, APK,
> emulator) and make the single allowed follow-up docs commit at Step 48. Written for Claude Opus 5 running
> unattended overnight: every decision is already made — do not re-open one, do not ask, do not
> stop to confirm, and do not assume anything this file does not state — when the plan says
> "read file X lines a–b first", do that before writing.
> If a step is genuinely impossible after 3 attempts, write what happened under **Execution log**
> at the bottom and continue with the next step. Never leave the tree failing `npm run typecheck`
> at commit time.

**Goal:** A new "Practice / Nhiệm vụ" feature: teachers plan daily self-study tasks per class (copied
per student), students submit photo/video proof from the phone with a timer, misses feed a monthly
excuse quota and an escalating ×2/×3/×4 penalty badge, parents see it on the portal and slip.

**Architecture:** Three new tenant-scoped D1 tables for tasks/copies, three for the miss economy
(misses, excuse requests, per-student warning state) and one settings row per class. Pure rules in
`shared/logic/practice.ts` (practice-day derivation, quota, escalation) used by the server, the web
and the phone. A nightly Worker cron (00:00 ICT) finalizes misses, writes a `missing_practice`
behavior row, pushes the penalty alert and Zalo-texts paired parents; a 20:00 ICT cron reminds.
Web teacher UI = weekly grid + review queue + ledger under `/practice`. Student UI = a new mobile
tab. Video proof needs a native module, so `runtimeVersion` bumps 3 → 4 and a new APK is built.

**Tech Stack:** React Router 7 SSR on Cloudflare Workers (D1 via Drizzle, R2 `FILES`), Mochi DS
(`src/ds`, `src/ui.tsx`), Zod 4, vitest (`test/` jsdom + `test-worker/` cloudflare pool), Playwright
e2e against `calendar-test`, Expo SDK 57 / RN 0.86 (expo-router, react-query, expo-image-picker,
react-native-compressor 2.0.3), EAS Update + EAS Build.

**Spec:** the decisions table in §2 of this file is the spec (49 answers from the 2026-09-03
clarification round). Companion pages: spec review
https://claude.ai/code/artifact/d7390a34-c922-4cfa-806e-13358e1ab8f4 · conflict map
https://claude.ai/code/artifact/539f0013-e6a3-40b3-bfd4-3421c543a416. Source sheet structure is in
the memory note `homework-tracker-sheet`.

---

## 0. Session survival kit — read before the first step

### 0.1 Machine facts (verified 2026-09-03)

| Thing | Value |
|---|---|
| OS / shells | Windows 11. PowerShell 5.1 is the primary tool; Git Bash also available. `cd` does NOT persist between tool calls — always `cd f:/code/calendar && …` or `cd f:/code/calendar/mobile && …` in the same command. |
| Node | v24.16.0 (needed: mobile tests use `node:sqlite`). |
| Repo | `f:\code\calendar`, branch `main`, remote `https://github.com/VuNQ-Jeremy/calendar.git`. A second worktree exists at `.worktrees/vocab` — **exclude `.worktrees/**` from every search** or every hit doubles. |
| No `gh` CLI | Read Actions status with `curl -s "https://api.github.com/repos/VuNQ-Jeremy/calendar/actions/runs?per_page=3"`. |
| adb | `C:\Users\ADMIN\AppData\Local\Android\Sdk\platform-tools\adb.exe` (also on PATH as `adb`). |
| emulator | `C:\Users\ADMIN\AppData\Local\Android\Sdk\emulator\emulator.exe` (NOT on PATH). AVDs: `mochi_dev`, `entag_dev`. Use `mochi_dev`. |
| Java / Maestro | **NOT installed.** `npm run test:device` cannot run. Device testing in Phase 4d is adb + `uiautomator dump` driven (Step 46). Do not try to install Java. |
| EAS CLI | via `npx eas-cli` from `mobile/`. Logged in as the project owner (`owner: vu-nguyens-team`, project `mochi-class`, id `83251f6c-1fa9-4724-ba61-39a9eb806aab`). If a command says not logged in, STOP that step and log it — never run `eas login` (interactive). |
| Cloudflare | Account ngqv0712@gmail.com. Never `wrangler login` (it is global and would evict another project's token). Never `wrangler deploy` (Workers Builds deploys on push and wins the race). |
| Test accounts | staff/admin `dev@mochi.edu` / `mochi123`; student `vunq@mochi.edu` / `mochi123` (student `s1` "Leo Park", class `c1` "Biology 9A"). Exist on prod and on calendar-test. |

### 0.2 Authorizations granted for THIS run (user, 2026-09-03) — and what stays forbidden

Granted (normally manual-trigger only per CLAUDE.md; the user explicitly allowed them for this run):
- `npm test` and `npm run test:worker` (unit suites) — run as often as needed.
- `npm run test:env:setup` then `npm run test:e2e:staging` (redeploys + resets `calendar-test`, ~4–13 min).
- Apply the new migration to **production** D1 by hand after the push (Step 42).
- Manual OTA publish fallback: `npx eas-cli update --branch preview --platform android --environment preview --message "…"` (Step 43).
- `npx eas-cli build -p android --profile preview` to produce the new APK (Step 44) and driving the `mochi_dev` emulator (Step 46).
- Writing WALKTHROUGH-prefixed practice rows on production for class `c1` during the device smoke, **with mandatory cleanup** (Step 46).

Still forbidden, no exceptions:
- Any paid API call (Anthropic `/enrich-vocab` `/generate-vocab`, Workers AI `/vocab-image-generate`, Azure `/speech-assess`). This feature needs none of them.
- `npm run format` / `prettier --write .` (the tree is CRLF; it would rewrite hundreds of files). Format only the files you created/changed: `npx prettier --write <file> <file>`.
- `git add -A` / `git add .` — stage files by name. `git push --force`, `git reset --hard`, `git checkout -- <file>` on files you did not create.
- `wrangler deploy`, `wrangler login`, `wrangler deploy --env test` (silently ships prod config).
- `npx tsc -b` at the root (emits ~150 stray `.js` files). Use `npm run typecheck`.
- `cd mobile && npm run test:device` (Maestro; not installed anyway).

### 0.3 Command cheat sheet

```
# free static checks (web + server)
cd f:/code/calendar && npm run typecheck
cd f:/code/calendar && npm run lint            # oxlint src worker workers app shared scripts (NOT server/, test/)
cd f:/code/calendar && npm run check:i18n      # every t('key') defined in en, every en key present in vi
cd f:/code/calendar && npx prettier --write <your files>
# mobile
cd f:/code/calendar/mobile && npm test          # vitest, ~1s
cd f:/code/calendar/mobile && npx tsc --noEmit  # the ONLY thing that checks mobile/lib/contract-check.ts
# unit suites (granted)
cd f:/code/calendar && npm test                 # test/ (jsdom) then test-worker/ (cloudflare pool, real D1 via miniflare)
cd f:/code/calendar && npm run test:worker
# e2e (granted) — ALWAYS setup first when a migration was added (schema + worker go stale as a PAIR)
cd f:/code/calendar && npm run test:env:setup
cd f:/code/calendar && npm run test:e2e:staging                       # whole suite
cd f:/code/calendar && npm run test:e2e:staging -- --grep "Practice"  # one spec
# changelog (stages CHANGELOG.md) — run right before the single commit
cd f:/code/calendar && node scripts/changelog.mjs "feat(practice): ..."
```

### 0.4 Traps that have each cost a real debugging cycle (do not rediscover them)

1. **`/api/*` is bearer-only.** A browser `useFetcher().load('/api/…')` gets 401 and a degrade-to-null card hides it silently. Web fetchers use cookie-authed routes (this plan: `practice-actions`, `report-extras`). Mobile uses `/api/*` with `Authorization: Bearer`.
2. **`.data` POST bodies are turbo-stream, not JSON.** In e2e never parse them; use `k.posted(path)` (status only) and assert on rendered UI.
3. **`/login` lands on the Zalo tab.** e2e uses `gotoEmailLogin`/`signInStaff`/`signInStudent` from `e2e/crud-helpers.ts`, never a raw goto+fill.
4. **Dialogs close optimistically.** Arm `const p = k.posted('/practice-actions')` BEFORE clicking submit, `await p`, then assert.
5. **Menus are portalled to `document.body`.** Use `k.pickSel(label, option)`; `exact: true` matters.
6. **`getByText` is a substring match** — pass `{ exact: true }`.
7. **Known e2e baseline failures (not yours):** `pvp.spec.ts` "room battle", `crud-feedback-profile.spec.ts` "changelog: hide", `sidebar-collapse.spec.ts` "hairline scrollbar", `crud-vocab-curriculum.spec.ts` "grade filter". The 2 zalo specs skip without `ZALO_BOT_TOKEN`. Anything else failing is yours.
8. **The Worker clock is UTC.** Never `new Date().getMonth()`/`toISOString().slice(0,10)` for "today". Use `ictDateOf(new Date().toISOString())` from `shared/logic/tests` and `ictNow(at)`/`addDaysIso` from `server/services/notify.ts`.
9. **Every tenant table query must be fenced**: reads `db.raw.select().from(t).where(db.own(t, …))`, writes `db.insert(t)` / `db.update(t, set, …)` / `db.delete(t, …)`. The tripwire `test/tenant-scope.test.ts` derives the table list from `server/db/schema.ts` (`tenantId` column) automatically — it is blind to unscoped UPDATE/DELETE, so check those by reading.
10. **`class_schedule` is DORMANT** (never written by the app). Class weekdays come from `events` (recurring rows with `class_id`), expanded with `expandEvents` from `shared/logic/recurrence.ts`.
11. **A new `/api/*` route needs three more edits** or the suites fail: `server/api/docs/registry.ts` entry, `ROUTE_FILES` in `test-worker/api-docs.test.js`, a row in `docs/api.md`. `registry.ts` may import only `zod`, `shared/schemas`, `shared/api-contract`.
12. **`shared/walkthrough.ts` has a hard story count** in `test/walkthrough.test.ts` (`27`) — bump it when adding stories (Step 37 adds 2 → `29`).
13. **`mobile/.expo/types/router.d.ts` is stale after adding a screen.** If `cd mobile && npx tsc --noEmit` complains about a route string, run `cd f:/code/calendar/mobile && npx expo start --clear` for ~40s in the background, kill it, retry.
14. **Workers Builds deploys on push;** verify the deploy by observing the new behaviour (curl a new route) not by any deploy output. **Prod D1 migration is NOT automatic** — Step 42.
15. **OTA is keyed by runtimeVersion.** After this commit `shared/version.json` says `4`; verify with the `curl … expo-runtime-version: 4` command in CLAUDE.md, never a hardcoded number. Installed phones on runtime 3 keep their old bundle until they install the new APK (accepted by the user).
16. **Git push 403?** `printf "protocol=https\nhost=github.com\n\n" | git credential fill` — if it says `tech-entag`, `printf "protocol=https\nhost=github.com\nusername=tech-entag\n\n" | git credential reject` and retry.
17. **Emulator:** boot with `-no-snapshot-load`; screenshots via `adb shell screencap -p /sdcard/s.png` + `adb pull` (PowerShell corrupts binary redirects); find tap targets with `adb shell uiautomator dump` instead of guessing coordinates; the keyboard swallows the first back press.
18. **D1 bound-parameter cap is 100** (99 usable with tenant_id). Chunk multi-row inserts with `chunk(rows, rowsPerStatement(nColumns))` from `server/db/index.ts`.

### 0.5 Working rules for the run

- Work directly on `main` (the user wants one commit on main). `git status` must be clean at Step 0.
- Every new file starts with a doc comment saying WHY it exists (house style).
- New i18n keys go in BOTH the `en` block (`const en_strings = {` … `} as const;`) and the `vi` block (`vi: {` … `} satisfies …`) of `shared/i18n/strings.ts`. Vietnamese copy is given in §5; English strings are also the e2e/walkthrough selectors — copy them exactly.
- Tick boxes in this file as you finish steps; add anything surprising to **Execution log** (bottom) with the step number.

---

## 1. Decisions (the spec) — do not re-open

| # | Area | Decision |
|---|---|---|
| 1 | Identity | New feature **Practice / Nhiệm vụ**, distinct from homework. Removes nothing (check-in "Bài tập về nhà" square and the vocab card stay). |
| 2 | Placement | Own nav row in the **Teaching** group, staff only. Route family `/practice…`. |
| 3 | Enablement | Per-class opt-in (`practice_settings` row). |
| 4 | Permissions | Any staff (`level: 'staff'`). `class_teachers` link is BACKLOG — not in this plan. |
| 5 | Practice days | Default = every weekday **Mon–Sat** that is **not** a class day; Sunday off. Class days = weekdays on which the class has a recurring `events` row (expanded over the next 14 days at enable time). Stored as a weekday mask the teacher can edit; per-date overrides (day off / extra day). |
| 6 | Deadline | End of the practice day, ICT (finalized by the 00:00 ICT cron). No per-task deadline field. |
| 7 | Assignment | Tasks are created on a class + date and **copied per enrolled student** (`class_students`). |
| 8 | Overrides | Teacher can add a task for one student only, or remove one student's copy. Editing a class task **propagates to copies with status `open`** only. Deleting a class task deletes its `open` copies; other copies keep `task_id = NULL`. |
| 9 | Authoring | Weekly grid (Mon–Sun columns) + **multi-line quick add** (one task per line). |
| 10 | Material | Optional link to the materials library (`material_id`) + optional free URL. |
| 11 | Proof type | Per task: `photo` / `video` / `either` / `none`. |
| 12 | Time | In-app start/stop timer, editable before submit; stored as ICT `HH:mm–HH:mm`. Honor system. |
| 13 | Submit | Student submits in the app. Media must finish uploading before Submit is enabled (**online-only**). Submitted before deadline = on time. |
| 14 | Review | One review queue across classes: Accept / Reject (reason) / Feedback text. Rejected → student may resubmit until the deadline. |
| 15 | Teacher-recorded | Teacher can mark a task done on a student's behalf; shows a "recorded by teacher" marker. |
| 16 | Miss unit | A practice day with ≥1 copy not in `submitted/accepted/teacher_done` at 00:00 ICT = **1 miss** (per student per class). |
| 17 | Finalize | Nightly cron at 00:00 ICT (`0 17 * * *` UTC) records yesterday's misses, writes behavior type **`missing_practice`** ("Thiếu nhiệm vụ"), pushes the penalty alert, Zalo-texts paired parents. Ledger keys prevent duplicates. |
| 18 | Excuse | Student requests **before the deadline** (reason required); teacher approves/rejects. After the deadline only a teacher can excuse (creates an approved excuse and flips the miss). |
| 19 | Quota | 3 excused misses per month **+ 1 carried** if the previous month had **zero misses of any kind** (cap 4). Nothing stored; derived. |
| 20 | Penalty | Unexcused miss → next practice day is **×N**, `N = 1 + level`, where `level` = unexcused misses since the teacher last cleared the warning. Badge only; the teacher assigns the extra work. |
| 21 | Clearing ×N | All copies on the ×N day in `submitted/accepted/teacher_done` at 00:00 ICT → pending multiplier clears (level stays). Missing the ×N day is the next miss (level+1, new ×N on the next practice day). |
| 22 | Warning | Persists until a teacher clicks **Clear warning** (level → 0). Miss history stays. |
| 23 | Months | No freeze, no close button. Entries stay editable; rejection after month end just edits the entry. |
| 24 | Pushes | Student: 20:00 ICT reminder (`0 13 * * *` UTC) when open copies remain today; penalty alert at finalize. Channel `reminders`. New pref switch `practiceReminders` (default on). |
| 25 | Parents | Zalo text on miss via `chatsForParentsOfStudents` (primary tenant only, existing rule) + portal/slip block: done/total, excused + unexcused, active warning/×N, feedback highlights. Ledger shows "No Zalo pairing" when no chat. |
| 26 | Student view | Today + upcoming 7 days with links, per-task feedback, miss balance + penalty badge. |
| 27 | Teacher on mobile | None. Web only. |
| 28 | Video | `react-native-compressor@2.0.3` (+ peer `react-native-nitro-modules`), ≤60 s / ≤50 MB after compression. Native → `runtimeVersion` 3→4, new APK. |
| 29 | Scores | **Out of scope.** No `score_components`, no test detail view. |
| 30 | Phasing | One commit containing Phases 1–3 + walkthrough; then verification (unit, e2e staging, prod migration, OTA, APK build, emulator smoke); one docs-only follow-up commit with the verification log. |

---

## 2. File map

| File | Responsibility |
|---|---|
| `migrations/0057_practice.sql` | 7 tables (create) |
| `server/db/schema.ts` | Drizzle mirrors (append) |
| `shared/schemas.ts` | Zod inputs; `missing_practice` in `BehaviorType`; `practiceReminders` in `NotifPrefsInput` |
| `shared/logic/practice.ts` | Pure rules: practice days, quota, escalation, month summary |
| `shared/logic/assess.ts` | `missing_practice` in the three behavior lists |
| `shared/api-contract.ts` | Response schemas (`.meta({ id })`) |
| `shared/live.ts` | `'practice'` mutation domain |
| `shared/i18n/strings.ts` | en + vi keys (§5) |
| `shared/walkthrough.ts` | 2 stories (Phase 4) |
| `server/services/practice.ts` | All reads/writes for the feature |
| `server/services/practice-notify.ts` | `runPracticeFinalize`, `runPracticeReminders` |
| `server/services/notify.ts` | export `deliver`; `ledgerKey.practiceMiss/practiceRemind`; two new cron branches |
| `server/services/notif-prefs.ts` | `practiceReminders` switch |
| `server/services/report-card.ts` | `practice` block for slip + parent API |
| `server/api/docs/registry.ts` | OpenAPI entries for 3 new `/api/practice/*` routes |
| `app/routes.ts` | Route registration |
| `app/routes/practice.tsx` | Landing: classes with enable toggles |
| `app/routes/practice.$classId.week.$monday.tsx` | Weekly grid page |
| `app/routes/practice.$classId.ledger.$month.tsx` | Ledger page |
| `app/routes/practice.review.tsx` | Review queue page |
| `app/routes/practice-actions.tsx` | Cookie-authed action route for ALL web mutations (`intent` dispatch) |
| `app/routes/api.practice.my.tsx` | Student: tasks + summary (GET) |
| `app/routes/api.practice.submit.tsx` | Student: multipart submit (POST) |
| `app/routes/api.practice.excuse.tsx` | Student: excuse request (POST) |
| `app/routes/practice-media.$key.tsx` | Serve proof media from R2 (auth: staff of tenant, or the owning student) |
| `app/routes/report-extras.tsx` | add `practice` to the parallel fetch |
| `src/practice/*.tsx` | Web screens (grid, review, ledger, landing) |
| `src/assessments/report-slip.tsx` | Practice card on the slip |
| `src/lib/sidebar-nav.tsx`, `src/lib/page-title.ts`, `src/lib/route-cache.ts` | nav row, titles, cache keys + `MUTATION_EFFECTS.practice` |
| `wrangler.jsonc` | two new cron strings |
| `app/routes/api.push.run.tsx` | `job=practice-finalize` / `job=practice-remind` |
| `scripts/test-accounts.sql` | `DELETE FROM` sweeps for the 7 tables |
| `docs/api.md` | 3 rows |
| `test/practice-logic.test.ts` | pure-rule tests |
| `test-worker/practice.test.js` | service + finalize job tests on real D1 |
| `test-worker/api-docs.test.js` | `ROUTE_FILES` entries |
| `test/walkthrough.test.ts` | count 27 → 29 |
| `e2e/crud-practice.spec.ts` | UI lifecycle spec |
| `mobile/lib/types.ts`, `mobile/lib/contract-check.ts`, `mobile/lib/endpoints.ts`, `mobile/lib/query.ts` | types, contract lines, endpoint fns, query keys |
| `mobile/lib/practice-timer.ts` | persisted timer + `fmtHm`/`fmtDuration` |
| `mobile/lib/use-practice.ts` | react-query hooks |
| `mobile/lib/push.ts` | `kind: 'practice'` routing |
| `mobile/app/(app)/practice/_layout.tsx`, `index.tsx`, `[id].tsx`, `excuse.tsx` | student screens |
| `mobile/app/(app)/_layout.tsx` | tab + `STUDENT_TAB_ROOTS` |
| `mobile/app/(app)/notifications.tsx` | `practiceReminders` switch |
| `mobile/test/practice-timer.test.ts`, `mobile/test/practice-endpoints.test.ts` | mobile tests |
| `mobile/package.json`, `mobile/app.config.ts`, `shared/version.json` | native deps, plugins, `runtimeVersion: 4` |
| `docs/mobile/TESTING.md` | practice rows in the manual matrix; fix "three channels" → two |
| `CHANGELOG.md` | via `scripts/changelog.mjs` |

---

## 3. Data model

### 3.1 `migrations/0057_practice.sql` (create exactly this)

```sql
-- 0057: Practice (Nhiệm vụ) — teacher-planned daily self-study tasks, copied per student, with
-- proof submissions, an excused-miss quota and an escalating penalty badge.
--
-- NOT the old homework feature: `homework` / `homework_grades` (0001/0007) are dead, unscoped and
-- deliberately untouched. Every table here carries tenant_id and an idx_*_tenant index because
-- 0045 will not rebuild them for us.
--
-- Dates are ICT 'YYYY-MM-DD'. The deadline of a practice day is the end of that day in ICT; the
-- 00:00 ICT cron (server/services/practice-notify.ts) is the only thing that decides a miss.

-- One row per class that opted in. `weekdays` is a comma list of ICT weekday numbers (0=Sun..6=Sat)
-- that are practice days by default; per-date exceptions live in practice_day_overrides.
CREATE TABLE practice_settings (
  class_id      TEXT PRIMARY KEY REFERENCES classes(id) ON DELETE CASCADE,
  tenant_id     TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  weekdays      TEXT NOT NULL DEFAULT '1,2,3,4,5,6',
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_practice_settings_tenant ON practice_settings(tenant_id);

-- A teacher's per-date decision that beats the weekday mask: 1 = practice day, 0 = day off.
CREATE TABLE practice_day_overrides (
  tenant_id     TEXT NOT NULL,
  class_id      TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  date          TEXT NOT NULL,
  is_practice   INTEGER NOT NULL,
  PRIMARY KEY (class_id, date)
);
CREATE INDEX idx_practice_day_overrides_tenant ON practice_day_overrides(tenant_id);

-- The class-level task as the teacher typed it. Copies are what students see.
CREATE TABLE practice_tasks (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  class_id      TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  date          TEXT NOT NULL,
  title         TEXT NOT NULL,
  -- SET NULL, not CASCADE: deleting a library file must not delete the task.
  material_id   TEXT REFERENCES materials(id) ON DELETE SET NULL,
  url           TEXT,
  proof_type    TEXT NOT NULL DEFAULT 'either',   -- photo | video | either | none
  sort_order    INTEGER NOT NULL DEFAULT 0,
  staff_id      TEXT REFERENCES staff(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_practice_tasks_class_date ON practice_tasks(class_id, date);
CREATE INDEX idx_practice_tasks_tenant ON practice_tasks(tenant_id);

-- One row per (student, task). task_id is NULL for a task added for one student only, and becomes
-- NULL when the class task is deleted after this copy was already submitted.
-- The submission lives on the same row: one submission per copy, a resubmit overwrites it.
CREATE TABLE practice_student_tasks (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  task_id             TEXT REFERENCES practice_tasks(id) ON DELETE SET NULL,
  class_id            TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id          TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date                TEXT NOT NULL,
  title               TEXT NOT NULL,
  material_id         TEXT REFERENCES materials(id) ON DELETE SET NULL,
  url                 TEXT,
  proof_type          TEXT NOT NULL DEFAULT 'either',
  sort_order          INTEGER NOT NULL DEFAULT 0,
  -- open | submitted | accepted | rejected | teacher_done
  status              TEXT NOT NULL DEFAULT 'open',
  submitted_at        TEXT,
  time_from           TEXT,          -- ICT HH:mm, self-reported
  time_to             TEXT,
  media_key           TEXT,          -- R2 key under t/<tenant>/practice/<id>/...
  media_type          TEXT,          -- image/jpeg | video/mp4
  note                TEXT,          -- student's question / note
  feedback            TEXT,          -- teacher's "Kết quả + Nhận xét"
  reject_reason       TEXT,
  reviewed_at         TEXT,
  reviewed_by         TEXT REFERENCES staff(id) ON DELETE SET NULL,
  recorded_by_teacher INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_practice_student_tasks_student_date ON practice_student_tasks(student_id, date);
CREATE INDEX idx_practice_student_tasks_class_date   ON practice_student_tasks(class_id, date);
CREATE INDEX idx_practice_student_tasks_status       ON practice_student_tasks(status, submitted_at);
CREATE INDEX idx_practice_student_tasks_tenant       ON practice_student_tasks(tenant_id);

-- A student's request to be excused for one practice day. Only one per (student, class, date).
CREATE TABLE practice_excuses (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  class_id      TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id    TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date          TEXT NOT NULL,
  reason        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  requested_by  TEXT NOT NULL,                      -- 'student' | 'teacher'
  requested_at  TEXT NOT NULL,
  decided_at    TEXT,
  decided_by    TEXT REFERENCES staff(id) ON DELETE SET NULL,
  UNIQUE (class_id, student_id, date)
);
CREATE INDEX idx_practice_excuses_status ON practice_excuses(status, requested_at);
CREATE INDEX idx_practice_excuses_tenant ON practice_excuses(tenant_id);

-- One row per missed practice day, written only by the nightly finalize job (or flipped to
-- excused by a teacher afterwards). `multiplier` is the ×N this miss imposed on the next day.
CREATE TABLE practice_misses (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  class_id            TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id          TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date                TEXT NOT NULL,
  excused             INTEGER NOT NULL DEFAULT 0,
  multiplier          INTEGER NOT NULL DEFAULT 0,
  behavior_record_id  TEXT,
  created_at          TEXT NOT NULL,
  UNIQUE (class_id, student_id, date)
);
CREATE INDEX idx_practice_misses_student ON practice_misses(student_id, date);
CREATE INDEX idx_practice_misses_tenant  ON practice_misses(tenant_id);

-- The lifetime escalation state per (class, student). `level` = unexcused misses since the last
-- clear; `pending_multiplier` / `pending_for_date` = the ×N currently owed and the day it is due.
CREATE TABLE practice_warnings (
  tenant_id           TEXT NOT NULL,
  class_id            TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id          TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  level               INTEGER NOT NULL DEFAULT 0,
  pending_multiplier  INTEGER NOT NULL DEFAULT 0,
  pending_for_date    TEXT,
  pending_from_miss   TEXT,
  updated_at          TEXT NOT NULL,
  cleared_at          TEXT,
  cleared_by          TEXT REFERENCES staff(id) ON DELETE SET NULL,
  PRIMARY KEY (class_id, student_id)
);
CREATE INDEX idx_practice_warnings_tenant ON practice_warnings(tenant_id);
```

### 3.2 Drizzle mirrors — append to `server/db/schema.ts`

Every table gets `tenantId: text('tenant_id').notNull()` so `test/tenant-scope.test.ts` fences it automatically. Mirror the SQL above exactly; the pattern to copy is `behaviorRecords` (`schema.ts:565`) for a keyed table and `classMaterials` (`schema.ts:303`) for a composite-PK table. Export names: `practiceSettings`, `practiceDayOverrides`, `practiceTasks`, `practiceStudentTasks`, `practiceExcuses`, `practiceMisses`, `practiceWarnings`. Boolean-ish columns use `integer('enabled', { mode: 'boolean' })` etc.

```ts
export const practiceSettings = sqliteTable(
  'practice_settings',
  {
    classId: text('class_id').primaryKey().references(() => classes.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    weekdays: text('weekdays').notNull().default('1,2,3,4,5,6'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('idx_practice_settings_tenant').on(t.tenantId)],
);

export const practiceDayOverrides = sqliteTable(
  'practice_day_overrides',
  {
    tenantId: text('tenant_id').notNull(),
    classId: text('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    isPractice: integer('is_practice', { mode: 'boolean' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.classId, t.date] }), index('idx_practice_day_overrides_tenant').on(t.tenantId)],
);

export const practiceTasks = sqliteTable(
  'practice_tasks',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    classId: text('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    title: text('title').notNull(),
    materialId: text('material_id').references(() => materials.id, { onDelete: 'set null' }),
    url: text('url'),
    proofType: text('proof_type').notNull().default('either'),
    sortOrder: integer('sort_order').notNull().default(0),
    staffId: text('staff_id').references(() => staff.id, { onDelete: 'set null' }),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('idx_practice_tasks_class_date').on(t.classId, t.date),
    index('idx_practice_tasks_tenant').on(t.tenantId),
  ],
);

export const practiceStudentTasks = sqliteTable(
  'practice_student_tasks',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    taskId: text('task_id').references(() => practiceTasks.id, { onDelete: 'set null' }),
    classId: text('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
    studentId: text('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    title: text('title').notNull(),
    materialId: text('material_id').references(() => materials.id, { onDelete: 'set null' }),
    url: text('url'),
    proofType: text('proof_type').notNull().default('either'),
    sortOrder: integer('sort_order').notNull().default(0),
    status: text('status').notNull().default('open'),
    submittedAt: text('submitted_at'),
    timeFrom: text('time_from'),
    timeTo: text('time_to'),
    mediaKey: text('media_key'),
    mediaType: text('media_type'),
    note: text('note'),
    feedback: text('feedback'),
    rejectReason: text('reject_reason'),
    reviewedAt: text('reviewed_at'),
    reviewedBy: text('reviewed_by').references(() => staff.id, { onDelete: 'set null' }),
    recordedByTeacher: integer('recorded_by_teacher', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    index('idx_practice_student_tasks_student_date').on(t.studentId, t.date),
    index('idx_practice_student_tasks_class_date').on(t.classId, t.date),
    index('idx_practice_student_tasks_status').on(t.status, t.submittedAt),
    index('idx_practice_student_tasks_tenant').on(t.tenantId),
  ],
);

export const practiceExcuses = sqliteTable(
  'practice_excuses',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    classId: text('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
    studentId: text('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('pending'),
    requestedBy: text('requested_by').notNull(),
    requestedAt: text('requested_at').notNull(),
    decidedAt: text('decided_at'),
    decidedBy: text('decided_by').references(() => staff.id, { onDelete: 'set null' }),
  },
  (t) => [
    unique('uq_practice_excuses').on(t.classId, t.studentId, t.date),
    index('idx_practice_excuses_status').on(t.status, t.requestedAt),
    index('idx_practice_excuses_tenant').on(t.tenantId),
  ],
);

export const practiceMisses = sqliteTable(
  'practice_misses',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    classId: text('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
    studentId: text('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    excused: integer('excused', { mode: 'boolean' }).notNull().default(false),
    multiplier: integer('multiplier').notNull().default(0),
    behaviorRecordId: text('behavior_record_id'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    unique('uq_practice_misses').on(t.classId, t.studentId, t.date),
    index('idx_practice_misses_student').on(t.studentId, t.date),
    index('idx_practice_misses_tenant').on(t.tenantId),
  ],
);

export const practiceWarnings = sqliteTable(
  'practice_warnings',
  {
    tenantId: text('tenant_id').notNull(),
    classId: text('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
    studentId: text('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
    level: integer('level').notNull().default(0),
    pendingMultiplier: integer('pending_multiplier').notNull().default(0),
    pendingForDate: text('pending_for_date'),
    pendingFromMiss: text('pending_from_miss'),
    updatedAt: text('updated_at').notNull(),
    clearedAt: text('cleared_at'),
    clearedBy: text('cleared_by').references(() => staff.id, { onDelete: 'set null' }),
  },
  (t) => [primaryKey({ columns: [t.classId, t.studentId] }), index('idx_practice_warnings_tenant').on(t.tenantId)],
);
```
(`unique` is imported from `drizzle-orm/sqlite-core` alongside `index`/`primaryKey`; check the file's existing import line and extend it if `unique` is missing.)

---

## 4. Shared contracts

### 4.1 `shared/schemas.ts` additions

Add `'missing_practice'` to `BehaviorType` (after `'missing_homework'`). Add to `NotifPrefsInput`:
```ts
  /** The 20:00 ICT "you still have practice tasks open today" push. On by default. */
  practiceReminders: FormBool.default(true),
```
Then append this block (near the tuition schemas, before the file's end):

```ts
// ---------------------------------------------------------------------------
// Practice (Nhiệm vụ) — docs/superpowers/plans/2026-09-03-practice-tracker.md
// ---------------------------------------------------------------------------

export const PracticeDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const PracticeProofType = z.enum(['photo', 'video', 'either', 'none']);
export type PracticeProofType = z.infer<typeof PracticeProofType>;
export const PracticeTaskStatus = z.enum(['open', 'submitted', 'accepted', 'rejected', 'teacher_done']);
export type PracticeTaskStatus = z.infer<typeof PracticeTaskStatus>;

/** Comma list of ICT weekday numbers, 0=Sun … 6=Sat, e.g. "1,3,5". */
export const PracticeWeekdays = z
  .string()
  .regex(/^([0-6](,[0-6])*)?$/, 'Expected weekday numbers 0-6 separated by commas');

export const PracticeSettingsInput = z.object({
  classId: z.string().min(1),
  enabled: FormBool.default(true),
  weekdays: PracticeWeekdays.default('1,2,3,4,5,6'),
});
export type PracticeSettingsInput = z.infer<typeof PracticeSettingsInput>;

export const PracticeDayOverrideInput = z.object({
  classId: z.string().min(1),
  date: PracticeDate,
  /** true = force a practice day, false = day off; null removes the override. */
  isPractice: z.union([FormBool, z.null()]),
});
export type PracticeDayOverrideInput = z.infer<typeof PracticeDayOverrideInput>;

export const PracticeTaskInput = z.object({
  classId: z.string().min(1),
  date: PracticeDate,
  title: z.string().trim().min(1).max(500),
  materialId: z.string().nullish(),
  url: z.string().trim().url().max(2000).nullish().or(z.literal('').transform(() => null)),
  proofType: PracticeProofType.default('either'),
  /** When set, the task is created for this student only (no class-level row). */
  studentId: z.string().nullish(),
});
export type PracticeTaskInput = z.infer<typeof PracticeTaskInput>;

/** Multi-line quick add: one task per non-empty line, all sharing material + proof type. */
export const PracticeQuickAddInput = z.object({
  classId: z.string().min(1),
  date: PracticeDate,
  lines: z.string().min(1).max(10_000),
  materialId: z.string().nullish(),
  proofType: PracticeProofType.default('either'),
});
export type PracticeQuickAddInput = z.infer<typeof PracticeQuickAddInput>;

export const PracticeReviewInput = z.object({
  studentTaskId: z.string().min(1),
  decision: z.enum(['accept', 'reject', 'feedback', 'teacher_done']),
  feedback: z.string().trim().max(4000).nullish(),
  rejectReason: z.string().trim().max(1000).nullish(),
});
export type PracticeReviewInput = z.infer<typeof PracticeReviewInput>;

export const PracticeExcuseRequestInput = z.object({
  classId: z.string().min(1),
  date: PracticeDate,
  reason: z.string().trim().min(1).max(1000),
});
export type PracticeExcuseRequestInput = z.infer<typeof PracticeExcuseRequestInput>;

export const PracticeExcuseDecideInput = z.object({
  excuseId: z.string().min(1),
  decision: z.enum(['approve', 'reject']),
});
export type PracticeExcuseDecideInput = z.infer<typeof PracticeExcuseDecideInput>;

/** Teacher excuses a miss after the fact (creates an approved excuse and flips the miss). */
export const PracticeExcuseMissInput = z.object({
  missId: z.string().min(1),
  reason: z.string().trim().max(1000).default('Teacher excused'),
});
export type PracticeExcuseMissInput = z.infer<typeof PracticeExcuseMissInput>;

export const PracticeClearWarningInput = z.object({
  classId: z.string().min(1),
  studentId: z.string().min(1),
});
export type PracticeClearWarningInput = z.infer<typeof PracticeClearWarningInput>;

/** Student submit (multipart; the file arrives as form field `file`, validated in the route). */
export const PracticeSubmitInput = z.object({
  studentTaskId: z.string().min(1),
  timeFrom: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  timeTo: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  note: z.string().trim().max(2000).nullish(),
});
export type PracticeSubmitInput = z.infer<typeof PracticeSubmitInput>;
```

### 4.2 `shared/logic/assess.ts`

Add `'missing_practice'` to `BEHAVIOR_TYPES` and `NEGATIVE_TYPES` (after `missing_homework`) and to `BEHAVIOR_META`: `missing_practice: { tk: 'bh_missing_practice', color: 'blue' }` (all six `ColorId`s are taken; `blue` is the least-loaded).

### 4.3 `shared/logic/practice.ts` — pure rules (create in full)

```ts
/**
 * Practice (Nhiệm vụ) rules shared by the Worker, the web and the phone.
 *
 * Everything here is a pure function over plain data so the nightly cron, the ledger page and the
 * student's badge cannot disagree about what a miss costs. No Date arithmetic leaks in except
 * through `dates.ts` helpers; dates are ICT 'YYYY-MM-DD' strings throughout.
 */
import { addDays, iso, parseISO } from './dates';
import { expandEvents, type RecurringEvent } from './recurrence';

export const EXCUSED_BASE_QUOTA = 3;
export const EXCUSED_CARRY_CAP = 1;
export const VIDEO_MAX_SECONDS = 60;
export const MEDIA_MAX_BYTES = 50 * 1024 * 1024;

export type PracticeSettingsLike = { enabled: boolean; weekdays: string };
export type DayOverrideLike = { date: string; isPractice: boolean };

/** "1,3,5" → Set{1,3,5}. Tolerates blanks. */
export function parseWeekdays(mask: string): Set<number> {
  return new Set(
    mask
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
  );
}

export function formatWeekdays(days: Iterable<number>): string {
  return [...new Set(days)].sort((a, b) => a - b).join(',');
}

/** ICT weekday of a 'YYYY-MM-DD' string; the date is a calendar day so no timezone math applies. */
export function weekdayOf(date: string): number {
  return parseISO(date).getDay();
}

/** Override wins; otherwise the weekday mask. A disabled class never has practice days. */
export function isPracticeDay(
  settings: PracticeSettingsLike | null | undefined,
  overrides: readonly DayOverrideLike[],
  date: string,
): boolean {
  if (!settings || !settings.enabled) return false;
  const ov = overrides.find((o) => o.date === date);
  if (ov) return ov.isPractice;
  return parseWeekdays(settings.weekdays).has(weekdayOf(date));
}

/** Every practice day in [from, to] inclusive. */
export function practiceDaysInRange(
  settings: PracticeSettingsLike | null | undefined,
  overrides: readonly DayOverrideLike[],
  from: string,
  to: string,
): string[] {
  const out: string[] = [];
  let d = parseISO(from);
  const end = parseISO(to);
  while (d <= end) {
    const day = iso(d);
    if (isPracticeDay(settings, overrides, day)) out.push(day);
    d = addDays(d, 1);
  }
  return out;
}

/** First practice day strictly after `date`, searching up to 60 days ahead; null if none. */
export function nextPracticeDay(
  settings: PracticeSettingsLike | null | undefined,
  overrides: readonly DayOverrideLike[],
  date: string,
): string | null {
  let d = addDays(parseISO(date), 1);
  for (let i = 0; i < 60; i++) {
    const day = iso(d);
    if (isPracticeDay(settings, overrides, day)) return day;
    d = addDays(d, 1);
  }
  return null;
}

/**
 * Default mask when a class opts in: Mon–Sat minus the weekdays the class meets (derived from its
 * recurring events over the next 14 days). Sunday is never a default practice day (the sheet's
 * DAY OFF). A class with no events keeps all six.
 */
export function defaultWeekdaysFromEvents(events: readonly RecurringEvent[], fromDate: string): string {
  const start = parseISO(fromDate);
  const classDays = new Set(expandEvents([...events], start, addDays(start, 13)).map((e) => weekdayOf(e.date)));
  const days: number[] = [];
  for (let wd = 1; wd <= 6; wd++) if (!classDays.has(wd)) days.push(wd);
  return formatWeekdays(days);
}

export type MissLike = { date: string; excused: boolean };

/** 'YYYY-MM' of a date string. */
export const monthOf = (date: string): string => date.slice(0, 7);

/** Previous month of a 'YYYY-MM'. */
export function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * Excused quota for `month`: 3, plus 1 carried when the previous month had zero misses of ANY kind
 * (excused misses spoil it too — the sheet's literal rule) and the class actually had ≥1 practice
 * day that month (an unenrolled or disabled month earns nothing).
 */
export function excusedQuota(
  month: string,
  misses: readonly MissLike[],
  prevMonthHadPracticeDays: boolean,
): number {
  const prev = prevMonth(month);
  const prevMisses = misses.filter((m) => monthOf(m.date) === prev).length;
  const carry = prevMonthHadPracticeDays && prevMisses === 0 ? EXCUSED_CARRY_CAP : 0;
  return EXCUSED_BASE_QUOTA + carry;
}

export type WarningLike = {
  level: number;
  pendingMultiplier: number;
  pendingForDate: string | null;
  pendingFromMiss: string | null;
};

export const EMPTY_WARNING: WarningLike = {
  level: 0,
  pendingMultiplier: 0,
  pendingForDate: null,
  pendingFromMiss: null,
};

/** An unexcused miss: level +1, and the next practice day owes ×(1 + level). */
export function applyUnexcusedMiss(w: WarningLike, missId: string, nextDay: string | null): WarningLike {
  const level = w.level + 1;
  return { level, pendingMultiplier: 1 + level, pendingForDate: nextDay, pendingFromMiss: missId };
}

/** The ×N day was fully submitted: the debt clears, the level (and the warning) stay. */
export function clearPending(w: WarningLike): WarningLike {
  return { ...w, pendingMultiplier: 0, pendingForDate: null, pendingFromMiss: null };
}

/** Teacher excused a miss after the fact: undo its level step; drop its pending ×N if it is the one owed. */
export function undoMiss(w: WarningLike, missId: string): WarningLike {
  const level = Math.max(0, w.level - 1);
  const base = { ...w, level };
  return w.pendingFromMiss === missId ? clearPending(base) : base;
}

/** Teacher cleared the warning: everything resets. */
export function clearWarning(): WarningLike {
  return { ...EMPTY_WARNING };
}

export type StudentTaskLike = { date: string; status: string };

export const DONE_STATUSES: ReadonlySet<string> = new Set(['submitted', 'accepted', 'teacher_done']);

/** Did the student finish the day? Every copy on that date must be in a done status. */
export function dayIsComplete(tasks: readonly StudentTaskLike[], date: string): boolean {
  const onDay = tasks.filter((t) => t.date === date);
  return onDay.length > 0 && onDay.every((t) => DONE_STATUSES.has(t.status));
}

export type MonthSummary = {
  month: string;
  doneTasks: number;
  totalTasks: number;
  excusedUsed: number;
  excusedQuota: number;
  unexcused: number;
  level: number;
  pendingMultiplier: number;
  pendingForDate: string | null;
};

export function monthSummary(
  month: string,
  tasks: readonly StudentTaskLike[],
  misses: readonly MissLike[],
  warning: WarningLike,
  prevMonthHadPracticeDays: boolean,
): MonthSummary {
  const inMonth = tasks.filter((t) => monthOf(t.date) === month);
  const monthMisses = misses.filter((m) => monthOf(m.date) === month);
  return {
    month,
    doneTasks: inMonth.filter((t) => DONE_STATUSES.has(t.status)).length,
    totalTasks: inMonth.length,
    excusedUsed: monthMisses.filter((m) => m.excused).length,
    excusedQuota: excusedQuota(month, misses, prevMonthHadPracticeDays),
    unexcused: monthMisses.filter((m) => !m.excused).length,
    level: warning.level,
    pendingMultiplier: warning.pendingMultiplier,
    pendingForDate: warning.pendingForDate,
  };
}

/** Quick-add parsing: one task per non-empty line, trimmed, capped at 40 lines. */
export function parseQuickAddLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((l) => l.length > 0)
    .slice(0, 40);
}
```

### 4.4 `test/practice-logic.test.ts` (create in full; run with `npm test` later)

```ts
import { describe, it, expect } from 'vitest';
import {
  applyUnexcusedMiss,
  clearPending,
  dayIsComplete,
  defaultWeekdaysFromEvents,
  EMPTY_WARNING,
  excusedQuota,
  isPracticeDay,
  monthSummary,
  nextPracticeDay,
  parseQuickAddLines,
  parseWeekdays,
  practiceDaysInRange,
  undoMiss,
} from '../shared/logic/practice';

/**
 * The practice rules came from a real teacher's sheet and several are counter-intuitive on
 * purpose: an EXCUSED miss still spoils the "clean month" credit, and the escalation level never
 * resets by itself. These tests pin each rule so a future "fix" cannot quietly soften them.
 */
describe('practice — days', () => {
  const settings = { enabled: true, weekdays: '1,3,5,6' }; // Mon Wed Fri Sat

  it('parses and honours the weekday mask', () => {
    expect([...parseWeekdays('1,3,5,6')]).toEqual([1, 3, 5, 6]);
    expect(isPracticeDay(settings, [], '2031-03-03')).toBe(true); // Monday
    expect(isPracticeDay(settings, [], '2031-03-04')).toBe(false); // Tuesday
    expect(isPracticeDay(settings, [], '2031-03-09')).toBe(false); // Sunday
  });

  it('an override beats the mask in both directions', () => {
    expect(isPracticeDay(settings, [{ date: '2031-03-03', isPractice: false }], '2031-03-03')).toBe(false);
    expect(isPracticeDay(settings, [{ date: '2031-03-04', isPractice: true }], '2031-03-04')).toBe(true);
  });

  it('a disabled class has no practice days', () => {
    expect(isPracticeDay({ enabled: false, weekdays: '1,2,3,4,5,6' }, [], '2031-03-03')).toBe(false);
  });

  it('lists and finds the next practice day', () => {
    expect(practiceDaysInRange(settings, [], '2031-03-03', '2031-03-09')).toEqual([
      '2031-03-03', '2031-03-05', '2031-03-07', '2031-03-08',
    ]);
    expect(nextPracticeDay(settings, [], '2031-03-03')).toBe('2031-03-05');
    expect(nextPracticeDay({ enabled: true, weekdays: '' }, [], '2031-03-03')).toBe(null);
  });

  it('defaults to Mon–Sat minus the class weekdays, Sunday never', () => {
    // Class meets Tue + Thu (weekly from a Tuesday).
    const events = [
      { date: '2031-03-04', recurrence: 'weekly' },
      { date: '2031-03-06', recurrence: 'weekly' },
    ];
    expect(defaultWeekdaysFromEvents(events, '2031-03-03')).toBe('1,3,5,6');
    expect(defaultWeekdaysFromEvents([], '2031-03-03')).toBe('1,2,3,4,5,6');
  });
});

describe('practice — quota', () => {
  it('is 3, plus 1 carried only after a month with zero misses of any kind', () => {
    expect(excusedQuota('2031-04', [], true)).toBe(4);
    expect(excusedQuota('2031-04', [], false)).toBe(3); // no practice days last month → nothing to carry
    expect(excusedQuota('2031-04', [{ date: '2031-03-10', excused: true }], true)).toBe(3); // excused still spoils it
    expect(excusedQuota('2031-04', [{ date: '2031-03-10', excused: false }], true)).toBe(3);
    expect(excusedQuota('2031-04', [{ date: '2031-02-10', excused: false }], true)).toBe(4); // two months back is irrelevant
  });
});

describe('practice — escalation', () => {
  it('first miss owes ×2, second ×3, and clearing the day keeps the level', () => {
    const w1 = applyUnexcusedMiss(EMPTY_WARNING, 'm1', '2031-03-05');
    expect(w1).toEqual({ level: 1, pendingMultiplier: 2, pendingForDate: '2031-03-05', pendingFromMiss: 'm1' });
    const cleared = clearPending(w1);
    expect(cleared.level).toBe(1);
    expect(cleared.pendingMultiplier).toBe(0);
    const w2 = applyUnexcusedMiss(cleared, 'm2', '2031-03-12');
    expect(w2.pendingMultiplier).toBe(3);
  });

  it('missing the ×N day itself escalates again', () => {
    const w1 = applyUnexcusedMiss(EMPTY_WARNING, 'm1', '2031-03-05');
    const w2 = applyUnexcusedMiss(w1, 'm2', '2031-03-07');
    expect(w2).toEqual({ level: 2, pendingMultiplier: 3, pendingForDate: '2031-03-07', pendingFromMiss: 'm2' });
  });

  it('excusing a miss after the fact undoes its step and its pending debt', () => {
    const w1 = applyUnexcusedMiss(EMPTY_WARNING, 'm1', '2031-03-05');
    expect(undoMiss(w1, 'm1')).toEqual(EMPTY_WARNING);
    const w2 = applyUnexcusedMiss(w1, 'm2', '2031-03-07');
    // Excusing the OLDER miss lowers the level but leaves the newer debt in place.
    expect(undoMiss(w2, 'm1')).toEqual({ level: 1, pendingMultiplier: 3, pendingForDate: '2031-03-07', pendingFromMiss: 'm2' });
  });
});

describe('practice — completion and summary', () => {
  const tasks = [
    { date: '2031-03-03', status: 'accepted' },
    { date: '2031-03-03', status: 'submitted' },
    { date: '2031-03-05', status: 'open' },
    { date: '2031-03-05', status: 'teacher_done' },
  ];
  it('a day is complete only when every copy is done', () => {
    expect(dayIsComplete(tasks, '2031-03-03')).toBe(true);
    expect(dayIsComplete(tasks, '2031-03-05')).toBe(false);
    expect(dayIsComplete(tasks, '2031-03-06')).toBe(false); // no tasks → not complete (caller decides it is not a miss either)
  });
  it('summarises a month', () => {
    const s = monthSummary('2031-03', tasks, [{ date: '2031-03-05', excused: false }], EMPTY_WARNING, false);
    expect(s).toMatchObject({ doneTasks: 3, totalTasks: 4, excusedUsed: 0, excusedQuota: 3, unexcused: 1 });
  });
  it('quick add strips bullets and numbering', () => {
    expect(parseQuickAddLines('1. Workbook p.4-7\n- Grammar in Use unit 4\n\n• Quizlet unit 11')).toEqual([
      'Workbook p.4-7', 'Grammar in Use unit 4', 'Quizlet unit 11',
    ]);
  });
});
```

### 4.5 `shared/api-contract.ts` additions (append; every export gets `.meta({ id })` = its name)

```ts
export const PracticeStudentTask = z
  .object({
    id: z.string(),
    classId: z.string(),
    className: z.string(),
    date: z.string(),
    title: z.string(),
    materialId: Nullable(z.string()),
    materialTitle: Nullable(z.string()),
    url: Nullable(z.string()),
    proofType: z.enum(['photo', 'video', 'either', 'none']),
    status: z.enum(['open', 'submitted', 'accepted', 'rejected', 'teacher_done']),
    submittedAt: Nullable(z.string()),
    timeFrom: Nullable(z.string()),
    timeTo: Nullable(z.string()),
    /** Same-origin path to the proof, e.g. /practice-media/<key>; null until submitted. */
    mediaPath: Nullable(z.string()),
    mediaType: Nullable(z.string()),
    note: Nullable(z.string()),
    feedback: Nullable(z.string()),
    rejectReason: Nullable(z.string()),
    recordedByTeacher: z.boolean(),
  })
  .meta({ id: 'PracticeStudentTask' });

export const PracticeMonthSummary = z
  .object({
    month: z.string(),
    doneTasks: z.number().int(),
    totalTasks: z.number().int(),
    excusedUsed: z.number().int(),
    excusedQuota: z.number().int(),
    unexcused: z.number().int(),
    level: z.number().int(),
    pendingMultiplier: z.number().int(),
    pendingForDate: Nullable(z.string()),
  })
  .meta({ id: 'PracticeMonthSummary' });

export const PracticeExcuse = z
  .object({
    id: z.string(),
    classId: z.string(),
    date: z.string(),
    reason: z.string(),
    status: z.enum(['pending', 'approved', 'rejected']),
    requestedAt: z.string(),
  })
  .meta({ id: 'PracticeExcuse' });

/** GET /api/practice/my — computed against the server clock, hence `serverNow`/`todayIct`. */
export const PracticeMyResponse = z
  .object({
    serverNow: z.string(),
    todayIct: z.string(),
    /** Per enrolled class with Practice enabled. */
    classes: z.array(
      z.object({
        classId: z.string(),
        className: z.string(),
        /** Practice days in [today, today+7]. */
        practiceDays: z.array(z.string()),
        summary: PracticeMonthSummary,
        excuses: z.array(PracticeExcuse),
      }),
    ),
    /** Tasks dated today … today+7, plus yesterday's still-open ones for context. */
    tasks: z.array(PracticeStudentTask),
  })
  .meta({ id: 'PracticeMyResponse' });

export const PracticeSubmitResponse = PracticeStudentTask;
```
Also extend `ParentReportResponse` with
```ts
    /** Null when the student is in no Practice-enabled class. */
    practice: Nullable(
      z.object({
        summary: PracticeMonthSummary,
        /** Up to 5 most recent non-empty teacher feedback lines this month. */
        feedback: z.array(z.object({ date: z.string(), title: z.string(), feedback: z.string() })),
      }),
    ),
```

---

## 5. i18n keys (add every row to BOTH blocks of `shared/i18n/strings.ts`)

English strings are load-bearing: e2e and walkthrough target them literally. Do not paraphrase.

| key | en | vi |
|---|---|---|
| `nav_practice` | Practice | Nhiệm vụ |
| `bh_missing_practice` | Missed practice | Thiếu nhiệm vụ |
| `pr_title` | Practice | Nhiệm vụ |
| `pr_sub` | Daily self-study tasks per class, proof from the phone, misses and penalties | Nhiệm vụ tự học hằng ngày theo lớp, minh chứng từ điện thoại, thiếu bài và phạt |
| `pr_enable` | Enable Practice | Bật Nhiệm vụ |
| `pr_disable` | Disable Practice | Tắt Nhiệm vụ |
| `pr_enabled_badge` | Practice on | Đang bật |
| `pr_open_week` | Open week | Mở tuần |
| `pr_open_ledger` | Open ledger | Mở sổ theo dõi |
| `pr_review_queue` | Review queue | Hàng chờ duyệt |
| `pr_weekdays` | Practice weekdays | Ngày làm nhiệm vụ |
| `pr_weekdays_help` | Defaults to Mon–Sat minus the days this class meets. Sunday is off. | Mặc định Thứ 2–Thứ 7 trừ ngày lớp học. Chủ nhật nghỉ. |
| `pr_day_off` | Day off | Ngày nghỉ |
| `pr_make_practice_day` | Make practice day | Đặt là ngày nhiệm vụ |
| `pr_remove_override` | Use weekly default | Dùng mặc định tuần |
| `pr_add_tasks` | Add tasks | Thêm nhiệm vụ |
| `pr_add_task_for` | Add task for one student | Thêm nhiệm vụ cho một học sinh |
| `pr_lines` | Tasks (one per line) | Nhiệm vụ (mỗi dòng một việc) |
| `pr_lines_ph` | Workbook Prepare p.4-7\nGrammar in Use unit 4\nRecord a 1-minute self-introduction | Workbook Prepare trang 4-7\nGrammar in Use unit 4\nQuay video giới thiệu bản thân 1 phút |
| `pr_material` | Material | Tài liệu |
| `pr_material_none` | No material | Không có tài liệu |
| `pr_url` | Link | Liên kết |
| `pr_proof` | Proof | Minh chứng |
| `pr_proof_photo` | Photo | Ảnh |
| `pr_proof_video` | Video | Video |
| `pr_proof_either` | Photo or video | Ảnh hoặc video |
| `pr_proof_none` | No proof needed | Không cần minh chứng |
| `pr_student` | Student | Học sinh |
| `pr_task_title` | Task | Nhiệm vụ |
| `pr_edit_task` | Edit task | Sửa nhiệm vụ |
| `pr_delete_task` | Delete task | Xoá nhiệm vụ |
| `pr_delete_task_confirm` | Delete this task? Students who already submitted keep their copy. | Xoá nhiệm vụ này? Học sinh đã nộp vẫn giữ bản của mình. |
| `pr_students_on_day` | Students on this day | Học sinh trong ngày |
| `pr_remove_copy` | Remove for this student | Bỏ cho học sinh này |
| `pr_mark_done` | Mark done | Đánh dấu đã làm |
| `pr_recorded_by_teacher` | Recorded by teacher | Giáo viên ghi nhận |
| `pr_status_open` | Open | Chưa nộp |
| `pr_status_submitted` | Submitted | Đã nộp |
| `pr_status_accepted` | Accepted | Đã duyệt |
| `pr_status_rejected` | Rejected | Bị từ chối |
| `pr_status_teacher_done` | Done (teacher) | Đã làm (GV) |
| `pr_accept` | Accept | Duyệt |
| `pr_reject` | Reject | Từ chối |
| `pr_reject_reason` | Reason | Lý do |
| `pr_feedback` | Feedback | Nhận xét |
| `pr_save_feedback` | Save feedback | Lưu nhận xét |
| `pr_queue_empty` | Nothing to review | Không có gì cần duyệt |
| `pr_excuses_pending` | Excuse requests | Đơn xin phép |
| `pr_approve` | Approve | Chấp nhận |
| `pr_time` | Time | Thời gian |
| `pr_note` | Student note | Ghi chú của học sinh |
| `pr_ledger` | Ledger | Sổ theo dõi |
| `pr_done_total` | Done / total | Đã làm / tổng |
| `pr_excused` | Excused | Có phép |
| `pr_unexcused` | Unexcused | Không phép |
| `pr_penalty_badge` | ×{n} on {date} | ×{n} ngày {date} |
| `pr_warning_level` | Warning level {n} | Mức cảnh báo {n} |
| `pr_clear_warning` | Clear warning | Xoá cảnh báo |
| `pr_clear_warning_confirm` | Reset this student's escalation to zero? Miss history is kept. | Đặt lại mức cảnh báo về 0? Lịch sử thiếu bài vẫn giữ. |
| `pr_excuse_miss` | Mark excused | Đánh dấu có phép |
| `pr_no_zalo` | No Zalo pairing | Chưa liên kết Zalo |
| `pr_misses` | Misses | Thiếu bài |
| `pr_week_prev` | Previous week | Tuần trước |
| `pr_week_next` | Next week | Tuần sau |
| `pr_this_week` | This week | Tuần này |
| `pr_no_tasks_day` | No tasks | Chưa có nhiệm vụ |
| `pr_not_enabled` | Practice is off for this class. | Lớp này chưa bật Nhiệm vụ. |
| `pr_pick_class` | Pick a class | Chọn lớp |
| `pr_slip_title` | Practice (Nhiệm vụ) | Nhiệm vụ tự học |
| `pr_slip_done` | {done}/{total} tasks done | Hoàn thành {done}/{total} nhiệm vụ |
| `pr_slip_misses` | {excused} excused, {unexcused} unexcused | {excused} có phép, {unexcused} không phép |
| `pr_slip_warning` | Active warning: level {n} | Đang cảnh báo: mức {n} |
| `notif_practice_reminders` | Practice reminders | Nhắc nhiệm vụ |
| `notif_practice_reminders_sub` | 20:00 nudge when today's practice is not submitted, and penalty alerts | Nhắc lúc 20:00 nếu chưa nộp nhiệm vụ hôm nay, và cảnh báo phạt |
| `m_pr_tab` | Practice | Nhiệm vụ |
| `m_pr_today` | Today | Hôm nay |
| `m_pr_upcoming` | Upcoming | Sắp tới |
| `m_pr_empty` | No practice tasks yet | Chưa có nhiệm vụ |
| `m_pr_deadline` | Due tonight (00:00) | Hạn đêm nay (00:00) |
| `m_pr_start_timer` | Start timer | Bắt đầu tính giờ |
| `m_pr_stop_timer` | Stop timer | Dừng tính giờ |
| `m_pr_time_range` | Time worked | Thời gian làm |
| `m_pr_edit_time` | Edit | Sửa |
| `m_pr_add_photo` | Add photo | Thêm ảnh |
| `m_pr_take_photo` | Take photo | Chụp ảnh |
| `m_pr_add_video` | Add video | Thêm video |
| `m_pr_uploading` | Uploading… {pct}% | Đang tải… {pct}% |
| `m_pr_compressing` | Compressing video… | Đang nén video… |
| `m_pr_submit` | Submit | Nộp |
| `m_pr_resubmit` | Resubmit | Nộp lại |
| `m_pr_submitted` | Submitted | Đã nộp |
| `m_pr_note_ph` | Anything to ask the teacher? | Có gì muốn hỏi giáo viên? |
| `m_pr_feedback` | Teacher feedback | Nhận xét của giáo viên |
| `m_pr_rejected` | Rejected: {reason} | Bị từ chối: {reason} |
| `m_pr_balance` | Excused {used}/{quota} · Unexcused {unexcused} | Có phép {used}/{quota} · Không phép {unexcused} |
| `m_pr_penalty` | ×{n} practice on {date} | Nhiệm vụ ×{n} ngày {date} |
| `m_pr_warning` | Warning level {n} | Mức cảnh báo {n} |
| `m_pr_request_excuse` | Request excuse | Xin phép |
| `m_pr_excuse_reason` | Reason | Lý do |
| `m_pr_excuse_sent` | Request sent | Đã gửi đơn |
| `m_pr_excuse_late` | The deadline has passed — only your teacher can excuse this day now. | Đã quá hạn — chỉ giáo viên mới có thể cho phép ngày này. |
| `m_pr_excuse_pending` | Excuse pending | Đang chờ duyệt phép |
| `m_pr_excuse_approved` | Excused | Đã được phép |
| `m_pr_excuse_rejected` | Excuse rejected | Đơn bị từ chối |
| `m_pr_video_too_long` | Video must be 60 seconds or shorter | Video phải dưới 60 giây |
| `m_pr_file_too_big` | File is too large (max 50 MB) | Tệp quá lớn (tối đa 50 MB) |
| `m_pr_need_proof` | This task needs a {kind} before you can submit | Nhiệm vụ này cần {kind} trước khi nộp |
| `m_pr_offline` | You are offline — connect to submit | Bạn đang offline — hãy kết nối để nộp |
| `push_pr_remind_title` | Practice due tonight | Nhiệm vụ hạn đêm nay |
| `push_pr_remind_body` | {n} task(s) still open — submit before 00:00 | Còn {n} nhiệm vụ chưa nộp — nộp trước 00:00 |
| `push_pr_penalty_title` | Missed practice | Thiếu nhiệm vụ |
| `push_pr_penalty_body` | Yesterday counts as a miss. Practice on {date} is ×{n}. | Hôm qua tính là thiếu bài. Nhiệm vụ ngày {date} nhân ×{n}. |
| `zalo_pr_miss` | [Mochi] {student} missed practice on {date} ({kind}). Excused used this month: {used}/{quota}. | [Mochi] {student} thiếu nhiệm vụ ngày {date} ({kind}). Phép đã dùng tháng này: {used}/{quota}. |
| `zalo_pr_kind_excused` | excused | có phép |
| `zalo_pr_kind_unexcused` | unexcused, next practice ×{n} | không phép, nhiệm vụ tới ×{n} |

Interpolation follows the file's existing `{name}` convention (check how `rslip_homework_done` is used before writing the first `t(key, params)` call, and copy that call shape).

---

## 6. Server service — `server/services/practice.ts` (create in full)

Read first: `server/services/class-materials.ts` (whole file), `server/services/classes.ts:80-230`, `server/services/assessments.ts:133-205`, `server/services/audit.ts:400-450`, `server/services/materials.ts:38-70`, `server/db/tenant.ts` (whole file).

```ts
/**
 * Practice (Nhiệm vụ): the teacher's daily task plan per class, the per-student copies students
 * submit against, and the miss economy (excuses, quota, escalating ×N badge).
 *
 * Rules live in shared/logic/practice.ts. This module is the only writer of the practice_* tables;
 * the nightly finalize job in practice-notify.ts calls into it and never touches rows directly.
 * Dates are ICT 'YYYY-MM-DD'; the caller supplies "today" (the Worker clock is UTC).
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { TenantDb } from '../db/tenant';
import { chunk, rowsPerStatement } from '../db/index';
import {
  behaviorRecords,
  classes,
  classStudents,
  events,
  materials,
  practiceDayOverrides,
  practiceExcuses,
  practiceMisses,
  practiceSettings,
  practiceStudentTasks,
  practiceTasks,
  practiceWarnings,
  students,
} from '../db/schema';
import { record, recordCreate, recordDelete } from './audit';
import * as classesSvc from './classes';
import {
  applyUnexcusedMiss,
  clearPending,
  clearWarning,
  dayIsComplete,
  defaultWeekdaysFromEvents,
  DONE_STATUSES,
  EMPTY_WARNING,
  isPracticeDay,
  monthSummary,
  nextPracticeDay,
  parseQuickAddLines,
  practiceDaysInRange,
  prevMonth,
  undoMiss,
  type MonthSummary,
  type WarningLike,
} from '../../shared/logic/practice';
import type {
  PracticeDayOverrideInput,
  PracticeExcuseDecideInput,
  PracticeExcuseMissInput,
  PracticeExcuseRequestInput,
  PracticeQuickAddInput,
  PracticeReviewInput,
  PracticeSettingsInput,
  PracticeSubmitInput,
  PracticeTaskInput,
} from '../../shared/schemas';

// ---------------------------------------------------------------------------
// Row types (the web loaders and the API return these)
// ---------------------------------------------------------------------------

export type PracticeSettingsRow = { classId: string; enabled: boolean; weekdays: string };
export type DayOverrideRow = { date: string; isPractice: boolean };
export type PracticeTaskRow = {
  id: string; classId: string; date: string; title: string; materialId: string | null;
  url: string | null; proofType: string; sortOrder: number;
};
export type StudentTaskRow = {
  id: string; taskId: string | null; classId: string; studentId: string; date: string; title: string;
  materialId: string | null; url: string | null; proofType: string; sortOrder: number; status: string;
  submittedAt: string | null; timeFrom: string | null; timeTo: string | null; mediaKey: string | null;
  mediaType: string | null; note: string | null; feedback: string | null; rejectReason: string | null;
  reviewedAt: string | null; reviewedBy: string | null; recordedByTeacher: boolean;
};
export type ExcuseRow = {
  id: string; classId: string; studentId: string; date: string; reason: string; status: string;
  requestedBy: string; requestedAt: string; decidedAt: string | null; decidedBy: string | null;
};
export type MissRow = {
  id: string; classId: string; studentId: string; date: string; excused: boolean; multiplier: number;
  behaviorRecordId: string | null; createdAt: string;
};
export type WarningRow = WarningLike & { classId: string; studentId: string; clearedAt: string | null };

const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Settings + practice days
// ---------------------------------------------------------------------------

export async function listSettings(db: TenantDb): Promise<PracticeSettingsRow[]> {
  const rows = await db.raw.select().from(practiceSettings).where(db.own(practiceSettings));
  return rows.map((r) => ({ classId: r.classId, enabled: r.enabled, weekdays: r.weekdays }));
}

export async function getSettings(db: TenantDb, classId: string): Promise<PracticeSettingsRow | null> {
  const [r] = await db.raw
    .select()
    .from(practiceSettings)
    .where(db.own(practiceSettings, eq(practiceSettings.classId, classId)));
  return r ? { classId: r.classId, enabled: r.enabled, weekdays: r.weekdays } : null;
}

/**
 * Enable (or re-save) Practice for a class. On FIRST enable with no explicit weekdays the mask is
 * derived from the class's recurring events (Mon–Sat minus class days) — see shared/logic.
 */
export async function saveSettings(
  db: TenantDb,
  input: PracticeSettingsInput,
  todayIct: string,
  explicitWeekdays: boolean,
): Promise<PracticeSettingsRow> {
  const existing = await getSettings(db, input.classId);
  let weekdays = input.weekdays;
  if (!existing && !explicitWeekdays) {
    const evs = await db.raw
      .select({ date: events.date, recurrence: events.recurrence, until: events.until, exdates: events.exdates })
      .from(events)
      .where(db.own(events, eq(events.classId, input.classId)));
    weekdays = defaultWeekdaysFromEvents(
      evs.map((e) => ({ ...e, exdates: e.exdates ? (JSON.parse(e.exdates) as string[]) : null })),
      todayIct,
    );
  }
  if (existing) {
    await db.update(practiceSettings, { enabled: input.enabled, weekdays }, eq(practiceSettings.classId, input.classId));
  } else {
    await db.insert(practiceSettings).values({ classId: input.classId, enabled: input.enabled, weekdays, createdAt: nowIso() });
    recordCreate('practice_settings', input.classId, { ...input, weekdays });
  }
  return { classId: input.classId, enabled: input.enabled, weekdays };
}
```
> **Check before writing:** open `server/db/schema.ts` and confirm the `events` table's `until` and `exdates` column names and whether `exdates` is stored as JSON text (grep `exdates`). If `exdates` is already typed as an array via a Drizzle `{ mode: 'json' }`, drop the `JSON.parse`. Do not guess — read it.

```ts
export async function listOverrides(db: TenantDb, classId: string, from: string, to: string): Promise<DayOverrideRow[]> {
  const rows = await db.raw
    .select()
    .from(practiceDayOverrides)
    .where(db.own(practiceDayOverrides, eq(practiceDayOverrides.classId, classId), gte(practiceDayOverrides.date, from), lte(practiceDayOverrides.date, to)));
  return rows.map((r) => ({ date: r.date, isPractice: r.isPractice }));
}

export async function setOverride(db: TenantDb, input: PracticeDayOverrideInput): Promise<void> {
  await db.delete(practiceDayOverrides, eq(practiceDayOverrides.classId, input.classId), eq(practiceDayOverrides.date, input.date));
  if (input.isPractice !== null) {
    await db.insert(practiceDayOverrides).values({ classId: input.classId, date: input.date, isPractice: input.isPractice });
  }
  record({ action: 'update', entityType: 'practice_day', entityId: `${input.classId}:${input.date}`, after: input });
}

/** Practice days for a class in [from, to] — the single source for grid, cron and phone. */
export async function practiceDays(db: TenantDb, classId: string, from: string, to: string): Promise<string[]> {
  const [settings, overrides] = await Promise.all([getSettings(db, classId), listOverrides(db, classId, from, to)]);
  return practiceDaysInRange(settings, overrides, from, to);
}

// ---------------------------------------------------------------------------
// Tasks and copies
// ---------------------------------------------------------------------------

const mapTask = (r: typeof practiceTasks.$inferSelect): PracticeTaskRow => ({
  id: r.id, classId: r.classId, date: r.date, title: r.title, materialId: r.materialId ?? null,
  url: r.url ?? null, proofType: r.proofType, sortOrder: r.sortOrder,
});
const mapStudentTask = (r: typeof practiceStudentTasks.$inferSelect): StudentTaskRow => ({
  id: r.id, taskId: r.taskId ?? null, classId: r.classId, studentId: r.studentId, date: r.date, title: r.title,
  materialId: r.materialId ?? null, url: r.url ?? null, proofType: r.proofType, sortOrder: r.sortOrder,
  status: r.status, submittedAt: r.submittedAt ?? null, timeFrom: r.timeFrom ?? null, timeTo: r.timeTo ?? null,
  mediaKey: r.mediaKey ?? null, mediaType: r.mediaType ?? null, note: r.note ?? null, feedback: r.feedback ?? null,
  rejectReason: r.rejectReason ?? null, reviewedAt: r.reviewedAt ?? null, reviewedBy: r.reviewedBy ?? null,
  recordedByTeacher: r.recordedByTeacher,
});

export async function listTasks(db: TenantDb, classId: string, from: string, to: string): Promise<PracticeTaskRow[]> {
  const rows = await db.raw
    .select()
    .from(practiceTasks)
    .where(db.own(practiceTasks, eq(practiceTasks.classId, classId), gte(practiceTasks.date, from), lte(practiceTasks.date, to)))
    .orderBy(asc(practiceTasks.date), asc(practiceTasks.sortOrder));
  return rows.map(mapTask);
}

export async function listStudentTasks(db: TenantDb, classId: string, from: string, to: string): Promise<StudentTaskRow[]> {
  const rows = await db.raw
    .select()
    .from(practiceStudentTasks)
    .where(db.own(practiceStudentTasks, eq(practiceStudentTasks.classId, classId), gte(practiceStudentTasks.date, from), lte(practiceStudentTasks.date, to)))
    .orderBy(asc(practiceStudentTasks.date), asc(practiceStudentTasks.sortOrder));
  return rows.map(mapStudentTask);
}

export async function listStudentTasksFor(db: TenantDb, studentId: string, from: string, to: string): Promise<StudentTaskRow[]> {
  const rows = await db.raw
    .select()
    .from(practiceStudentTasks)
    .where(db.own(practiceStudentTasks, eq(practiceStudentTasks.studentId, studentId), gte(practiceStudentTasks.date, from), lte(practiceStudentTasks.date, to)))
    .orderBy(asc(practiceStudentTasks.date), asc(practiceStudentTasks.sortOrder));
  return rows.map(mapStudentTask);
}

export async function getStudentTask(db: TenantDb, id: string): Promise<StudentTaskRow | null> {
  const [r] = await db.raw.select().from(practiceStudentTasks).where(db.own(practiceStudentTasks, eq(practiceStudentTasks.id, id)));
  return r ? mapStudentTask(r) : null;
}

async function rosterIds(db: TenantDb, classId: string): Promise<string[]> {
  const rows = await db.raw
    .select({ id: classStudents.studentId })
    .from(classStudents)
    .where(db.own(classStudents, eq(classStudents.classId, classId)));
  return rows.map((r) => r.id);
}

async function nextSortOrder(db: TenantDb, classId: string, date: string): Promise<number> {
  const [r] = await db.raw
    .select({ n: sql<number>`coalesce(max(${practiceTasks.sortOrder}), -1)` })
    .from(practiceTasks)
    .where(db.own(practiceTasks, eq(practiceTasks.classId, classId), eq(practiceTasks.date, date)));
  return (r?.n ?? -1) + 1;
}

/**
 * Create one task. With `studentId` it is a per-student task: one copy, no class row.
 * Otherwise a class row plus one copy per enrolled student (chunked: 12 columns → 8 rows/stmt).
 */
export async function createTask(db: TenantDb, input: PracticeTaskInput, staffId: string | null): Promise<PracticeTaskRow | StudentTaskRow> {
  const created = nowIso();
  const base = { classId: input.classId, date: input.date, title: input.title, materialId: input.materialId ?? null, url: input.url ?? null, proofType: input.proofType };
  const sortOrder = await nextSortOrder(db, input.classId, input.date);
  if (input.studentId) {
    const id = crypto.randomUUID();
    await db.insert(practiceStudentTasks).values({ id, taskId: null, studentId: input.studentId, sortOrder, ...base });
    recordCreate('practice_task', id, { ...base, studentId: input.studentId });
    return (await getStudentTask(db, id))!;
  }
  const id = crypto.randomUUID();
  const roster = await rosterIds(db, input.classId);
  const ops = [db.insert(practiceTasks).values({ id, staffId, sortOrder, createdAt: created, ...base })];
  for (const part of chunk(roster, rowsPerStatement(12))) {
    ops.push(
      db.insert(practiceStudentTasks).values(
        part.map((studentId) => ({ id: crypto.randomUUID(), taskId: id, studentId, sortOrder, ...base })),
      ),
    );
  }
  await db.batch(ops as [typeof ops[0], ...typeof ops]);
  recordCreate('practice_task', id, { ...base, copies: roster.length });
  return { id, sortOrder, ...base, materialId: base.materialId, url: base.url };
}

export async function quickAdd(db: TenantDb, input: PracticeQuickAddInput, staffId: string | null): Promise<PracticeTaskRow[]> {
  const out: PracticeTaskRow[] = [];
  for (const title of parseQuickAddLines(input.lines)) {
    out.push((await createTask(db, { classId: input.classId, date: input.date, title, materialId: input.materialId, url: null, proofType: input.proofType, studentId: null }, staffId)) as PracticeTaskRow);
  }
  return out;
}

/** Edit a class task; the change propagates to copies still `open` (decision #8). */
export async function updateTask(db: TenantDb, id: string, patch: Partial<Pick<PracticeTaskInput, 'title' | 'materialId' | 'url' | 'proofType'>>): Promise<void> {
  const set: Partial<typeof practiceTasks.$inferInsert> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.materialId !== undefined) set.materialId = patch.materialId ?? null;
  if (patch.url !== undefined) set.url = patch.url ?? null;
  if (patch.proofType !== undefined) set.proofType = patch.proofType;
  if (!Object.keys(set).length) return;
  await db.update(practiceTasks, set, eq(practiceTasks.id, id));
  await db.update(practiceStudentTasks, set, eq(practiceStudentTasks.taskId, id), eq(practiceStudentTasks.status, 'open'));
  record({ action: 'update', entityType: 'practice_task', entityId: id, after: set });
}

/** Delete a class task: open copies go, submitted copies survive with task_id NULL (FK SET NULL). */
export async function deleteTask(db: TenantDb, id: string): Promise<void> {
  await recordDelete(db, 'practice_task', practiceTasks, id);
  await db.delete(practiceStudentTasks, eq(practiceStudentTasks.taskId, id), eq(practiceStudentTasks.status, 'open'));
  await db.delete(practiceTasks, eq(practiceTasks.id, id));
}

/** Remove one student's copy (per-student override). Only `open` copies may be removed. */
export async function removeStudentTask(db: TenantDb, id: string): Promise<void> {
  await recordDelete(db, 'practice_task', practiceStudentTasks, id, { kind: 'copy' });
  await db.delete(practiceStudentTasks, eq(practiceStudentTasks.id, id), eq(practiceStudentTasks.status, 'open'));
}

// ---------------------------------------------------------------------------
// Submission + review
// ---------------------------------------------------------------------------

export function mediaKeyFor(tenantId: string, studentTaskId: string, ext: string): string {
  return `t/${tenantId}/practice/${studentTaskId}/${crypto.randomUUID()}.${ext}`;
}

/**
 * Student submits (or resubmits after a rejection). Allowed while the task's date is >= todayIct
 * (before the 00:00 deadline). The route stores the media in R2 first and passes the key here.
 */
export async function submit(
  db: TenantDb,
  studentId: string,
  input: PracticeSubmitInput,
  media: { key: string; type: string } | null,
  todayIct: string,
): Promise<StudentTaskRow> {
  const row = await getStudentTask(db, input.studentTaskId);
  if (!row || row.studentId !== studentId) throw new Error('not_found');
  if (row.date < todayIct) throw new Error('deadline_passed');
  if (row.status === 'accepted' || row.status === 'teacher_done') throw new Error('already_done');
  if (row.proofType !== 'none' && !media && !row.mediaKey) throw new Error('proof_required');
  if (media && row.proofType === 'photo' && !media.type.startsWith('image/')) throw new Error('wrong_proof');
  if (media && row.proofType === 'video' && !media.type.startsWith('video/')) throw new Error('wrong_proof');
  await db.update(
    practiceStudentTasks,
    {
      status: 'submitted', submittedAt: nowIso(), timeFrom: input.timeFrom ?? null, timeTo: input.timeTo ?? null,
      note: input.note ?? null, rejectReason: null, recordedByTeacher: false,
      ...(media ? { mediaKey: media.key, mediaType: media.type } : {}),
    },
    eq(practiceStudentTasks.id, row.id),
  );
  record({ action: 'update', entityType: 'practice_submission', entityId: row.id, after: { status: 'submitted' } });
  return (await getStudentTask(db, row.id))!;
}

export async function review(db: TenantDb, input: PracticeReviewInput, staffId: string): Promise<StudentTaskRow> {
  const row = await getStudentTask(db, input.studentTaskId);
  if (!row) throw new Error('not_found');
  const at = nowIso();
  const set: Partial<typeof practiceStudentTasks.$inferInsert> = { reviewedAt: at, reviewedBy: staffId };
  if (input.decision === 'accept') set.status = 'accepted';
  if (input.decision === 'reject') { set.status = 'rejected'; set.rejectReason = input.rejectReason ?? null; }
  if (input.decision === 'teacher_done') { set.status = 'teacher_done'; set.recordedByTeacher = true; set.submittedAt = row.submittedAt ?? at; }
  if (input.feedback !== undefined) set.feedback = input.feedback ?? null;
  await db.update(practiceStudentTasks, set, eq(practiceStudentTasks.id, row.id));
  record({ action: 'update', entityType: 'practice_submission', entityId: row.id, after: set });
  return (await getStudentTask(db, row.id))!;
}

/** The review queue: submitted copies newest first, across all classes. */
export async function reviewQueue(db: TenantDb, limit = 200): Promise<StudentTaskRow[]> {
  const rows = await db.raw
    .select()
    .from(practiceStudentTasks)
    .where(db.own(practiceStudentTasks, eq(practiceStudentTasks.status, 'submitted')))
    .orderBy(desc(practiceStudentTasks.submittedAt))
    .limit(limit);
  return rows.map(mapStudentTask);
}

// ---------------------------------------------------------------------------
// Excuses
// ---------------------------------------------------------------------------

const mapExcuse = (r: typeof practiceExcuses.$inferSelect): ExcuseRow => ({
  id: r.id, classId: r.classId, studentId: r.studentId, date: r.date, reason: r.reason, status: r.status,
  requestedBy: r.requestedBy, requestedAt: r.requestedAt, decidedAt: r.decidedAt ?? null, decidedBy: r.decidedBy ?? null,
});

/** Student asks before the deadline (date >= today). One request per day; a re-request replaces a rejected one. */
export async function requestExcuse(db: TenantDb, studentId: string, input: PracticeExcuseRequestInput, todayIct: string): Promise<ExcuseRow> {
  if (input.date < todayIct) throw new Error('deadline_passed');
  const enrolled = (await rosterIds(db, input.classId)).includes(studentId);
  if (!enrolled) throw new Error('not_found');
  await db.delete(practiceExcuses, eq(practiceExcuses.classId, input.classId), eq(practiceExcuses.studentId, studentId), eq(practiceExcuses.date, input.date), eq(practiceExcuses.status, 'rejected'));
  const id = crypto.randomUUID();
  await db.insert(practiceExcuses).values({ id, classId: input.classId, studentId, date: input.date, reason: input.reason, status: 'pending', requestedBy: 'student', requestedAt: nowIso() });
  recordCreate('practice_excuse', id, { ...input, studentId });
  const [r] = await db.raw.select().from(practiceExcuses).where(db.own(practiceExcuses, eq(practiceExcuses.id, id)));
  return mapExcuse(r);
}

export async function listExcuses(db: TenantDb, opts: { status?: string; studentId?: string; classId?: string; from?: string; to?: string }): Promise<ExcuseRow[]> {
  const rows = await db.raw
    .select()
    .from(practiceExcuses)
    .where(
      db.own(
        practiceExcuses,
        opts.status ? eq(practiceExcuses.status, opts.status) : undefined,
        opts.studentId ? eq(practiceExcuses.studentId, opts.studentId) : undefined,
        opts.classId ? eq(practiceExcuses.classId, opts.classId) : undefined,
        opts.from ? gte(practiceExcuses.date, opts.from) : undefined,
        opts.to ? lte(practiceExcuses.date, opts.to) : undefined,
      ),
    )
    .orderBy(desc(practiceExcuses.requestedAt));
  return rows.map(mapExcuse);
}

/** Teacher decides a pending request. Approving after the miss was already finalized flips the miss too. */
export async function decideExcuse(db: TenantDb, input: PracticeExcuseDecideInput, staffId: string): Promise<ExcuseRow> {
  const [r] = await db.raw.select().from(practiceExcuses).where(db.own(practiceExcuses, eq(practiceExcuses.id, input.excuseId)));
  if (!r) throw new Error('not_found');
  const status = input.decision === 'approve' ? 'approved' : 'rejected';
  await db.update(practiceExcuses, { status, decidedAt: nowIso(), decidedBy: staffId }, eq(practiceExcuses.id, r.id));
  if (status === 'approved') {
    const [miss] = await db.raw.select().from(practiceMisses).where(db.own(practiceMisses, eq(practiceMisses.classId, r.classId), eq(practiceMisses.studentId, r.studentId), eq(practiceMisses.date, r.date)));
    if (miss && !miss.excused) await flipMissToExcused(db, miss.id);
  }
  record({ action: 'update', entityType: 'practice_excuse', entityId: r.id, after: { status } });
  return mapExcuse({ ...r, status });
}

/** Teacher excuses an existing miss directly (decision #18, after the deadline). */
export async function excuseMiss(db: TenantDb, input: PracticeExcuseMissInput, staffId: string): Promise<void> {
  const [miss] = await db.raw.select().from(practiceMisses).where(db.own(practiceMisses, eq(practiceMisses.id, input.missId)));
  if (!miss) throw new Error('not_found');
  if (miss.excused) return;
  await db.delete(practiceExcuses, eq(practiceExcuses.classId, miss.classId), eq(practiceExcuses.studentId, miss.studentId), eq(practiceExcuses.date, miss.date));
  await db.insert(practiceExcuses).values({ id: crypto.randomUUID(), classId: miss.classId, studentId: miss.studentId, date: miss.date, reason: input.reason, status: 'approved', requestedBy: 'teacher', requestedAt: nowIso(), decidedAt: nowIso(), decidedBy: staffId });
  await flipMissToExcused(db, miss.id);
}

async function flipMissToExcused(db: TenantDb, missId: string): Promise<void> {
  const [miss] = await db.raw.select().from(practiceMisses).where(db.own(practiceMisses, eq(practiceMisses.id, missId)));
  if (!miss || miss.excused) return;
  await db.update(practiceMisses, { excused: true, multiplier: 0 }, eq(practiceMisses.id, missId));
  const w = await getWarning(db, miss.classId, miss.studentId);
  await saveWarning(db, miss.classId, miss.studentId, undoMiss(w, missId));
  // The behavior row was written for an unexcused miss; an excused one is not an incident.
  if (miss.behaviorRecordId) {
    await recordDelete(db, 'assessment', behaviorRecords, miss.behaviorRecordId, { kind: 'behavior', reason: 'practice miss excused' });
    await db.delete(behaviorRecords, eq(behaviorRecords.id, miss.behaviorRecordId));
    await db.update(practiceMisses, { behaviorRecordId: null }, eq(practiceMisses.id, missId));
  }
  record({ action: 'update', entityType: 'practice_miss', entityId: missId, after: { excused: true } });
}

// ---------------------------------------------------------------------------
// Misses + warnings
// ---------------------------------------------------------------------------

const mapMiss = (r: typeof practiceMisses.$inferSelect): MissRow => ({
  id: r.id, classId: r.classId, studentId: r.studentId, date: r.date, excused: r.excused, multiplier: r.multiplier,
  behaviorRecordId: r.behaviorRecordId ?? null, createdAt: r.createdAt,
});

export async function listMisses(db: TenantDb, opts: { classId?: string; studentId?: string; from?: string; to?: string }): Promise<MissRow[]> {
  const rows = await db.raw
    .select()
    .from(practiceMisses)
    .where(
      db.own(
        practiceMisses,
        opts.classId ? eq(practiceMisses.classId, opts.classId) : undefined,
        opts.studentId ? eq(practiceMisses.studentId, opts.studentId) : undefined,
        opts.from ? gte(practiceMisses.date, opts.from) : undefined,
        opts.to ? lte(practiceMisses.date, opts.to) : undefined,
      ),
    )
    .orderBy(asc(practiceMisses.date));
  return rows.map(mapMiss);
}

export async function getWarning(db: TenantDb, classId: string, studentId: string): Promise<WarningRow> {
  const [r] = await db.raw.select().from(practiceWarnings).where(db.own(practiceWarnings, eq(practiceWarnings.classId, classId), eq(practiceWarnings.studentId, studentId)));
  if (!r) return { ...EMPTY_WARNING, classId, studentId, clearedAt: null };
  return { classId, studentId, level: r.level, pendingMultiplier: r.pendingMultiplier, pendingForDate: r.pendingForDate ?? null, pendingFromMiss: r.pendingFromMiss ?? null, clearedAt: r.clearedAt ?? null };
}

export async function listWarnings(db: TenantDb, classId: string): Promise<WarningRow[]> {
  const rows = await db.raw.select().from(practiceWarnings).where(db.own(practiceWarnings, eq(practiceWarnings.classId, classId)));
  return rows.map((r) => ({ classId: r.classId, studentId: r.studentId, level: r.level, pendingMultiplier: r.pendingMultiplier, pendingForDate: r.pendingForDate ?? null, pendingFromMiss: r.pendingFromMiss ?? null, clearedAt: r.clearedAt ?? null }));
}

async function saveWarning(db: TenantDb, classId: string, studentId: string, w: WarningLike, cleared?: { by: string }): Promise<void> {
  const existing = await db.raw.select({ classId: practiceWarnings.classId }).from(practiceWarnings).where(db.own(practiceWarnings, eq(practiceWarnings.classId, classId), eq(practiceWarnings.studentId, studentId)));
  const set = { level: w.level, pendingMultiplier: w.pendingMultiplier, pendingForDate: w.pendingForDate, pendingFromMiss: w.pendingFromMiss, updatedAt: nowIso(), ...(cleared ? { clearedAt: nowIso(), clearedBy: cleared.by } : {}) };
  if (existing.length) await db.update(practiceWarnings, set, eq(practiceWarnings.classId, classId), eq(practiceWarnings.studentId, studentId));
  else await db.insert(practiceWarnings).values({ classId, studentId, ...set });
}

export async function clearStudentWarning(db: TenantDb, classId: string, studentId: string, staffId: string): Promise<void> {
  await saveWarning(db, classId, studentId, clearWarning(), { by: staffId });
  record({ action: 'update', entityType: 'practice_warning', entityId: `${classId}:${studentId}`, after: { level: 0 } });
}

export type FinalizeOutcome = {
  classId: string; studentId: string; date: string; excused: boolean; multiplier: number; nextDay: string | null;
  missId: string;
};

/**
 * Finalize one practice day for one class (called by the nightly job with yesterday's ICT date).
 * Idempotent: a (class, student, date) that already has a miss row is skipped; a day that was
 * complete clears any pending ×N due that day. Returns the misses created this call.
 */
export async function finalizeDay(db: TenantDb, classId: string, date: string): Promise<FinalizeOutcome[]> {
  const [settings, overrides] = await Promise.all([getSettings(db, classId), listOverrides(db, classId, date, date)]);
  if (!isPracticeDay(settings, overrides, date)) return [];
  const copies = await listStudentTasks(db, classId, date, date);
  if (!copies.length) return [];
  const byStudent = new Map<string, StudentTaskRow[]>();
  for (const c of copies) byStudent.set(c.studentId, [...(byStudent.get(c.studentId) ?? []), c]);
  const existing = await listMisses(db, { classId, from: date, to: date });
  const approved = new Set((await listExcuses(db, { classId, status: 'approved', from: date, to: date })).map((e) => e.studentId));
  const farOverrides = await listOverrides(db, classId, date, addDaysStr(date, 60));
  const out: FinalizeOutcome[] = [];
  for (const [studentId, tasks] of byStudent) {
    const w = await getWarning(db, classId, studentId);
    if (dayIsComplete(tasks, date)) {
      if (w.pendingForDate === date) await saveWarning(db, classId, studentId, clearPending(w));
      continue;
    }
    if (existing.some((m) => m.studentId === studentId)) continue;
    const excused = approved.has(studentId);
    const missId = crypto.randomUUID();
    const nextDay = nextPracticeDay(settings, farOverrides, date);
    let multiplier = 0;
    let behaviorRecordId: string | null = null;
    if (!excused) {
      const nw = applyUnexcusedMiss(w, missId, nextDay);
      multiplier = nw.pendingMultiplier;
      await saveWarning(db, classId, studentId, nw);
      behaviorRecordId = crypto.randomUUID();
      await db.insert(behaviorRecords).values({ id: behaviorRecordId, studentId, classId, date, type: 'missing_practice', notes: `Practice ${date}: ${tasks.filter((t) => !DONE_STATUSES.has(t.status)).length}/${tasks.length} tasks not submitted` });
      recordCreate('assessment', behaviorRecordId, { kind: 'behavior', type: 'missing_practice', studentId, date });
    } else if (w.pendingForDate === date) {
      // An excused ×N day: the debt moves to the next practice day rather than being forgiven.
      await saveWarning(db, classId, studentId, { ...w, pendingForDate: nextDay });
    }
    await db.insert(practiceMisses).values({ id: missId, classId, studentId, date, excused, multiplier, behaviorRecordId, createdAt: nowIso() });
    recordCreate('practice_miss', missId, { classId, studentId, date, excused, multiplier });
    out.push({ classId, studentId, date, excused, multiplier, nextDay, missId });
  }
  return out;
}

function addDaysStr(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Summaries (ledger, phone, parent)
// ---------------------------------------------------------------------------

export async function studentMonthSummary(db: TenantDb, classId: string, studentId: string, month: string): Promise<MonthSummary> {
  const from = `${prevMonth(month)}-01`;
  const to = `${month}-31`;
  const [tasks, misses, warning, prevDays] = await Promise.all([
    listStudentTasksFor(db, studentId, `${month}-01`, to).then((r) => r.filter((t) => t.classId === classId)),
    listMisses(db, { classId, studentId, from, to }),
    getWarning(db, classId, studentId),
    practiceDays(db, classId, from, `${prevMonth(month)}-31`),
  ]);
  return monthSummary(month, tasks, misses, warning, prevDays.length > 0);
}

export type LedgerRow = {
  studentId: string; studentName: string; summary: MonthSummary; misses: MissRow[]; hasZalo: boolean;
};

/** One row per enrolled student for the ledger page. `hasZalo` is filled by the route. */
export async function classLedger(db: TenantDb, classId: string, month: string): Promise<Omit<LedgerRow, 'hasZalo'>[]> {
  const roster = await classesSvc.listRosterNames(db);
  const mine = roster.filter((r) => r.classId === classId);
  const out: Omit<LedgerRow, 'hasZalo'>[] = [];
  for (const s of mine) {
    const [summary, misses] = await Promise.all([
      studentMonthSummary(db, classId, s.id, month),
      listMisses(db, { classId, studentId: s.id, from: `${month}-01`, to: `${month}-31` }),
    ]);
    out.push({ studentId: s.id, studentName: s.name, summary, misses });
  }
  return out;
}

/** Enabled classes the student is enrolled in. */
export async function enabledClassesFor(db: TenantDb, studentId: string): Promise<{ classId: string; className: string }[]> {
  const rows = await db.raw
    .select({ classId: classes.id, className: classes.name })
    .from(classStudents)
    .innerJoin(classes, eq(classes.id, classStudents.classId))
    .innerJoin(practiceSettings, eq(practiceSettings.classId, classes.id))
    .where(db.own(classStudents, eq(classStudents.studentId, studentId), eq(practiceSettings.enabled, true)));
  return rows;
}

/** Material titles for a set of ids (for row decoration). */
export async function materialTitles(db: TenantDb, ids: string[]): Promise<Map<string, string>> {
  const clean = [...new Set(ids.filter(Boolean))];
  if (!clean.length) return new Map();
  const rows = await db.raw.select({ id: materials.id, title: materials.title }).from(materials).where(db.own(materials, inArray(materials.id, clean)));
  return new Map(rows.map((r) => [r.id, r.title]));
}

/** For the parent slip: summary + up to 5 recent feedback lines, or null when not enrolled anywhere. */
export async function studentPracticeForReport(db: TenantDb, studentId: string, month: string): Promise<{ summary: MonthSummary; feedback: { date: string; title: string; feedback: string }[] } | null> {
  const enabled = await enabledClassesFor(db, studentId);
  if (!enabled.length) return null;
  // One class per student is the norm; with several, sum the task counts and take the worst warning.
  const parts = await Promise.all(enabled.map((c) => studentMonthSummary(db, c.classId, studentId, month)));
  const summary = parts.reduce((acc, p) => ({
    ...acc,
    doneTasks: acc.doneTasks + p.doneTasks, totalTasks: acc.totalTasks + p.totalTasks,
    excusedUsed: acc.excusedUsed + p.excusedUsed, excusedQuota: Math.max(acc.excusedQuota, p.excusedQuota),
    unexcused: acc.unexcused + p.unexcused, level: Math.max(acc.level, p.level),
    pendingMultiplier: Math.max(acc.pendingMultiplier, p.pendingMultiplier),
    pendingForDate: p.pendingMultiplier > acc.pendingMultiplier ? p.pendingForDate : acc.pendingForDate,
  }), { ...parts[0] });
  const tasks = await listStudentTasksFor(db, studentId, `${month}-01`, `${month}-31`);
  const feedback = tasks
    .filter((t) => t.feedback && t.feedback.trim())
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 5)
    .map((t) => ({ date: t.date, title: t.title, feedback: t.feedback! }));
  return { summary, feedback };
}
```
> **Type check discipline:** `db.batch` expects a non-empty tuple type; if the cast above does not typecheck, look at how `server/services/classes.ts:133-160` builds `ops` and copy that exact shape. Unused imports (`isNull`, `or`, `students`) must be removed or `oxlint` fails.

---

## 7. Nightly jobs — `server/services/practice-notify.ts` (create) + `notify.ts` edits

Read first: `server/services/notify.ts:40-100` (helpers + `ledgerKey`), `:620-680` (`runGardenAlerts` — the shape to copy), `:686-746` (`zaloDeliver`, `deliver`), `:748-800` (`runScheduled`); `server/services/push.ts:60-130` and `:190-230`; `server/services/notif-prefs.ts` whole file; `server/services/zalo.ts:130-140`, `:245-258`.

### 7.1 `notify.ts` edits
1. Change `async function deliver(` to `export async function deliver(` (same for nothing else).
2. Add to `ledgerKey`:
   ```ts
   practiceMiss:   (studentId: string, classId: string, date: string) => `practice-miss:${studentId}:${classId}:${date}`,
   practiceRemind: (studentId: string, date: string) => `practice-remind:${studentId}:${date}`,
   ```
3. In `runScheduled`, extend the branch so the two new crons dispatch (keep every existing line):
   ```ts
   const sent =
     cron === '0 1 * * *'  ? await runDailyDigest(db, at, env)
   : cron === '0 12 * * *' ? await runEveningPreview(db, at, env)
   : cron === '0 13 * * *' ? await runPracticeReminders(db, at, env)
   : cron === '0 17 * * *' ? await runPracticeFinalize(db, at, env)
                           : await runClassReminders(db, at, env);
   ```
   Import both from `./practice-notify`. If `practice-notify.ts` needs `deliver`/`ledgerKey` from `notify.ts` and `notify.ts` imports from `practice-notify.ts`, that is a circular import; it is fine for functions (they are only called at runtime), but to be safe put the two runners' *imports* of `deliver`/`ledgerKey`/`ictNow`/`addDaysIso` as `import { … } from './notify'` and have `notify.ts` import the runners with `import * as practiceNotify from './practice-notify'` and call `practiceNotify.runPracticeFinalize(...)`. Verify with `npm run typecheck` and `npm run test:worker` (the cron test must still pass).
4. `wrangler.jsonc` crons (production block only; the test env stays `[]`):
   ```jsonc
   "0 13 * * *", // 20:00 ICT — practice reminders (open tasks due tonight)
   "0 17 * * *", // 00:00 ICT — practice finalize: yesterday's misses, penalty alerts, parent Zalo
   ```
   Also add both lines to the docblock in `workers/app.ts:116-125` that lists the crons.
5. `notif-prefs.ts`: add `practiceReminders: true` to `DEFAULT_NOTIF_PREFS` and `'practiceReminders'` to `NotifSwitch`.
6. `app/routes/api.push.run.tsx`: accept `job=practice-remind` and `job=practice-finalize`, calling the two runners with `(db, new Date(), env)`. Update the docblock list.

### 7.2 `server/services/practice-notify.ts` (create in full)

```ts
/**
 * Practice crons.
 *
 * 20:00 ICT — remind students who still have open copies today (channel 'reminders', pref
 * `practiceReminders`). 00:00 ICT — finalize YESTERDAY (the ICT day that just ended): record
 * misses via practiceSvc.finalizeDay, push the penalty alert, Zalo-text paired parents.
 * Both are idempotent through the sent_notifications ledger and finalizeDay's own UNIQUE guard.
 */
import type { TenantDb } from '../db/tenant';
import { deliver, ictNow, addDaysIso, ledgerKey } from './notify';
import * as push from './push';
import * as zalo from './zalo';
import * as practiceSvc from './practice';
import * as peopleSvc from './people';
import * as classesSvc from './classes';
import { accountsWanting, getNotifPrefsByAccount, getSchoolNotifPrefs } from './notif-prefs';
import type { ExpoPushMessage } from './push';
import { PRIMARY_TENANT_ID } from '../db/tenant';
import { strings } from '../../shared/i18n/strings';

/** Vietnamese copy for pushes/Zalo — the school's language; the phone shows pushes as sent. */
const vi = strings.vi as Record<string, string>;
const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

export async function runPracticeReminders(db: TenantDb, at: Date = new Date(), _env?: Env): Promise<number> {
  const { dateIso: today } = ictNow(at);
  const [settings, prefs, perAccount] = await Promise.all([
    practiceSvc.listSettings(db), getSchoolNotifPrefs(db), getNotifPrefsByAccount(db),
  ]);
  const messages: ExpoPushMessage[] = [];
  const doneKeys: string[] = [];
  for (const s of settings.filter((x) => x.enabled)) {
    const days = await practiceSvc.practiceDays(db, s.classId, today, today);
    if (!days.length) continue;
    const copies = await practiceSvc.listStudentTasks(db, s.classId, today, today);
    const openByStudent = new Map<string, number>();
    for (const c of copies) if (c.status === 'open' || c.status === 'rejected') openByStudent.set(c.studentId, (openByStudent.get(c.studentId) ?? 0) + 1);
    if (!openByStudent.size) continue;
    const keys = [...openByStudent.keys()].map((sid) => ledgerKey.practiceRemind(sid, today));
    const already = await push.alreadySent(db, keys);
    for (const [studentId, n] of openByStudent) {
      const key = ledgerKey.practiceRemind(studentId, today);
      if (already.has(key)) continue;
      doneKeys.push(key);
      const accountIds = accountsWanting(perAccount, await push.accountIdsForStudents(db, [studentId]), 'practiceReminders');
      const body = { title: vi.push_pr_remind_title, body: fill(vi.push_pr_remind_body, { n }), data: { url: '/practice', kind: 'practice' }, channelId: 'reminders' as const };
      for (const to of await push.tokensForAccounts(db, accountIds)) messages.push({ to, ...body });
    }
  }
  await deliver(db, messages);
  await push.markSent(db, doneKeys);
  return messages.length;
}

export async function runPracticeFinalize(db: TenantDb, at: Date = new Date(), env?: Env): Promise<number> {
  const { dateIso: today } = ictNow(at);
  const yesterday = addDaysIso(today, -1);
  const [settings, prefs, perAccount, studentsList, classesList] = await Promise.all([
    practiceSvc.listSettings(db), getSchoolNotifPrefs(db), getNotifPrefsByAccount(db),
    peopleSvc.listStudents(db), classesSvc.listLite(db),
  ]);
  const nameOf = (id: string) => studentsList.find((s) => s.id === id)?.name ?? id;
  const messages: ExpoPushMessage[] = [];
  const doneKeys: string[] = [];
  let sent = 0;
  for (const s of settings.filter((x) => x.enabled)) {
    const outcomes = await practiceSvc.finalizeDay(db, s.classId, yesterday);
    for (const o of outcomes) {
      const key = ledgerKey.practiceMiss(o.studentId, o.classId, o.date);
      const already = await push.alreadySent(db, [key]);
      if (already.has(key)) continue;
      doneKeys.push(key);
      if (!o.excused && o.nextDay) {
        const accountIds = accountsWanting(perAccount, await push.accountIdsForStudents(db, [o.studentId]), 'practiceReminders');
        const body = { title: vi.push_pr_penalty_title, body: fill(vi.push_pr_penalty_body, { date: o.nextDay.slice(8, 10) + '/' + o.nextDay.slice(5, 7), n: o.multiplier }), data: { url: '/practice', kind: 'practice' }, channelId: 'reminders' as const };
        for (const to of await push.tokensForAccounts(db, accountIds)) messages.push({ to, ...body });
      }
      // Parents by Zalo — one bot token, primary tenant only (same rule as zaloDeliver in notify.ts).
      if (env && zalo.isEnabled(env) && db.tenantId === PRIMARY_TENANT_ID) {
        const summary = await practiceSvc.studentMonthSummary(db, o.classId, o.studentId, o.date.slice(0, 7));
        const kind = o.excused ? vi.zalo_pr_kind_excused : fill(vi.zalo_pr_kind_unexcused, { n: o.multiplier });
        const text = fill(vi.zalo_pr_miss, { student: nameOf(o.studentId), date: o.date.slice(8, 10) + '/' + o.date.slice(5, 7), kind, used: summary.excusedUsed, quota: summary.excusedQuota });
        const chats = await zalo.chatsForParentsOfStudents(db, [o.studentId]);
        if (chats.length) sent += await zalo.broadcastText(env, chats, text);
      }
    }
  }
  await deliver(db, messages);
  await push.markSent(db, doneKeys);
  void prefs; void classesList;
  return messages.length + sent;
}
```
> **Check before writing:** (a) how `strings` is exported from `shared/i18n/strings.ts` (the object may be named differently — grep `export const` at the top and bottom of that file) and adapt the `vi` lookup; (b) `getSchoolNotifPrefs` / `getNotifPrefsByAccount` exact names in `notif-prefs.ts` (they are used in `runGardenAlerts`; copy from there); (c) whether `Env` is a global type (it is used unqualified in `zalo.ts`) — if not, import it the way `notify.ts` does. Remove the `void` lines if the variables end up used or unused imports remain.

### 7.3 `test-worker/practice.test.js` (create; the file MUST be `.js`)

```js
import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { createRawDb } from '../server/db/internal';
import { TenantDb, PRIMARY_TENANT_ID } from '../server/db/index';
import * as practiceSvc from '../server/services/practice';
import * as classesSvc from '../server/services/classes';
import * as peopleSvc from '../server/services/people';
import * as assessSvc from '../server/services/assessments';
import { runPracticeFinalize } from '../server/services/practice-notify';

/**
 * Practice: the nightly finalize is the only writer of misses and the one place the ×N rule is
 * applied. These tests drive it against real D1 through the service layer — no hand SQL — and
 * pin: copies fan out to the roster, a complete day is not a miss, an incomplete day is, an
 * approved excuse makes it excused with no behavior row, and the ×N badge escalates/clears.
 */
const db = () => new TenantDb(createRawDb(env), PRIMARY_TENANT_ID);

async function fixture(d) {
  const a = await peopleSvc.createStudent(d, { name: 'PR Student A' });
  const b = await peopleSvc.createStudent(d, { name: 'PR Student B' });
  const cls = await classesSvc.create(d, { name: `PR Class ${crypto.randomUUID().slice(0, 6)}`, color: 'green', studentIds: [a.id, b.id] });
  await practiceSvc.saveSettings(d, { classId: cls.id, enabled: true, weekdays: '1,2,3,4,5,6' }, '2031-03-03', true);
  return { a, b, cls };
}

describe('practice — tasks fan out to the roster', () => {
  it('creates one copy per enrolled student and edits propagate to open copies only', async () => {
    const d = db();
    const { a, cls } = await fixture(d);
    const task = await practiceSvc.createTask(d, { classId: cls.id, date: '2031-03-03', title: 'Workbook p.4', materialId: null, url: null, proofType: 'photo', studentId: null }, null);
    const copies = await practiceSvc.listStudentTasks(d, cls.id, '2031-03-03', '2031-03-03');
    expect(copies).toHaveLength(2);
    const mine = copies.find((c) => c.studentId === a.id);
    await practiceSvc.submit(d, a.id, { studentTaskId: mine.id, timeFrom: '20:00', timeTo: '20:30', note: null }, { key: 'k', type: 'image/jpeg' }, '2031-03-03');
    await practiceSvc.updateTask(d, task.id, { title: 'Workbook p.4-7' });
    const after = await practiceSvc.listStudentTasks(d, cls.id, '2031-03-03', '2031-03-03');
    expect(after.find((c) => c.studentId === a.id).title).toBe('Workbook p.4');      // submitted: frozen
    expect(after.find((c) => c.studentId !== a.id).title).toBe('Workbook p.4-7');    // open: followed
  });
});

describe('practice — finalize', () => {
  it('records a miss for the incomplete student, ×2 on the next practice day, and a behavior row', async () => {
    const d = db();
    const { a, b, cls } = await fixture(d);
    await practiceSvc.createTask(d, { classId: cls.id, date: '2031-03-03', title: 'T1', materialId: null, url: null, proofType: 'none', studentId: null }, null);
    const copies = await practiceSvc.listStudentTasks(d, cls.id, '2031-03-03', '2031-03-03');
    await practiceSvc.submit(d, a.id, { studentTaskId: copies.find((c) => c.studentId === a.id).id, timeFrom: null, timeTo: null, note: null }, null, '2031-03-03');
    const outcomes = await practiceSvc.finalizeDay(d, cls.id, '2031-03-03');
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ studentId: b.id, excused: false, multiplier: 2, nextDay: '2031-03-04' });
    const w = await practiceSvc.getWarning(d, cls.id, b.id);
    expect(w).toMatchObject({ level: 1, pendingMultiplier: 2, pendingForDate: '2031-03-04' });
    const beh = (await assessSvc.listBehavior(d)).filter((r) => r.studentId === b.id && r.type === 'missing_practice');
    expect(beh).toHaveLength(1);
    // Idempotent
    expect(await practiceSvc.finalizeDay(d, cls.id, '2031-03-03')).toEqual([]);
  });

  it('an approved excuse makes the miss excused with no behavior row; excusing after the fact undoes ×N', async () => {
    const d = db();
    const { a, b, cls } = await fixture(d);
    await practiceSvc.createTask(d, { classId: cls.id, date: '2031-03-05', title: 'T', materialId: null, url: null, proofType: 'none', studentId: null }, null);
    const ex = await practiceSvc.requestExcuse(d, a.id, { classId: cls.id, date: '2031-03-05', reason: 'Sick' }, '2031-03-05');
    await practiceSvc.decideExcuse(d, { excuseId: ex.id, decision: 'approve' }, 'u1');
    const out = await practiceSvc.finalizeDay(d, cls.id, '2031-03-05');
    const forA = out.find((o) => o.studentId === a.id);
    const forB = out.find((o) => o.studentId === b.id);
    expect(forA).toMatchObject({ excused: true, multiplier: 0 });
    expect(forB).toMatchObject({ excused: false, multiplier: 2 });
    await practiceSvc.excuseMiss(d, { missId: forB.missId, reason: 'Family' }, 'u1');
    expect(await practiceSvc.getWarning(d, cls.id, b.id)).toMatchObject({ level: 0, pendingMultiplier: 0 });
    expect((await assessSvc.listBehavior(d)).filter((r) => r.studentId === b.id && r.type === 'missing_practice')).toHaveLength(0);
  });

  it('the cron runner finalizes yesterday ICT for every enabled class', async () => {
    const d = db();
    const { cls } = await fixture(d);
    await practiceSvc.createTask(d, { classId: cls.id, date: '2031-03-10', title: 'T', materialId: null, url: null, proofType: 'none', studentId: null }, null);
    // 2031-03-11 00:30 ICT = 2031-03-10T17:30:00Z → yesterday ICT is 2031-03-10
    await runPracticeFinalize(d, new Date('2031-03-10T17:30:00Z'));
    const misses = await practiceSvc.listMisses(d, { classId: cls.id });
    expect(misses.map((m) => m.date)).toEqual(['2031-03-10', '2031-03-10']);
  });
});
```
> **Check before writing:** the exact signatures of `peopleSvc.createStudent` and `classesSvc.create` (open `server/services/people.ts` and `classes.ts:133`; the `ClassInput` shape is in `shared/schemas.ts`) — pass whatever required fields they need. Also confirm `staff` row `u1` exists in the migrated test DB (it is the seed's teacher); if `reviewedBy`/`decidedBy` FKs reject it, create a staff row via `peopleSvc.createStaff` first.

---

## 8. Routes

### 8.1 `app/routes.ts`
Read `app/routes.ts:30-60` (cookie-authed non-shell routes), `:74-170` (`/api/*`), `:178-248` (`_app` layout). Add:

```ts
// outside _app, next to 'class-materials' / 'report-extras':
route('practice-actions', 'routes/practice-actions.tsx'),
route('practice-media/:key', 'routes/practice-media.$key.tsx'),
// inside the api block:
route('api/practice/my', 'routes/api.practice.my.tsx'),
route('api/practice/submit', 'routes/api.practice.submit.tsx'),
route('api/practice/excuse', 'routes/api.practice.excuse.tsx'),
// inside the _app layout block (static segments BEFORE dynamic ones):
route('practice', 'routes/practice.tsx'),
route('practice/review', 'routes/practice.review.tsx'),
route('practice/:classId/week/:monday', 'routes/practice.$classId.week.$monday.tsx'),
route('practice/:classId/ledger/:month', 'routes/practice.$classId.ledger.$month.tsx'),
```

### 8.2 Nav, titles, cache, live
- `src/lib/sidebar-nav.tsx`, section `teaching`, after the `materials` row:
  `{ id: 'practice', path: '/practice', tk: 'nav_practice', icon: 'clipboard', staffOnly: true },`
  (`clipboard` is an existing `IconName`; `test/sidebar-sections.test.tsx` forbids reusing the *section's* icon — check `teaching`'s section icon and pick `repeat` if `clipboard` collides.)
- `src/lib/page-title.ts` `EXTRA`: `'/practice/review': 'pr_review_queue'`. (`/practice/:classId/…` pages: check how `PATH_KEYS` resolves dynamic paths — if it needs a prefix rule, mirror how `/tuition/:month` is handled in `src/lib/page-title.ts`; if tuition is not handled specially, do nothing.)
- `shared/live.ts`: add `'practice'` to `MUTATION_DOMAINS`. Do **not** add it to `STUDENT_LIVE_DOMAINS` (students use the phone).
- `src/lib/route-cache.ts`: `K.practice: 'route:practice'`; `MUTATION_EFFECTS.practice = { hard: [K.practice], stale: [K.assessments] }`; in `cacheKeyForPath`, `if (pathname === '/practice' || pathname.startsWith('/practice/')) return K.practice;` placed before any catch-all.

### 8.3 `app/routes/practice-actions.tsx` — every web mutation (create in full)

Read first `app/routes/class-materials.tsx` (whole) and `app/routes/materials.tsx:48-134`.

```tsx
import type { ActionFunctionArgs, ClientActionFunctionArgs } from 'react-router';
import { tenantDbFor } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as practiceSvc from '../../server/services/practice';
import {
  PracticeClearWarningInput, PracticeDayOverrideInput, PracticeExcuseDecideInput, PracticeExcuseMissInput,
  PracticeQuickAddInput, PracticeReviewInput, PracticeSettingsInput, PracticeTaskInput, parsePatch,
} from '../../shared/schemas';
import { ictDateOf } from '../../shared/logic/tests';
import { invalidateAfterMutation } from '../../src/lib/route-cache.js';
import { withLiveAction } from '../../server/live';

/**
 * Cookie-authed action for every Practice mutation on the web (the `/api/*` twins are bearer-only,
 * so a browser fetcher cannot use them). One route, dispatched on `intent`, so e2e can `posted()`
 * a single path. Any staff may act (decision #4).
 */
const bad = (error: string, status = 400) => Response.json({ error }, { status });

function formObject(fd: FormData): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) if (typeof v === 'string') o[k] = v;
  return o;
}

async function actionImpl({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const staff = await requireStaff(request, env);
  const db = tenantDbFor(env, staff);
  const fd = await request.formData();
  const intent = String(fd.get('intent') ?? '');
  const body = formObject(fd);
  const today = ictDateOf(new Date().toISOString());
  const staffId = staff.user.id;

  switch (intent) {
    case 'settings': {
      const p = PracticeSettingsInput.safeParse(body);
      if (!p.success) return bad('validation_failed', 422);
      return { ok: true, settings: await practiceSvc.saveSettings(db, p.data, today, fd.has('weekdays')) };
    }
    case 'day-override': {
      const raw = { ...body, isPractice: body.isPractice === 'null' ? null : body.isPractice };
      const p = PracticeDayOverrideInput.safeParse(raw);
      if (!p.success) return bad('validation_failed', 422);
      await practiceSvc.setOverride(db, p.data);
      return { ok: true };
    }
    case 'quick-add': {
      const p = PracticeQuickAddInput.safeParse(body);
      if (!p.success) return bad('validation_failed', 422);
      return { ok: true, tasks: await practiceSvc.quickAdd(db, p.data, staffId) };
    }
    case 'create-task': {
      const p = PracticeTaskInput.safeParse(body);
      if (!p.success) return bad('validation_failed', 422);
      return { ok: true, task: await practiceSvc.createTask(db, p.data, staffId) };
    }
    case 'update-task': {
      const id = String(fd.get('id') ?? '');
      if (!id) return bad('missing_id');
      const p = parsePatch(PracticeTaskInput.pick({ title: true, materialId: true, url: true, proofType: true }), body);
      if (!p.success) return bad('validation_failed', 422);
      await practiceSvc.updateTask(db, id, p.data);
      return { ok: true };
    }
    case 'delete-task': {
      const id = String(fd.get('id') ?? '');
      if (!id) return bad('missing_id');
      await practiceSvc.deleteTask(db, id);
      return { ok: true };
    }
    case 'remove-copy': {
      const id = String(fd.get('id') ?? '');
      if (!id) return bad('missing_id');
      await practiceSvc.removeStudentTask(db, id);
      return { ok: true };
    }
    case 'review': {
      const p = PracticeReviewInput.safeParse(body);
      if (!p.success) return bad('validation_failed', 422);
      return { ok: true, task: await practiceSvc.review(db, p.data, staffId) };
    }
    case 'excuse-decide': {
      const p = PracticeExcuseDecideInput.safeParse(body);
      if (!p.success) return bad('validation_failed', 422);
      return { ok: true, excuse: await practiceSvc.decideExcuse(db, p.data, staffId) };
    }
    case 'excuse-miss': {
      const p = PracticeExcuseMissInput.safeParse(body);
      if (!p.success) return bad('validation_failed', 422);
      await practiceSvc.excuseMiss(db, p.data, staffId);
      return { ok: true };
    }
    case 'clear-warning': {
      const p = PracticeClearWarningInput.safeParse(body);
      if (!p.success) return bad('validation_failed', 422);
      await practiceSvc.clearStudentWarning(db, p.data.classId, p.data.studentId, staffId);
      return { ok: true };
    }
    default:
      return bad('unknown intent');
  }
}

export const action = withLiveAction('practice', actionImpl);

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  try {
    return await serverAction();
  } finally {
    invalidateAfterMutation('practice');
  }
}
```
> **Check before writing:** `parsePatch`'s exact signature at `shared/schemas.ts:16` (it may take `(schema, data)` and return a SafeParse-like result or throw) — adapt the `update-task` case to it. Confirm `requireStaff` returns `{ user: { id } }` (see how `tuition.tsx` reads `admin.user`).

### 8.4 Page loaders (create four route files)

All four: `requireStaff`, `tenantDbFor`, `swrLoad`/`clientLoader` like `app/routes/tuition.tsx:60-66` with `K.practice`, `clientLoader.hydrate = true`. Each default-exports a screen from `src/practice/`.

**`practice.tsx` (landing)** — loader returns `{ classes: classesSvc.listLite(db), settings: practiceSvc.listSettings(db), today }`. Screen: `src/practice/practice-home.tsx`.

**`practice.$classId.week.$monday.tsx`** — validate `params.monday` with `PracticeDate` and that it is a Monday (`weekdayOf(monday) === 1`, else redirect to the Monday of that week); `sunday = monday + 6`. Loader returns:
```ts
{
  classId, monday, sunday, today,
  cls: (await classesSvc.get(db, classId)),                 // 404 when null
  settings: await practiceSvc.getSettings(db, classId),
  overrides: await practiceSvc.listOverrides(db, classId, monday, sunday),
  practiceDays: await practiceSvc.practiceDays(db, classId, monday, sunday),
  tasks: await practiceSvc.listTasks(db, classId, monday, sunday),
  copies: await practiceSvc.listStudentTasks(db, classId, monday, sunday),
  roster: (await classesSvc.listRosterNames(db)).filter((r) => r.classId === classId),
  materials: await materialsSvc.list(db),
}
```
Screen: `src/practice/practice-week.tsx`.

**`practice.$classId.ledger.$month.tsx`** — validate month with `TuitionMonth` (same regex; reuse it). Loader: `cls`, `month`, `rows = await practiceSvc.classLedger(db, classId, month)` then decorate `hasZalo` per student with `zalo.chatsForParentsOfStudents(db, [studentId])` (length > 0) — one call per student is fine (≤40 students), plus `pendingExcuses = practiceSvc.listExcuses(db, { classId, status: 'pending' })`. Screen: `src/practice/practice-ledger.tsx`.

**`practice.review.tsx`** — loader: `queue = practiceSvc.reviewQueue(db)`, `excuses = practiceSvc.listExcuses(db, { status: 'pending' })`, `students = peopleSvc.listStudents(db)`, `classes = classesSvc.listLite(db)`, `materialTitles` for the queue's material ids. Screen: `src/practice/practice-review.tsx`.

### 8.5 Web screens — `src/practice/*.tsx`

Read first: `src/screens-tuition.tsx:1-120` and one dialog in it (`:660-720`), `src/ui.tsx:30-60` (`Modal` props), `:649-658` (exports), `src/ds/index.d.ts` (DS members: `Avatar Badge Button Card Checkbox IconButton Input ProgressBar Switch Tabs Tag`). Field wrappers: `DS.Input` with a `label` prop renders `.mochi-field > label.mochi-field__label` (this is what e2e's `k.textIn('Label')` finds); `MSelect` from `src/ui.tsx` renders the combobox e2e's `k.pickSel` drives. For a multi-line textarea check whether `DS.Input` has a `multiline`/`as="textarea"` prop (grep `textarea` in `src/ds/bundle.js`); if not, render `<div className="mochi-field"><label className="mochi-field__label">…</label><textarea className="mochi-input" …/></div>` by hand — the e2e helper matches `textarea.mochi-input`.

Mutations: `const fetcher = useFetcher(); fetcher.submit(fd, { action: '/practice-actions', method: 'post' })` where `fd` is a `FormData` with `intent` + fields. Close dialogs optimistically on submit (house pattern). Confirmations via `const [confirm, confirmNode] = useConfirm();`.

**`practice-home.tsx`** — `PageHeader` title `t('pr_title')`, subtitle `t('pr_sub')`, actions: `Button` "Review queue" (`pr_review_queue`) → `/practice/review`. A `Card` per class (name + color dot). If no settings row or `enabled=false`: button **Enable Practice** (`pr_enable`) → opens `Modal` titled **Enable Practice** with a `pr_weekdays` group of 7 `DS.Checkbox` (Mon…Sun, labels from the existing calendar weekday strings) pre-checked from `defaultWeekdaysFromEvents`-equivalent — simply leave the checkboxes unchecked and DO NOT send `weekdays` on first enable (the server derives the default, decision #5); show `pr_weekdays_help`. Footer primary button **Save** → intent `settings` with `enabled=true`. If enabled: `Tag` "Practice on" (`pr_enabled_badge`), buttons **Open week** → `/practice/:classId/week/:thisMonday`, **Open ledger** → `/practice/:classId/ledger/:thisMonth`, secondary **Disable Practice** (confirm) → intent `settings`, `enabled=false`, `weekdays=<current>`.

**`practice-week.tsx`** — header: class name; `pr_week_prev` / `pr_this_week` / `pr_week_next` links (`shiftMonday`), a **Ledger** link. Seven columns Mon–Sun. Column header: date `dd/MM`; if the day is a practice day show nothing extra, else a muted `Tag` **Day off** (`pr_day_off`). Column menu (`IconButton` `more`): **Day off** (intent `day-override`, `isPractice=false`), **Make practice day** (`isPractice=true`), **Use weekly default** (`isPractice=null`). Body: one `Card` per class task (title, material title chip, proof `Tag`, link icon); per-card `IconButton edit` → **Edit task** modal (fields **Task**, **Material** (`MSelect`, first option **No material**), **Link**, **Proof** (`MSelect` with the four `pr_proof_*` labels)); `IconButton trash` → confirm `pr_delete_task_confirm` → intent `delete-task`. Column footer: **Add tasks** button (`pr_add_tasks`) → modal **Add tasks** with textarea **Tasks (one per line)** (placeholder `pr_lines_ph`), **Material**, **Proof**; primary **Save** → intent `quick-add`. Second footer button **Students on this day** (`pr_students_on_day`) → modal listing the roster: each row = name, copy count `done/total`, `Tag` per copy status, **Remove for this student** per open copy (intent `remove-copy`), **Mark done** per open copy (intent `review`, `decision=teacher_done`; shows `pr_recorded_by_teacher` tag afterwards), and at the bottom **Add task for one student** (`pr_add_task_for`): `MSelect` **Student** + **Task** input + **Proof** → intent `create-task` with `studentId`. Under each class task show a tiny per-status count like `3/8 ✓` computed from `copies` (`taskId` match). If `settings` is null/disabled render `Empty` with `pr_not_enabled` and an **Enable Practice** button linking to `/practice`.

**`practice-review.tsx`** — header `pr_review_queue`. Section **Excuse requests** (`pr_excuses_pending`): each row = student name, class, date, reason; buttons **Approve** (`pr_approve`, intent `excuse-decide`, `decision=approve`) and **Reject** (`pr_reject`, `decision=reject`). Section queue: one `Card` per submitted copy, newest first: student name, class, date, title, **Time** `timeFrom–timeTo`, **Student note**, media: `<img src={'/practice-media/' + encodeURIComponent(mediaKey)}>` for images / `<video controls>` for video (the media route needs the key URL-encoded because it contains slashes — see 8.7), a **Feedback** textarea + **Save feedback** (intent `review`, `decision=feedback`), **Accept** (`decision=accept`), **Reject** → inline **Reason** input + confirm (`decision=reject`, `rejectReason`). Empty state `pr_queue_empty`.

**`practice-ledger.tsx`** — header: class name + month with prev/next month links (`shiftMonth`). Table columns: **Student**, **Done / total**, **Excused** (`excusedUsed/excusedQuota`), **Unexcused**, penalty (`Tag` `pr_penalty_badge` with `n`/`date` when `pendingMultiplier>0`), warning (`Tag` `pr_warning_level` when `level>0`) + **Clear warning** button (confirm `pr_clear_warning_confirm`, intent `clear-warning`), Zalo: muted `Tag` **No Zalo pairing** when `!hasZalo`. Expand row → list of misses (`date`, `Excused`/`Unexcused`, **Mark excused** button on unexcused → intent `excuse-miss`).

### 8.6 API routes for the phone

**`api.practice.my.tsx`**
```tsx
import { fail, withAuth } from '../../server/api/handler';
import * as practiceSvc from '../../server/services/practice';
import { ictDateOf } from '../../shared/logic/tests';

/** Student-only. Everything in one round trip so the tab renders from one query. */
export const loader = withAuth('user', async ({ db, user }) => {
  if (user.kind !== 'student') throw fail('forbidden', 403);
  const studentId = user.user.id;
  const now = new Date();
  const today = ictDateOf(now.toISOString());
  const to = addDays(today, 7);
  const from = addDays(today, -1);
  const enabled = await practiceSvc.enabledClassesFor(db, studentId);
  const classes = [];
  for (const c of enabled) {
    const [practiceDays, summary, excuses] = await Promise.all([
      practiceSvc.practiceDays(db, c.classId, today, to),
      practiceSvc.studentMonthSummary(db, c.classId, studentId, today.slice(0, 7)),
      practiceSvc.listExcuses(db, { classId: c.classId, studentId, from, to }),
    ]);
    classes.push({ ...c, practiceDays, summary, excuses: excuses.map(({ id, classId, date, reason, status, requestedAt }) => ({ id, classId, date, reason, status, requestedAt })) });
  }
  const rows = (await practiceSvc.listStudentTasksFor(db, studentId, from, to)).filter((t) => enabled.some((c) => c.classId === t.classId) && (t.date >= today || t.status === 'open' || t.status === 'rejected'));
  const titles = await practiceSvc.materialTitles(db, rows.map((r) => r.materialId).filter((x): x is string => !!x));
  const tasks = rows.map((t) => ({
    id: t.id, classId: t.classId, className: enabled.find((c) => c.classId === t.classId)?.className ?? '', date: t.date, title: t.title,
    materialId: t.materialId, materialTitle: t.materialId ? titles.get(t.materialId) ?? null : null, url: t.url, proofType: t.proofType,
    status: t.status, submittedAt: t.submittedAt, timeFrom: t.timeFrom, timeTo: t.timeTo,
    mediaPath: t.mediaKey ? `/practice-media/${encodeURIComponent(t.mediaKey)}` : null, mediaType: t.mediaType,
    note: t.note, feedback: t.feedback, rejectReason: t.rejectReason, recordedByTeacher: t.recordedByTeacher,
  }));
  return { serverNow: now.toISOString(), todayIct: today, classes, tasks };
});

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
```
(The row mapper above is reused by `api.practice.submit.tsx` — extract it into `practiceSvc.toApiTask(row, className, materialTitle)` so both routes share it.)

**`api.practice.submit.tsx`** — `withAuth('user')`, student only, `POST` multipart: read `form = await request.formData()`, parse `PracticeSubmitInput` from the string fields, `file = form.get('file')`; if `file instanceof File`: reject `> MEDIA_MAX_BYTES` with `fail('file_too_large', 413)`; accept only `image/jpeg|image/png|image/webp|video/mp4|video/quicktime` else `fail('bad_media_type', 415)`; `key = practiceSvc.mediaKeyFor(db.tenantId, studentTaskId, ext)`; `await env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type } })`. Then `practiceSvc.submit(db, user.user.id, input, media, todayIct)`; map service errors: `deadline_passed`→`fail('deadline_passed', 409)`, `proof_required`/`wrong_proof`→422, `not_found`→404, `already_done`→409. Return `toApiTask(...)`. `live: 'practice'` in the `withAuth` opts so open teacher tabs refresh.

**`api.practice.excuse.tsx`** — `withAuth('user')`, student only, JSON body `PracticeExcuseRequestInput` via `parseBody`; `practiceSvc.requestExcuse(db, user.user.id, input, todayIct)`; `deadline_passed` → 409. Returns the `PracticeExcuse` shape.

### 8.7 `practice-media.$key.tsx` (serving proof media)
Read `app/routes/logo-images.$key.tsx` (whole). Loader: `requireUser` (cookie) OR bearer via `requireStaffCookieOrBearer`-style — students use bearer, so implement: `const user = bearer(request) ? await requireApiUser(request, env) : await requireUser(request, env);` (`bearer` is private in `server/api/auth.ts` — export it, or replicate `request.headers.get('authorization')?.startsWith('Bearer ')`). Decode `params.key` with `decodeURIComponent`; it must match `/^t\/[A-Za-z0-9_-]+\/practice\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|mp4|mov)$/i` else 404; the tenant segment must equal `user.tenantId` else 404; a student may only fetch a key whose studentTaskId (3rd segment) belongs to them — look it up with `practiceSvc.getStudentTask(db, id)` and compare `studentId`. Stream `env.FILES.get(key)` with the stored content type, `cache-control: private, max-age=3600`. **No default export** (add the mandatory comment).

### 8.8 OpenAPI registry + tests + docs
- `server/api/docs/registry.ts`: three entries (`api/practice/my` GET auth `user`, response `c.PracticeMyResponse`; `api/practice/submit` POST auth `user` request `PracticeSubmitInput` (note: multipart; describe the `file` field in `description`), response `c.PracticeSubmitResponse`; `api/practice/excuse` POST auth `user` request `PracticeExcuseRequestInput`, response `c.PracticeExcuse`). Tag: `'Practice'`. Import the input schemas in the destructure at the top.
- `test-worker/api-docs.test.js` `ROUTE_FILES`: `['api/practice/my', 'api.practice.my']`, `['api/practice/submit', 'api.practice.submit']`, `['api/practice/excuse', 'api.practice.excuse']`.
- `docs/api.md`: three rows in the same table style.

### 8.9 Parent slip + portal
- `server/services/report-card.ts`: add `practiceSvc.studentPracticeForReport(db, studentId, month).catch(() => null)` to the `Promise.all` and `practice` to the returned object.
- `app/routes/report-extras.tsx`: add `practice` the same way (parallel fetch) and to the returned `data`.
- `src/assessments/report-slip.tsx`: read the file; add a card after the vocabulary homework card rendering `pr_slip_title`, `pr_slip_done`, `pr_slip_misses`, `pr_slip_warning` (only when `level > 0`) and the feedback lines (date · title — feedback). Render nothing when `practice` is null.
- Assessments report tab rail (`src/screens-assessments.tsx`, search `homework` / `report-extras`): add a small **Practice** card using the same data. If the rail component is hard to find within 10 minutes, skip this bullet and log it — the slip and the phone are the parent-facing surfaces that matter.

### 8.10 `scripts/test-accounts.sql` sweeps
After the tuition block add, with a comment in the file's style:
```sql
-- Practice (migration 0057). Nothing seeds these; a failed spec must not leave a class opted in
-- or a stray task for the next run. Children first, though every FK cascades from classes anyway.
DELETE FROM practice_warnings;
DELETE FROM practice_misses;
DELETE FROM practice_excuses;
DELETE FROM practice_student_tasks;
DELETE FROM practice_tasks;
DELETE FROM practice_day_overrides;
DELETE FROM practice_settings;
```

### 8.11 `e2e/crud-practice.spec.ts` (create in full)

```ts
import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * Practice (Nhiệm vụ): the teacher's whole web loop through the real dialogs — enable a class,
 * plan a day with quick add, edit and delete a task, mark one student done, see the ledger, and
 * disable again. Runs on calendar-test only (crudGuard). Every fixture is prefixed E2E and removed.
 */
test.describe('CRUD: practice', () => {
  crudGuard();

  test('enable → quick add → edit → mark done → ledger → delete → disable', async ({ page }) => {
    const k = ui(page);
    const stamp = Date.now();
    const line1 = `E2E practice task A ${stamp}`;
    const line2 = `E2E practice task B ${stamp}`;

    await signInStaff(page);
    await page.goto('/practice');
    await expect(page.getByRole('heading', { name: 'Practice' })).toBeVisible();

    // Enable for Biology 9A (seeded class c1 with Leo Park enrolled).
    const bio = page.locator('.mochi-card', { hasText: 'Biology 9A' });
    await bio.getByRole('button', { name: 'Enable Practice' }).click();
    const enabled = k.posted('/practice-actions');
    await k.dlgOf('Enable Practice').getByRole('button', { name: 'Save' }).click();
    await enabled;
    await expect(bio.getByText('Practice on', { exact: true })).toBeVisible();

    // Open this week's grid and quick-add two tasks on today's column.
    await bio.getByRole('link', { name: 'Open week' }).click();
    await page.waitForURL(/\/practice\/[^/]+\/week\/\d{4}-\d{2}-\d{2}/);
    const todayCol = page.locator('[data-testid="pr-day"][data-today="true"]');
    await expect(todayCol).toBeVisible();
    // Today may be a day off by default (class day); force it to be a practice day.
    if (await todayCol.getByText('Day off', { exact: true }).count()) {
      await todayCol.getByRole('button', { name: 'Day menu' }).click();
      const ov = k.posted('/practice-actions');
      await page.getByRole('menuitem', { name: 'Make practice day' }).click();
      await ov;
    }
    await todayCol.getByRole('button', { name: 'Add tasks' }).click();
    const dlg = k.dlgOf('Add tasks');
    await k.on(dlg).textIn('Tasks (one per line)').fill(`${line1}\n${line2}`);
    await k.on(dlg).pickSel('Proof', 'No proof needed');
    const added = k.posted('/practice-actions');
    await dlg.getByRole('button', { name: 'Save' }).click();
    await added;
    await expect(todayCol.getByText(line1, { exact: true })).toBeVisible();
    await expect(todayCol.getByText(line2, { exact: true })).toBeVisible();

    // Edit task A.
    const cardA = todayCol.locator('.mochi-card', { hasText: line1 });
    await cardA.getByRole('button', { name: 'Edit task' }).click();
    const edit = k.dlgOf('Edit task');
    await k.on(edit).textIn('Task').fill(`${line1} edited`);
    const edited = k.posted('/practice-actions');
    await edit.getByRole('button', { name: 'Save' }).click();
    await edited;
    await expect(todayCol.getByText(`${line1} edited`, { exact: true })).toBeVisible();

    // Mark Leo Park done on task B from the students dialog.
    await todayCol.getByRole('button', { name: 'Students on this day' }).click();
    const students = k.dlgOf('Students on this day');
    const leo = students.locator('[data-testid="pr-student-row"]', { hasText: 'Leo Park' });
    const done = k.posted('/practice-actions');
    await leo.locator('[data-testid="pr-copy"]', { hasText: line2 }).getByRole('button', { name: 'Mark done' }).click();
    await done;
    await expect(leo.locator('[data-testid="pr-copy"]', { hasText: line2 }).getByText('Recorded by teacher', { exact: true })).toBeVisible();
    await students.getByRole('button', { name: 'Close' }).click();

    // Ledger shows 1 done out of 2 for Leo.
    await page.getByRole('link', { name: 'Ledger' }).click();
    await page.waitForURL(/\/practice\/[^/]+\/ledger\/\d{4}-\d{2}/);
    const row = page.locator('tr', { hasText: 'Leo Park' });
    await expect(row.getByText('1 / 2', { exact: true })).toBeVisible();
    await expect(row.getByText('No Zalo pairing', { exact: true })).toBeVisible();

    // Back to the week; delete both tasks (B has a teacher_done copy → copy survives, task row goes).
    await page.goBack();
    for (const title of [`${line1} edited`, line2]) {
      const card = todayCol.locator('.mochi-card', { hasText: title });
      await card.getByRole('button', { name: 'Delete task' }).click();
      const del = k.posted('/practice-actions');
      await k.confirmDanger('Delete task').click();
      await del;
      await expect(card).toHaveCount(0);
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
> The screen must therefore render: `data-testid="pr-day"` with `data-today="true"` on today's column, a column `IconButton` with accessible name **Day menu** opening a menu whose items have `role="menuitem"` (check how other screens render menus — `src/screens-manage/classes.tsx` or `src/ui.tsx` may have a `Menu`; if none exists, render three plain `Button`s inside a small popover `div` with `role="menu"` and `role="menuitem"` buttons), `data-testid="pr-student-row"` per roster row and `data-testid="pr-copy"` per copy inside the students dialog, a footer **Close** button on that dialog, the ledger's done cell text exactly `1 / 2`, and the delete confirm dialog title **Delete task** / the disable confirm dialog title **Disable Practice** (pass those titles to `confirm({ title })`). `Edit task` / `Delete task` icon buttons need `aria-label` set to those strings.

---

## 9. Mobile (Phase 2) — student side

Read first: `mobile/app/(app)/_layout.tsx:25-40` and `:250-311`, `mobile/app/(app)/schedule.tsx` (whole — the list-screen template), `mobile/app/(app)/materials/[id].tsx:30-140` (photo pick + FormData + progress), `mobile/lib/endpoints.ts:90-160` and `:200-215`, `mobile/lib/query.ts:24-110`, `mobile/lib/use-garden.ts` (whole), `mobile/lib/push.ts:184-215`, `mobile/lib/types.ts:1-60`, `mobile/lib/contract-check.ts` (whole), `mobile/test/outbox.test.ts:1-60`, `mobile/app/(app)/notifications.tsx` (whole).

### 9.1 Types + contract + endpoints + keys
- `mobile/lib/types.ts`: add interfaces `PracticeStudentTask`, `PracticeMonthSummary`, `PracticeExcuse`, `PracticeMyResponse` mirroring §4.5 field-for-field (`string | null` for nullables).
- `mobile/lib/contract-check.ts`: under a new `/* ── Practice ── */` banner:
  ```ts
  type _PracticeStudentTask = Expect<Extends<Infer<typeof c.PracticeStudentTask>, t.PracticeStudentTask>>;
  type _PracticeMonthSummary = Expect<Extends<Infer<typeof c.PracticeMonthSummary>, t.PracticeMonthSummary>>;
  type _PracticeMyResponse = Expect<Extends<Infer<typeof c.PracticeMyResponse>, t.PracticeMyResponse>>;
  ```
- `mobile/lib/endpoints.ts`:
  ```ts
  export const practice = {
    my: () => apiFetch<PracticeMyResponse>('/api/practice/my'),
    submit: (form: FormData, onProgress?: (pct: number) => void) =>
      apiUpload<PracticeStudentTask>('/api/practice/submit', form, { onProgress }),
    requestExcuse: (input: PracticeExcuseRequestInput) =>
      apiFetch<PracticeExcuse>('/api/practice/excuse', { method: 'POST', body: input }),
  };
  ```
- `mobile/lib/query.ts`: `practice: ['practice'] as const` in `qk`.

### 9.2 `mobile/lib/practice-timer.ts` (create) + `mobile/test/practice-timer.test.ts`
Pure, persisted timer: the app may be backgrounded or killed mid-task, so the timer stores `startedAt` (ISO) in AsyncStorage keyed by student task id and derives elapsed from the clock; ticks only re-render.
```ts
/**
 * Practice timer state. Persisting `startedAt` (not a tick count) is what makes the timer honest
 * across a lock screen or an app kill: elapsed is always `now - startedAt`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = (id: string) => `mochi_practice_timer_v1:${id}`;

export type TimerState = { startedAt: string | null; stoppedAt: string | null };

export async function readTimer(id: string): Promise<TimerState> {
  try {
    const raw = await AsyncStorage.getItem(KEY(id));
    return raw ? (JSON.parse(raw) as TimerState) : { startedAt: null, stoppedAt: null };
  } catch {
    return { startedAt: null, stoppedAt: null };
  }
}
export async function startTimer(id: string, now: Date): Promise<TimerState> {
  const s = { startedAt: now.toISOString(), stoppedAt: null };
  await AsyncStorage.setItem(KEY(id), JSON.stringify(s));
  return s;
}
export async function stopTimer(id: string, now: Date): Promise<TimerState> {
  const cur = await readTimer(id);
  const s = { startedAt: cur.startedAt ?? now.toISOString(), stoppedAt: now.toISOString() };
  await AsyncStorage.setItem(KEY(id), JSON.stringify(s));
  return s;
}
export async function clearTimer(id: string): Promise<void> {
  await AsyncStorage.removeItem(KEY(id));
}
/** 'HH:mm' in ICT for a UTC instant (the school's clock, not the device's). */
export function ictHm(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 60 * 60_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
/** '20:50–21:26' from a timer state; null until started. */
export function timeRange(s: TimerState, now: Date): { from: string; to: string } | null {
  if (!s.startedAt) return null;
  return { from: ictHm(s.startedAt), to: ictHm(s.stoppedAt ?? now.toISOString()) };
}
/** 'm:ss' / 'h:mm:ss' elapsed. */
export function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
```
Test (`mobile/test/practice-timer.test.ts`): mock `@react-native-async-storage/async-storage` with an in-memory Map (check `mobile/test/` for an existing stub of it; if none, `vi.mock` inline with `getItem/setItem/removeItem`). Cases: start→read round-trip; stop keeps `startedAt`; `ictHm('2031-03-03T13:05:00Z')` → `'20:05'`; `timeRange` uses `now` while running; `fmtDuration(65_000)` → `'1:05'`, `fmtDuration(3_600_000)` → `'1:00:00'`.

### 9.3 `mobile/lib/use-practice.ts` (create)
```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './endpoints';
import { qk } from './query';
import type { PracticeExcuseRequestInput } from '@mochi/shared/schemas';

/** Computed against the server clock → never trust the cache across a day boundary. */
export function usePracticeMy(enabled = true) {
  return useQuery({ queryKey: qk.practice, queryFn: api.practice.my, staleTime: 0, refetchOnMount: 'always', enabled });
}
export function useSubmitPractice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { form: FormData; onProgress?: (pct: number) => void }) => api.practice.submit(args.form, args.onProgress),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.practice }),
  });
}
export function useRequestExcuse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PracticeExcuseRequestInput) => api.practice.requestExcuse(input),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.practice }),
  });
}
```

### 9.4 Screens — `mobile/app/(app)/practice/`
Nested stack like `mobile/app/(app)/vocabulary/_layout.tsx` (read it and copy the `Stack` setup).

**`index.tsx`** — copy `schedule.tsx`'s skeleton (`Screen`, `ScrollView` + `RefreshControl`, `ActivityIndicator`, `Card`, `Heading`, `Body`, `Muted`, `Tag`; theme tokens only). Data: `usePracticeMy()`. Top: per class a compact balance line `t('m_pr_balance', { used, quota, unexcused })`; when `summary.pendingMultiplier > 0` a danger `Tag` `t('m_pr_penalty', { n, date })`; when `level > 0` a warning `Tag` `t('m_pr_warning', { n: level })`. Then **Today** (`m_pr_today`) section: tasks with `date === todayIct`, plus a `Muted` `m_pr_deadline` line; **Upcoming** (`m_pr_upcoming`): later dates grouped by date using `dayLabel` from `schedule.tsx` (copy that helper). Each task = tappable `Card` → `router.push('/practice/[id]')` with status `Tag` (`m_pr_submitted` / `pr_status_accepted` / `m_pr_rejected` / `pr_status_teacher_done`), material title + link icon, and a feedback preview when present. Empty state `m_pr_empty`. Error state as in `vocabulary/garden/[classId]/index.tsx:58-66` (`t('m_offline')`). Header right: **Request excuse** (`m_pr_request_excuse`) → `router.push('/practice/excuse')`.

**`[id].tsx`** — task detail: title, class, date, material (open `url` with `Linking.openURL`), proof requirement line. Timer block: `Start timer` / `Stop timer` buttons (`practice-timer.ts`), elapsed via a 500 ms `setInterval` reading `Date.now()` (MatchGame pattern), the resulting **Time worked** `from–to` with **Edit** (two `TextInput`s `HH:mm`, validate `/^\d{2}:\d{2}$/`). Note input (`m_pr_note_ph`). Media: **Take photo** (`ImagePicker.launchCameraAsync({ quality: 0.6 })`), **Add photo** (`launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 })`), and — Phase 3 — **Add video**. Show a thumbnail (`Image`) once picked. **Submit** button: disabled until (a) proof satisfied per `proofType`, (b) online (`onlineManager.isOnline()` from react-query — show `m_pr_offline`), (c) not currently uploading. On press: build `FormData` (`studentTaskId`, `timeFrom`, `timeTo`, `note`, and `file` as `{ uri, name, type }`), call `useSubmitPractice().mutateAsync({ form, onProgress: setPct })`, show `ProgressBar` with `m_pr_uploading`; on success `clearTimer(id)` and `router.back()`. Status `rejected` shows `m_pr_rejected` with the reason and the button reads **Resubmit** (`m_pr_resubmit`). Status `accepted`/`teacher_done`/`submitted`: read-only summary + **Teacher feedback** (`m_pr_feedback`) when present. A task whose `date < todayIct` shows `m_pr_excuse_late` guidance instead of the submit button.

**`excuse.tsx`** — class picker (only when >1 enabled class; `ChipSelect`), date picker limited to today…today+7 practice days (`DateTimeField` from `~/components`, or a `ChipSelect` of the `practiceDays` strings — simpler and enough), **Reason** multiline `Input`, **Request excuse** button → `useRequestExcuse()`; on success show `m_pr_excuse_sent` and `router.back()`. If the chosen date `< todayIct` the button is disabled with `m_pr_excuse_late`. Existing requests list with status tags (`m_pr_excuse_pending/approved/rejected`).

### 9.5 Tab registration
`mobile/app/(app)/_layout.tsx`:
1. `STUDENT_TAB_ROOTS = ['/vocabulary', '/schedule', '/practice', '/profile'];` (`:34`).
2. Add a module-scope icon like `TabIconSchedule` (`:347-349`) named `TabIconPractice` using lucide `ClipboardCheck`.
3. Insert after the `schedule` screen (`:258-267`) and before `more`:
   ```tsx
   <Tabs.Screen name="practice" options={{ title: t('m_pr_tab'), href: staff || parent ? null : undefined, tabBarIcon: TabIconPractice }} />
   ```
4. Update the stale header comment at `:125-126` to say a student has 4 tabs (Vocabulary, My schedule, Practice, Profile).
5. `mobile/lib/push.ts` `useNotificationRouting` (`:184-215`): add `if (data.kind === 'practice') return router.replace('/practice');` before the `url` fallback (copy the garden branch's exact router call).
6. `mobile/app/(app)/notifications.tsx`: add a `Switch` row `notif_practice_reminders` / `notif_practice_reminders_sub` bound to `practiceReminders` (copy the `gardenAlerts` row).
7. After adding screens run `cd f:/code/calendar/mobile && npx expo start --clear` for ~40 s in the background, kill it, then `npx tsc --noEmit` (route types).

### 9.6 `mobile/test/practice-endpoints.test.ts`
Copy `mobile/test/api.test.ts`'s `loadApi`/`mockFetch` pattern; assert `practice.my()` calls `GET /api/practice/my` with a Bearer header and unwraps `{ data }`, and `practice.requestExcuse()` POSTs JSON. (The upload path uses XHR and is covered by the existing `apiUpload` tests — do not mock XHR.)

---

## 10. Video proof (Phase 3) — native change

Read first: `mobile/app.config.ts:80-110` (plugins) and `:140-177`, `shared/version.json`, `mobile/package.json`, `docs/mobile/TESTING.md:280-290`.

1. `cd f:/code/calendar/mobile && npx expo install react-native-compressor react-native-nitro-modules` (Expo picks compatible versions; if it refuses `react-native-compressor` for SDK 57, `npm install react-native-compressor@2.0.3 react-native-nitro-modules@latest --save-exact` and log it). Do NOT run `expo prebuild` — EAS does it.
2. `mobile/app.config.ts` plugins: add `'react-native-compressor'` and `['expo-image-picker', { cameraPermission: 'Mochi dùng camera để chụp minh chứng nhiệm vụ.', microphonePermission: 'Mochi dùng micro khi quay video minh chứng.' }]`. Android permissions array: add `'CAMERA'`, `'RECORD_AUDIO'`, `'READ_MEDIA_IMAGES'`, `'READ_MEDIA_VIDEO'`. Extend the comment block at `:100-103` with today's date and the reason (video proof).
3. `shared/version.json`: `"runtimeVersion": 4`. Nothing else in that file changes.
4. `[id].tsx` **Add video**: `ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], videoMaxDuration: 60 })` and a **Record video** camera variant (`launchCameraAsync({ mediaTypes: ['videos'], videoMaxDuration: 60 })`); reject `duration > 60_000` with `m_pr_video_too_long`. Then:
   ```ts
   import { Video } from 'react-native-compressor';
   setPhase('compressing');
   const out = await Video.compress(asset.uri, { compressionMethod: 'auto', maxSize: 1280 }, (p) => setPct(Math.round(p * 100)));
   ```
   Guard the import with `requireOptionalNativeModule`-style try/catch **at call time** (the JS bundle for runtime 4 always has the module, but keep the import lazy: `const { Video } = await import('react-native-compressor')`). Size check after compression: `> MEDIA_MAX_BYTES` → `m_pr_file_too_big`. Append as `{ uri: out, name: 'proof.mp4', type: 'video/mp4' }`.
5. `docs/mobile/TESTING.md`: add a "Practice" block to the manual matrix (photo submit, video submit, timer survives background, excuse request, reminder push, penalty push) and fix the "three channels" sentence (`:398`) to two. Also fix `mobile/lib/push.ts:20-30` comment ("Three channels" → "Two channels").
6. `cd f:/code/calendar/mobile && npm test && npx tsc --noEmit`.

---

## 11. Walkthrough (Phase 4a)

Read `shared/walkthrough.ts:41-105` (types), `:691-726` (an example story), `test/walkthrough.test.ts:62-67`. Add two `TourStory` objects to `STORIES` in the `teaching`-equivalent journey (find the journey whose stories cover `/materials` / `/classes` and use its `id`; `account: 'staff'`) and change the count assertion `27` → `29`:

```ts
{
  id: 'practice-plan-week',
  journey: '<same journey id as content-materials>',
  title: 'Enable Practice for a class and plan a day with quick add',
  tag: 'write',
  route: '/practice',
  account: 'staff',
  specs: ['crud-practice.spec.ts'],
  steps: [
    { kind: 'goto', text: 'Open Practice', route: '/practice' },
    { kind: 'click', text: 'On a class card click Enable Practice', target: { button: 'Enable Practice' }, opensDialog: 'Enable Practice' },
    { kind: 'check', text: 'Leave the weekdays untouched the first time — Mochi derives Mon–Sat minus the days this class meets, Sunday off' },
    { kind: 'submit', text: 'Press Save', target: { button: 'Save' }, post: '/practice-actions' },
    { kind: 'click', text: 'Click Open week', target: { button: 'Open week' } },
    { kind: 'click', text: "On today's column click Add tasks", target: { button: 'Add tasks' }, opensDialog: 'Add tasks' },
    { kind: 'fill', text: 'One task per line', dialog: 'Add tasks',
      fields: [{ field: 'Tasks (one per line)', value: 'WALKTHROUGH Workbook p.4-7\nWALKTHROUGH Grammar in Use unit 4' }] },
    { kind: 'submit', text: 'Press Save', target: { button: 'Save' }, post: '/practice-actions' },
    { kind: 'check', text: 'Two task cards appear under today; each shows a proof tag and a done/total count' },
    { kind: 'check', text: 'Cleanup: delete both WALKTHROUGH tasks from the column, then Disable Practice on the class card' },
  ],
},
{
  id: 'practice-review-ledger',
  journey: '<same journey id>',
  title: 'Review a submission and read the ledger',
  tag: 'read',
  route: '/practice/review',
  account: 'staff',
  specs: ['crud-practice.spec.ts'],
  steps: [
    { kind: 'goto', text: 'Open the review queue', route: '/practice/review' },
    { kind: 'check', text: 'Submitted proofs are listed newest first with photo/video, time worked and the student note; Accept, Reject (with reason) and Save feedback act on one row' },
    { kind: 'check', text: 'Excuse requests sit above the queue with Approve / Reject' },
    { kind: 'goto', text: 'Open a class ledger for this month', route: '/practice' },
    { kind: 'click', text: 'Click Open ledger on an enabled class', target: { button: 'Open ledger' } },
    { kind: 'check', text: 'Each student row shows done/total, excused used out of quota, unexcused, the ×N badge and warning level, and "No Zalo pairing" when parents cannot be messaged' },
  ],
},
```
(`fill` values must start with `WALKTHROUGH` and the last step of a filling story must contain "Cleanup" — the test enforces both.)

---

## 12. The sequence — tick as you go

Each step names the section with the code. "Check" steps must actually be run; paste the last line of
their output into the Execution log if anything is red.

### Phase 0 — preflight
- [x] **Step 0.** `cd f:/code/calendar && git status --short` is empty and `git rev-parse --abbrev-ref HEAD` is `main`. `git pull --ff-only`. `node -v` starts with `v24`. `ls migrations | tail -1` is `0056_logo_library.sql` (else renumber every `0057` in this plan to the next free number).
- [x] **Step 1.** Read the files listed at the top of §6, §7, §8.3, §8.5, §9 (about 25 minutes of reading). Do not skip — the plan's code assumes their exact exports.

### Phase 1 — schema, rules, server, web
- [x] **Step 2.** Create `migrations/0057_practice.sql` (§3.1). Apply locally to prove it parses: `cd f:/code/calendar && npx wrangler d1 migrations apply mochi-class --local` (creates a throwaway local D1; harmless).
- [x] **Step 3.** Append the Drizzle tables to `server/db/schema.ts` (§3.2). `npm run typecheck`.
- [x] **Step 4.** `shared/schemas.ts` (§4.1), `shared/logic/assess.ts` (§4.2), `server/services/notif-prefs.ts` + `server/services/report-card.ts:74-79` unchanged but verify `missing_practice` now reaches `NEGATIVE_TYPES` (it does via assess.ts). Add `bh_missing_practice` + `nav_practice` + `notif_practice_reminders*` to strings (§5) now; the rest of §5 in Step 12.
- [x] **Step 5.** Create `shared/logic/practice.ts` (§4.3) and `test/practice-logic.test.ts` (§4.4). Run `cd f:/code/calendar && npx vitest run test/practice-logic.test.ts` → all green. If `parseISO`/`iso`/`addDays` are not exported from `shared/logic/dates.ts` under those names, open the file and use its real names — do not reimplement.
- [x] **Step 6.** `shared/api-contract.ts` (§4.5) including the `practice` field on `ParentReportResponse`. `npm run typecheck`.
- [x] **Step 7.** Create `server/services/practice.ts` (§6). `npm run typecheck` until clean (expect 2–4 rounds: Drizzle inferred types, `db.batch` tuple typing, unused imports).
- [x] **Step 8.** `server/services/notify.ts` edits + `wrangler.jsonc` crons + `workers/app.ts` docblock + `notif-prefs.ts` + `api.push.run.tsx` (§7.1); create `server/services/practice-notify.ts` (§7.2). `npm run typecheck`.
- [x] **Step 9.** Create `test-worker/practice.test.js` (§7.3). Run `cd f:/code/calendar && npx vitest run --config vitest.workers.config.js test-worker/practice.test.js` → green. Then the tripwire: `npx vitest run test/tenant-scope.test.ts` → green.
- [x] **Step 10.** Routes: `app/routes.ts` (§8.1), nav/title/cache/live (§8.2), `practice-actions.tsx` (§8.3), the four page routes (§8.4), the three API routes + media route (§8.6, §8.7), registry + `ROUTE_FILES` + `docs/api.md` (§8.8), report card/slip/extras (§8.9), sweeps (§8.10). `npm run typecheck`, then `npx vitest run test/api-docs-completeness.test.ts test/api-contract.test.ts test/page-title.test.ts test/sidebar-sections.test.tsx test/routes.test.tsx`.
- [x] **Step 11.** Web screens `src/practice/practice-home.tsx`, `practice-week.tsx`, `practice-review.tsx`, `practice-ledger.tsx` (§8.5). Wire default exports from the four page routes. Every string through `t()`; every button the e2e spec names has exactly that accessible name.
- [x] **Step 12.** All remaining §5 strings in both blocks. `npm run check:i18n` → clean (only "unused" informational lines allowed).
- [x] **Step 13.** Create `e2e/crud-practice.spec.ts` (§8.11). `npx tsc --noEmit -p tsconfig.json` still clean (the e2e dir is type-checked by the root config — if it is not, run `npx tsc --noEmit e2e/crud-practice.spec.ts --esModuleInterop --skipLibCheck` to catch typos).
- [x] **Step 14.** Check: `npm run typecheck && npm run lint && npm run check:i18n`; `npx prettier --write` on every file you created or edited (list them from `git status --short`).
- [x] **Step 15.** Check (granted): `cd f:/code/calendar && npm test`. Fix anything red that your changes caused. Log the final counts.

### Phase 2 — mobile
- [x] **Step 16.** Types/contract/endpoints/keys (§9.1). `cd f:/code/calendar/mobile && npx tsc --noEmit`.
- [x] **Step 17.** `mobile/lib/practice-timer.ts` + `mobile/test/practice-timer.test.ts` (§9.2); `mobile/lib/use-practice.ts` (§9.3); `mobile/test/practice-endpoints.test.ts` (§9.6). `cd f:/code/calendar/mobile && npm test` → green.
- [x] **Step 18.** Screens (§9.4) and tab registration + push routing + notifications switch (§9.5). Regenerate route types (§9.5 item 7). `npx tsc --noEmit`.
- [x] **Step 19.** Check: `cd f:/code/calendar/mobile && npm test && npx tsc --noEmit`.

### Phase 3 — video
- [x] **Step 20.** Install deps, plugins, permissions, `runtimeVersion: 4` (§10 items 1–3). Confirm `git diff shared/version.json` shows exactly one changed line.
- [x] **Step 21.** Video pick + compress + submit in `[id].tsx` (§10 item 4). Docs (§10 item 5).
- [x] **Step 22.** Check: `cd f:/code/calendar/mobile && npm test && npx tsc --noEmit`. Then (granted, ~1 min) `cd f:/code/calendar/mobile && npm run test:bundle` — the packaging guard must pass; it needs `EXPO_PUBLIC_API_URL` from `mobile/.env.local` (if that file is missing, set `$env:EXPO_PUBLIC_API_URL='https://calendar.ngqv0712.workers.dev'` for the command).

### Phase 4a — walkthrough
- [x] **Step 23.** Two stories + count bump (§11). `npx vitest run test/walkthrough.test.ts` → green.
- [x] **Step 24.** Add to `docs/superpowers/plans/2026-09-01-walkthrough-continuation.md` under its file map a one-line note that `/practice` stories exist (keeps that living doc honest).

### Phase 4b — full verification before the commit
- [x] **Step 25.** `cd f:/code/calendar && npm run typecheck && npm run lint && npm run check:i18n && npm test` — all green (log counts).
- [x] **Step 26.** `cd f:/code/calendar/mobile && npm test && npx tsc --noEmit` — green.
- [x] **Step 27.** Deploy the test env WITH the new migration: `cd f:/code/calendar && npm run test:env:setup` (5–8 min; rebuilds with `CLOUDFLARE_ENV=test`, applies migrations to `mochi-class-test`, redeploys, reseeds). Verify the stamp changed: `curl -s https://calendar-test.ngqv0712.workers.dev/login | Select-String -Pattern 'v0\.\d{4}'` shows a build number one higher than `git rev-list --count HEAD` minus 135… simpler: `curl -s -o /dev/null -w "%{http_code}" https://calendar-test.ngqv0712.workers.dev/practice-actions` must be `405`/`400`/`302`, not `404`.
- [x] **Step 28.** `npm run test:e2e:staging -- --grep "practice"` → the new spec green. Fix and rerun (max 3 laps). Then the whole suite: `npm run test:e2e:staging` (≈4–13 min). Compare against the 4 known failures (§0.4 item 7); anything else red is yours — fix and rerun the affected spec.
- [x] **Step 29.** Re-run Step 25 + 26 after any fix.

### Phase 4c — the single commit + push + prod follow-through
- [x] **Step 30.** Stage by name: every file in `git status --short` that you created or edited (there must be no untracked `.js` files from a stray `tsc -b`; `mobile/.expo/` is gitignored — confirm with `git status --short | Select-String expo`). Include this plan file.
- [x] **Step 31.** `node scripts/changelog.mjs "feat(practice): Nhiệm vụ tracker — teacher weekly grid + review queue + ledger, student mobile tab with timer and photo/video proof, nightly miss/penalty crons, parent slip block; runtimeVersion 3→4"` (it stages CHANGELOG.md).
- [x] **Step 32.** Commit (one commit). Message body: bullet the four phases, the migration number, the runtimeVersion bump, and the test counts. End with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` (that is the attribution for this repo per the session instructions — copy it exactly).
- [x] **Step 33.** `git push origin main`. On 403 apply §0.4 item 16 and retry once.
- [x] **Step 34.** Wait for Workers Builds (2–4 min), then verify the deploy: `curl -s -o /dev/null -w "%{http_code}" https://calendar.ngqv0712.workers.dev/practice-actions` → not `404`. If still 404 after 6 minutes, check `curl -s "https://api.github.com/repos/VuNQ-Jeremy/calendar/actions/runs?per_page=3"` and log; continue.
- [x] **Step 35.** Prod migration (granted): `cd f:/code/calendar && npx wrangler d1 migrations list mochi-class --remote`. If `0057_practice.sql` is listed as pending: `npx wrangler d1 migrations apply mochi-class --remote`. Re-list to confirm empty. If wrangler reports an auth error, the account token is wrong — do NOT `wrangler login`; log it and move on.
- [x] **Step 36.** Live smoke on prod as staff (cookie flow per memory `live-verify-authed-pages`, or simply Playwright headless): sign in as `dev@mochi.edu`, `GET /practice` renders the class list with **Enable Practice** buttons. Do not enable anything yet (Step 46 does, with cleanup).

### Phase 4d — OTA, APK, emulator
- [x] **Step 37.** OTA: `cd f:/code/calendar/mobile && npx eas-cli workflow:runs` — top entry should be your commit, `SUCCESS`, trigger `GitHub` (allow 3 min). If `FAILURE`/missing (free-tier CI quota), publish manually (granted): `npx eas-cli update --branch preview --platform android --environment preview --message "practice tracker (runtime 4)"`. Verify what runtime 4 serves:
  ```
  cd f:/code/calendar; $rv = node -p "require('./shared/version.json').runtimeVersion"; curl -s -H "expo-platform: android" -H "expo-runtime-version: $rv" -H "expo-channel-name: preview" -H "expo-protocol-version: 1" -H "accept: multipart/mixed" https://u.expo.dev/83251f6c-1fa9-4724-ba61-39a9eb806aab | Select-String gitSha
  ```
  The `gitSha` must be your commit. Log it.
- [x] **Step 38.** APK (granted): `cd f:/code/calendar/mobile && npx eas-cli build -p android --profile preview --non-interactive --no-wait` → note the build id/URL. Poll every 3 minutes (max 45 min): `npx eas-cli build:view <id> --json` (or `build:list --platform android --limit 1 --json --non-interactive`) until `status` is `FINISHED`; take `artifacts.buildUrl`. If `ERRORED`, fetch logs with `npx eas-cli build:view <id>`, fix if it is a config error in files you touched (typical: plugin name, permission string), re-run once; otherwise log and skip to Step 47.
- [x] **Step 39.** Download: `curl -L -o "$env:TEMP\mochi-practice.apk" <buildUrl>` (PowerShell) — file size must be > 30 MB.
- [x] **Step 40.** Emulator up: `& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd mochi_dev -no-snapshot-load -no-boot-anim` in the background (Bash tool `run_in_background`, or PowerShell `Start-Process`). Wait: loop `adb shell getprop sys.boot_completed` until `1` (max 4 min). Probe: `adb shell am force-stop com.mochi.lms` must return within 5 s (else kill emulator and reboot once).
- [x] **Step 41.** `adb install -r "$env:TEMP\mochi-practice.apk"`. If it fails with a signature mismatch, `adb uninstall com.mochi.lms` then install (this loses the dev-client build — acceptable, log it).
- [x] **Step 42.** Create `scripts/adb-ui.mjs` (commit it in Step 48) — a tiny helper used by the smoke: `dump()` (`adb shell uiautomator dump /sdcard/ui.xml` + `adb pull` + parse `bounds="[x1,y1][x2,y2]"` per node with `text`/`content-desc`), `tapText(t)` (center of the first node whose text or content-desc equals `t`), `type(text)` (`adb shell input text` with spaces as `%s`), `shot(name)` (`adb shell screencap -p /sdcard/s.png` + `adb pull` to `docs/superpowers/reviews/2026-09-03-practice-smoke/<name>.png`), `back()` (`adb shell input keyevent 4`), `wait(ms)`. Node 24, no deps.
- [x] **Step 43.** Prepare prod fixtures as staff, via Playwright headless against `https://calendar.ngqv0712.workers.dev` (a throwaway script in the scratchpad, NOT a repo spec): sign in `dev@mochi.edu`, enable Practice for **Biology 9A**, force today as a practice day if it shows **Day off**, quick-add one task `WALKTHROUGH smoke photo ${Date.now()}` with proof **Photo**. Leave the browser context open for Step 45.
- [x] **Step 44.** Student flow on the emulator with `adb-ui.mjs`: launch `adb shell am start -n com.mochi.lms/.MainActivity`; wait 8 s; `shot('01-launch')`. If the login screen shows the Zalo tab, `tapText('Email')`. Tap the email field (text `you@school.edu`), `type('vunq@mochi.edu')`; tap the password field (the node below), `type('mochi123')`; `tapText('Sign in')`; wait 10 s; `shot('02-home')`. `tapText('Practice')` (bottom tab); wait 4 s; `shot('03-practice-list')` — the WALKTHROUGH task must be visible (assert via `dump()` containing the title; if not, pull-to-refresh: `adb shell input swipe 500 600 500 1400`). Tap the task; `shot('04-task')`; `tapText('Start timer')`; wait 3 s; `tapText('Stop timer')`. Photo: push an image first — `adb push <any small jpg from mobile/assets/images> /sdcard/Pictures/proof.jpg` and `adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/proof.jpg`; `tapText('Add photo')`; in the system picker tap the first thumbnail (dump; pick the first node with `class="android.widget.ImageView"` inside the picker, or `tapText('Pictures')` then the image); wait; `shot('05-photo-picked')`; `tapText('Submit')`; wait 8 s; `shot('06-submitted')` — dump must contain `Submitted`. Then `back()` twice and `shot('07-list-after')`. Each `tapText` that fails to find its node: `shot('err-<step>')`, log, and continue to the cleanup.
- [x] **Step 45.** Teacher review via the Step 43 Playwright context: open `/practice/review`, assert the WALKTHROUGH submission is listed with an `<img src="/practice-media/…">` that returns 200 (fetch it with the page's cookies), click **Accept**; `screenshot` → `docs/superpowers/reviews/2026-09-03-practice-smoke/08-review-accepted.png`. Open the ledger for this month; screenshot `09-ledger.png` (Leo Park: `1 / 1`).
- [x] **Step 46.** Cleanup on prod (mandatory): delete the WALKTHROUGH task (its accepted copy survives by design — remove it via the students dialog is not possible for non-open copies, so instead run, from `f:/code/calendar`, `npx wrangler d1 execute mochi-class --remote --command "DELETE FROM practice_student_tasks WHERE title LIKE 'WALKTHROUGH smoke%'"`), remove any day override you created (**Use weekly default**), then **Disable Practice** on Biology 9A. Delete the R2 object: `npx wrangler r2 object delete mochi-files/<mediaKey>` (the key is in the ledger row / the `img src`). Confirm `/practice` shows **Enable Practice** for Biology 9A again. Sign out of the emulator app is not required.
- [x] **Step 47.** Fill the **Execution log** below: unit counts, e2e counts vs baseline, prod migration state, OTA `gitSha`, APK URL + size, emulator results per screenshot, anything skipped and why.
- [x] **Step 48.** The single allowed follow-up commit, docs only: this plan file (ticked + log), `scripts/adb-ui.mjs`, `docs/superpowers/reviews/2026-09-03-practice-smoke/*.png` (≤ 9 PNGs, each < 400 KB — downscale with `magick`/`sharp` only if available, else leave). `node scripts/changelog.mjs "docs(practice): overnight verification log + adb smoke helper"`, commit with the same trailer, push. (This second push republishes an identical bundle; harmless.)

### If something blocks
- A failing unit/e2e test you cannot fix in 3 attempts: mark the spec `test.fixme` with a one-line reason, log it, continue. Never delete a test.
- `eas build` unavailable/errored: skip Steps 39–46, log the error text, still do 47–48.
- Emulator will not boot: skip 41–46, log, still do 47–48.
- Anything that would need a decision: pick the option that changes the fewest files, log the choice under "Decisions taken by the executor".

---

## 13. Self-review notes (author, 2026-09-03)

- Spec coverage: every row of §1 maps to code in §3–§11; #25's Zalo indicator is §8.4 ledger loader + §8.5; #21 (missing the ×N day) is `applyUnexcusedMiss` on an already-pending warning and is pinned by a test in §4.4.
- Deliberate simplifications: one submission row per copy (a resubmit overwrites); quota derived, never stored; `class_teachers` not built; scores excluded; per-student tasks have no class row.
- Known soft spots for the executor to verify by reading, not assuming: `parsePatch` signature, `events.exdates` storage type, `strings` export name, `db.batch` tuple typing, DS textarea availability, menu component availability, `peopleSvc.createStudent` signature.

---

## Execution log

Run: 2026-09-03 23:30 → 2026-09-04 02:40 ICT, unattended, Claude Opus 5. Every step 0–48 executed.

- **Started:** 2026-09-03 23:32 ICT. Tree clean, `main`, node v24.16.0, last migration `0056` (so `0057` was free).
- **Unit (web):** `npx vitest run` → **912 passed, 1 failed** (60 files). The failure is
  `test/tenant-scope.test.ts` → `app/routes/logo-library.tsx` imports `createRawDb` outside the
  allowlist. Pre-existing and unrelated; nothing in this commit touches that file.
- **Unit (worker):** `npm run test:worker` → **437 passed, 17 failed** across 5 files. All 17 are
  `env` being undefined (`env.GAME_ROOM`, `env.EMAIL_API_KEY`) — missing local secrets and DO
  bindings on this machine. Verified pre-existing: `git stash -u` on a clean tree reproduced the
  same failure in `test-worker/services.test.js` exactly.
- **Mobile:** `npm test` → **91 passed** (10 files, incl. the two new ones). `npx tsc --noEmit` clean.
  `npm run test:bundle` passes with `EXPO_PUBLIC_API_URL` set (8 MB android bundle, URL baked in).
- **Static:** `npm run typecheck`, `npm run lint` (only the two pre-existing warnings) and
  `npm run check:i18n` (2038 en / 2038 vi) all clean. Prettier run on every touched file only.
- **e2e staging:** `npm run test:env:setup` then `npm run test:e2e:staging` →
  **139 passed, 4 failed, 2 flaky (27.3 min)**. `crud-practice.spec.ts` **passed**.
  Failures vs the §0.4 baseline: `pvp` "room battle" ✔ baseline, `crud-feedback-profile`
  "changelog: hide" ✔ baseline, `crud-vocab-curriculum` "grade filter" ✔ baseline, plus
  `crud-calendar-drag` "dragging a recurring event asks which occurrences" — NOT on the baseline
  list, but it times out waiting for the calendar's own "Previous month" button and this commit
  touches no calendar code (see the memory note `mochi-calendar-drag-opens-editor`). The baseline's
  fourth item (`sidebar-collapse` "hairline scrollbar") passed this run. Flaky-then-passed:
  `crud-calendar-drag` one-off drag, `pvp` face-off.
- **Commit:** `d271e74`, pushed to `main`. Workers Builds deployed it (`/practice-actions` answers
  400, not 404).
- **Prod migration 0057:** already applied when checked (`No migrations to apply!`); confirmed by
  querying `sqlite_master` — all **7** `practice_*` tables exist on `mochi-class`.
- **OTA runtime 4 gitSha:** workflow `publish-preview-update.yml` run `01a0686b` **SUCCESS** for
  `d271e74`; the manifest for `expo-runtime-version: 4` serves `"gitSha":"d271e74"`.
- **APK:** first build `711c8bee` **ERRORED** — Gradle could not resolve four core Expo modules
  because `repo.maven.apache.org` answered **429 Too Many Requests**. Infrastructure, not config,
  so it was re-run once as the plan allows: `694df0a6` **finished**,
  `https://expo.dev/artifacts/eas/cN2HdPaQJdInlgKHCuE1FNQmJ08uzjs7fWnCJNt1xn8.apk`, **132 MB**,
  version code 7, runtime 4. Installed on `mochi_dev` with `adb install -r` (no signature clash).
- **Emulator smoke** (`scripts/adb-ui.mjs`, screenshots in
  `docs/superpowers/reviews/2026-09-03-practice-smoke/`):
  - The in-app version row read `v0.0000 · rt4 · d271e74 · embedded` — the right binary.
  - Staff (`dev@mochi.edu`) sees **no** Practice tab. Correct: it is student-only.
  - Student (`vunq@mochi.edu`) has four tabs — Vocabulary, My schedule, **Practice**, Your profile.
  - `03-practice-list`: the balance line "Bamblebee · Excused 0/4 · Unexcused 0" (quota 4 = the
    carried month) and the task under **Today**.
  - `04-task`: "Proof: Photo", the timer at 0:00, the student note, Take photo / Add photo, and the
    "This task needs a Photo before you can submit" hint above a disabled Submit.
  - `04c/04e`: timer ran and stopped — "Time worked 1:14", reported as the ICT range **02:24–02:26**
    with an Edit button.
  - `05b`/`06`: photo attached from the system picker, Submit uploaded, the screen popped back and
    the card now carries the **Submitted** tag.
  - `08`/`09`: on the web the submission appeared in the review queue, its
    `/practice-media/…` URL returned **200** to the teacher's cookie, Accept worked, and the ledger
    rendered.
- **Cleanup confirmed on prod:** proof object deleted from R2; every one of the seven `practice_*`
  tables and `behavior_records WHERE type='missing_practice'` back to **0 rows**; the day override
  removed and Practice switched off, then the settings row deleted so prod is byte-for-byte as
  found. `/practice` shows **Enable Practice** again.

### Decisions taken by the executor

1. **Commit trailer** is `Co-Authored-By: Claude Opus 5 (1M context)`, not the plan's Fable line —
   the session's own attribution instruction explicitly replaces earlier guidance.
2. **Per-page cache keys.** §8.2 said every `/practice*` page shares `K.practice`. `swrLoad` is
   keyed, so two weeks under one key would serve week A's grid at week B's URL. Added
   `practiceWeekKey` / `practiceLedgerKey` / `PRACTICE_REVIEW_KEY`, all under the `route:practice`
   prefix, so one invalidation still drops them together.
3. **The dialogs must not own the fetcher.** They close optimistically, and `useFetcher`'s unmount
   cleanup aborts the request it just started — the edit-task POST vanished about half the time.
   `usePracticeSubmit` is now created in the screen and passed down; the rule is written into its
   doc comment.
4. **Blank `<select>` values are nulled in the action.** A cleared Material posts `''`, which Zod
   accepts as a string and D1 then rejects on the FK. `nullBlanks()` in `practice-actions.tsx`.
   This was the real cause of the first e2e failure.
5. **`practice-actions` catches service throws** and returns a JSON error instead of a 500 that
   would take down the route the (already-closed) dialog was on. Auth redirects are re-thrown.
6. **Screens got a stylesheet.** The plan did not mention CSS; the screens are unusable without it,
   so `src/styles/app.css` gained a namespaced `.pr-*` block.
7. **`pr_disable_confirm`** added: the disable confirm had no message key of its own.
8. **The prod smoke used class "Bamblebee", not `c1`.** Production has no seeded demo data — its
   two classes are the school's real ones. Bamblebee's only enrolled student is the test account
   (`vunq@mochi.edu` → "Moon"), so the smoke touched no other child; anything else would have put a
   WALKTHROUGH task in front of real students.
9. **`PracticeSubmitResponse` dropped** from `shared/api-contract.ts`: it aliased
   `PracticeStudentTask`, and `test/api-contract.test.ts` requires every export's `meta.id` to match
   its own name. The registry points at `PracticeStudentTask` directly.
10. **A `Practice` tag description** was added to `TAGS` in the registry — `test/api-docs-spec.ts`
    fails on an undescribed tag.
11. **e2e Zalo assertion split across two students.** `seed.sql` pairs Leo Park's mother and nobody
    else, so "No Zalo pairing" absent on Leo and present on Mia Chen is what actually proves the
    indicator reads the pairing.

### Open issues for the morning

- `uiautomator dump` cannot settle while the practice timer ticks ("could not get idle state") and
  silently returns the previous dump. The smoke worked around it by tapping the coordinates captured
  before the timer started and verifying with screenshots. Worth knowing before anyone writes a
  Maestro flow over this screen.
- `crud-calendar-drag` "dragging a recurring event" failed this run and is not on the known-failures
  list. It is the drag flakiness already recorded in memory, but it now fails often enough to be
  worth a look.
- The two crons (`0 13 * * *`, `0 17 * * *`) have never fired in production yet. The first real
  finalize will be at 00:00 ICT after a class opts in; `POST /api/push/run?job=practice-finalize`
  as an admin is the way to force one.
- Nothing has been enabled on production. `class_teachers` scoping stays backlog, as decided.
