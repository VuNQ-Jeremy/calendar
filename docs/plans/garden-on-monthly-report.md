# Garden progress on the assessments monthly report

> **Handoff note:** Written to be picked up by any agent on any machine with no other context.
> The web work described in "What shipped" is **done and pushed** (commit `5d53010`, `v0.0129`).
> What remains is in "Outstanding" — two items, both optional, both specified to be executable
> without rediscovering anything. All paths are relative to the repo root.

## Why this exists

The assessments monthly report (`/assessments` → **Monthly report** tab, and the printable slip a
teacher pastes into Zalo) showed academics only: average score, tests taken, incidents, praise. A
student practising vocabulary in the garden every evening had nothing to show for it there, so the
report told half the story of the month.

The garden is `Vườn cây từ vựng` — the plant a student grows by passing flashcard rounds. It already
had a student widget (`/vocabulary`), a class garden (`/garden/:classId`), and a monthly album. What
it did not have was any presence on the document the parents actually see.

## What shipped (commit `5d53010`)

Web only. Both report surfaces now carry the month's garden activity.

### The teacher's report tab

`GardenMonthCard` in [`src/screens-assessments.tsx`](../../src/screens-assessments.tsx) (defined
just above `TypeBadge`, rendered at the bottom of the report branch). Six `Stat` tiles —

| Tile | Field | Meaning |
|---|---|---|
| Days practised | `activeDays` | Distinct ICT days with a qualifying round. The habit number |
| Rounds passed | `playDays` | Every qualifying round, including ones the daily cap zeroed |
| Stages grown | `stagesGained` | Stages actually gained (a capped play contributes 0) |
| Fruit harvested | `fruits` | Harvests inside the month |
| Fruit all-time | `fruitsTotal` | Lifetime, off the plant row, for context |
| Stages lost | `setbacks` | Stages lost to neglect or a missed deadline |

