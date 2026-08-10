/**
 * Assessment vocabulary and score/behaviour maths — shared by the web app and the mobile app.
 *
 * Pure data plus pure functions: no React, no DOM, and — the reason this moved out of
 * `src/lib/assess.ts` — no `server/` imports. The old module typed its arguments as the Drizzle
 * row types from `server/services/assessments.ts`, which pulled the Workers types into anything
 * that touched it. React Native cannot follow that graph, so the rows are described structurally
 * here instead: the only fields any of this reads are `date`, `type` and `score`.
 *
 * `src/lib/assess.ts` re-exports this file, so every existing web import keeps working.
 */

export const BEHAVIOR_TYPES = [
  'late',
  'absent',
  'missing_homework',
  'disruptive',
  'praise',
  'other',
] as const;
export type BehaviorTypeId = (typeof BEHAVIOR_TYPES)[number];

/** Incident chart shows only negative types; praise renders as a positive stat instead. */
export const NEGATIVE_TYPES: BehaviorTypeId[] = [
  'late',
  'absent',
  'missing_homework',
  'disruptive',
  'other',
];

/** tk = i18n key; color = a ColorId understood by `colorOf()` (web) / `theme.category` (mobile). */
export const BEHAVIOR_META: Record<BehaviorTypeId, { tk: string; color: string }> = {
  late: { tk: 'bh_late', color: 'orange' },
  absent: { tk: 'bh_absent', color: 'rose' },
  missing_homework: { tk: 'bh_missing_homework', color: 'violet' },
  disruptive: { tk: 'bh_disruptive', color: 'cocoa' },
  praise: { tk: 'bh_praise', color: 'green' },
  other: { tk: 'bh_other', color: 'blue' },
};

/** The minimum a behaviour record must have for the bucketing below. */
export interface BehaviorLike {
  date: string;
  type: string;
}

/** The minimum a score record must have for `scoreStats`. */
export interface ScoreLike {
  score: number;
}

/** Monday-of-week for an ISO date, as ISO string. Pure local-date math, no timezone/locale. */
export function weekStart(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const shift = (dt.getDay() + 6) % 7; // Mon=0 … Sun=6
  dt.setDate(dt.getDate() - shift);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

export type WeekBucket = { key: string; counts: Record<string, number>; total: number };

/**
 * Last `weeks` week-buckets ending at the week containing `todayIso`.
 * Only NEGATIVE_TYPES are counted. Weeks with zero incidents still appear
 * (an empty week is the visual evidence of improvement).
 */
export function bucketBehaviorByWeek(
  records: BehaviorLike[],
  weeks: number,
  todayIso: string,
): WeekBucket[] {
  const end = weekStart(todayIso);
  const [y, m, d] = end.split('-').map(Number);
  const keys: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - i * 7);
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    keys.push(`${dt.getFullYear()}-${mm}-${dd}`);
  }
  const buckets = new Map<string, WeekBucket>(
    keys.map((k) => [k, { key: k, counts: {}, total: 0 }]),
  );
  for (const r of records) {
    if (!NEGATIVE_TYPES.includes(r.type as BehaviorTypeId)) continue;
    const b = buckets.get(weekStart(r.date));
    if (!b) continue; // outside the window
    b.counts[r.type] = (b.counts[r.type] || 0) + 1;
    b.total += 1;
  }
  return keys.map((k) => buckets.get(k)!);
}

/** Monday keys of every week that overlaps the month 'YYYY-MM', in order (4–6 keys). */
export function monthWeekStarts(month: string): string[] {
  const first = weekStart(`${month}-01`);
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate(); // day 0 of the next month = last day of this one
  const last = weekStart(`${month}-${String(lastDay).padStart(2, '0')}`);
  const keys: string[] = [];
  let [cy, cm, cd] = first.split('-').map(Number);
  for (;;) {
    const key = `${cy}-${String(cm).padStart(2, '0')}-${String(cd).padStart(2, '0')}`;
    keys.push(key);
    if (key === last) break;
    const dt = new Date(cy, cm - 1, cd + 7);
    cy = dt.getFullYear();
    cm = dt.getMonth() + 1;
    cd = dt.getDate();
  }
  return keys;
}

