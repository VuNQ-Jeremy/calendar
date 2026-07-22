import { eq, asc } from 'drizzle-orm';
import { scoreRecords, behaviorRecords } from '../db/schema';
import type { Db } from '../db/index';
import type { ScoreRecordInput, BehaviorRecordInput } from '../../shared/schemas';

export type ScoreRow = {
  id: string;
  studentId: string;
  classId: string | null;
  date: string;
  score: number;
  label: string | null;
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
    label: r.label,
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
    label: input.label ?? null,
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
  if (patch.label !== undefined) set.label = patch.label ?? null;
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
