import { eq, and, gte, lte, isNotNull, asc } from 'drizzle-orm';
import {
  attendanceRecords,
  behaviorRecords,
  events,
  monthlyRemarks,
  scoreRecords,
  settings,
} from '../db/schema';
import type { Db } from '../db/index';
import { DEFAULT_RANKING_WEIGHTS, type RankingWeights } from '../../shared/logic/rankings';
import { record } from './audit';

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Rankings (bảng xếp hạng): one month's raw material for the leaderboard, plus the weights setting.
 *
 * These reads are month-scoped, unlike the assessments service's deliberately dumb full-table
 * `listScores`/`listBehavior`. The assessments screen charts a student's whole history; this page
 * never looks outside one month, the tables grow without bound, and the client cache is keyed per
 * month — so the payload should be month-sized too.
 *
 * The scoring itself is in `shared/logic/rankings.ts`, which knows nothing about Drizzle so the
 * mobile app can reuse it unchanged.
 */

const SETTINGS_KEY = 'ranking-weights';

/** Same store and defaulting shape as `getTuitionSettings`. */
export async function getRankingWeights(db: Db): Promise<RankingWeights> {
  const rows = await db.select().from(settings).where(eq(settings.key, SETTINGS_KEY));
  const row = rows[0];
  if (!row) return { ...DEFAULT_RANKING_WEIGHTS };
  try {
    const parsed = JSON.parse(row.value) as Partial<RankingWeights>;
    const { attitude, score } = parsed;
    // A stored pair that no longer adds up would silently distort every total, so fall back
    // to the defaults rather than ranking on it.
    if (
      typeof attitude !== 'number' ||
      typeof score !== 'number' ||
      !Number.isInteger(attitude) ||
      !Number.isInteger(score) ||
      attitude < 0 ||
      score < 0 ||
      attitude + score !== 100
    ) {
      return { ...DEFAULT_RANKING_WEIGHTS };
    }
    return { attitude, score };
  } catch {
    return { ...DEFAULT_RANKING_WEIGHTS };
  }
}

export async function setRankingWeights(db: Db, input: RankingWeights): Promise<RankingWeights> {
  const before = await getRankingWeights(db);
  const value = JSON.stringify(input);
  await db
    .insert(settings)
    .values({ key: SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
  if (!sameJson(before, input)) {
    record({
      action: 'update',
      entityType: 'setting',
      entityId: SETTINGS_KEY,
      before,
      after: input,
    });
  }
  return input;
}

/** '2026-03' -> ['2026-03-01', '2026-03-31'] — dates are zero-padded, so lexical compare works. */
function monthRange(month: string): [string, string] {
  return [`${month}-01`, `${month}-31`];
}

export type RankAttendanceRow = { studentId: string; classId: string; status: string };

/**
 * `attendance_records` has no class column, so the class comes from the event — the same join
 * tuition bills from. Sessions on an event with no class are dropped: they cannot pass a class
 * filter, and an ad-hoc one-off is not part of a class's ý thức record.
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
    .where(
      and(
        gte(attendanceRecords.date, start),
        lte(attendanceRecords.date, end),
        isNotNull(events.classId),
      ),
    );
  // `isNotNull` already excluded the null classIds; this only narrows the type.
  return rows as RankAttendanceRow[];
}

export type RankScoreRow = { studentId: string; classId: string | null; score: number };

/**
 * `score_records` is the whole gradebook: hand-entered marks and graded tests both land here
 * (tests sync through `syncScoreRecord`), so there is nothing to read from `test_attempts`.
 */
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
      ratings = JSON.parse(r.ratings) as Record<string, number>;
    } catch {
      // A corrupt row reads as unrated rather than taking the page down — same call the
      // assessments service makes.
    }
    return { studentId: r.studentId, ratings };
  });
}
