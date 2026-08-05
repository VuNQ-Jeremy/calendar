import { eq, and, asc } from 'drizzle-orm';
import { scoreRecords, behaviorRecords, monthlyRemarks } from '../db/schema';
import type { Db } from '../db/index';
import type {
  ScoreRecordInput,
  BehaviorRecordInput,
  MonthlyRemarkInput,
} from '../../shared/schemas';

export type ScoreRow = {
  id: string;
  studentId: string;
  classId: string | null;
  date: string;
  score: number;
  assessmentTypeId: string | null;
  notes: string | null;
};

export type BehaviorRow = {
  id: string;
  studentId: string;
  classId: string | null;
  date: string;
  type: string;
  notes: string | null;
};

function mapScore(r: typeof scoreRecords.$inferSelect): ScoreRow {
  return {
    id: r.id,
    studentId: r.studentId,
    classId: r.classId,
    date: r.date,
    score: r.score,
    assessmentTypeId: r.assessmentTypeId,
    notes: r.notes,
  };
}

function mapBehavior(r: typeof behaviorRecords.$inferSelect): BehaviorRow {
  return {
    id: r.id,
    studentId: r.studentId,
    classId: r.classId,
    date: r.date,
    type: r.type,
    notes: r.notes,
  };
}

export async function listScores(db: Db): Promise<ScoreRow[]> {
  const rows = await db.select().from(scoreRecords).orderBy(asc(scoreRecords.date));
  return rows.map(mapScore);
}

export async function createScore(db: Db, input: ScoreRecordInput): Promise<ScoreRow> {
  const id = crypto.randomUUID();
  await db.insert(scoreRecords).values({
    id,
    studentId: input.studentId,
    classId: input.classId ?? null,
    date: input.date,
    score: input.score,
    assessmentTypeId: input.assessmentTypeId ?? null,
    notes: input.notes ?? null,
  });
  const rows = await db.select().from(scoreRecords).where(eq(scoreRecords.id, id));
  return mapScore(rows[0]);
}

export async function updateScore(
  db: Db,
  id: string,
  patch: Partial<ScoreRecordInput>,
): Promise<ScoreRow> {
  const set: Partial<typeof scoreRecords.$inferInsert> = {};
  if (patch.studentId !== undefined) set.studentId = patch.studentId;
  if (patch.classId !== undefined) set.classId = patch.classId ?? null;
  if (patch.date !== undefined) set.date = patch.date;
  if (patch.score !== undefined) set.score = patch.score;
  if (patch.assessmentTypeId !== undefined) set.assessmentTypeId = patch.assessmentTypeId ?? null;
  if (patch.notes !== undefined) set.notes = patch.notes ?? null;
  if (Object.keys(set).length) {
    await db.update(scoreRecords).set(set).where(eq(scoreRecords.id, id));
  }
  const rows = await db.select().from(scoreRecords).where(eq(scoreRecords.id, id));
  return mapScore(rows[0]);
}

export async function removeScore(db: Db, id: string): Promise<void> {
  await db.delete(scoreRecords).where(eq(scoreRecords.id, id));
}

export async function listBehavior(db: Db): Promise<BehaviorRow[]> {
  const rows = await db.select().from(behaviorRecords).orderBy(asc(behaviorRecords.date));
  return rows.map(mapBehavior);
}

export async function createBehavior(db: Db, input: BehaviorRecordInput): Promise<BehaviorRow> {
  const id = crypto.randomUUID();
  await db.insert(behaviorRecords).values({
    id,
    studentId: input.studentId,
    classId: input.classId ?? null,
    date: input.date,
    type: input.type,
    notes: input.notes ?? null,
  });
  const rows = await db.select().from(behaviorRecords).where(eq(behaviorRecords.id, id));
  return mapBehavior(rows[0]);
}