/**
 * `bucketBehaviorByWeek`, but the window is one month instead of the trailing N weeks.
 *
 * Only records dated inside the month are counted. A boundary week (say Jul 27 – Aug 2) shows up
 * in both months' charts, but each chart counts only its own month's days — the alternative,
 * dropping the partial week, would hide incidents entirely.
 */
export function bucketBehaviorByWeekInMonth(records: BehaviorLike[], month: string): WeekBucket[] {
  const keys = monthWeekStarts(month);
  const buckets = new Map<string, WeekBucket>(
    keys.map((k) => [k, { key: k, counts: {}, total: 0 }]),
  );
  for (const r of records) {
    if (!r.date.startsWith(month)) continue;
    if (!NEGATIVE_TYPES.includes(r.type as BehaviorTypeId)) continue;
    const b = buckets.get(weekStart(r.date));
    if (!b) continue;
    b.counts[r.type] = (b.counts[r.type] || 0) + 1;
    b.total += 1;
  }
  return keys.map((k) => buckets.get(k)!);
}

export const ATTENDANCE_STATUSES = ['present', 'late', 'absent', 'excused'] as const;
export type AttendanceStatusId = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_META: Record<AttendanceStatusId, { tk: string; color: string }> = {
  present: { tk: 'att_present', color: 'green' },
  late: { tk: 'att_late', color: 'orange' },
  absent: { tk: 'att_absent', color: 'rose' },
  excused: { tk: 'att_excused', color: 'blue' },
};

export type ScoreColorId = 'green' | 'orange' | 'rose';

/**
 * The one score→colour convention, on a 0–10 scale: below 5 is red, 5 up to 7 is orange,
 * 7 and above is green. Every score the teacher sees — badges, stat chips, chart points and
 * the line between them — goes through this, so a colour means the same thing everywhere.
 *
 * Returns a ColorId understood by `colorOf()` (web) / `theme.category` (mobile).
 */
export function scoreColorId(score: number): ScoreColorId {
  return score >= 7 ? 'green' : score >= 5 ? 'orange' : 'rose';
}

export type ScoreStats = { average: number | null; latest: number | null; delta: number | null };

/**
 * `records` should be sorted ascending by date (the service guarantees this).
 * delta = avg(last 3) − avg(previous 3); null when fewer than 2 scores exist.
 */
export function scoreStats(records: ScoreLike[]): ScoreStats {
  if (!records.length) return { average: null, latest: null, delta: null };
  const scores = records.map((r) => r.score);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const average = Math.round(avg(scores) * 10) / 10;
  const latest = scores[scores.length - 1];
  let delta: number | null = null;
  if (scores.length >= 2) {
    const recent = scores.slice(-3);
    const prior = scores.slice(Math.max(0, scores.length - 6), scores.length - 3);
    const base = prior.length ? avg(prior) : scores[0];
    delta = Math.round((avg(recent) - base) * 10) / 10;
  }
  return { average, latest, delta };
}

/** The minimum a score record must have for the per-class breakdown on the report slip. */
export interface ClassScoreLike extends ScoreLike {
  classId: string | null;
}

export type ClassScoreSummary = { classId: string | null; average: number; count: number };

/**
 * Per-class score averages for the monthly report. Records with no class group under
 * `classId: null` (rendered with the generic "no class" label). First-appearance order is kept:
 * the input is date-sorted, so classes come out in the order they were first tested that month.
 */
export function scoreStatsByClass(records: ClassScoreLike[]): ClassScoreSummary[] {
  const groups = new Map<string | null, number[]>();
  for (const r of records) {
    const list = groups.get(r.classId);
    if (list) list.push(r.score);
    else groups.set(r.classId, [r.score]);
  }
  const out: ClassScoreSummary[] = [];
  for (const [classId, scores] of groups) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    out.push({ classId, average: Math.round(avg * 10) / 10, count: scores.length });
  }
  return out;
}
