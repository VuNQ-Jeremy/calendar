import { eq, desc, sql, inArray } from 'drizzle-orm';
import { questions, testQuestions, testAttempts, tests } from '../db/schema';
import {
  chunk,
  rowsPerStatement,
  D1_MAX_BOUND_PARAMS,
  SCOPED_MAX_BOUND_PARAMS,
  type TenantDb,
} from '../db/index';
import { QuestionInput, type QuestionInputBase } from '../../shared/schemas';
import { record, recordCreate, recordDelete } from './audit';

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

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

/**
 * The bank as one school sees it: the platform library (`tenant_id IS NULL`) plus its own rows.
 * `pool`, not `own` — see the two-tier rule on `TenantDb.pool`. Which of the two a row belongs to
 * only matters on a WRITE, and every write path below re-reads and checks.
 */
export async function list(db: TenantDb): Promise<QuestionRow[]> {
  const rows = await db.raw
    .select()
    .from(questions)
    .where(db.pool(questions))
    .orderBy(desc(questions.updatedAt));
  return rows.map(map);
}

/**
 * questionId -> how many tests include it. Only ids with at least one link appear.
 *
 * Joined through `tests` so the number counts THIS school's tests only: `test_questions` carries
 * no `tenant_id`, and a library question is linked by every school that uses it — an unjoined
 * count would put a neighbouring school's usage on this school's screen.
 */
export async function usageCounts(db: TenantDb): Promise<Record<string, number>> {
  const rows = await db.raw
    .select({ questionId: testQuestions.questionId, n: sql<number>`count(*)` })
    .from(testQuestions)
    .innerJoin(tests, eq(tests.id, testQuestions.testId))
    .where(db.own(tests))
    .groupBy(testQuestions.questionId);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.questionId] = Number(r.n);
  return out;
}

/**
 * True when a student has already attempted a test containing this question. Editing the answer
 * shape after that point would silently invalidate the points already stored on those attempts.
 *
 * Deliberately NOT scoped to the caller's school: this is a safety interlock, and the honest
 * answer to "has anyone sat this" is across every school that links the question. For an owned
 * question the two answers coincide (only this school's tests can link it); for a library
 * question the write is refused anyway.
 */
export async function hasAttempts(db: TenantDb, questionId: string): Promise<boolean> {
  const rows = await db.raw
    .select({ id: testAttempts.id })
    .from(testQuestions)
    .innerJoin(testAttempts, eq(testAttempts.testId, testQuestions.testId))
    .where(eq(testQuestions.questionId, questionId))
    .limit(1);
  return rows.length > 0;
}

export async function create(db: TenantDb, input: QuestionInput): Promise<QuestionRow> {
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
  const rows = await db.raw
    .select()
    .from(questions)
    .where(db.own(questions, eq(questions.id, id)));
  const row = map(rows[0]);
  recordCreate('question', id, row);
  return row;
}

/** The columns `createMany` binds per row — see `rowsPerStatement`. `tenant_id` is one of them. */
const QUESTION_COLUMNS = 13;

/**
 * Bulk insert for the file-import flow. Every input has already passed the refined `QuestionInput`
 * (the route parses `z.array(QuestionInput)`), so there is nothing left to validate here.
 *
 * Returns the new rows in submitted order — the caller uses that order for `sortOrder` when
 * attaching them to a test. No lock check: a row created a millisecond ago cannot be on an
 * attempted test.
 */
export async function createMany(db: TenantDb, inputs: QuestionInput[]): Promise<QuestionRow[]> {
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
      chunk(ids, SCOPED_MAX_BOUND_PARAMS).map((part) =>
        db.raw
          .select()
          .from(questions)
          .where(db.own(questions, inArray(questions.id, part))),
      ),
    )
  ).flat();
  // A SELECT ... IN gives no ordering guarantee, so re-index by id to restore submitted order.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const created = ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [map(row)] : [];
  });
  // One event for the whole import, not N per-row creates — same "reorder" precedent.
  record({
    action: 'create',
    entityType: 'question',
    meta: { imported: created.map((r) => r.id) },
  });
  return created;
}

/** The fields whose change would invalidate already-graded attempts. */
const ANSWER_SHAPING_KEYS = ['type', 'options', 'answerKey'] as const;

export async function update(
  db: TenantDb,
  id: string,
  patch: Partial<QuestionInputBase>,
): Promise<QuestionRow> {
  // `pool`, so a library row is FOUND here and can be refused with an honest 403 rather than a
  // 404 for something the teacher can plainly see in the bank. A third school's row stays out of
  // the pool entirely and falls through to the 404 below, which is the answer it should get.
  const existing = await db.raw
    .select()
    .from(questions)
    .where(db.pool(questions, eq(questions.id, id)));
  if (!existing.length) throw Response.json({ error: 'not_found' }, { status: 404 });
  // A platform-library question is readable by every school and writable by none of them from
  // here. Editing the library is a platform-admin action and this service has no session to check
  // `isPlatformAdmin` against, so the answer is a flat refusal — see the note in questions.tsx.
  if (existing[0].tenantId === null) {
    throw Response.json({ error: 'forbidden' }, { status: 403 });
  }
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

  await db.update(
    questions,
    {
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
    },
    eq(questions.id, id),
  );

  const rows = await db.raw
    .select()
    .from(questions)
    .where(db.own(questions, eq(questions.id, id)));
  const after = map(rows[0]);
  if (!sameJson(current, after)) {
    record({ action: 'update', entityType: 'question', entityId: id, before: current, after });
  }
  return after;
}

