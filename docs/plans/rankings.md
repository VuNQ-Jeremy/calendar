# Plan: Bảng xếp hạng — monthly student rankings page

> **Handoff note:** This plan is written to be executed by any agent on any machine with no
> additional context. Every step names exact files, exports, and code shapes. Execute steps
> in the listed order. All paths are relative to the repo root.

## Context

The teacher (repo owner) wants a leaderboard to motivate students: rank students each month by
two criteria — **ý thức** (attitude/diligence: doing homework fully, attending on time and fully,
working hard in class) and **điểm kiểm tra** (test scores). It is a new page in the app's sidebar
navigation with a **class filter** and a **month filter**.

Decisions confirmed with the user:
- **Month-only** for now (weekly view is a later follow-up).
- **One combined leaderboard**: rank = weighted total of ý thức and average test score; both
  criteria also shown as columns on each row.
- **Ý thức is hybrid** — auto-computed from `attendance_records` + `behavior_records`, plus the
  teacher's existing `monthly_remarks` 1–5 ratings as the manual component. **No new data-entry UI.**
- **Test score = average** of `score_records.score` (0–10) in the month.
- **Weights are configurable** on the Config page (admin), stored in the `settings` KV table,
  default 40% ý thức / 60% điểm.
- **Web only** for now; note it in `docs/mobile-parity.md`. (Mobile is a separate Expo app.)

## Architecture facts (verified 2026-08-06)

- React Router 7 framework mode on Cloudflare Workers + D1 (SQLite) + Drizzle. Routes are
  explicitly registered in `app/routes.ts`; app pages live inside `layout('routes/_app.tsx', [...])`.
- Route modules import screens with a `.jsx` extension even for `.tsx` files
  (e.g. `import { TuitionScreen } from '../../src/screens-tuition.jsx'`) — follow this.
- Client cache: `src/lib/route-cache.ts`. `cacheKeyForPath` only sees pathnames ⇒ **month must be
  in the URL path**, mirroring `route('tuition/:month?', 'routes/tuition.tsx')`.
- Months are `'YYYY-MM'` strings; dates `'YYYY-MM-DD'`; filtering is lexical
  (`date.startsWith(month)` or `gte/lte` on `'YYYY-MM-01'..'YYYY-MM-31'`). Never use `Date`
  month math — the Worker clock is UTC, users are UTC+7 (ICT). `ictDateOf` is at
  `shared/logic/tests.ts:140`.
- Relevant tables:
  - `score_records(id, student_id, class_id NULL, date, score REAL 0-10, assessment_type_id, notes)`
    — canonical gradebook; graded tests sync into it (never read `test_attempts`).
  - `attendance_records(event_id, student_id, date, status present|absent|late|excused)` — **no
    class_id**; join `events.class_id` (pattern: `server/services/tuition.ts:219-239`). No row ≠ absent.
  - `behavior_records(id, student_id, class_id NULL, date, type, notes)` — types from
    `shared/logic/assess.ts` `BEHAVIOR_TYPES`; `NEGATIVE_TYPES = ['late','absent','missing_homework','disruptive','other']`; `praise` is the only positive.
  - `monthly_remarks(id, student_id, month, ratings JSON Record<criterionId,1-5>, comment, UNIQUE(student_id, month))` — student-wide (no class).
  - `settings(key TEXT PK, value TEXT JSON)` — KV store; pattern: `getTuitionSettings`/`setTuitionSettings` in `server/services/tuition.ts:47-77`.
- `peopleSvc.listStudents` returns `StudentRow` with `classIds: string[]` (`server/services/people.ts:70`) — class filter can be fully client-side.
- `classesSvc.listLite` returns `ClassLite { id, name, color }` (`server/services/classes.ts:20`).
- i18n: `shared/i18n/strings.ts` — add keys to BOTH `en_strings` and the `vi:` object;
  a `satisfies` clause enforces parity at compile time. `npm run check:i18n` exists.
- UI toolkit: `DS` from `src/ds/index.js` (`Card, Avatar, Button, IconButton, ...`);
  `MSelect, PageHeader, Empty` from `src/ui.tsx` (export block at line 622); icons via
  `<MIcon name="..."/>` from `src/icons.tsx` (**no trophy icon — use `grad`**);
  `colorOf(id)` from `src/lib/core.js`; `scoreColorId(score)` from `src/lib/assess.js`
  (re-export of `shared/logic/assess.ts`).
- Leaderboard row precedent: `src/flashcards/topic.tsx:749-826` (`.lrow` rows: rank, avatar, name, metric).
- Month stepper precedent: `src/screens-tuition.tsx:362-381` (PageHeader `actions` with two
  IconButtons navigating to `/tuition/${shiftMonth(month, ±1)}`).
