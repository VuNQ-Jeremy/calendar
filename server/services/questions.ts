import { eq, desc, sql, inArray } from 'drizzle-orm';
import { questions, testQuestions, testAttempts } from '../db/schema';
import { chunk, rowsPerStatement, D1_MAX_BOUND_PARAMS, type Db } from '../db/index';
import { QuestionInput, type QuestionInputBase } from '../../shared/schemas';

export type QuestionRow = {
  id: string;
  type: 'mcq' | 'multi' | 'text' | 'essay';
  prompt: string;
  gradeLevelId: string | null;
  difficulty: 'easy' | 'medium' | 'hard' | null;
  tags: string[];
  options: { id: string; text: string }[];
  answerKey: string | string[] | null;
  explanation: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

/**
 * JSON columns are parsed defensively: a hand-edited D1 row (or a column written before a schema
 * change) must degrade to an empty list rather than 500 the whole question bank.
 */
function parseJson<T>(raw: string | null, fallback: T): T {
  if (raw == null || raw === '') return fallback;
  try {
    const v = JSON.parse(raw);
    return v == null ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

function map(r: typeof questions.$inferSelect): QuestionRow {
  return {
    id: r.id,
    type: r.type as QuestionRow['type'],
    prompt: r.prompt,
    gradeLevelId: r.gradeLevelId,
    difficulty: (r.difficulty as QuestionRow['difficulty']) ?? null,
    tags: parseJson<string[]>(r.tags, []),
    options: parseJson<QuestionRow['options']>(r.options, []),
    answerKey: parseJson<QuestionRow['answerKey']>(r.answerKey, null),
    explanation: r.explanation,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function list(db: Db): Promise<QuestionRow[]> {
  const rows = await db.select().from(questions).orderBy(desc(questions.updatedAt));
  return rows.map(map);
}

/** questionId -> how many tests include it. Only ids with at least one link appear. */
export async function usageCounts(db: Db): Promise<Record<string, number>> {
  const rows = await db
    .select({ questionId: testQuestions.questionId, n: sql<number>`count(*)` })
    .from(testQuestions)
    .groupBy(testQuestions.questionId);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.questionId] = Number(r.n);
  return out;
}

/**
 * True when a student has already attempted a test containing this question. Editing the answer
 * shape after that point would silently invalidate the points already stored on those attempts.
 */
export async function hasAttempts(db: Db, questionId: string): Promise<boolean> {
  const rows = await db
    .select({ id: testAttempts.id })
    .from(testQuestions)
    .innerJoin(testAttempts, eq(testAttempts.testId, testQuestions.testId))
    .where(eq(testQuestions.questionId, questionId))
    .limit(1);
  return rows.length > 0;
}

export async function create(db: Db, input: QuestionInput): Promise<QuestionRow> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(questions).values({
    id,
    type: input.type,
    prompt: input.prompt,
    gradeLevelId: input.gradeLevelId ?? null,
    difficulty: input.difficulty ?? null,
    tags: JSON.stringify(input.tags ?? []),
    options: JSON.stringify(input.options ?? []),
    answerKey: input.answerKey == null ? null : JSON.stringify(input.answerKey),
    explanation: input.explanation ?? null,
    createdAt: now,
    updatedAt: now,
  });
  const rows = await db.select().from(questions).where(eq(questions.id, id));
  return map(rows[0]);
}

/** The columns `createMany` binds per row — see `rowsPerStatement`. */
const QUESTION_COLUMNS = 11;

/**
 * Bulk insert for the file-import flow. Every input has already passed the refined `QuestionInput`
 * (the route parses `z.array(QuestionInput)`), so there is nothing left to validate here.
 *
 * Returns the new rows in submitted order — the caller uses that order for `sortOrder` when
 * attaching them to a test. No lock check: a row created a millisecond ago cannot be on an
 * attempted test.
 */
export async function createMany(db: Db, inputs: QuestionInput[]): Promise<QuestionRow[]> {
  if (!inputs.length) return [];
  const now = new Date().toISOString();
  const values = inputs.map((input) => ({
    id: crypto.randomUUID(),
    type: input.type,
    prompt: input.prompt,
    gradeLevelId: input.gradeLevelId ?? null,
    difficulty: input.difficulty ?? null,
    tags: JSON.stringify(input.tags ?? []),
    options: JSON.stringify(input.options ?? []),
    answerKey: input.answerKey == null ? null : JSON.stringify(input.answerKey),
    explanation: input.explanation ?? null,
    createdAt: now,
    updatedAt: now,
  }));
  // Chunked so no single INSERT exceeds D1's bound-parameter ceiling, then sent as one batch so
  // a partial import can never be left behind.
  const inserts = chunk(values, rowsPerStatement(QUESTION_COLUMNS)).map((rows) =>
    db.insert(questions).values(rows),
  );
  if (inserts.length === 1) {
    await inserts[0];
  } else {
    await db.batch(inserts as [(typeof inserts)[number], ...typeof inserts]);
  }

  const ids = values.map((v) => v.id);
  // `inArray` binds one parameter per id, so the read-back is chunked for the same reason.
  const rows = (
    await Promise.all(
      chunk(ids, D1_MAX_BOUND_PARAMS).map((part) =>
        db.select().from(questions).where(inArray(questions.id, part)),
      ),
    )
  ).flat();
  // A SELECT ... IN gives no ordering guarantee, so re-index by id to restore submitted order.
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [map(row)] : [];
  });
}

/** The fields whose change would invalidate already-graded attempts. */
const ANSWER_SHAPING_KEYS = ['type', 'options', 'answerKey'] as const;

export async function update(
  db: Db,
  id: string,
  patch: Partial<QuestionInputBase>,
): Promise<QuestionRow> {
  const existing = await db.select().from(questions).where(eq(questions.id, id));
  if (!existing.length) throw Response.json({ error: 'not_found' }, { status: 404 });
  const current = map(existing[0]);

  const touchesAnswerShape = ANSWER_SHAPING_KEYS.some((k) => patch[k] !== undefined);
  if (touchesAnswerShape && (await hasAttempts(db, id))) {
    throw Response.json({ error: 'question_locked' }, { status: 409 });
  }

  // `parsePatch` uses the UNREFINED QuestionInputBase (Zod v4 cannot `.partial()` a refined
  // object), so the per-type option/answer-key rules have not run yet. Re-validate the MERGED
  // row against the refined schema so a patch cannot leave the row in a state a create would
  // have rejected (e.g. switching type to 'essay' while options stay behind).
  const merged = {
    type: patch.type ?? current.type,
    prompt: patch.prompt ?? current.prompt,
    gradeLevelId: patch.gradeLevelId !== undefined ? patch.gradeLevelId : current.gradeLevelId,
    difficulty: patch.difficulty !== undefined ? patch.difficulty : current.difficulty,
    tags: patch.tags ?? current.tags,
    options: patch.options ?? current.options,
    answerKey: patch.answerKey !== undefined ? patch.answerKey : current.answerKey,
    explanation: patch.explanation !== undefined ? patch.explanation : current.explanation,
  };
  const parsed = QuestionInput.safeParse(merged);
  if (!parsed.success) {
    throw Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }
  const next = parsed.data;

  await db
    .update(questions)
    .set({
      type: next.type,
      prompt: next.prompt,
      gradeLevelId: next.gradeLevelId ?? null,
      difficulty: next.difficulty ?? null,
      tags: JSON.stringify(next.tags ?? []),
      options: JSON.stringify(next.options ?? []),
      answerKey: next.answerKey == null ? null : JSON.stringify(next.answerKey),
      explanation: next.explanation ?? null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(questions.id, id));

  const rows = await db.select().from(questions).where(eq(questions.id, id));
  return map(rows[0]);
}

/**
 * test_questions deliberately has no cascade on question_id (see server/db/schema.ts), so a
 * question that any test still uses cannot be deleted — the test would lose an item silently.
 */
export async function remove(db: Db, id: string): Promise<void> {
  const used = await db
    .select({ testId: testQuestions.testId })
    .from(testQuestions)
    .where(eq(testQuestions.questionId, id))
    .limit(1);
  if (used.length) throw Response.json({ error: 'question_in_use' }, { status: 409 });
  await db.delete(questions).where(eq(questions.id, id));
}
