import { eq, desc, sql, inArray } from 'drizzle-orm';
import { questions, testQuestions, testAttempts } from '../db/schema';
import { chunk, rowsPerStatement, D1_MAX_BOUND_PARAMS, type Db } from '../db/index';
import { QuestionInput, type QuestionInputBase } from '../../shared/schemas';

export type QuestionRow = {
  id: string;
  type: 'mcq' | 'multi' | 'text' | 'essay';
  prompt: string;
  /** Shared passage / section instruction, shown above the prompt. */
  context: string | null;
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
    context: r.context,
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
    context: input.context ?? null,
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
const QUESTION_COLUMNS = 12;

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
    context: input.context ?? null,
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
    context: patch.context !== undefined ? patch.context : current.context,
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
      context: next.context ?? null,
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

/**
 * Run a list of prepared statements as one atomic batch.
 *
 * `db.batch` wants a non-empty tuple, and every bulk operation below can legitimately end up with
 * nothing to do (all ids in use, every row already tagged), so the empty and single-statement cases
 * are handled once here rather than at four call sites.
 */
async function runBatch(db: Db, statements: unknown[]): Promise<void> {
  if (!statements.length) return;
  if (statements.length === 1) {
    await (statements[0] as Promise<unknown>);
    return;
  }
  await db.batch(statements as unknown as Parameters<Db['batch']>[0]);
}

/** The ids in `ids` that at least one test still includes. */
async function idsInUse(db: Db, ids: string[]): Promise<Set<string>> {
  const rows = (
    await Promise.all(
      chunk(ids, D1_MAX_BOUND_PARAMS).map((part) =>
        db
          .select({ questionId: testQuestions.questionId })
          .from(testQuestions)
          .where(inArray(testQuestions.questionId, part)),
      ),
    )
  ).flat();
  return new Set(rows.map((r) => r.questionId));
}

/**
 * Delete many questions at once, keeping any that a test still uses.
 *
 * The per-row `remove` refuses outright, which is right for one deliberate click but wrong for a
 * selection of forty: the teacher meant "clear these out", and failing the whole batch because three
 * of them are on a test helps nobody. So the in-use ones are kept and COUNTED, and the caller reports
 * the split — the honest middle ground between silently skipping and refusing everything.
 */
export async function removeMany(
  db: Db,
  ids: string[],
): Promise<{ deleted: number; skippedInUse: number }> {
  if (!ids.length) return { deleted: 0, skippedInUse: 0 };
  const unique = [...new Set(ids)];
  const inUse = await idsInUse(db, unique);
  const deletable = unique.filter((id) => !inUse.has(id));
  await runBatch(
    db,
    chunk(deletable, D1_MAX_BOUND_PARAMS).map((part) =>
      db.delete(questions).where(inArray(questions.id, part)),
    ),
  );
  return { deleted: deletable.length, skippedInUse: unique.length - deletable.length };
}

/** What `bulkSetMeta` may change: metadata only, never anything that shapes an answer. */
export type QuestionMetaPatch = {
  gradeLevelId?: string | null;
  difficulty?: QuestionRow['difficulty'];
};

/**
 * Set grade level and/or difficulty across many questions in one statement per chunk.
 *
 * Deliberately NOT routed through `update`: that does a SELECT plus an UPDATE per id and re-validates
 * the merged row, which for forty questions is eighty statements to change one column.
 *
 * Equally deliberately NOT lock-checked. `ANSWER_SHAPING_KEYS` is type/options/answerKey; a grade
 * level or a difficulty label cannot invalidate a graded attempt, and the single-question path
 * already lets you rename a locked question for the same reason. The safety here is structural — the
 * function can only write these two columns, so no caller can smuggle an answer change through it.
 */
export async function bulkSetMeta(
  db: Db,
  ids: string[],
  patch: QuestionMetaPatch,
): Promise<number> {
  const unique = [...new Set(ids)];
  const set: Partial<typeof questions.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (patch.gradeLevelId !== undefined) set.gradeLevelId = patch.gradeLevelId;
  if (patch.difficulty !== undefined) set.difficulty = patch.difficulty;
  // Nothing to do — the route rejects an empty patch, so this is only reachable with no ids.
  if (!unique.length || Object.keys(set).length === 1) return 0;

  // Every SET value binds a parameter too, so the ids get what is left of the ceiling rather than
  // all of it. Off-by-one here is a runtime D1 error on a big selection, not a type error.
  const perStatement = Math.max(1, D1_MAX_BOUND_PARAMS - Object.keys(set).length);
  await runBatch(
    db,
    chunk(unique, perStatement).map((part) =>
      db.update(questions).set(set).where(inArray(questions.id, part)),
    ),
  );
  return unique.length;
}

/** Mirrors `QuestionInputBase.tags`' `.max(20)` in shared/schemas.ts. */
const MAX_TAGS_PER_QUESTION = 20;

/**
 * Add tags to many questions, merging with whatever each already has.
 *
 * `tags` is a JSON text column, so this cannot be one UPDATE: each row's existing list has to be
 * read, merged and written back. Rows that already carry every tag are left alone, so re-running the
 * same add is free and does not churn `updatedAt` (which the bank sorts by).
 *
 * Caps mirror the zod field: 50 characters per tag, 20 tags per question. A row already at the cap
 * keeps what it has rather than losing an older tag to make room.
 */
export async function bulkAddTags(db: Db, ids: string[], tags: string[]): Promise<number> {
  const unique = [...new Set(ids)];
  const adding = [...new Set(tags.map((t) => t.trim()).filter(Boolean))].map((t) => t.slice(0, 50));
  if (!unique.length || !adding.length) return 0;

  const rows = (
    await Promise.all(
      chunk(unique, D1_MAX_BOUND_PARAMS).map((part) =>
        db
          .select({ id: questions.id, tags: questions.tags })
          .from(questions)
          .where(inArray(questions.id, part)),
      ),
    )
  ).flat();

  const now = new Date().toISOString();
  const updates: unknown[] = [];
  for (const row of rows) {
    const current = parseJson<string[]>(row.tags, []);
    const merged = [...new Set([...current, ...adding])].slice(0, MAX_TAGS_PER_QUESTION);
    if (merged.length === current.length && merged.every((t, i) => t === current[i])) continue;
    updates.push(
      db
        .update(questions)
        .set({ tags: JSON.stringify(merged), updatedAt: now })
        .where(eq(questions.id, row.id)),
    );
  }
  await runBatch(db, updates);
  return updates.length;
}

/**
 * Empty the whole question bank, detaching every question from every test on the way out.
 *
 * This is the one place that overrides the no-cascade rule on `test_questions.questionId`, because
 * the teacher has asked for exactly that. Worth knowing what it costs, and what it does not:
 *
 *   - Every test's question list becomes empty. The tests themselves survive.
 *   - `test_answers.questionId` DOES cascade, so each student's stored answer to each question is
 *     deleted with it. Attempt rows keep their scores (rawScore / normalizedScore live on
 *     `test_attempts`, and any synced score_record is untouched), but per-question review is gone.
 *
 * The two deletes must go in this order — questions first would be rejected by the foreign key — and
 * they go as ONE batch so the bank can never be left with orphaned links if the second fails. Both
 * are unfiltered, so there are no bound parameters and nothing to chunk however large the bank is.
 */
export async function wipe(db: Db): Promise<{ deleted: number; detachedFromTests: number }> {
  const [questionCount] = await db.select({ n: sql<number>`count(*)` }).from(questions);
  const [linkCount] = await db.select({ n: sql<number>`count(*)` }).from(testQuestions);
  const deleted = Number(questionCount?.n ?? 0);
  if (!deleted) return { deleted: 0, detachedFromTests: 0 };
  await db.batch([db.delete(testQuestions), db.delete(questions)]);
  return { deleted, detachedFromTests: Number(linkCount?.n ?? 0) };
}