- Repo ritual: push to `main` only; `node scripts/changelog.mjs "…"` stages CHANGELOG.md on every
  push; the EAS OTA workflow auto-runs on push (web-only change is fine — just confirm it goes green).

---

## Step 0 — Publish this plan to the repo (do this first)

Copy this plan file into the repo as `docs/plans/rankings.md`, then:
`node scripts/changelog.mjs "docs: plan for monthly student rankings page"`, commit, push to `main`.
This lets any device pull the plan and execute the remaining steps.

## Step 1 — Shared scoring logic: NEW FILE `shared/logic/rankings.ts`

Pure functions only — **no React, no DOM, no `server/` imports** (same rule as
`shared/logic/assess.ts`; copy its header-comment style). Full contents:

```ts
/**
 * Monthly student ranking maths — shared by the web app and (later) the mobile app.
 * Pure functions only: no React, no DOM, no server/ imports (same rule as assess.ts).
 *
 * Ý thức (attitude, 0-10) is the mean of up to three components; a component with no
 * data is null and is EXCLUDED from the mean (not counted as zero):
 *   1. attendance: present=1, late=0.5, absent=0, excused excluded from the
 *      denominator entirely; ratio × 10. Null when the month has no counted rows.
 *   2. behavior: start at 10, −1 per negative record (NEGATIVE_TYPES), +0.5 per
 *      praise, clamped to [0,10]. Null when the month has no behavior records.
 *   3. remark: mean of the teacher's 1-5 star ratings × 2. Null when no remark.
 *      Remarks are student-wide: a class filter does NOT exclude them.
 *
 * total = round1((attitude × w.attitude + avgScore × w.score) / 100). When exactly
 * one of the two criteria is null the total is the other one alone — a student who
 * took tests but has no attitude data yet is still ranked. Both null → unranked.
 *
 * Ranking is competition style (1, 2, 2, 4), comparing the 1-decimal rounded
 * totals, so two rows that DISPLAY the same total always share a rank.
 */

import { NEGATIVE_TYPES } from './assess';

export interface RankingWeights {
  /** Integer percent, attitude + score === 100. */
  attitude: number;
  score: number;
}

export const DEFAULT_RANKING_WEIGHTS: RankingWeights = { attitude: 40, score: 60 };

/** Behavior component tuning. Exported so tests and any future UI copy agree. */
export const RANK_NEGATIVE_PENALTY = 1;
export const RANK_PRAISE_BONUS = 0.5;

/** Everything the ranking of ONE student needs, already filtered to month + class. */
export interface RankRowInput {
  studentId: string;
  attendanceStatuses: string[];            // attendance_records.status values
  behaviorTypes: string[];                 // behavior_records.type values
  scores: number[];                        // score_records.score values, 0-10
  remarkRatings: Record<string, number> | null;  // monthly_remarks.ratings or null
}

export interface StudentRanking {
  studentId: string;
  attendance: number | null;   // each component 0-10 or null (no data)
  behavior: number | null;
  remark: number | null;
  attitude: number | null;     // mean of non-null components, 1 decimal
  avgScore: number | null;     // mean of month's scores, 1 decimal
  testCount: number;
  total: number | null;        // weighted total, 1 decimal; null → unranked
  rank: number | null;         // competition rank; null for the unranked section
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

/** present=1, late=0.5, absent=0; excused rows are skipped entirely (not zero). */
export function attendanceComponent(statuses: string[]): number | null {
  let points = 0;
  let counted = 0;
  for (const s of statuses) {
    if (s === 'excused') continue;
    if (s === 'present') points += 1;
    else if (s === 'late') points += 0.5;
    else if (s === 'absent') points += 0;
    else continue; // unknown status: ignore
    counted += 1;
  }
  if (counted === 0) return null;
  return round1((points / counted) * 10);
}

/** 10 − 1 per negative, +0.5 per praise, clamped to [0,10]. Null with no records. */
export function behaviorComponent(types: string[]): number | null {
  if (types.length === 0) return null;
  let score = 10;
  for (const t of types) {
    if ((NEGATIVE_TYPES as readonly string[]).includes(t)) score -= RANK_NEGATIVE_PENALTY;
    else if (t === 'praise') score += RANK_PRAISE_BONUS;
  }
  return round1(Math.min(10, Math.max(0, score)));
}

/** Mean of the 1-5 star ratings × 2 → 0-10. Null when there is no remark / no ratings. */
export function remarkComponent(ratings: Record<string, number> | null | undefined): number | null {
  if (!ratings) return null;
  const values = Object.values(ratings);
  if (values.length === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return round1(mean * 2);
}

/** Weighted total; single-sided data uses that side alone; both null → null. */
export function combineTotal(
  attitude: number | null,
  avgScore: number | null,
  weights: RankingWeights,
): number | null {
  if (attitude == null && avgScore == null) return null;
  if (attitude == null) return round1(avgScore!);
  if (avgScore == null) return round1(attitude);
  return round1((attitude * weights.attitude + avgScore * weights.score) / 100);
}

/**
 * Rank a month. `rows` must already be filtered to the month (and to the class when
 * a class filter is active) and MUST be in the caller's tie-break order — the web
 * screen passes students sorted by name. Returns ranked students first (total desc,
 * competition ranks 1,2,2,4), then the unranked (total null, rank null) in input order.
 */
export function computeMonthRankings(
  rows: RankRowInput[],
  weights: RankingWeights,
): StudentRanking[] {
  const computed: StudentRanking[] = rows.map((r) => {
    const attendance = attendanceComponent(r.attendanceStatuses);
    const behavior = behaviorComponent(r.behaviorTypes);
    const remark = remarkComponent(r.remarkRatings);
    const parts = [attendance, behavior, remark].filter((x): x is number => x != null);
    const attitude = parts.length
      ? round1(parts.reduce((a, b) => a + b, 0) / parts.length)
      : null;
    const avgScore = r.scores.length
      ? round1(r.scores.reduce((a, b) => a + b, 0) / r.scores.length)
      : null;
    return {
      studentId: r.studentId,
      attendance, behavior, remark, attitude, avgScore,
      testCount: r.scores.length,
      total: combineTotal(attitude, avgScore, weights),
      rank: null,
    };
  });

  const ranked = computed.filter((s) => s.total != null);
  const unranked = computed.filter((s) => s.total == null);
  // Array.prototype.sort is stable, so equal totals keep the caller's (name) order.
  ranked.sort((a, b) => b.total! - a.total!);
  let prevTotal: number | null = null;
  let prevRank = 0;
  ranked.forEach((s, i) => {
    // totals are already rounded to 1 decimal, so === compares displayed values
    s.rank = s.total === prevTotal ? prevRank : i + 1;
    prevTotal = s.total;
    prevRank = s.rank;
  });
  return [...ranked, ...unranked];
}
```

