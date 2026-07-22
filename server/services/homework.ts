import { eq, and, lte, inArray } from 'drizzle-orm';
import { homework, homeworkGrades, scoreRecords } from '../db/schema';
import type { Db } from '../db/index';
import type { HomeworkInput, HomeworkGradesSaveInput } from '../../shared/schemas';

export type HomeworkRow = {
  id: string;
  title: string;
  classId: string | null;
  due: string | null;
  points: number | null;
  notes: string | null;
  color: string | null;
  done: boolean;
  assessmentTypeId: string | null;
};

export type GradeRow = {
  id: string;
  homeworkId: string;
  studentId: string;
  score: number | null;
  comment: string | null;
  gradedAt: string | null;
  scoreRecordId: string | null;
};

function map(r: typeof homework.$inferSelect): HomeworkRow {
  return {
    id: r.id,
    title: r.title,
    classId: r.classId,
    due: r.due,
    points: r.points,
    notes: r.notes,
    color: r.color,
    done: Boolean(r.done),
    assessmentTypeId: r.assessmentTypeId,
  };
}

function mapGrade(r: typeof homeworkGrades.$inferSelect): GradeRow {
  return {
    id: r.id,
    homeworkId: r.homeworkId,
    studentId: r.studentId,
    score: r.score,
    comment: r.comment,
    gradedAt: r.gradedAt,
    scoreRecordId: r.scoreRecordId,
  };
}

export async function list(db: Db): Promise<HomeworkRow[]> {
  const rows = await db.select().from(homework);
  return rows.map(map);
}

export async function create(db: Db, input: HomeworkInput): Promise<HomeworkRow> {
  const id = crypto.randomUUID();
  await db.insert(homework).values({
    id,
    title: input.title,
    classId: input.classId ?? null,
    due: input.due ?? null,
    points: input.points ?? null,
    notes: input.notes ?? null,
    color: input.color ?? null,
    done: input.done,
    assessmentTypeId: input.assessmentTypeId ?? null,
  });
  const rows = await db.select().from(homework).where(eq(homework.id, id));
  return map(rows[0]);
}

export async function update(
  db: Db,
  id: string,
  patch: Partial<HomeworkInput>,
): Promise<HomeworkRow> {
  const set: Partial<typeof homework.$inferInsert> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.classId !== undefined) set.classId = patch.classId ?? null;
  if (patch.due !== undefined) set.due = patch.due ?? null;
  if (patch.points !== undefined) set.points = patch.points ?? null;
  if (patch.notes !== undefined) set.notes = patch.notes ?? null;
  if (patch.color !== undefined) set.color = patch.color ?? null;
  if (patch.done !== undefined) set.done = patch.done;
  if (patch.assessmentTypeId !== undefined) set.assessmentTypeId = patch.assessmentTypeId ?? null;
  if (Object.keys(set).length) {
    await db.update(homework).set(set).where(eq(homework.id, id));
  }

  // Propagate class/type/due changes to any score records synced from this homework's grades.
  if (patch.classId !== undefined || patch.assessmentTypeId !== undefined || patch.due) {
    const grades = await db.select().from(homeworkGrades).where(eq(homeworkGrades.homeworkId, id));
    const scoreRecordIds = grades.map((g) => g.scoreRecordId).filter((x): x is string => x != null);
    if (scoreRecordIds.length) {
      const scoreSet: Partial<typeof scoreRecords.$inferInsert> = {};
      if (patch.classId !== undefined) scoreSet.classId = patch.classId ?? null;
      if (patch.assessmentTypeId !== undefined) {
        scoreSet.assessmentTypeId = patch.assessmentTypeId ?? null;
      }
      if (patch.due) scoreSet.date = patch.due;
      if (Object.keys(scoreSet).length) {
        await db.update(scoreRecords).set(scoreSet).where(inArray(scoreRecords.id, scoreRecordIds));
      }
    }
  }

  const rows = await db.select().from(homework).where(eq(homework.id, id));
  return map(rows[0]);
}