/**
 * test_questions deliberately has no cascade on question_id (see server/db/schema.ts), so a
 * question that any test still uses cannot be deleted — the test would lose an item silently.
 */
export async function remove(db: TenantDb, id: string): Promise<void> {
  // Same two-tier refusal as `update`: visible-but-not-yours is a 403, not-in-the-pool is a 404.
  const existing = await db.raw
    .select({ tenantId: questions.tenantId })
    .from(questions)
    .where(db.pool(questions, eq(questions.id, id)))
    .limit(1);
  if (!existing.length) throw Response.json({ error: 'not_found' }, { status: 404 });
  if (existing[0].tenantId === null) throw Response.json({ error: 'forbidden' }, { status: 403 });

  // tenant-unscoped: `test_questions` carries no tenant_id, and the FK it violates is global —
  // a link from ANY school blocks the delete, so the guard has to look at all of them or the
  // DELETE would fail with an opaque D1 foreign-key error instead of this 409.
  const used = await db.raw
    .select({ testId: testQuestions.testId })
    .from(testQuestions)
    .where(eq(testQuestions.questionId, id))
    .limit(1);
  if (used.length) throw Response.json({ error: 'question_in_use' }, { status: 409 });
  await recordDelete(db, 'question', questions, id);
  await db.delete(questions, eq(questions.id, id));
}

/**
 * Run a list of prepared statements as one atomic batch.
 *
 * `db.batch` wants a non-empty tuple, and every bulk operation below can legitimately end up with
 * nothing to do (all ids in use, every row already tagged), so the empty and single-statement cases
 * are handled once here rather than at four call sites.
 */
async function runBatch(db: TenantDb, statements: unknown[]): Promise<void> {
  if (!statements.length) return;
  if (statements.length === 1) {
    await (statements[0] as Promise<unknown>);
    return;
  }
  await db.batch(statements as unknown as Parameters<TenantDb['batch']>[0]);
}

/**
 * The ids in `ids` that at least one test still includes.
 *
 * tenant-unscoped, for the same reason as `remove`'s guard: the FK that would reject the delete
 * is global, so the question "is anything still pointing at this row" has to be asked globally.
 */
async function idsInUse(db: TenantDb, ids: string[]): Promise<Set<string>> {
  const rows = (
    await Promise.all(
      chunk(ids, D1_MAX_BOUND_PARAMS).map((part) =>
        db.raw
          .select({ questionId: testQuestions.questionId })
          .from(testQuestions)
          .where(inArray(testQuestions.questionId, part)),
      ),
    )
  ).flat();
  return new Set(rows.map((r) => r.questionId));
}

/**
 * Which of `ids` this school actually owns — i.e. may write.
 *
 * The bank screen shows owned rows and platform-library rows in one undifferentiated list, so a
 * multi-select can easily include library ids. The bulk writes below are scoped and would skip
 * those silently; this is what lets them report a count the teacher can believe.
 */
async function ownedIds(db: TenantDb, ids: string[]): Promise<Set<string>> {
  const rows = (
    await Promise.all(
      chunk(ids, SCOPED_MAX_BOUND_PARAMS).map((part) =>
        db.raw
          .select({ id: questions.id })
          .from(questions)
          .where(db.own(questions, inArray(questions.id, part))),
      ),
    )
  ).flat();
  return new Set(rows.map((r) => r.id));
}

/**
 * Delete many questions at once, keeping any that a test still uses.
 *
 * The per-row `remove` refuses outright, which is right for one deliberate click but wrong for a
 * selection of forty: the teacher meant "clear these out", and failing the whole batch because three
 * of them are on a test helps nobody. So the in-use ones are kept and COUNTED, and the caller reports
 * the split — the honest middle ground between silently skipping and refusing everything.
 *
 * Platform-library rows in the selection are kept too — no school may delete them — and fall into
 * the same skipped count. `deleted` is therefore always the number of rows that really went.
 */