## Step 2 — Zod schema: EDIT `shared/schemas.ts`

Insert directly after the `TuitionSettingsInput` block (ends ~line 734):

```ts
/**
 * Ranking weights (bảng xếp hạng): how much ý thức vs test average counts.
 * Integer percents that must sum to 100 — the config UI enforces the same rule.
 */
export const RankingWeightsInput = z
  .object({
    attitude: z.coerce.number().int().min(0).max(100),
    score: z.coerce.number().int().min(0).max(100),
  })
  .refine((w) => w.attitude + w.score === 100, { message: 'weights must sum to 100' });
export type RankingWeightsInput = z.infer<typeof RankingWeightsInput>;
```

(`z.coerce` because the config form posts FormData strings — same reason `RemarkRating` coerces.)

## Step 3 — Tests: NEW FILE `test/rankings.test.ts`

Vitest, plain node config (same as `test/assess.test.ts`), importing from
`../shared/logic/rankings.js`. Cases to cover:

- `attendanceComponent`: `['present','present','late','absent']` → `6.3` (round1 of 6.25);
  `['excused','excused']` → `null`; `[]` → `null`; `['present','excused']` → `10`
  (excused excluded from denominator).
- `behaviorComponent`: `[]` → `null`; `['praise']` → `10` (capped); `['late','disruptive']` → `8`;
  12 negatives → `0` (floored); `['missing_homework','praise']` → `9.5`.
- `remarkComponent`: `null` → `null`; `{}` → `null`; `{a:4, b:5}` → `9`.
- Attitude null-exclusion: a row with ONLY a remark `{a:5}` → `attitude === 10` (not diluted by zeros).
- `combineTotal`: `(8, 6, {attitude:40,score:60})` → `6.8`; `(null, 7, w)` → `7`; `(7, null, w)` → `7`;
  `(null, null, w)` → `null`.
- `computeMonthRankings` ties: totals 9, 8, 8, 7 → ranks `1, 2, 2, 4`; tied students keep input order.
- Unranked: all-empty input → `total === null`, `rank === null`, listed last; scores-only student IS ranked.
- `avgScore`: `[7, 8]` → `7.5`, `testCount 2`.

