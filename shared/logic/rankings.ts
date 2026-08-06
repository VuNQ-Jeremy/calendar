/**
 * Monthly student ranking maths — the "bảng xếp hạng" page.
 *
 * Pure functions only: no React, no DOM, no `server/` imports (same rule as `assess.ts`, and for
 * the same reason — the mobile app has to be able to import this without pulling in Workers types).
 * Rows are described structurally; the only fields read are status, type, score and ratings.
 *
 * Ý thức (attitude, 0–10) is the mean of up to three components. A component with no data for the
 * month is null and is EXCLUDED from the mean rather than counted as zero — a class that has never
 * recorded behaviour must not drag every student down to a third of their attendance score:
 *
 *   1. attendance — present=1, late=0.5, absent=0; `excused` is skipped entirely (an approved
 *      absence is not a mark against the student), ratio × 10.
 *   2. behaviour  — starts at 10, −1 per negative record, +0.5 per praise, clamped to [0, 10].
 *   3. remark     — the teacher's monthly 1–5 star ratings, averaged, × 2. Remarks are
 *      student-wide (there is no class column), so they survive a class filter unchanged.
 *
 * total = round1((attitude × w.attitude + avgScore × w.score) / 100). When exactly one of the two
 * criteria has no data the total is the other one alone: a student who sat tests but has no
 * attitude records yet is still ranked, rather than being penalised for the teacher's bookkeeping.
 * Both null → unranked, listed separately at the bottom of the board.
 *
 * Ranking is competition style (1, 2, 2, 4) over the 1-decimal rounded totals, so two rows that
 * DISPLAY the same score always share a rank.
 */

import { NEGATIVE_TYPES, type BehaviorTypeId } from './assess';

export interface RankingWeights {
  /** Integer percent; attitude + score === 100. */
  attitude: number;
  score: number;
}

export const DEFAULT_RANKING_WEIGHTS: RankingWeights = { attitude: 40, score: 60 };

/** Behaviour component tuning, exported so the tests and any future UI copy stay in agreement. */
export const RANK_NEGATIVE_PENALTY = 1;
export const RANK_PRAISE_BONUS = 0.5;

/** One student's month, already filtered to the month (and to the class, when one is selected). */
export interface RankRowInput {
  studentId: string;
  /** `attendance_records.status` values. */
  attendanceStatuses: string[];
  /** `behavior_records.type` values; unrecognised values are ignored. */
  behaviorTypes: string[];
  /** `score_records.score` values, 0–10. */
  scores: number[];
  /** `monthly_remarks.ratings` for this student and month, or null when no remark exists. */
  remarkRatings: Record<string, number> | null;
}

export interface StudentRanking {
  studentId: string;
  /** The three ý thức components, each 0–10, or null when the month has no data for it. */
  attendance: number | null;
  behavior: number | null;
  remark: number | null;
  /** Mean of the non-null components; null when all three are null. */
  attitude: number | null;
  /** Mean of the month's test scores; null when there are none. */
  avgScore: number | null;
  testCount: number;
  /** Weighted total; null when the student has no data at all this month. */
  total: number | null;
  /** Competition rank (1, 2, 2, 4). Null for the unranked section. */
  rank: number | null;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** present=1, late=0.5, absent=0. `excused` rows leave the denominator untouched. */
export function attendanceComponent(statuses: string[]): number | null {
  let points = 0;
  let counted = 0;
  for (const s of statuses) {
    if (s === 'present') points += 1;
    else if (s === 'late') points += 0.5;
    else if (s === 'absent') points += 0;
    else continue; // 'excused' and anything unrecognised
    counted += 1;
  }
  if (counted === 0) return null;
  return round1((points / counted) * 10);
}

/** 10 − 1 per negative record, +0.5 per praise, clamped to [0, 10]. Null with no records. */
export function behaviorComponent(types: string[]): number | null {
  if (types.length === 0) return null;
  let score = 10;
  for (const t of types) {
    if (NEGATIVE_TYPES.includes(t as BehaviorTypeId)) score -= RANK_NEGATIVE_PENALTY;
    else if (t === 'praise') score += RANK_PRAISE_BONUS;
  }
  return round1(Math.min(10, Math.max(0, score)));
}

/** Mean of the teacher's 1–5 ratings, doubled onto the 0–10 scale the rest of the app uses. */
export function remarkComponent(
  ratings: Record<string, number> | null | undefined,
): number | null {
  if (!ratings) return null;
  const values = Object.values(ratings).filter((v) => typeof v === 'number' && !Number.isNaN(v));
  if (values.length === 0) return null;
  return round1(mean(values) * 2);
}

/** Weighted total. One-sided data uses that side alone; no data at all is null. */
export function combineTotal(
  attitude: number | null,
  avgScore: number | null,
  weights: RankingWeights,
): number | null {
  if (attitude == null && avgScore == null) return null;
  if (attitude == null) return round1(avgScore as number);
  if (avgScore == null) return round1(attitude);
  return round1((attitude * weights.attitude + avgScore * weights.score) / 100);
}

/**
 * Rank one month.
 *
 * `rows` must already be filtered to the month (and class) and must arrive in the caller's
 * tie-break order — the screen passes students sorted by name, so tied totals list alphabetically.
 * Ranked students come back first (total descending), then the unranked in input order.
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
    const attitude = parts.length ? round1(mean(parts)) : null;
    const avgScore = r.scores.length ? round1(mean(r.scores)) : null;
    return {
      studentId: r.studentId,
      attendance,
      behavior,
      remark,
      attitude,
      avgScore,
      testCount: r.scores.length,
      total: combineTotal(attitude, avgScore, weights),
      rank: null,
    };
  });

  const ranked = computed.filter((s) => s.total != null);
  const unranked = computed.filter((s) => s.total == null);
  // Array.prototype.sort is stable, so equal totals keep the caller's ordering.
  ranked.sort((a, b) => (b.total as number) - (a.total as number));

  let prevTotal: number | null = null;
  let prevRank = 0;
  ranked.forEach((s, i) => {
    // Totals are already rounded to one decimal, so this compares what the user actually sees.
    s.rank = s.total === prevTotal ? prevRank : i + 1;
    prevTotal = s.total;
    prevRank = s.rank;
  });

  return [...ranked, ...unranked];
}
