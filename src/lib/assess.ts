import type { ScoreRow, BehaviorRow } from '../../server/services/assessments.js';

export const BEHAVIOR_TYPES = [
  'late',
  'absent',
  'missing_homework',
  'disruptive',
  'praise',
  'other',
] as const;
export type BehaviorTypeId = (typeof BEHAVIOR_TYPES)[number];

// Incident chart shows only negative types; praise renders as a positive stat instead.
export const NEGATIVE_TYPES: BehaviorTypeId[] = [
  'late',
  'absent',
  'missing_homework',
  'disruptive',
  'other',
];

// tk = i18n key; color = ColorId understood by colorOf() in src/lib/core.ts
export const BEHAVIOR_META: Record<BehaviorTypeId, { tk: string; color: string }> = {
  late: { tk: 'bh_late', color: 'orange' },
  absent: { tk: 'bh_absent', color: 'rose' },
  missing_homework: { tk: 'bh_missing_homework', color: 'violet' },
  disruptive: { tk: 'bh_disruptive', color: 'cocoa' },
  praise: { tk: 'bh_praise', color: 'green' },
  other: { tk: 'bh_other', color: 'blue' },
};

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
  records: BehaviorRow[],
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

export type ScoreStats = { average: number | null; latest: number | null; delta: number | null };

/**
 * `records` should be sorted ascending by date (the service guarantees this).
 * delta = avg(last 3) − avg(previous 3); null when fewer than 2 scores exist.
 */
export function scoreStats(records: ScoreRow[]): ScoreStats {
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
