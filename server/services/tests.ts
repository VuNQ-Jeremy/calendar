import { eq, asc, desc, inArray } from 'drizzle-orm';
import { tests, testQuestions, testAttempts, questions, scoreRecords } from '../db/schema';
import { chunk, rowsPerStatement, D1_MAX_BOUND_PARAMS, type Db } from '../db/index';
import type { TestInput } from '../../shared/schemas';
import { ictDateOf } from '../../shared/logic/tests';

/**
 * Tests domain service. Paper-mode score entry syncs a gradebook row per attempt so the
 * Assessment charts include test results.
 *
 * D1 has no interactive transactions, so every multi-row write here runs as a sequence of
 * idempotent awaits (or, where the whole write is one replace-set, a single `db.batch`).
 * A partially applied save is therefore always safe to re-run.
 */

export type TestRow = {
  id: string;
  title: string;
  classId: string | null;
  assessmentTypeId: string | null;
  gradeLevelId: string | null;
  status: 'draft' | 'published';
  mode: 'online' | 'paper';
  date: string | null;
  openAt: string | null;
  closeAt: string | null;
  timeLimitMinutes: number | null;
  instructions: string | null;
  color: string | null;
  createdAt: string | null;
};

export type TestQuestionRow = {
  testId: string;
  questionId: string;
  sortOrder: number;
  points: number;
};

export type TestAttemptRow = {
  id: string;
  testId: string;
  studentId: string;
  source: 'online' | 'paper';
  status: 'in_progress' | 'submitted' | 'needs_grading' | 'graded';
  startedAt: string;
  submittedAt: string | null;
  deadlineAt: string | null;
  autoScore: number | null;
  totalScore: number | null;
  normalizedScore: number | null;
  comment: string | null;
  scoreRecordId: string | null;
};

function map(r: typeof tests.$inferSelect): TestRow {
  return {
    id: r.id,
    title: r.title,
    classId: r.classId,
    assessmentTypeId: r.assessmentTypeId,
    gradeLevelId: r.gradeLevelId,
    status: r.status as TestRow['status'],
    mode: r.mode as TestRow['mode'],
    date: r.date,
    openAt: r.openAt,
    closeAt: r.closeAt,
    timeLimitMinutes: r.timeLimitMinutes,
    instructions: r.instructions,
    color: r.color,
    createdAt: r.createdAt,
  };
}

function mapLink(r: typeof testQuestions.$inferSelect): TestQuestionRow {
  return {
    testId: r.testId,
    questionId: r.questionId,
    sortOrder: r.sortOrder,
    points: r.points,
  };
}

function mapAttempt(r: typeof testAttempts.$inferSelect): TestAttemptRow {
  return {
    id: r.id,
    testId: r.testId,
    studentId: r.studentId,
    source: r.source as TestAttemptRow['source'],
    status: r.status as TestAttemptRow['status'],
    startedAt: r.startedAt,
    submittedAt: r.submittedAt,
    deadlineAt: r.deadlineAt,
    autoScore: r.autoScore,
    totalScore: r.totalScore,
    normalizedScore: r.normalizedScore,
    comment: r.comment,
    scoreRecordId: r.scoreRecordId,
  };
}

export async function list(db: Db): Promise<TestRow[]> {
  const rows = await db.select().from(tests).orderBy(desc(tests.createdAt));
  return rows.map(map);
}

export async function get(db: Db, id: string): Promise<TestRow> {
  const rows = await db.select().from(tests).where(eq(tests.id, id));
  if (!rows[0]) throw Response.json({ error: 'test_not_found' }, { status: 404 });
  return map(rows[0]);
}

export async function listQuestionLinks(db: Db, testId?: string): Promise<TestQuestionRow[]> {
  const q = db.select().from(testQuestions).$dynamic();
  const rows = testId
    ? await q.where(eq(testQuestions.testId, testId)).orderBy(asc(testQuestions.sortOrder))
    : await q.orderBy(asc(testQuestions.sortOrder));
  return rows.map(mapLink);
}

export async function listAttempts(db: Db, testId?: string): Promise<TestAttemptRow[]> {
  const q = db.select().from(testAttempts).$dynamic();
  const rows = testId ? await q.where(eq(testAttempts.testId, testId)) : await q;
  return rows.map(mapAttempt);
}