## Step 4 — Server service: NEW FILE `server/services/rankings.ts`

**Month-scoped queries** (not the full-table `listScores`/`listBehavior` reads that `/assessments`
uses): the page needs exactly one month, tables grow without bound, and the cache key is per-month.
The attendance join copies `server/services/tuition.ts:219-239`.

```ts
import { eq, and, gte, lte, isNotNull, asc } from 'drizzle-orm';
import {
  attendanceRecords, behaviorRecords, events, monthlyRemarks, scoreRecords, settings,
} from '../db/schema';
import type { Db } from '../db/index';
import type { RankingWeights } from '../../shared/logic/rankings';
import { DEFAULT_RANKING_WEIGHTS } from '../../shared/logic/rankings';

/**
 * Bảng xếp hạng: month-scoped reads for the rankings page, plus the weights setting.
 * Scoring itself lives in shared/logic/rankings.ts (pure, mobile-reusable).
 */

const SETTINGS_KEY = 'ranking-weights';

/** Same shape/defaulting pattern as getTuitionSettings (server/services/tuition.ts). */
export async function getRankingWeights(db: Db): Promise<RankingWeights> {
  const rows = await db.select().from(settings).where(eq(settings.key, SETTINGS_KEY));
  const row = rows[0];
  if (!row) return { ...DEFAULT_RANKING_WEIGHTS };
  try {
    const parsed = JSON.parse(row.value) as Partial<RankingWeights>;
    const a = parsed.attitude, s = parsed.score;
    if (
      typeof a !== 'number' || typeof s !== 'number' ||
      !Number.isInteger(a) || !Number.isInteger(s) ||
      a < 0 || s < 0 || a + s !== 100
    ) return { ...DEFAULT_RANKING_WEIGHTS };
    return { attitude: a, score: s };
  } catch {
    return { ...DEFAULT_RANKING_WEIGHTS };
  }
}

export async function setRankingWeights(db: Db, input: RankingWeights): Promise<RankingWeights> {
  await db.insert(settings)
    .values({ key: SETTINGS_KEY, value: JSON.stringify(input) })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(input) } });
  return input;
}

/** '2026-03' -> ['2026-03-01','2026-03-31']; zero-padded, so lexical compare works. */
function monthRange(month: string): [string, string] {
  return [`${month}-01`, `${month}-31`];
}

export type RankAttendanceRow = { studentId: string; classId: string; status: string };

/**
 * attendance_records has no class_id; the class comes from the event, exactly as
 * tuition's computeMonthLines does it. Rows whose event has no class are excluded —
 * ad-hoc events are not a class's ý thức and cannot pass a class filter.
 */
export async function listMonthAttendance(db: Db, month: string): Promise<RankAttendanceRow[]> {
  const [start, end] = monthRange(month);
  const rows = await db
    .select({
      studentId: attendanceRecords.studentId,
      classId: events.classId,
      status: attendanceRecords.status,
    })
    .from(attendanceRecords)
    .innerJoin(events, eq(attendanceRecords.eventId, events.id))
    .where(and(
      gte(attendanceRecords.date, start),
      lte(attendanceRecords.date, end),
      isNotNull(events.classId),
    ));
  return rows as RankAttendanceRow[]; // isNotNull already excludes nulls; cast narrows for TS
}

export type RankScoreRow = { studentId: string; classId: string | null; score: number };

export async function listMonthScores(db: Db, month: string): Promise<RankScoreRow[]> {
  const [start, end] = monthRange(month);
  return db
    .select({
      studentId: scoreRecords.studentId,
      classId: scoreRecords.classId,
      score: scoreRecords.score,
    })
    .from(scoreRecords)
    .where(and(gte(scoreRecords.date, start), lte(scoreRecords.date, end)))
    .orderBy(asc(scoreRecords.date));
}

export type RankBehaviorRow = { studentId: string; classId: string | null; type: string };

export async function listMonthBehavior(db: Db, month: string): Promise<RankBehaviorRow[]> {
  const [start, end] = monthRange(month);
  return db
    .select({
      studentId: behaviorRecords.studentId,
      classId: behaviorRecords.classId,
      type: behaviorRecords.type,
    })
    .from(behaviorRecords)
    .where(and(gte(behaviorRecords.date, start), lte(behaviorRecords.date, end)));
}

export type RankRemarkRow = { studentId: string; ratings: Record<string, number> };

export async function listMonthRemarks(db: Db, month: string): Promise<RankRemarkRow[]> {
  const rows = await db.select().from(monthlyRemarks).where(eq(monthlyRemarks.month, month));
  return rows.map((r) => {
    let ratings: Record<string, number> = {};
    try {
      ratings = JSON.parse(r.ratings);
    } catch {
      // corrupt row reads as unrated rather than a 500 (same policy as assessments.ts mapRemark)
    }
    return { studentId: r.studentId, ratings };
  });
}
```

