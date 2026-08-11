import { eq, and, asc } from 'drizzle-orm';
import { scoreRecords, behaviorRecords, monthlyRemarks } from '../db/schema';
import type { Db } from '../db/index';
import type {
  ScoreRecordInput,
  BehaviorRecordInput,
  MonthlyRemarkInput,
} from '../../shared/schemas';
import { record, recordCreate, recordDelete } from './audit';

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

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
  const row = mapScore(rows[0]);
  recordCreate('assessment', id, { kind: 'score', ...row });
  return row;
}

export async function updateScore(
  db: Db,
  id: string,
  patch: Partial<ScoreRecordInput>,
): Promise<ScoreRow> {
  const beforeRows = await db.select().from(scoreRecords).where(eq(scoreRecords.id, id));
  const before = beforeRows[0] ? mapScore(beforeRows[0]) : undefined;
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
  const after = mapScore(rows[0]);
  if (!sameJson(before, after)) {
    record({
      action: 'update',
      entityType: 'assessment',
      entityId: id,
      before,
      after,
      meta: { kind: 'score' },
    });
  }
  return after;
}

export async function removeScore(db: Db, id: string): Promise<void> {
  await recordDelete(db, 'assessment', scoreRecords, id, { kind: 'score' });
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
  const row = mapBehavior(rows[0]);
  recordCreate('assessment', id, { kind: 'behavior', ...row });
  return row;
}

export async function updateBehavior(
  db: Db,
  id: string,
  patch: Partial<BehaviorRecordInput>,
): Promise<BehaviorRow> {
  const beforeRows = await db.select().from(behaviorRecords).where(eq(behaviorRecords.id, id));
  const before = beforeRows[0] ? mapBehavior(beforeRows[0]) : undefined;
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
  const after = mapBehavior(rows[0]);
  if (!sameJson(before, after)) {
    record({
      action: 'update',
      entityType: 'assessment',
      entityId: id,
      before,
      after,
      meta: { kind: 'behavior' },
    });
  }
  return after;
}

export async function removeBehavior(db: Db, id: string): Promise<void> {
  await recordDelete(db, 'assessment', behaviorRecords, id, { kind: 'behavior' });
  await db.delete(behaviorRecords).where(eq(behaviorRecords.id, id));
}

export type RemarkRow = {
  id: string;
  studentId: string;
  month: string;
  /** remark_criteria id -> 1-5 rating. Keys for deleted criteria may linger; no screen renders them. */
  ratings: Record<string, number>;
  comment: string | null;
  staffId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** When the slip image last reached a family chat; null = never sent. */
  sentAt: string | null;
};

function mapRemark(r: typeof monthlyRemarks.$inferSelect): RemarkRow {
  let ratings: Record<string, number> = {};
  try {
    ratings = JSON.parse(r.ratings);
  } catch {
    // A corrupt row renders as an unrated report rather than a 500.
  }
  return {
    id: r.id,
    studentId: r.studentId,
    month: r.month,
    ratings,
    comment: r.comment,
    staffId: r.staffId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    sentAt: r.sentAt,
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
export async function createRemark(
  db: Db,
  input: MonthlyRemarkInput,
  staffId: string | null,
): Promise<RemarkRow> {
  const before = await getRemark(db, input.studentId, input.month);
  const now = new Date().toISOString();
  const fields = {
    ratings: JSON.stringify(input.ratings),
    comment: input.comment ?? null,
    staffId,
    updatedAt: now,
  };
  await db
    .insert(monthlyRemarks)
    .values({
      id: crypto.randomUUID(),
      studentId: input.studentId,
      month: input.month,
      createdAt: now,
      ...fields,
    })
    .onConflictDoUpdate({
      target: [monthlyRemarks.studentId, monthlyRemarks.month],
      // created_at and sent_at deliberately survive the upsert: first save and delivery are
      // historical facts a re-save must not rewrite.
      set: fields,
    });
  const after = (await getRemark(db, input.studentId, input.month))!;
  if (!before) recordCreate('assessment', after.id, { kind: 'remark', ...after });
  else if (!sameJson(before, after)) {
    record({
      action: 'update',
      entityType: 'assessment',
      entityId: after.id,
      before,
      after,
      meta: { kind: 'remark' },
    });
  }
  return after;
}

export async function updateRemark(
  db: Db,
  id: string,
  patch: Partial<MonthlyRemarkInput>,
  staffId: string | null,
): Promise<RemarkRow> {
  const beforeRows = await db.select().from(monthlyRemarks).where(eq(monthlyRemarks.id, id));
  const before = beforeRows[0] ? mapRemark(beforeRows[0]) : undefined;
  const set: Partial<typeof monthlyRemarks.$inferInsert> = {};
  if (patch.studentId !== undefined) set.studentId = patch.studentId;
  if (patch.month !== undefined) set.month = patch.month;
  if (patch.ratings !== undefined) set.ratings = JSON.stringify(patch.ratings);
  if (patch.comment !== undefined) set.comment = patch.comment ?? null;
  if (Object.keys(set).length) {
    set.staffId = staffId;
    set.updatedAt = new Date().toISOString();
    await db.update(monthlyRemarks).set(set).where(eq(monthlyRemarks.id, id));
  }
  const rows = await db.select().from(monthlyRemarks).where(eq(monthlyRemarks.id, id));
  const after = mapRemark(rows[0]);
  if (!sameJson(before, after)) {
    record({
      action: 'update',
      entityType: 'assessment',
      entityId: id,
      before,
      after,
      meta: { kind: 'remark' },
    });
  }
  return after;
}

export async function removeRemark(db: Db, id: string): Promise<void> {
  await recordDelete(db, 'assessment', monthlyRemarks, id, { kind: 'remark' });
  await db.delete(monthlyRemarks).where(eq(monthlyRemarks.id, id));
}

/**
 * Stamp the moment a slip image for this remark reached at least one family chat.
 * Called by /zalo-send-card only after Zalo accepted the photo — never speculatively.
 * A repeat send simply moves the stamp forward; "last sent" is the honest reading.
 */
export async function markRemarkSent(db: Db, id: string): Promise<void> {
  await db
    .update(monthlyRemarks)
    .set({ sentAt: new Date().toISOString() })
    .where(eq(monthlyRemarks.id, id));
}