export async function attemptsSummary(
  db: Db,
): Promise<Record<string, { total: number; needsGrading: number; graded: number }>> {
  const rows = await db.select().from(testAttempts);
  const out: Record<string, { total: number; needsGrading: number; graded: number }> = {};
  for (const r of rows) {
    const bucket = (out[r.testId] ??= { total: 0, needsGrading: 0, graded: 0 });
    bucket.total += 1;
    if (r.status === 'needs_grading') bucket.needsGrading += 1;
    if (r.status === 'graded') bucket.graded += 1;
  }
  return out;
}

export async function hasAttempts(db: Db, testId: string): Promise<boolean> {
  const rows = await db.select().from(testAttempts).where(eq(testAttempts.testId, testId));
  return rows.length > 0;
}

export async function create(db: Db, input: TestInput): Promise<TestRow> {
  const id = crypto.randomUUID();
  await db.insert(tests).values({
    id,
    title: input.title,
    classId: input.classId ?? null,
    assessmentTypeId: input.assessmentTypeId ?? null,
    gradeLevelId: input.gradeLevelId ?? null,
    status: 'draft',
    mode: input.mode,
    date: input.date ?? null,
    openAt: input.openAt ?? null,
    closeAt: input.closeAt ?? null,
    timeLimitMinutes: input.timeLimitMinutes ?? null,
    instructions: input.instructions ?? null,
    color: input.color ?? null,
    createdAt: new Date().toISOString(),
  });
  return get(db, id);
}

export async function update(db: Db, id: string, patch: Partial<TestInput>): Promise<TestRow> {
  // Switching mode once anyone has sat the test would strand their attempts in a mode that
  // cannot display them: an online attempt is invisible to the paper score grid, which then
  // silently discards whatever the teacher types for that student. Close the door instead.
  if (patch.mode !== undefined) {
    const current = await get(db, id);
    if (patch.mode !== current.mode && (await hasAttempts(db, id))) {
      throw Response.json({ error: 'test_has_attempts' }, { status: 409 });
    }
  }

  const set: Partial<typeof tests.$inferInsert> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.classId !== undefined) set.classId = patch.classId ?? null;
  if (patch.assessmentTypeId !== undefined) set.assessmentTypeId = patch.assessmentTypeId ?? null;
  if (patch.gradeLevelId !== undefined) set.gradeLevelId = patch.gradeLevelId ?? null;
  if (patch.mode !== undefined) set.mode = patch.mode;
  if (patch.date !== undefined) set.date = patch.date ?? null;
  if (patch.openAt !== undefined) set.openAt = patch.openAt ?? null;
  if (patch.closeAt !== undefined) set.closeAt = patch.closeAt ?? null;
  if (patch.timeLimitMinutes !== undefined) set.timeLimitMinutes = patch.timeLimitMinutes ?? null;
  if (patch.instructions !== undefined) set.instructions = patch.instructions ?? null;
  if (patch.color !== undefined) set.color = patch.color ?? null;
  if (Object.keys(set).length) {
    await db.update(tests).set(set).where(eq(tests.id, id));
  }

  const row = await get(db, id);

  // Propagate class/type/date changes to any score records synced from this test's attempts.
  // Each guard tests `!== undefined`, not truthiness: clearing a field to null is a real
  // change that must propagate too, and a date cleared to null falls back to today in ICT
  // (the same rule syncScoreRecord applies) rather than stranding the old date.
  if (
    patch.classId !== undefined ||
    patch.assessmentTypeId !== undefined ||
    patch.date !== undefined
  ) {
    const attempts = await db.select().from(testAttempts).where(eq(testAttempts.testId, id));
    const scoreRecordIds = attempts
      .map((a) => a.scoreRecordId)
      .filter((x): x is string => x != null);
    if (scoreRecordIds.length) {
      const scoreSet: Partial<typeof scoreRecords.$inferInsert> = {};
      if (patch.classId !== undefined) scoreSet.classId = row.classId;
      if (patch.assessmentTypeId !== undefined) scoreSet.assessmentTypeId = row.assessmentTypeId;
      if (patch.date !== undefined) scoreSet.date = row.date ?? ictDateOf(new Date().toISOString());
      if (Object.keys(scoreSet).length) {
        await db.update(scoreRecords).set(scoreSet).where(inArray(scoreRecords.id, scoreRecordIds));
      }
    }
  }

  return row;
}