No new live domain (page is read-only) and no D1 bound-param concerns (SELECTs only).

## Step 5 — Cache policy: EDIT `src/lib/route-cache.ts`

Four edits:

1. In the `K` const, after `assessments: 'route:assessments',` add:
   `rankings: 'route:rankings',`
2. Next to `tuitionMonthKey` (~line 53) add:
   ```ts
   /** Same prefix trick again: K.rankings drops/stales every cached month at once. */
   export const rankingsMonthKey = (month: string) => `route:rankings:${month}`;
   ```
3. In `MUTATION_EFFECTS`, append `K.rankings` to the **`stale`** array (never `hard`) of exactly
   these six domains: `classes`, `people`, `assessments`, `tests`, `config`, `attendance`.
   (`markStale` matches by prefix, so `'route:rankings'` stales every `'route:rankings:<month>'`.)
4. In `cacheKeyForPath`, after the tuition regex block add:
   ```ts
   // Months only, mirroring tuition: the month must be in the PATH because this
   // function only ever sees pathnames.
   const rk = pathname.match(/^\/rankings\/(\d{4}-\d{2})\/?$/);
   if (rk) return rankingsMonthKey(rk[1]);
   ```
   and add `'/rankings': K.rankings,` to the `map` object.

## Step 6 — Route registration: EDIT `app/routes.ts` + `app/routes/_app.tsx`

- `app/routes.ts`, inside the `layout('routes/_app.tsx', [...])` block, after the
  `route('assessments', ...)` line:
  ```ts
  // Month in the PATH for the same cache reason as tuition below.
  route('rankings/:month?', 'routes/rankings.tsx'),
  ```
- `app/routes/_app.tsx`, in the `NAV` const's `nav_manage` section, immediately after the
  `assessments` item:
  ```ts
  { id: 'rankings', path: '/rankings', tk: 'nav_rankings', icon: 'grad', staffOnly: true },
  ```
  Icon: existing `grad` (no trophy icon exists; do not add SVG).

## Step 7 — Route module: NEW FILE `app/routes/rankings.tsx`

Read-only: no `action`, no `clientAction`, no live domain. `requireStaff` (not admin).
Do NOT import `currentIctMonth` from `routes/tuition.tsx` (couples route chunks) — re-derive locally.

```tsx
import type { LoaderFunctionArgs, ClientLoaderFunctionArgs } from 'react-router';
import { RankingsScreen } from '../../src/screens-rankings.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../load-context';
import { requireStaff } from '../../server/services/auth';
import * as rankingsSvc from '../../server/services/rankings';
import * as peopleSvc from '../../server/services/people';
import * as classesSvc from '../../server/services/classes';
import { TuitionMonth } from '../../shared/schemas';
import { ictDateOf } from '../../shared/logic/tests';
import { K, rankingsMonthKey, swrLoad } from '../../src/lib/route-cache.js';

/** The ICT month we are in — the Worker's clock is UTC (same note as routes/tuition.tsx). */
function currentIctMonth(now = new Date()): string {
  return ictDateOf(now.toISOString()).slice(0, 7);
}

function requireMonth(raw: string | undefined): string {
  const month = raw ?? currentIctMonth();
  const parsed = TuitionMonth.safeParse(month);
  if (!parsed.success) throw Response.json({ error: 'bad_month' }, { status: 400 });
  return parsed.data;
}

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
  const db = createDb(env);
  const month = requireMonth(params.month);
  const [attendance, scores, behavior, remarks, students, classes, weights] = await Promise.all([
    rankingsSvc.listMonthAttendance(db, month),
    rankingsSvc.listMonthScores(db, month),
    rankingsSvc.listMonthBehavior(db, month),
    rankingsSvc.listMonthRemarks(db, month),
    peopleSvc.listStudents(db),
    classesSvc.listLite(db),
    rankingsSvc.getRankingWeights(db),
  ]);
  return { month, attendance, scores, behavior, remarks, students, classes, weights };
}

export async function clientLoader({ params, serverLoader }: ClientLoaderFunctionArgs) {
  const key = params.month ? rankingsMonthKey(params.month) : K.rankings;
  return swrLoad(key, () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>);
}
clientLoader.hydrate = true as const;

export default function Rankings() {
  return <RankingsScreen />;
}
```