export async function remove(db: Db, id: string): Promise<void> {
  const grades = await db.select().from(homeworkGrades).where(eq(homeworkGrades.homeworkId, id));
  const scoreRecordIds = grades.map((g) => g.scoreRecordId).filter((x): x is string => x != null);
  if (scoreRecordIds.length) {
    await db.delete(scoreRecords).where(inArray(scoreRecords.id, scoreRecordIds));
  }
  // ON DELETE CASCADE removes the homework_grades rows.
  await db.delete(homework).where(eq(homework.id, id));
}

export async function countDue(db: Db, todayIso: string): Promise<number> {
  const rows = await db
    .select()
    .from(homework)
    .where(and(eq(homework.done, false), lte(homework.due, todayIso)));
  return rows.length;
}

export async function listDueToday(db: Db, todayIso: string): Promise<HomeworkRow[]> {
  const rows = await db
    .select()
    .from(homework)
    .where(and(eq(homework.done, false), eq(homework.due, todayIso)));
  return rows.map(map);
}

export async function listGrades(db: Db): Promise<GradeRow[]> {
  const rows = await db.select().from(homeworkGrades);
  return rows.map(mapGrade);
}

/**
 * Grading a homework auto-syncs a score_record so the Assessment charts reflect
 * assignment grades. Invariant: a linked score_record exists iff `grade.score != null`.
 * D1 has no interactive transactions, so this runs as sequential awaits (not a single batch).
 */
export async function saveGrades(
  db: Db,
  homeworkId: string,
  records: HomeworkGradesSaveInput['records'],
): Promise<GradeRow[]> {
  const hwRows = await db.select().from(homework).where(eq(homework.id, homeworkId));
  const hw = hwRows[0];
  if (!hw) throw Response.json({ error: 'homework not found' }, { status: 404 });

  const existingRows = await db
    .select()
    .from(homeworkGrades)
    .where(eq(homeworkGrades.homeworkId, homeworkId));
  const byStudent = new Map(existingRows.map((g) => [g.studentId, g]));

  const now = new Date().toISOString();
  const date = hw.due ?? now.slice(0, 10);

  for (const rec of records) {
    const prev = byStudent.get(rec.studentId);
    const hasScore = rec.score != null;
    const hasComment = !!(rec.comment && rec.comment.trim());

    if (!hasScore && !hasComment) {
      if (prev) {
        if (prev.scoreRecordId) {
          await db.delete(scoreRecords).where(eq(scoreRecords.id, prev.scoreRecordId));
        }
        await db.delete(homeworkGrades).where(eq(homeworkGrades.id, prev.id));
      }
      continue;
    }

    let scoreRecordId = prev?.scoreRecordId ?? null;
    if (hasScore) {
      if (scoreRecordId) {
        await db
          .update(scoreRecords)
          .set({
            score: rec.score!,
            notes: rec.comment ?? null,
            date,
            classId: hw.classId,
            assessmentTypeId: hw.assessmentTypeId,
          })
          .where(eq(scoreRecords.id, scoreRecordId));
      } else {
        scoreRecordId = crypto.randomUUID();
        await db.insert(scoreRecords).values({
          id: scoreRecordId,
          studentId: rec.studentId,
          classId: hw.classId,
          date,
          score: rec.score!,
          assessmentTypeId: hw.assessmentTypeId,
          notes: rec.comment ?? null,
        });
      }
    } else if (scoreRecordId) {
      // Comment-only grade: no score, so no score record should exist.
      await db.delete(scoreRecords).where(eq(scoreRecords.id, scoreRecordId));
      scoreRecordId = null;
    }

    const gradeValues = {
      score: rec.score ?? null,
      comment: rec.comment ?? null,
      gradedAt: now,
      scoreRecordId,
    };
    if (prev) {
      await db.update(homeworkGrades).set(gradeValues).where(eq(homeworkGrades.id, prev.id));
    } else {
      await db.insert(homeworkGrades).values({
        id: crypto.randomUUID(),
        homeworkId,
        studentId: rec.studentId,
        ...gradeValues,
      });
    }
  }

  const rows = await db
    .select()
    .from(homeworkGrades)
    .where(eq(homeworkGrades.homeworkId, homeworkId));
  return rows.map(mapGrade);
}