export async function remove(db: Db, id: string): Promise<void> {
  const attempts = await db.select().from(testAttempts).where(eq(testAttempts.testId, id));
  const scoreRecordIds = attempts.map((a) => a.scoreRecordId).filter((x): x is string => x != null);
  if (scoreRecordIds.length) {
    await db.delete(scoreRecords).where(inArray(scoreRecords.id, scoreRecordIds));
  }
  // ON DELETE CASCADE removes test_questions, test_attempts and test_answers.
  await db.delete(tests).where(eq(tests.id, id));
}

/** The columns each test_questions row binds — see `rowsPerStatement`. */
const TEST_QUESTION_COLUMNS = 4;

/**
 * Replace-set: the submitted array becomes the test's full question list, in array order.
 * Refuses once anyone has an attempt — reshaping a sat test would invalidate its scores.
 */
export async function setQuestions(
  db: Db,
  testId: string,
  items: { questionId: string; points: number }[],
): Promise<TestQuestionRow[]> {
  await get(db, testId);
  if (await hasAttempts(db, testId)) {
    throw Response.json({ error: 'test_has_attempts' }, { status: 409 });
  }

  const ids = [...new Set(items.map((i) => i.questionId))];
  if (ids.length) {
    // Chunked: `inArray` binds one parameter per id and D1 caps a statement at 100 of them.
    const found = (
      await Promise.all(
        chunk(ids, D1_MAX_BOUND_PARAMS).map((part) =>
          db.select().from(questions).where(inArray(questions.id, part)),
        ),
      )
    ).flat();
    if (found.length !== ids.length) {
      throw Response.json({ error: 'unknown_question' }, { status: 400 });
    }
  }

  const del = db.delete(testQuestions).where(eq(testQuestions.testId, testId));
  if (items.length) {
    const rows = items.map((it, i) => ({
      testId,
      questionId: it.questionId,
      sortOrder: i,
      points: it.points,
    }));
    // One INSERT of every link would bind 4 parameters per row and blow D1's 100-parameter
    // ceiling past 25 questions, so the rows go out in chunks — all in the same batch as the
    // delete, which is what makes the replace atomic.
    const inserts = chunk(rows, rowsPerStatement(TEST_QUESTION_COLUMNS)).map((part) =>
      db.insert(testQuestions).values(part),
    );
    await db.batch([del, ...inserts]);
  } else {
    await del;
  }

  return listQuestionLinks(db, testId);
}

/**
 * Add questions to the END of a test's list, keeping everything already there.
 *
 * `setQuestions` is a REPLACE-set, so the import flow cannot call it with only the new rows — that
 * would silently drop every question the teacher had already picked. Merging here and delegating
 * keeps a single write path (and with it the attempt guard and the unknown-question check).
 * Ids already on the test are skipped rather than duplicated: test_questions is keyed on
 * (test_id, question_id), so a repeat would fail the insert.
 */
export async function appendQuestions(
  db: Db,
  testId: string,
  add: { questionId: string; points: number }[],
): Promise<TestQuestionRow[]> {
  const existing = await listQuestionLinks(db, testId);
  const have = new Set(existing.map((l) => l.questionId));
  const fresh = add.filter((item) => !have.has(item.questionId));
  if (!fresh.length) return existing;

  const merged = [
    ...existing.map((l) => ({ questionId: l.questionId, points: l.points })),
    ...fresh,
  ];
  // Mirrors TestQuestionsSaveInput's cap, which setQuestions itself does not enforce.
  if (merged.length > 100) throw Response.json({ error: 'too_many_questions' }, { status: 400 });
  return setQuestions(db, testId, merged);
}

export async function publish(db: Db, id: string): Promise<TestRow> {
  const test = await get(db, id);
  const links = await listQuestionLinks(db, id);
  if (!links.length) throw Response.json({ error: 'test_empty' }, { status: 400 });
  if (test.mode === 'online' && !test.closeAt) {
    throw Response.json({ error: 'test_no_close' }, { status: 400 });
  }
  await db.update(tests).set({ status: 'published' }).where(eq(tests.id, id));
  return get(db, id);
}