Before writing, check how `app/routes/tuition.tsx` and `app/routes/assessments.tsx` do their
imports (`cloudflareCtx` path, `createDb`) and copy exactly.

## Step 8 — Screen: NEW FILE `src/screens-rankings.tsx`

`export function RankingsScreen()`. Follow `src/screens-assessments.tsx` and
`src/screens-tuition.tsx` idioms. Loader data interface:

```ts
interface RankingsLoaderData {
  month: string;
  attendance: RankAttendanceRow[];
  scores: RankScoreRow[];
  behavior: RankBehaviorRow[];
  remarks: RankRemarkRow[];
  students: StudentRow[];       // from server/services/people (has classIds: string[])
  classes: ClassLite[];
  weights: RankingWeights;
}
```

Logic (a single `React.useMemo` over `[data, classFilter]`):
1. Roster = `students` filtered by `classFilter === 'all' || s.classIds.includes(classFilter)`,
   copied and sorted by `a.name.localeCompare(b.name)` (this is the documented tie-break order).
2. Build per-student `Map`s in one pass each over `attendance`, `scores`, `behavior`, `remarks`.
   When `classFilter !== 'all'`:
   - attendance/scores/behavior rows: keep only `r.classId === classFilter` (rows with
     `classId === null` are excluded under a class filter — not attributable to the class;
     say so in a code comment);
   - remarks: **always kept** — comment: "remarks have no class; the teacher's monthly rating
     follows the student into any class view".
3. Map roster → `RankRowInput[]` (empty arrays / null when maps have no entry), call
   `computeMonthRankings(rows, data.weights)`, split into `ranked` / `unranked`.

Render:
- Root `<div className="content">` (page scrolls; no `--fill` split needed).
- `<PageHeader title={t('rank_title')} subtitle={t('rank_sub')} actions={...}/>` — actions is the
  tuition month stepper verbatim (`src/screens-tuition.tsx:366-381`): `IconButton` chevronLeft →
  `navigate(`/rankings/${shiftMonth(month, -1)}`)`, bold centered `monthLabel(month, lang)` span
  (minWidth 130), `IconButton` chevronRight → `+1`.
- Filter card: `<Card style={{ padding: 14 }}><div className="assess-filters">` (reuse existing
  class) with the class `MSelect` (`{value:'all', label: t('assess_all_classes')}` + classes,
  label `t('assess_class')` — both keys already exist) and a muted note at the end:
  `<span className="m-muted rank-weights-note">{t('rank_weights_note', { a: weights.attitude, s: weights.score })}</span>`.
- Leaderboard card `<Card style={{ padding: 18 }}>` with `.m-stack` (gap 8) of `.lrow` rows
  (**no podium** — rank numbers with medal CSS for top 3). Each ranked row:
  ```tsx
  <div key={s.studentId} className="lrow" style={{ alignItems: 'center', gap: 10 }}>
    <span className={'rank-num' + (s.rank! <= 3 ? ` rank-num--${s.rank}` : '')}>{s.rank}</span>
    <Avatar name={student.name} color={student.color} size="sm" />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontWeight: 600, color: 'var(--text-strong)' }}>{student.name}</div>
      <div className="lrow__meta rank-breakdown">{/* one span per NON-NULL component:
        t('rank_breakdown_attendance', {v}), _behavior, _remark, plus
        t('rank_tests_n', {n: s.testCount}) when testCount > 0, joined with ' · ' */}</div>
    </div>
    <ScoreChip label={t('rank_col_attitude')} value={s.attitude} />
    <ScoreChip label={t('rank_col_avg')} value={s.avgScore} />
    <span className="rank-total" style={{ color: colorOf(scoreColorId(s.total!)).ink }}>
      {s.total}
    </span>
  </div>
  ```
  `ScoreChip` = small local component: label span (`.rank-chip__label`) over an `.mchip` with
  `background: c.soft, color: c.ink, fontWeight: 700` from `colorOf(scoreColorId(value))`, or
  `—` when value is null (copy the ScoreBadge idiom in `src/screens-assessments.tsx:82-96`).
- Unranked section (only when non-empty), in the same card below the ranked rows: muted header
  `<div className="rank-section-head">{t('rank_no_data_section')}</div>` then the same `.lrow`
  rows with `<span className="rank-num">—</span>` and `—` in all metric slots.
- Empty state: if roster is empty, render
  `<Card><Empty icon="grad" title={t('rank_empty_title')} sub={t('rank_empty_sub')} /></Card>`
  instead of the leaderboard card. (Students with zero records still appear — in unranked.)
- No fetching/loading UI beyond `useLoaderData` — swrLoad handles it.