export async function updateBehavior(
  db: Db,
  id: string,
  patch: Partial<BehaviorRecordInput>,
): Promise<BehaviorRow> {
  const set: Partial<typeof behaviorRecords.$inferInsert> = {};
  if (patch.studentId !== undefined) set.studentId = patch.studentId;
  if (patch.classId !== undefined) set.classId = patch.classId ?? null;
  if (patch.date !== undefined) set.date = patch.date;
  if (patch.type !== undefined) set.type = patch.type;
  if (patch.notes !== undefined) set.notes = patch.notes ?? null;
  if (Object.keys(set).length) {
    await db.update(behaviorRecords).set(set).where(eq(behaviorRecords.id, id));
  }
  const rows = await db.select().from(behaviorRecords).where(eq(behaviorRecords.id, id));
  return mapBehavior(rows[0]);
}

export async function removeBehavior(db: Db, id: string): Promise<void> {
  await db.delete(behaviorRecords).where(eq(behaviorRecords.id, id));
}

export type RemarkRow = {
  id: string;
  studentId: string;
  month: string;
  attitude: number;
  homework: number;
  participation: number;
  progress: number;
  comment: string | null;
};

function mapRemark(r: typeof monthlyRemarks.$inferSelect): RemarkRow {
  return {
    id: r.id,
    studentId: r.studentId,
    month: r.month,
    attitude: r.attitude,
    homework: r.homework,
    participation: r.participation,
    progress: r.progress,
    comment: r.comment,
  };
}

export async function listRemarks(db: Db): Promise<RemarkRow[]> {
  const rows = await db.select().from(monthlyRemarks).orderBy(asc(monthlyRemarks.month));
  return rows.map(mapRemark);
}

/** One student's report for one month, or null. The printable slip loads exactly this. */
export async function getRemark(
  db: Db,
  studentId: string,
  month: string,
): Promise<RemarkRow | null> {
  const rows = await db
    .select()
    .from(monthlyRemarks)
    .where(and(eq(monthlyRemarks.studentId, studentId), eq(monthlyRemarks.month, month)));
  return rows[0] ? mapRemark(rows[0]) : null;
}

/**
 * UPSERT on (student_id, month). There is exactly one report per student per month, so a second
 * "create" from a client that had not seen the first must land on the same row rather than fail
 * the UNIQUE constraint — the teacher would only see an opaque 500 for what is a save.
 */
export async function createRemark(db: Db, input: MonthlyRemarkInput): Promise<RemarkRow> {
  const fields = {
    attitude: input.attitude,
    homework: input.homework,
    participation: input.participation,
    progress: input.progress,
    comment: input.comment ?? null,
  };
  await db
    .insert(monthlyRemarks)
    .values({ id: crypto.randomUUID(), studentId: input.studentId, month: input.month, ...fields })
    .onConflictDoUpdate({
      target: [monthlyRemarks.studentId, monthlyRemarks.month],
      set: fields,
    });
  return (await getRemark(db, input.studentId, input.month))!;
}

export async function updateRemark(
  db: Db,
  id: string,
  patch: Partial<MonthlyRemarkInput>,
): Promise<RemarkRow> {
  const set: Partial<typeof monthlyRemarks.$inferInsert> = {};
  if (patch.studentId !== undefined) set.studentId = patch.studentId;
  if (patch.month !== undefined) set.month = patch.month;
  if (patch.attitude !== undefined) set.attitude = patch.attitude;
  if (patch.homework !== undefined) set.homework = patch.homework;
  if (patch.participation !== undefined) set.participation = patch.participation;
  if (patch.progress !== undefined) set.progress = patch.progress;
  if (patch.comment !== undefined) set.comment = patch.comment ?? null;
  if (Object.keys(set).length) {
    await db.update(monthlyRemarks).set(set).where(eq(monthlyRemarks.id, id));
  }
  const rows = await db.select().from(monthlyRemarks).where(eq(monthlyRemarks.id, id));
  return mapRemark(rows[0]);
}

export async function removeRemark(db: Db, id: string): Promise<void> {
  await db.delete(monthlyRemarks).where(eq(monthlyRemarks.id, id));
}