— plus the plant as it stands today (existing `PlantSvg` at `size={44}` with the stage label), and
the streak line when there is one. Two distinct empty states: `remark_garden_never` ("has not
planted anything yet") when there is no plant row at all, versus `remark_garden_quiet` ("no
vocabulary practice this month") when a plant exists but the month was silent. Conflating those two
would have told a teacher a student quit when they had simply never started.

### The printable slip

[`src/assessments/report-slip.tsx`](../../src/assessments/report-slip.tsx) gains two tiles in the
existing `.rslip__stats` row — **days practised** and **fruit** — in garden green
(`.rslip__stat--garden`), with an inline `<Sprout />` SVG.

**Deliberately parent-facing only:** the slip gets the two numbers a parent can act on. *Stages
lost* stays teacher-only, and the loader says why — a keepsake should not scold. The glyph is inline
SVG because the slip is rasterized by `html-to-image`; nothing on it may be fetched.

### Where the numbers come from

Folded out of `garden_events`, **never off the `garden_plants` row**. The row only knows today's
stage, but a report may describe a month that ended weeks ago.

The lever that makes this honest: a `grow` row exists for **every** qualifying play, carrying
`stageAfter === stageBefore` when the daily cap was already spent. So `playDays` and `stagesGained`
can legitimately differ, and "practised 14 rounds, grew 9 stages" is *tellable* rather than merely
implied.

Three layers, in dependency order:

1. **`tallyGardenMonth(events)`** — [`shared/logic/garden.ts`](../../shared/logic/garden.ts), under
   the `---- Month rollup ----` heading. Pure, no dates, no DB. Also exports `emptyMonthTally()` and
   the `GardenMonthTally` type. **Caller-filtered**: it folds exactly the events handed to it, so
   the month scope lives in the query. Handing it events outside the month counts them as inside.
2. **`gardenMonthByStudent(db, month, vnToday, opts?)`** —
   [`server/services/garden.ts`](../../server/services/garden.ts), in the `---- Views ----` section.
   Two queries for any roll size (one month-scoped events sweep, one plants read), groups by student,
   folds each group with `tallyGardenMonth`, then settles each plant through the usual `plantView`.
   Every requested student gets an entry, so a student who never played reads as zeros rather than a
   missing key. `studentGardenMonth(db, studentId, …)` delegates to it — one definition of what the
   numbers mean, and no N+1.
3. **`GET /api/garden/month/:id?month=YYYY-MM`** —
   [`app/routes/api.garden.month.$id.tsx`](../../app/routes/api.garden.month.%24id.tsx), staff-only,
   registered in [`app/routes.ts`](../../app/routes.ts) beside `api/garden/progress/:id`.

### Two decisions worth not re-litigating

**Why a separate endpoint instead of the `/assessments` loader.** On that screen both report
controls — student *and* month — are pure client state, and the loader sits behind one SWR cache key
(`K.assessments`). Folding the garden in would mean loading every student's every month to serve the
one pair on screen. The card fetches the pair it is actually showing, via `useFetcher().load` keyed
on `` `${studentId}:${month}` ``.

**Why the rail became a scrolling column.** `.assess-report` is a fixed-height flex row and its
right rail used to be the single stats card, whose 4-tile grid took all the slack (`flex: 1`). With
two cards there, splitting the row height between them left both looking half-empty. So
[`src/styles/app.css`](../../src/styles/app.css) adds `.assess-report__rail` — it now owns the 380px
width and the `overflow-y: auto`, and each card inside sits at its natural height. Both tile grids
fall back to 2-up inside that width, because the page-level `cols-3`/`cols-4` breakpoints key off
the *viewport*, which on a wide screen would try to fit all of them on one line inside a 380px
column. Under the 1100px media query the rail drops its own scroller (`overflow-y: visible`) — the
page column already scrolls there, and a nested one would trap the wheel.

### Files touched

| File | Change |
|---|---|
| `shared/logic/garden.ts` | `tallyGardenMonth`, `emptyMonthTally`, `GardenMonthTally`, `SETBACK_TYPES` |
| `server/services/garden.ts` | `GardenMonthSummary`, `studentGardenMonth`, `gardenMonthByStudent` |
| `app/routes/api.garden.month.$id.tsx` | **New.** The staff-only month endpoint |
| `app/routes.ts` | Registers `api/garden/month/:id` |
| `app/routes/assessments.$month.$studentId.report.tsx` | Slip loader: garden, `.catch(() => null)` |
| `src/assessments/report-slip.tsx` | `<Sprout />`, two garden tiles, `.rslip__stat--garden` |
| `src/screens-assessments.tsx` | `GardenMonthCard`, the `.assess-report__rail` wrapper |
| `src/styles/app.css` | `.assess-report__rail`, `.assess-report__garden`, media-query updates |
| `shared/i18n/strings.ts` | 12 keys × 2 languages (`remark_garden_*`, `rslip_garden_*`, `garden_fruit_total_short`) |
| `test/garden-logic.test.ts` | 7 `tallyGardenMonth` cases |
| `e2e/crud-assess.spec.ts` | 1 spec for the report-tab card |

### Failure behaviour

Both surfaces degrade rather than break, matching how `/vocabulary` treats the garden as optional
for the first minutes after a deploy:

- The slip loader wraps `studentGardenMonth` in `.catch(() => null)` and prints everything else. A
  keepsake must not 500 over the garden.
- `GardenMonthCard` returns `null` on an error reply, so the report tab loses the card, not the page.
- While a fetch is in flight the tiles show `—`, and **previous numbers stay on screen** during a
  refetch rather than flashing a spinner (arrowing through the student dropdown otherwise made the
  whole rail flicker).

## Verification status — read this before claiming anything is green

Run and passing:

- `npm run typecheck` — clean.
- `npm run lint` — clean. The single `src/ui.tsx:351` `no-shadow` warning is **pre-existing at
  HEAD**, not from this work.
- `npx vitest run test/garden-logic.test.ts` — 49 pass (42 pre-existing + 7 new).

Not run, honestly outstanding:

- **The e2e spec is written but never executed.** `e2e/crud-assess.spec.ts` gained
  `'garden progress: loads for the shown student and month, and refetches on change'`. Per
  `CLAUDE.md` the staging suite is **manual-trigger only** — do not run `npm run test:e2e:staging`
  or `npm run test:env:setup` unless the repo owner asks in that session. This change touches the
  report tab that suite covers, so it is worth a run when convenient; it is not a gate.
- **OTA publish unverified.** `npx eas-cli workflow:runs` failed with "An Expo user account is
  required" — not authenticated in that session. This commit touches no `mobile/` file, so no bundle
  behaviour changed, but the `CLAUDE.md` post-push check is genuinely unperformed.
- **Nothing was viewed in a browser.** Per `memory/local-run-and-deploy-loop`, `workerd` is broken
  on this machine, so the layout claims above are construction, not observation. The rail's
  two-card scroll behaviour in particular deserves one look on a real screen.

### About the e2e spec's fixtures

It leans on seed facts, verified against `seed.sql` while writing it — do not "fix" these to
Vietnamese names, which was my first wrong guess:

- Students are `s1` **Leo Park**, `s2` **Mia Chen**, `s3` Ada Rivera, `s4` Noah Bennett.
- The screen opens on the first seeded student, so the first `/api/garden/month/` GET is `s1`'s.
- Seed scores live in **May/June 2026**, so `'June 2026'` is reliably in the Month dropdown — that
  is how the spec proves a month change refetches.
- The spec asserts on the GET (path + `?month=`), not on tile values: seeded students have no garden
  events, so every number is legitimately `0`. It checks all six tiles read `/^\d+$/` — i.e. real
  numbers rather than the in-flight `—`.

## Outstanding

### 1. Mobile parity (optional, not started)

`mobile/app/(app)/assessments.tsx` has the same three-tab screen, and its report tab (around
line 544) still shows the four academic `CountTile`s only. Recorded in
[`docs/mobile-parity.md`](../mobile-parity.md) as a deliberate, reasoned gap — this was scoped to
the web surface the owner pointed at rather than widened unasked.

Nothing hard is left, because the server side is done and client-agnostic. If it gets built:

- Add to `mobile/lib/endpoints.ts` in the `garden` object:
  `monthSummary: (studentId, month) => apiFetch<GardenMonthSummary>(\`/api/garden/month/${encodeURIComponent(studentId)}\`, { query: { month } })`.
  Note the block comment above that object currently says the garden endpoints there are
  student-facing only — this one is **staff-only**, so amend that comment rather than leaving it
  false.
- Add a query key in `mobile/lib/query.ts` beside `gardenPlant`. Unlike `gardenPlant` it does **not**
  need the ICT day baked in: a finished month is stable, and the current month re-fetches on focus
  like the rest of the screen.
- Render with the existing `CountTile` (it already flex-wraps at `flexBasis: '45%'`, so six tiles
  need no new layout) and `mobile/components/garden/` for the plant art.
- Reuse the same i18n keys — they are in `shared/i18n/strings.ts`, which both clients read, so the
  strings are already there in both languages.
- `mobile` has its own tsconfig: verify with `cd mobile && npx tsc --noEmit`, never from the root.

### 2. `gardenMonthByStudent` has no caller yet

The bulk function is deliberately public and currently unused — `studentGardenMonth` delegates to it
for one student. It exists for the obvious next asks: a class-wide garden column on the report, or a
month rollup on `/rankings`. If a reviewer flags it as dead code, this is the reason it was written
that way; the alternative was a per-student query loop that would N+1 the moment anyone wanted more
than one student.

## Traps this work actually hit

Recorded so the next session does not pay for them twice.

- **ICT, not UTC.** Every date here is an ICT `YYYY-MM-DD` string. The Worker clock is UTC and the
  school is UTC+7, so between 17:00 and 24:00 UTC the two disagree about the day. Use
  `ictDateOf(new Date().toISOString())` from `shared/logic/tests.ts`, never `new Date()` month math.
  Both new loaders do this.
- **`TuitionMonth` is the shared `'YYYY-MM'` guard.** The name is about where it started, not what it
  validates. Reusing it beat adding a second month schema; the endpoint has a comment saying so.
- **Prettier is not an enforced gate in this repo.** `npx prettier --check` already fails on
  `app/routes.ts`, `server/services/garden.ts` and `src/screens-assessments.tsx` **at HEAD**
  (a line-ending artifact — the repo is on Windows with CRLF). Running `--write` reformats hundreds
  of untouched lines and buries the real diff. What was done instead: keep added lines inside the
  100-char width, checked with
  `git diff -U0 | grep '^+' | awk '{ if (length($0) > 101) print }'`.
- **Heredocs, not PowerShell here-strings, for `git commit -F -` in the Bash tool.** A `@'…'@`
  here-string is a parse error there and shredded the first commit attempt into `pathspec` errors.