export async function removeMany(
  db: TenantDb,
  ids: string[],
): Promise<{ deleted: number; skippedInUse: number }> {
  if (!ids.length) return { deleted: 0, skippedInUse: 0 };
  const unique = [...new Set(ids)];
  const [inUse, owned] = await Promise.all([idsInUse(db, unique), ownedIds(db, unique)]);
  const deletable = unique.filter((id) => owned.has(id) && !inUse.has(id));
  await runBatch(
    db,
    chunk(deletable, SCOPED_MAX_BOUND_PARAMS).map((part) =>
      db.delete(questions, inArray(questions.id, part)),
    ),
  );
  if (deletable.length) {
    record({
      action: 'delete',
      entityType: 'question',
      meta: { deleted: deletable, skippedInUse: unique.length - deletable.length },
    });
  }
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
  db: TenantDb,
  ids: string[],
  patch: QuestionMetaPatch,
): Promise<number> {
  const unique = [...new Set(ids)];
  const set: Partial<typeof questions.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (patch.gradeLevelId !== undefined) set.gradeLevelId = patch.gradeLevelId;
  if (patch.difficulty !== undefined) set.difficulty = patch.difficulty;
  // Nothing to do — the route rejects an empty patch, so this is only reachable with no ids.
  if (!unique.length || Object.keys(set).length === 1) return 0;

  // One chunked id read — not the per-row SELECT the docblock rules out — so library rows in the
  // selection are dropped before the writes rather than skipped silently by the scoped UPDATE.
  const owned = [...(await ownedIds(db, unique))];
  if (!owned.length) return 0;

  // Every SET value binds a parameter too — and `tenant_id = ?` from the scoped update is one
  // more — so the ids get what is left of the ceiling rather than all of it. Off-by-one here is a
  // runtime D1 error on a big selection, not a type error.
  const perStatement = Math.max(1, D1_MAX_BOUND_PARAMS - Object.keys(set).length - 1);
  await runBatch(
    db,
    chunk(owned, perStatement).map((part) =>
      db.update(questions, set, inArray(questions.id, part)),
    ),
  );
  record({
    action: 'update',
    entityType: 'question',
    meta: { bulkMeta: owned, gradeLevelId: patch.gradeLevelId, difficulty: patch.difficulty },
  });
  return owned.length;
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
export async function bulkAddTags(db: TenantDb, ids: string[], tags: string[]): Promise<number> {
  const unique = [...new Set(ids)];
  const adding = [...new Set(tags.map((t) => t.trim()).filter(Boolean))].map((t) => t.slice(0, 50));
  if (!unique.length || !adding.length) return 0;

  // `own`, not `pool`: this read is the write's own worklist, so a library row must not reach the
  // merge loop at all — that keeps the returned count equal to the rows actually written.
  const rows = (
    await Promise.all(
      chunk(unique, SCOPED_MAX_BOUND_PARAMS).map((part) =>
        db.raw
          .select({ id: questions.id, tags: questions.tags })
          .from(questions)
          .where(db.own(questions, inArray(questions.id, part))),
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
      db.update(
        questions,
        { tags: JSON.stringify(merged), updatedAt: now },
        eq(questions.id, row.id),
      ),
    );
  }
  await runBatch(db, updates);
  if (updates.length) {
    record({
      action: 'update',
      entityType: 'question',
      meta: { bulkTagsAdded: adding, count: updates.length },
    });
  }
  return updates.length;
}

/**
 * Empty THIS school's question bank, detaching the deleted questions from every test on the way out.
 *
 * This is the one place that overrides the no-cascade rule on `test_questions.questionId`, because
 * the teacher has asked for exactly that. Worth knowing what it costs, and what it does not:
 *
 *   - Every test loses the questions that came from this school's bank. The tests themselves
 *     survive, and any platform-library question they use stays attached — the library is not this
 *     school's to empty, so a wipe must not quietly strip it out of their papers either.
 *   - `test_answers.questionId` DOES cascade, so each student's stored answer to each deleted
 *     question goes with it. Attempt rows keep their scores (rawScore / normalizedScore live on
 *     `test_attempts`, and any synced score_record is untouched), but per-question review is gone.
 *
 * The two deletes must go in this order — questions first would be rejected by the foreign key — and
 * they go as ONE batch so the bank can never be left with orphaned links if the second fails.
 * Neither binds a per-row parameter (the id set is a subquery, not a list), so there is nothing to
 * chunk however large the bank is.
 */
export async function wipe(db: TenantDb): Promise<{ deleted: number; detachedFromTests: number }> {
  /** This school's question ids, as a subquery — see the docblock on parameter binding. */
  const ownIds = () => db.raw.select({ id: questions.id }).from(questions).where(db.own(questions));

  const [questionCount] = await db.raw
    .select({ n: sql<number>`count(*)` })
    .from(questions)
    .where(db.own(questions));
  // tenant-unscoped table: `test_questions` has no tenant_id, so "which links go" is expressed as
  // "links pointing at a question that is about to be deleted".
  const [linkCount] = await db.raw
    .select({ n: sql<number>`count(*)` })
    .from(testQuestions)
    .where(inArray(testQuestions.questionId, ownIds()));
  const deleted = Number(questionCount?.n ?? 0);
  if (!deleted) return { deleted: 0, detachedFromTests: 0 };
  await db.batch([
    db.raw.delete(testQuestions).where(inArray(testQuestions.questionId, ownIds())),
    db.delete(questions),
  ]);
  const detachedFromTests = Number(linkCount?.n ?? 0);
  record({
    action: 'delete',
    entityType: 'question',
    meta: { wipedAll: true, deleted, detachedFromTests },
  });
  return { deleted, detachedFromTests };
}