## Step 9 — CSS: EDIT `src/styles/app.css`

Add a `.rank-*` block right after the assessments block (~after line 1221):

- `.rank-num` — width/height 28px, `border-radius: var(--radius-pill)`,
  `display:inline-flex; align-items:center; justify-content:center; font-weight:800;
  color: var(--text-muted); flex-shrink:0;`
- `.rank-num--1` gold `background:#F6C445; color:#5C4300;` · `.rank-num--2` silver
  `background:#D9DCE1; color:#4A4F57;` · `.rank-num--3` bronze `background:#E8B27D; color:#5C3A10;`
  (literal hexes OK — the DS has no medal tokens).
- `.rank-chip` — `display:inline-flex; flex-direction:column; align-items:center; gap:2px; min-width:64px;`
- `.rank-chip__label` — `font-size: var(--text-xs, 11px); color: var(--text-muted);`
- `.rank-total` — `font-weight:800; font-size: var(--text-lg); min-width:52px; text-align:right;`
- `.rank-breakdown` — `flex-wrap: wrap;` (rest comes from `.lrow__meta`)
- `.rank-section-head` — `margin-top: var(--space-4); font-weight:700; color: var(--text-muted); font-size: var(--text-sm);`
- `.rank-weights-note` — `margin-left:auto; font-size: var(--text-sm); align-self:center;`
- `@media (max-width: 720px) { .rank-chip { min-width: 48px; } .rank-breakdown { display: none; } }`

## Step 10 — Config page (weights admin)

**10a. EDIT `app/routes/config.tsx`:**
- Add `import * as rankingsSvc from '../../server/services/rankings';` and add
  `RankingWeightsInput` to the `shared/schemas` import.
- Loader: extend the `Promise.all` with `rankingsSvc.getRankingWeights(db)` → return as
  `rankingWeights`.
- Action (`actionImpl`), new intent branch next to the `tuition-settings` branch:
  ```ts
  if (intent === 'ranking-weights') {
    const parsed = RankingWeightsInput.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    }
    const rankingWeights = await rankingsSvc.setRankingWeights(db, parsed.data);
    return { ok: true, rankingWeights };
  }
  ```
  (Match how the existing intents parse `raw` from FormData — copy the `tuition-settings` branch's
  shape exactly.) No other change: `withLiveAction('config', ...)` + Step 5's
  `MUTATION_EFFECTS.config.stale` already stale all cached rankings months on save.

**10b. EDIT `src/screens-config.tsx`:**
- Add `rankingWeights: RankingWeights` to `ConfigLoaderData`;
  `import type { RankingWeights } from '../shared/logic/rankings.js';`
- New section component `RankingWeightsSection({ weights })`, modeled on the existing
  `TuitionSettingsSection` (same Card/h2/sub markup): local draft state
  `{ attitude: string; score: string } | null` seeded from props; two
  `<input type="number" className="mochi-input" min={0} max={100}>` labeled
  `t('cfg_rank_attitude')` / `t('cfg_rank_score')`; `valid` = both integers ≥ 0 summing to 100;
  Save `Button` (`disabled={!valid || !draft}`) submits FormData
  `{ intent: 'ranking-weights', attitude, score }` via `useFetcher` to `/config`; hint line
  `t('cfg_rank_hint')` turns red (`color: 'var(--rose-600, #c0392b)'`) when invalid.
  Check `TuitionSettingsSection` first and mirror its exact structure/props.
- Mount `<RankingWeightsSection weights={rankingWeights} />` right after
  `<TuitionSettingsSection ... />` and add `rankingWeights` to the `useLoaderData()` destructuring.

## Step 11 — i18n: EDIT `shared/i18n/strings.ts`

Add ALL keys to BOTH `en_strings` and the `vi:` object (compile-enforced parity;
`npm run check:i18n` re-checks). Reused existing keys — do NOT re-add: `assess_class`,
`assess_all_classes`, `save`.

