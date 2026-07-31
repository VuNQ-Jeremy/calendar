import { eq, and, inArray, asc } from 'drizzle-orm';
import {
  tests,
  testQuestions,
  testAttempts,
  testAnswers,
  questions,
  classStudents,
  scoreRecords,
} from '../db/schema';
import type { Db } from '../db/index';
import type { AttemptGradeInput } from '../../shared/schemas';
import {
  autoGradeAttempt,
  normalizeScore,
  isWindowOpen,
  type AnswerValue,
  type QuestionTypeId,
} from '../../shared/logic/tests';
import { get as getTest, listQuestionLinks, syncScoreRecord, type TestAttemptRow } from './tests';

/**
 * Attempts domain service — the student-facing side of online tests.
 *
 * This module is the security boundary for test taking. Two rules it must never break:
 *  1. No answer key or explanation ever leaves here before grading (see `StudentQuestion`).
 *  2. A student may only ever touch their own attempt (see `getOwn`).
 *
 * D1 has no interactive transactions, so every multi-row write is either a single atomic
 * `db.batch()` or a sequence of idempotent awaits that converges when re-run. Where a crash can
 * leave a half-finished state, the recovery path is documented at the call site.
 */

export type AttemptRow = TestAttemptRow;

export type AnswerRow = {
  attemptId: string;
  questionId: string;
  /** JSON-decoded. */
  answer: string | string[] | null;
  autoCorrect: boolean | null;
  autoPoints: number | null;
  manualPoints: number | null;
  feedback: string | null;
};

/**
 * The ONLY question shape a student loader may return: answerKey and explanation are
 * deliberately absent so a correct answer can never reach the client before grading.
 */
export type StudentQuestion = {
  id: string;
  type: QuestionTypeId;
  prompt: string;
  options: { id: string; text: string }[];
  points: number;
  sortOrder: number;
};

/**
 * A question plus its answer key — the post-grading shape. Only ever produced by
 * `reviewForStudent`, which refuses to build it unless the attempt is graded.
 */
export type ReviewQuestion = StudentQuestion & {
  answerKey: string | string[] | null;
  explanation: string | null;
};

export type AttemptReview = {
  attempt: AttemptRow;
  questions: ReviewQuestion[];
  answers: AnswerRow[];
};

export type StudentTestListItem = {
  test: {
    id: string;
    title: string;
    mode: 'online' | 'paper';
    date: string | null;
    openAt: string | null;
    closeAt: string | null;
    timeLimitMinutes: number | null;
    instructions: string | null;
    classId: string | null;
  };
  window: 'upcoming' | 'open' | 'closed';
  attempt: {
    id: string;
    status: AttemptRow['status'];
    normalizedScore: number | null;
    submittedAt: string | null;
    deadlineAt: string | null;
  } | null;
};

/**
 * A save or submit posted at the exact moment the clock hits zero is legitimate: the browser's
 * auto-submit fires on its own timer and the request still needs a few hundred ms of network. The
 * grace absorbs that skew without meaningfully extending the test.
 */
const DEADLINE_GRACE_MS = 30_000;

