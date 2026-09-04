# Plan template — §0 survival kit and the verification phase

Copy into the plan. Every `REQUIRED` slot is filled by running the command beside it on the day
the plan is written; write the date into the heading. The executor reads §0 before its first step.

---

## 0. Session survival kit — read before the first step

### 0.1 Machine facts (verified YYYY-MM-DD) — REQUIRED: today's date

| Thing | Value | Verify with |
|---|---|---|
| Shells | Windows 11. Bash tool for curl/grep/heredocs; PowerShell only where a step says so (`curl` there is `Invoke-WebRequest` — write `curl.exe`). `cd` does not persist: every command starts `cd f:/code/calendar && …`. | — |
| Node | REQUIRED | `node -v` (mobile tests need 24: `node:sqlite`) |
| Repo | `f:\code\calendar`, branch `main`. Other worktrees: REQUIRED | `git worktree list` — exclude `.worktrees/**` from every grep |
| Head | REQUIRED short sha the run starts from | `git rev-parse --short HEAD` |
| adb | REQUIRED path; device state | `adb version` and `adb devices` |
| emulator | `%LOCALAPPDATA%\Android\Sdk\emulator\emulator.exe` (not on PATH); AVD REQUIRED | `emulator.exe -list-avds` |
| Installed app | REQUIRED: `com.mochi.lms` versionCode, release APK or dev-client | `adb shell dumpsys package com.mochi.lms` and grep `versionCode` (needs the emulator up; else copy the last log's value and mark it *unverified*) |
| runtimeVersion | REQUIRED | `node -p "require('./shared/version.json').runtimeVersion"` |
| Java / Maestro | not installed → `npm run test:device` cannot run; device work is `scripts/adb-ui.mjs` | `java -version` |
| EAS | `npx eas-cli` from `mobile/`; logged-in account REQUIRED. Never `eas login` (interactive). | `cd mobile && npx eas-cli whoami` |
| Cloudflare | account ngqv0712@gmail.com; never `wrangler login`, never `wrangler deploy` | `npx wrangler whoami` |
| GitHub | no `gh`; Actions via `curl -s "https://api.github.com/repos/VuNQ-Jeremy/calendar/actions/runs?per_page=3"` | — |
| Accounts | staff `dev@mochi.edu` / `mochi123`; student `vunq@mochi.edu` / `mochi123`. Prod smoke class REQUIRED (a class whose only student is the test student) | check the roster on `/people` or by D1 query before writing to it |
| URLs | prod `https://calendar.ngqv0712.workers.dev`; test `https://calendar-test.ngqv0712.workers.dev`; manifest `https://u.expo.dev/83251f6c-1fa9-4724-ba61-39a9eb806aab` | — |

### 0.2 Authorizations granted for THIS run (user, YYYY-MM-DD) — and what stays forbidden

Granted (each is manual-trigger only per CLAUDE.md; list only what the user said, as the exact
command) — REQUIRED, one bullet per command:
- `npm test` / `npm run test:worker`
- `npm run test:env:setup` then `npm run test:e2e:staging`
- `npx wrangler d1 migrations apply mochi-class --remote` (prod migration by hand)
- `npx eas-cli update --branch preview --platform android --environment preview --message "…"` (manual OTA fallback)
- `npx eas-cli build -p android --profile preview` — only when runtimeVersion changed
- Driving the `<AVD>` emulator
- Writing WALKTHROUGH-prefixed `<object>` rows on production for class `<class>` only, with the
  cleanup step below; direct `wrangler d1 execute … DELETE` / `wrangler r2 object delete` as fallback

Forbidden, no exceptions: paid API routes (`/enrich-vocab`, `/generate-vocab`,
`/vocab-image-generate`, `/speech-assess`); `wrangler deploy` in any form; `wrangler login`;
`eas login`; `npm run format` / `prettier --write .` (CRLF tree — format only your files);
`git add -A`, `git add .`, `git push --force`, `git reset --hard`, `git checkout -- <file>` on a
file you did not create; `npx tsc -b` at the root; `npm run test:device`; new feature code
(fixes only for defects this phase proves, max N fix commits — REQUIRED N).

### 0.3 Names this phase depends on — confirm from the tree at step V.0 — REQUIRED table

| Name | Expected | Confirm with |
|---|---|---|
| Migration | `migrations/00NN_<name>.sql` | `ls migrations` (last two) |
| Table(s) | … | `grep -o 'CREATE TABLE [a-z_]*' <migration>` |
| Web route / action route / API route | … | `grep -n <name> app/routes.ts` |
| English UI strings (the Playwright and adb selectors) | … | `grep -n "<prefix>_" shared/i18n/strings.ts` |
| e2e spec | `e2e/crud-<name>.spec.ts` | `ls e2e` |
| Reset sweep | `DELETE FROM <table>;` present | `grep -n <table> scripts/test-accounts.sql` |
| Walkthrough story count | `test/walkthrough.test.ts` bumped | `grep -n toHaveLength test/walkthrough.test.ts` |
| Mobile screen | `mobile/app/(app)/…` | `ls "mobile/app/(app)"` |

### 0.4 Baselines — already red, not yours — REQUIRED, copied from the latest log

- Web unit: …
- Worker unit: …
- e2e: the known-failure list (spec file + test title). Anything else red is yours.
- lint: N pre-existing warnings, 0 errors.

### 0.5 Traps
Point at the skill: "See `.claude/skills/unattended-verification/playwright.md` and `emulator.md`."
Add only traps specific to this feature.

### 0.6 Time budget and hard stop — REQUIRED
Per-step minutes; total; **hard stop time** after which the executor abandons the current step and
runs cleanup + log unconditionally.

---

## Verification phase — step skeleton

Order matters: a migration makes the test Worker and its D1 stale as a pair, so env setup precedes
e2e; the prod migration precedes any prod smoke; cleanup precedes the log commit.

| Step | Command(s) | Pass looks like |
|---|---|---|
| V.0 Preflight | `git status --short`, `git rev-parse --short HEAD`, `node -v`; fill §0.3 from the tree; record the prod row count `N0` for every table the smoke will write | clean tree on `main`, nothing `[ahead]`, names confirmed |
| V.1 Static (free) | `npm run typecheck && npm run lint && npm run check:i18n`; `cd mobile && npx tsc --noEmit && npm test` | 0 errors; only baseline warnings; en/vi key counts equal |
| V.2 Unit (granted) | `npm test` | failures ⊆ §0.4; new tests present and green; log `P/F` per half |
| V.3 Test env (granted) | `npm run test:env:setup` | new route on calendar-test answers 302 not 404; `d1 migrations list mochi-class-test --remote --env test` says none pending |
| V.4 e2e (granted) | `npm run test:e2e:staging -- e2e/<new>.spec.ts` then `npm run test:e2e:staging` | new spec green; full-run failures ⊆ §0.4 by spec+title; paste the summary line. See `playwright.md` §C before diagnosing any other red |
| V.5 Prod deploy + migration (granted) | poll the new route on prod (Monitor, ≤15 min) → 302; `npx wrangler d1 migrations list mochi-class --remote`; apply if pending; authed GET per `playwright.md` §D | 302; `No migrations to apply!`; 200 with cookie, 200 with bearer, 401 anonymous |
| V.6 Visual (prod, write-scoped) | scratchpad Playwright script per `playwright.md` §B: create → edit → delete through the real dialog, screenshots into `docs/superpowers/reviews/<date>-<feature>-smoke/` | dialog inside the viewport; no raw i18n keys; every `posted()` resolved; stamp sha = HEAD; exactly the intended WALKTHROUGH rows remain |
| V.7 OTA | `cd mobile && npx eas-cli workflow:runs`; manifest curl from CLAUDE.md with `RV=$(node -p "require('./shared/version.json').runtimeVersion")` | top run = HEAD, `SUCCESS`; served `gitSha` = HEAD. On `FAILURE` (free CI quota) use the manual `eas update` line from §0.2 |
| V.8 Emulator up | `emulator.md` §1 | booted, `am force-stop` returns in < 5 s, right versionCode |
| V.9 OTA applied on device | `emulator.md` §3 | version row in More shows HEAD's sha7, not `embedded` |
| V.10 Device smoke | scratchpad script with `adb-ui.mjs`, `emulator.md` §4; ≤ 12 PNGs | each screen's dump contains the expected English strings; back-button rule holds; role gate holds |
| V.11 Cleanup (unconditional) | UI delete via the V.6 script; then the zero-count query per table; `adb emu kill` | `WHERE … LIKE 'WALKTHROUGH%'` count = 0; total = `N0`; `git status --short` shows only plan + PNGs |
| V.12 Log + docs commit | fill Execution log; `git add <plan> <pngs>` by name; `node scripts/changelog.mjs "docs(<feature>): overnight verification log"`; commit with the Co-Authored-By trailer; `git push origin main`; repeat V.7 for this sha | log has every count, sha, path taken, one line per PNG, decisions, open issues |

### If something blocks
| Situation | Do |
|---|---|
| §0.2 does not list the step's command | tick `skipped — not authorized`, continue |
| A test stays red after 3 laps | `test.fixme` with a one-line reason; never delete a test |
| Route never reaches 302 / D1 auth fails | skip V.6, V.9–V.11 (nothing to smoke), still V.7 and V.12 |
| Emulator will not boot or app absent (and no `FINISHED` artifact to `adb install`) | skip V.9–V.10; V.11 still runs (web-side cleanup) |
| Hard stop reached | V.11 then V.12, whatever step was open |
| A decision is needed | choose the option touching the fewest files; record it under **Decisions taken by the executor** |

## Execution log
_(filled by the executor — see V.12)_
### Decisions taken by the executor
### Open issues for the morning