export async function unpublish(db: Db, id: string): Promise<TestRow> {
  await get(db, id);
  if (await hasAttempts(db, id)) {
    throw Response.json({ error: 'test_has_attempts' }, { status: 409 });
  }
  await db.update(tests).set({ status: 'draft' }).where(eq(tests.id, id));
  return get(db, id);
}

export async function totalPoints(db: Db, testId: string): Promise<number> {
  const rows = await db.select().from(testQuestions).where(eq(testQuestions.testId, testId));
  return rows.reduce((sum, r) => sum + r.points, 0);
}

/**
 * Keeps one gradebook row in step with one attempt's score.
 * Invariant: a linked score_record exists iff the attempt's `normalizedScore != null`.
 * Returns the score_record id to store on the attempt, or null when there should be none.
 */
export async function syncScoreRecord(
  db: Db,
  test: TestRow,
  args: {
    studentId: string;
    score: number | null;
    comment: string | null;
    existingScoreRecordId: string | null;
  },
): Promise<string | null> {
  const date = test.date ?? ictDateOf(new Date().toISOString());

  if (args.score == null) {
    if (args.existingScoreRecordId) {
      await db.delete(scoreRecords).where(eq(scoreRecords.id, args.existingScoreRecordId));
    }
    return null;
  }

  if (args.existingScoreRecordId) {
    await db
      .update(scoreRecords)
      .set({
        score: args.score,
        notes: args.comment ?? null,
        date,
        classId: test.classId,
        assessmentTypeId: test.assessmentTypeId,
      })
      .where(eq(scoreRecords.id, args.existingScoreRecordId));
    return args.existingScoreRecordId;
  }

  const id = crypto.randomUUID();
  await db.insert(scoreRecords).values({
    id,
    studentId: args.studentId,
    classId: test.classId,
    date,
    score: args.score,
    assessmentTypeId: test.assessmentTypeId,
    notes: args.comment ?? null,
  });
  return id;
}

/**
 * Paper-mode score entry: one graded attempt per student, gradebook-synced.
 * D1 has no interactive transactions, so this is a sequence of idempotent awaits —
 * re-running the same payload converges on the same state.
 *
 * `skipped` names students whose record was ignored because they already hold an online
 * attempt. Paper entry must not clobber work a student actually submitted, but dropping
 * the teacher's input without telling anyone is worse — the caller surfaces this.
 */
export async function savePaperScores(
  db: Db,
  testId: string,
  records: { studentId: string; score?: number | null; comment?: string | null }[],
): Promise<{ attempts: TestAttemptRow[]; skipped: string[] }> {
  const test = await get(db, testId);

  const existing = await db.select().from(testAttempts).where(eq(testAttempts.testId, testId));
  const byStudent = new Map(existing.map((a) => [a.studentId, a]));

  const now = new Date().toISOString();
  const skipped: string[] = [];

  for (const rec of records) {
    const prev = byStudent.get(rec.studentId);
    if (prev && prev.source === 'online') {
      skipped.push(rec.studentId);
      continue;
    }

    const hasScore = rec.score != null;
    const hasComment = !!rec.comment?.trim();

    if (!hasScore && !hasComment) {
      if (prev) {
        if (prev.scoreRecordId) {
          await db.delete(scoreRecords).where(eq(scoreRecords.id, prev.scoreRecordId));
        }
        await db.delete(testAttempts).where(eq(testAttempts.id, prev.id));
      }
      continue;
    }

    const scoreRecordId = await syncScoreRecord(db, test, {
      studentId: rec.studentId,
      score: hasScore ? rec.score! : null,
      comment: rec.comment ?? null,
      existingScoreRecordId: prev?.scoreRecordId ?? null,
    });

    const values = {
      source: 'paper' as const,
      status: 'graded' as const,
      startedAt: prev?.startedAt ?? now,
      submittedAt: now,
      normalizedScore: hasScore ? rec.score! : null,
      totalScore: hasScore ? rec.score! : null,
      comment: rec.comment ?? null,
      scoreRecordId,
    };
    if (prev) {
      await db.update(testAttempts).set(values).where(eq(testAttempts.id, prev.id));
    } else {
      await db.insert(testAttempts).values({
        id: crypto.randomUUID(),
        testId,
        studentId: rec.studentId,
        ...values,
      });
    }
  }

  return { attempts: await listAttempts(db, testId), skipped };
}