/** JSON columns degrade to a fallback rather than 500 an attempt a student is sitting. */
function parseJson<T>(raw: string | null, fallback: T): T {
  if (raw == null || raw === '') return fallback;
  try {
    const v = JSON.parse(raw);
    return v == null ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

function mapAttempt(r: typeof testAttempts.$inferSelect): AttemptRow {
  return {
    id: r.id,
    testId: r.testId,
    studentId: r.studentId,
    source: r.source as AttemptRow['source'],
    status: r.status as AttemptRow['status'],
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

function mapAnswer(r: typeof testAnswers.$inferSelect): AnswerRow {
  return {
    attemptId: r.attemptId,
    questionId: r.questionId,
    answer: parseJson<AnswerRow['answer']>(r.answer, null),
    autoCorrect: r.autoCorrect ?? null,
    autoPoints: r.autoPoints,
    manualPoints: r.manualPoints,
    feedback: r.feedback,
  };
}

export async function listForTest(db: Db, testId: string): Promise<AttemptRow[]> {
  const rows = await db.select().from(testAttempts).where(eq(testAttempts.testId, testId));
  return rows.map(mapAttempt);
}

export async function listAnswers(db: Db, attemptId: string): Promise<AnswerRow[]> {
  const rows = await db.select().from(testAnswers).where(eq(testAnswers.attemptId, attemptId));
  return rows.map(mapAnswer);
}

/**
 * Fetches an attempt on behalf of a student.
 *
 * A row that belongs to someone else raises the SAME 404 as a row that does not exist: telling the
 * caller "this attempt exists but is not yours" would leak that another student sat the test, so
 * the two cases are deliberately indistinguishable.
 */
export async function getOwn(db: Db, attemptId: string, studentId: string): Promise<AttemptRow> {
  const rows = await db.select().from(testAttempts).where(eq(testAttempts.id, attemptId));
  const row = rows[0];
  if (!row || row.studentId !== studentId) {
    throw Response.json({ error: 'attempt_not_found' }, { status: 404 });
  }
  return mapAttempt(row);
}

export async function isEnrolled(db: Db, testId: string, studentId: string): Promise<boolean> {
  const test = await getTest(db, testId);
  if (!test.classId) return false;
  const rows = await db
    .select()
    .from(classStudents)
    .where(and(eq(classStudents.classId, test.classId), eq(classStudents.studentId, studentId)));
  return rows.length > 0;
}

async function classIdsOf(db: Db, studentId: string): Promise<string[]> {
  const rows = await db.select().from(classStudents).where(eq(classStudents.studentId, studentId));
  return rows.map((r) => r.classId);
}

const WINDOW_ORDER: Record<StudentTestListItem['window'], number> = {
  open: 0,
  upcoming: 1,
  closed: 2,
};

/**
 * The student's test list: published online tests for their classes. Closed tests are hidden unless
 * the student actually sat them — a missed test is noise, a sat test is their result.
 */
export async function listOpenForStudent(
  db: Db,
  studentId: string,
  now: Date,
): Promise<StudentTestListItem[]> {
  const classIds = await classIdsOf(db, studentId);
  if (!classIds.length) return [];

  const testRows = await db
    .select()
    .from(tests)
    .where(
      and(
        inArray(tests.classId, classIds),
        eq(tests.status, 'published'),
        eq(tests.mode, 'online'),
      ),
    );
  if (!testRows.length) return [];

  const attemptRows = await db
    .select()
    .from(testAttempts)
    .where(
      and(
        eq(testAttempts.studentId, studentId),
        inArray(
          testAttempts.testId,
          testRows.map((t) => t.id),
        ),
      ),
    );
  const byTest = new Map(attemptRows.map((a) => [a.testId, mapAttempt(a)]));

  const out: StudentTestListItem[] = [];
  for (const t of testRows) {
    const window = isWindowOpen(t.openAt, t.closeAt, now);
    const attempt = byTest.get(t.id) ?? null;
    if (window === 'closed' && !attempt) continue;
    out.push({
      test: {
        id: t.id,
        title: t.title,
        mode: t.mode as 'online' | 'paper',
        date: t.date,
        openAt: t.openAt,
        closeAt: t.closeAt,
        timeLimitMinutes: t.timeLimitMinutes,
        instructions: t.instructions,
        classId: t.classId,
      },
      window,
      attempt: attempt
        ? {
            id: attempt.id,
            status: attempt.status,
            normalizedScore: attempt.normalizedScore,
            submittedAt: attempt.submittedAt,
            deadlineAt: attempt.deadlineAt,
          }
        : null,
    });
  }

  out.sort((a, b) => {
    const w = WINDOW_ORDER[a.window] - WINDOW_ORDER[b.window];
    if (w !== 0) return w;
    return a.test.title.localeCompare(b.test.title);
  });
  return out;
}

/**
 * The test's questions in sit order, with the answer key and explanation attached.
 *
 * PRIVATE on purpose. The two public projections below narrow it: `studentQuestions` drops the key
 * fields entirely (the shape a student sitting the test gets) and `reviewQuestions` keeps them (only
 * ever reached through `reviewForStudent`, which gates on `status === 'graded'`).
 */
async function questionsWithKeys(db: Db, testId: string): Promise<ReviewQuestion[]> {
  const rows = await db
    .select({ link: testQuestions, q: questions })
    .from(testQuestions)
    .innerJoin(questions, eq(questions.id, testQuestions.questionId))
    .where(eq(testQuestions.testId, testId))
    .orderBy(asc(testQuestions.sortOrder));

  return rows.map(({ link, q }) => ({
    id: q.id,
    type: q.type as QuestionTypeId,
    prompt: q.prompt,
    options: parseJson<StudentQuestion['options']>(q.options, []),
    points: link.points,
    sortOrder: link.sortOrder,
    answerKey: parseJson<ReviewQuestion['answerKey']>(q.answerKey, null),
    explanation: q.explanation ?? null,
  }));
}

/** The test's questions in sit order, stripped of everything that would give the answer away. */
async function studentQuestions(db: Db, testId: string): Promise<StudentQuestion[]> {
  // Destructured rather than deleted so the returned objects genuinely lack the keys — a test
  // asserts `'answerKey' in q === false`, not merely that it is null.
  return (await questionsWithKeys(db, testId)).map(
    ({ answerKey: _answerKey, explanation: _explanation, ...q }) => q,
  );
}

/**
 * Starts — or resumes — a student's attempt.
 *
 * Idempotent by design: the UNIQUE(testId, studentId) row is created once and every later call
 * returns it untouched. Re-entering after a refresh or a dropped connection must never restart the
 * test or move the deadline, so nothing about an existing attempt is rewritten here.
 */
export async function start(
  db: Db,
  testId: string,
  studentId: string,
  now: Date,
): Promise<{ attempt: AttemptRow; questions: StudentQuestion[]; serverNow: string }> {
  const test = await getTest(db, testId);
  if (test.status !== 'published') {
    throw Response.json({ error: 'test_not_published' }, { status: 409 });
  }
  if (test.mode !== 'online') {
    throw Response.json({ error: 'test_not_online' }, { status: 409 });
  }
  if (!(await isEnrolled(db, testId, studentId))) {
    throw Response.json({ error: 'not_enrolled' }, { status: 403 });
  }
  const window = isWindowOpen(test.openAt, test.closeAt, now);
  if (window === 'upcoming') throw Response.json({ error: 'window_upcoming' }, { status: 409 });
  if (window === 'closed') throw Response.json({ error: 'window_closed' }, { status: 409 });

  const serverNow = now.toISOString();
  const existing = await db
    .select()
    .from(testAttempts)
    .where(and(eq(testAttempts.testId, testId), eq(testAttempts.studentId, studentId)));

  if (existing[0]) {
    return {
      attempt: mapAttempt(existing[0]),
      questions: await studentQuestions(db, testId),
      serverNow,
    };
  }

  // Both bounds are optional; the deadline is whichever arrives first. Computed from the SERVER
  // clock and persisted, so a client with a doctored clock cannot buy itself extra time.
  const limitAt =
    test.timeLimitMinutes != null
      ? new Date(now.getTime() + test.timeLimitMinutes * 60_000).toISOString()
      : null;
  const deadlineAt =
    limitAt && test.closeAt
      ? limitAt < test.closeAt
        ? limitAt
        : test.closeAt
      : (limitAt ?? test.closeAt ?? null);

  const id = crypto.randomUUID();
  await db.insert(testAttempts).values({
    id,
    testId,
    studentId,
    source: 'online',
    status: 'in_progress',
    startedAt: serverNow,
    deadlineAt,
  });

  return {
    attempt: await getOwn(db, id, studentId),
    questions: await studentQuestions(db, testId),
    serverNow,
  };
}

/**
 * Post-grading review for the student who sat the attempt. Answer keys and explanations
 * are included ONLY once the attempt is graded — before that a student could read the
 * correct answers straight out of the loader payload while classmates are still working.
 *
 * Two gates, both here rather than at the route so no caller can skip them:
 *  1. `getOwn` — a foreign or missing attempt id is an indistinguishable 404.
 *  2. `status === 'graded'` — `submitted` and `needs_grading` get 409 `not_graded`, and the thrown
 *     Response carries no question data at all.
 *
 * `start()` cannot serve this: it refuses a closed window, and a graded attempt is very often
 * reviewed after the test has closed.
 */
export async function reviewForStudent(
  db: Db,
  attemptId: string,
  studentId: string,
): Promise<AttemptReview> {
  const attempt = await getOwn(db, attemptId, studentId);
  if (attempt.status !== 'graded') {
    throw Response.json({ error: 'not_graded' }, { status: 409 });
  }
  return {
    attempt,
    questions: await questionsWithKeys(db, attempt.testId),
    answers: await listAnswers(db, attemptId),
  };
}

/** 409 unless the attempt is still open AND the server clock is inside the deadline + grace. */
function assertWritable(attempt: AttemptRow, now: Date): void {
  if (attempt.status !== 'in_progress') {
    throw Response.json({ error: 'attempt_closed' }, { status: 409 });
  }
  if (
    attempt.deadlineAt != null &&
    now.getTime() > new Date(attempt.deadlineAt).getTime() + DEADLINE_GRACE_MS
  ) {
    throw Response.json({ error: 'attempt_closed' }, { status: 409 });
  }
}

/**
 * Autosave. Replaces exactly the listed questions' rows and leaves the rest alone, so a partial
 * autosave of a single question never wipes the answers the student already gave.
 */
export async function saveAnswers(
  db: Db,
  attemptId: string,
  studentId: string,
  answers: { questionId: string; answer: AnswerValue }[],
  now: Date,
): Promise<void> {
  const attempt = await getOwn(db, attemptId, studentId);
  assertWritable(attempt, now);
  if (!answers.length) return;

  const links = await listQuestionLinks(db, attempt.testId);
  const onTest = new Set(links.map((l) => l.questionId));
  for (const a of answers) {
    if (!onTest.has(a.questionId)) {
      throw Response.json({ error: 'unknown_question' }, { status: 400 });
    }
  }

  // Last-write-wins on the composite PK: delete-then-insert the listed rows in one atomic batch.
  const ids = [...new Set(answers.map((a) => a.questionId))];
  const latest = new Map(answers.map((a) => [a.questionId, a.answer]));
  await db.batch([
    db
      .delete(testAnswers)
      .where(and(eq(testAnswers.attemptId, attemptId), inArray(testAnswers.questionId, ids))),
    db.insert(testAnswers).values(
      ids.map((questionId) => ({
        attemptId,
        questionId,
        answer: JSON.stringify(latest.get(questionId) ?? null),
      })),
    ),
  ]);
}

/**
 * Submits and auto-grades.
 *
 * Idempotent: an already-submitted attempt is returned unchanged, so a double-tap or a retried
 * auto-submit cannot re-grade or double-count.
 *
 * The three steps below run as separate awaits (D1 has no interactive transactions). A crash
 * between step 2 and step 3 leaves a `graded` attempt with no gradebook row; `grade()` re-runs
 * `syncScoreRecord` and repairs it, and the invariant it upholds makes that safe to repeat.
 */
export async function submit(
  db: Db,
  attemptId: string,
  studentId: string,
  now: Date,
): Promise<AttemptRow> {
  const attempt = await getOwn(db, attemptId, studentId);
  if (attempt.status !== 'in_progress') return attempt;
  assertWritable(attempt, now);

  const test = await getTest(db, attempt.testId);
  const links = await listQuestionLinks(db, attempt.testId);
  const questionIds = links.map((l) => l.questionId);
  const questionRows = questionIds.length
    ? await db.select().from(questions).where(inArray(questions.id, questionIds))
    : [];
  const byId = new Map(questionRows.map((q) => [q.id, q]));
  const saved = await listAnswers(db, attemptId);
  const answersMap = new Map<string, AnswerValue>(saved.map((a) => [a.questionId, a.answer]));

  const items = links.flatMap((l) => {
    const q = byId.get(l.questionId);
    if (!q) return [];
    return [
      {
        questionId: l.questionId,
        type: q.type as QuestionTypeId,
        answerKey: parseJson<AnswerValue>(q.answerKey, null),
        points: l.points,
      },
    ];
  });

  const graded = autoGradeAttempt(items, answersMap);

  // 1. Persist the machine's verdict per answer. A missing answer row is created so the teacher's
  //    grading screen sees every question, answered or not.
  const writes = items.map((item) => {
    const r = graded.perQuestion.get(item.questionId);
    return {
      attemptId,
      questionId: item.questionId,
      answer: JSON.stringify(answersMap.get(item.questionId) ?? null),
      autoCorrect: r?.correct ?? null,
      autoPoints: r?.autoPoints ?? null,
    };
  });
  if (writes.length) {
    await db.batch([
      db.delete(testAnswers).where(eq(testAnswers.attemptId, attemptId)),
      db.insert(testAnswers).values(writes),
    ]);
  }

  // 2. Close the attempt. An essay parks it in `needs_grading` with no total — nothing reaches the
  //    gradebook until a human has read it.
  const submittedAt = now.toISOString();
  const set = graded.hasEssay
    ? {
        status: 'needs_grading' as const,
        submittedAt,
        autoScore: graded.autoScore,
        totalScore: null,
        normalizedScore: null,
      }
    : {
        status: 'graded' as const,
        submittedAt,
        autoScore: graded.autoScore,
        totalScore: graded.autoScore,
        normalizedScore: normalizeScore(graded.autoScore, graded.maxTotalPoints),
      };
  await db.update(testAttempts).set(set).where(eq(testAttempts.id, attemptId));

  // 3. Gradebook sync, only for a fully auto-graded attempt.
  if (!graded.hasEssay) {
    const scoreRecordId = await syncScoreRecord(db, test, {
      studentId: attempt.studentId,
      score: set.normalizedScore,
      comment: attempt.comment,
      existingScoreRecordId: attempt.scoreRecordId,
    });
    await db.update(testAttempts).set({ scoreRecordId }).where(eq(testAttempts.id, attemptId));
  }

  return getOwn(db, attemptId, studentId);
}

/**
 * Teacher grading. Staff path — no student ownership check, the route's role guard is the gate.
 * Re-runnable: the same payload converges on the same total, score record included.
 */
export async function grade(
  db: Db,
  attemptId: string,
  input: AttemptGradeInput,
): Promise<AttemptRow> {
  const rows = await db.select().from(testAttempts).where(eq(testAttempts.id, attemptId));
  if (!rows[0]) throw Response.json({ error: 'attempt_not_found' }, { status: 404 });
  const attempt = mapAttempt(rows[0]);

  const test = await getTest(db, attempt.testId);
  const links = await listQuestionLinks(db, attempt.testId);
  const onTest = new Set(links.map((l) => l.questionId));
  for (const g of input.grades) {
    if (!onTest.has(g.questionId)) {
      throw Response.json({ error: 'unknown_question' }, { status: 400 });
    }
  }

  const updates = input.grades.map((g) =>
    db
      .update(testAnswers)
      .set({ manualPoints: g.manualPoints ?? null, feedback: g.feedback ?? null })
      .where(and(eq(testAnswers.attemptId, attemptId), eq(testAnswers.questionId, g.questionId))),
  );
  // Atomic: either every question's marks land or none do, so a partial mark-up can't be read.
  if (updates.length) await db.batch([updates[0], ...updates.slice(1)]);

  // Effective points per question = manualPoints ?? autoPoints ?? 0, over ALL the test's questions
  // so an unanswered question counts as a zero rather than vanishing from the total.
  const saved = await listAnswers(db, attemptId);
  const bySaved = new Map(saved.map((a) => [a.questionId, a]));
  let totalScore = 0;
  let maxTotalPoints = 0;
  for (const l of links) {
    maxTotalPoints += l.points;
    const a = bySaved.get(l.questionId);
    totalScore += a?.manualPoints ?? a?.autoPoints ?? 0;
  }

  const normalizedScore = input.normalizedOverride ?? normalizeScore(totalScore, maxTotalPoints);
  const comment = input.comment ?? null;

  const scoreRecordId = await syncScoreRecord(db, test, {
    studentId: attempt.studentId,
    score: normalizedScore,
    comment,
    existingScoreRecordId: attempt.scoreRecordId,
  });

  await db
    .update(testAttempts)
    .set({ status: 'graded', totalScore, normalizedScore, comment, scoreRecordId })
    .where(eq(testAttempts.id, attemptId));

  return getOwn(db, attemptId, attempt.studentId);
}

/**
 * Teacher "allow retake": wipes the attempt so the student can start again.
 * The score record goes first — the attempt's FK is ON DELETE SET NULL, so deleting the attempt
 * first would strand the gradebook row with nothing pointing at it. Answers CASCADE.
 */
export async function reset(db: Db, attemptId: string): Promise<void> {
  const rows = await db.select().from(testAttempts).where(eq(testAttempts.id, attemptId));
  const row = rows[0];
  if (!row) return;
  if (row.scoreRecordId) {
    await db.delete(scoreRecords).where(eq(scoreRecords.id, row.scoreRecordId));
  }
  await db.delete(testAttempts).where(eq(testAttempts.id, attemptId));
}