| key | en | vi |
|---|---|---|
| `nav_rankings` | Rankings | Xếp hạng |
| `rank_title` | Student rankings | Bảng xếp hạng |
| `rank_sub` | Monthly ranking from attitude and test scores | Xếp hạng theo tháng dựa trên ý thức và điểm kiểm tra |
| `rank_col_attitude` | Attitude | Ý thức |
| `rank_col_avg` | Avg. score | Điểm TB |
| `rank_col_total` | Total | Tổng điểm |
| `rank_breakdown_attendance` | Attendance {v} | Chuyên cần {v} |
| `rank_breakdown_behavior` | Behavior {v} | Hành vi {v} |
| `rank_breakdown_remark` | Teacher rating {v} | GV đánh giá {v} |
| `rank_tests_n` | {n} tests | {n} bài kiểm tra |
| `rank_no_data_section` | No data this month | Chưa có dữ liệu tháng này |
| `rank_empty_title` | No students yet | Chưa có học sinh |
| `rank_empty_sub` | Add students to a class to see their ranking. | Thêm học sinh vào lớp để xem bảng xếp hạng. |
| `rank_weights_note` | Weights: attitude {a}% · score {s}% | Trọng số: ý thức {a}% · điểm {s}% |
| `cfg_rank_title` | Ranking weights | Trọng số xếp hạng |
| `cfg_rank_sub` | How much attitude vs. average test score counts on the Rankings page. | Tỷ trọng giữa ý thức và điểm kiểm tra trung bình trên trang Bảng xếp hạng. |
| `cfg_rank_attitude` | Attitude weight (%) | Trọng số ý thức (%) |
| `cfg_rank_score` | Test score weight (%) | Trọng số điểm kiểm tra (%) |
| `cfg_rank_hint` | The two weights must add up to 100. | Tổng hai trọng số phải bằng 100. |

Interpolation (`{n}`/`{v}`/`{a}`/`{s}`) follows the existing `t(key, { n })` pattern.

## Step 12 — Docs: EDIT `docs/mobile-parity.md`

- Routes table, after the `/assessments` row:
  `| \`/rankings/:month?\` | **Not built** | Web-only for now (added 2026-08). Monthly student rankings; scoring is pure shared logic (\`shared/logic/rankings.ts\`) so a mobile screen can reuse it unchanged |`
- Under "Deliberate omissions, with reasons": short entry noting web-only, scoring in
  `shared/logic/rankings.ts` (no React / no server imports), weights in a plain `settings` row
  (`ranking-weights`) — parity is one screen, not a logic port.

## Step 13 — Verify & ship

1. `npm run typecheck` (i18n parity, loader/screen types, route typegen for `rankings/:month?`)
2. `npm run check:i18n`
3. `npm run lint`
4. `npm run test` (includes `test/rankings.test.ts`)
5. Manual QA (`npm run dev`, staff account):
   - "Xếp hạng" in sidebar after Đánh giá; hidden for student accounts.
   - `/rankings` shows the current ICT month; stepper navigates `/rankings/2026-07` etc.;
     revisited months render instantly from cache.
   - Class filter narrows roster; class-filtered view still uses the student's (student-wide) remark.
   - Student with zero records appears under "Chưa có dữ liệu tháng này".
   - Record a behavior on `/assessments` → back to `/rankings` → row refreshes (stale-mark works).
   - `/config` (admin): weights reject 50+60, save 30/70 → rankings note + totals update.
   - Excused-only attendance month → attendance component shows `—`, not 0.
6. Ship: `node scripts/changelog.mjs "feat: monthly student rankings page (bảng xếp hạng)"`,
   commit, push to `main`, then verify the EAS workflow run:
   `cd mobile && npx eas-cli workflow:runs` → top entry SUCCESS (web-only change, but the
   workflow must still go green).

## Execution order (dependency-sorted)

- [ ] 0. Commit this plan to `docs/plans/rankings.md`, changelog, push (so other devices can pull it)
- [ ] 1. `shared/logic/rankings.ts` (new)
- [ ] 2. `shared/schemas.ts` (`RankingWeightsInput`)
- [ ] 3. `test/rankings.test.ts` (new — proves step 1 early)
- [ ] 4. `server/services/rankings.ts` (new)
- [ ] 5. `src/lib/route-cache.ts` (K, `rankingsMonthKey`, regex, MUTATION_EFFECTS)
- [ ] 6. `shared/i18n/strings.ts` (all keys, both languages)
- [ ] 7. `app/routes/rankings.tsx` (new)
- [ ] 8. `src/screens-rankings.tsx` (new)
- [ ] 9. `src/styles/app.css` (`.rank-*`)
- [ ] 10. `app/routes.ts` + `app/routes/_app.tsx` (route + nav)
- [ ] 11. `app/routes/config.tsx` + `src/screens-config.tsx` (weights admin)
- [ ] 12. `docs/mobile-parity.md`
- [ ] 13. Verify, changelog, push, confirm EAS workflow green

## Follow-ups (out of scope, noted for later)
- Weekly rankings (all math prerequisites exist: `weekStart`, `monthWeekStarts` in `shared/logic/assess.ts`).
- Mobile screen + `/api/rankings` endpoint (scoring already shared).
- Shareable "export image" of the leaderboard for the parents' Zalo group.
