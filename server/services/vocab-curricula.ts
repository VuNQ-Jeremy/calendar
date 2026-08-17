import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { flashcardTopics, flashcardWords, vocabCurricula, vocabWordTopics } from '../db/schema';
import { chunk, rowsPerStatement, type TenantDb } from '../db/index';
import type { VocabCurriculumInput, VocabImportUnit, VocabUnitInput } from '../../shared/schemas';
import { record, recordCreate } from './audit';

/**
 * Curricula — the books a grade is taught from, and the units inside them.
 *
 * Two-tier, exactly like `flashcardTopics`: `tenant_id NULL` is the platform library that every
 * school reads through `db.pool()`, and a non-null value is that school's own private book. Reads use
 * `pool`, writes check ownership first, because "can see it" and "may edit it" are different
 * questions — a library row is visible to everyone and editable only by a platform admin.
 *
 * A unit IS a deck (`flashcardTopics.curriculumId` + `.unitNo`). There is no separate units table:
 * everything downstream keys on a deck's id — the thirteen games, `vocab_assignments`, the garden's
 * `ref_id`s, `flashcard_mastery`, the mobile offline bundle — so a level above the deck would repoint
 * all of them for nothing a teacher can see.
 */

export type VocabCurriculumRow = {
  id: string;
  /** NULL means the shared platform library. */
  tenantId: string | null;
  gradeLevelId: string | null;
  name: string;
  slug: string;
  publisher: string | null;
  description: string | null;
  active: boolean;
  sortOrder: number;
  createdAt: string | null;
  /** Units filed under it that this school can see. */
  unitCount: number;
};

/** Thrown as a Response so a route can hand it straight back. */
const fail = (error: string, status: number) => Response.json({ error }, { status });

function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'curriculum';
}

/**
 * Append -2, -3… until the slug is free across the READABLE POOL.
 *
 * `pool`, not `own`, for the same reason `flashcardTopics.uniqueSlug` uses it: a school slug that
 * collided with a library one would make that URL ambiguous rather than merely duplicated. This is
 * also why the migration puts a plain index on `slug` and not a UNIQUE one — a UNIQUE index would
 * fail the insert instead of letting us pick the next free suffix.
 */
async function uniqueSlug(db: TenantDb, base: string, excludeId?: string): Promise<string> {
  const rows = await db.raw
    .select({ id: vocabCurricula.id, slug: vocabCurricula.slug })
    .from(vocabCurricula)
    .where(db.pool(vocabCurricula));
  const taken = new Set(rows.filter((r) => r.id !== excludeId).map((r) => r.slug));
  taken.add('new');
  taken.add('import');
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Everything this school may read: its own books plus the shared library. */
export async function list(db: TenantDb): Promise<VocabCurriculumRow[]> {
  const rows = await db.raw
    .select({
      id: vocabCurricula.id,
      tenantId: vocabCurricula.tenantId,
      gradeLevelId: vocabCurricula.gradeLevelId,
      name: vocabCurricula.name,
      slug: vocabCurricula.slug,
      publisher: vocabCurricula.publisher,
      description: vocabCurricula.description,
      active: vocabCurricula.active,
      sortOrder: vocabCurricula.sortOrder,
      createdAt: vocabCurricula.createdAt,
      unitCount: sql<number>`count(${flashcardTopics.id})`,
    })
    .from(vocabCurricula)
    // A LEFT JOIN so a book with no units yet still lists. The deck side is pool-fenced too: a
    // library curriculum must not report another school's units in its count.
    .leftJoin(
      flashcardTopics,
      and(eq(flashcardTopics.curriculumId, vocabCurricula.id), db.pool(flashcardTopics)),
    )
    .where(db.pool(vocabCurricula))
    .groupBy(vocabCurricula.id)
    .orderBy(asc(vocabCurricula.sortOrder), asc(vocabCurricula.name));
  return rows.map((r) => ({ ...r, active: Boolean(r.active), unitCount: Number(r.unitCount) }));
}

/**
 * Refuse a write this caller may not make.
 *
 * A library row (`tenantId IS NULL`) is editable only by a platform admin; another school's row must
 * look like it does not exist, which is what `pool` returning nothing achieves.
 */
async function assertWritable(
  db: TenantDb,
  id: string,
  isPlatformAdmin: boolean,
): Promise<{ tenantId: string | null }> {
  const rows = await db.raw
    .select({ tenantId: vocabCurricula.tenantId })
    .from(vocabCurricula)
    .where(db.pool(vocabCurricula, eq(vocabCurricula.id, id)))
    .limit(1);
  const row = rows[0];
  if (!row) throw fail('not_found', 404);
  if (row.tenantId === null && !isPlatformAdmin) throw fail('library_read_only', 403);
  return row;
}

export async function create(
  db: TenantDb,
  input: VocabCurriculumInput,
  opts: { intoLibrary?: boolean; isPlatformAdmin: boolean },
): Promise<VocabCurriculumRow> {
  if (opts.intoLibrary && !opts.isPlatformAdmin) throw fail('library_read_only', 403);
  const id = crypto.randomUUID();
  const slug = await uniqueSlug(db, slugify(input.name));
  const values = {
    id,
    gradeLevelId: input.gradeLevelId ?? null,
    name: input.name,
    slug,
    publisher: input.publisher ?? null,
    description: input.description ?? null,
    active: input.active,
    sortOrder: input.sortOrder ?? 0,
    createdAt: new Date().toISOString(),
  };
  if (opts.intoLibrary) {
    // tenant-unscoped: a platform-library row is deliberately tenant_id NULL, which `db.insert`
    // cannot express because it stamps the acting school on every row.
    await db.raw.insert(vocabCurricula).values({ ...values, tenantId: null });
  } else {
    await db.insert(vocabCurricula).values(values);
  }
  recordCreate('vocab_curriculum', id, {
    ...values,
    tenantId: opts.intoLibrary ? null : db.tenantId,
  });
  const rows = await list(db);
  return rows.find((r) => r.id === id)!;
}

export async function update(
  db: TenantDb,
  id: string,
  patch: Partial<VocabCurriculumInput>,
  opts: { isPlatformAdmin: boolean },
): Promise<void> {
  await assertWritable(db, id, opts.isPlatformAdmin);
  const set: Partial<typeof vocabCurricula.$inferInsert> = {};
  if (patch.name !== undefined) {
    set.name = patch.name;
    set.slug = await uniqueSlug(db, slugify(patch.name), id);
  }
  if (patch.gradeLevelId !== undefined) set.gradeLevelId = patch.gradeLevelId ?? null;
  if (patch.publisher !== undefined) set.publisher = patch.publisher ?? null;
  if (patch.description !== undefined) set.description = patch.description ?? null;
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.sortOrder !== undefined && patch.sortOrder != null) set.sortOrder = patch.sortOrder;
  if (!Object.keys(set).length) return;
  // `db.raw`, fenced by the id the ownership check above already resolved through `pool`: a library
  // row has no tenant_id to match, so `db.update` would silently update nothing.
  // tenant-unscoped: two-tier pool row; `assertWritable` is the fence.
  await db.raw.update(vocabCurricula).set(set).where(eq(vocabCurricula.id, id));
  record({ action: 'update', entityType: 'vocab_curriculum', entityId: id, after: set });
}

export async function remove(
  db: TenantDb,
  id: string,
  opts: { isPlatformAdmin: boolean },
): Promise<void> {
  await assertWritable(db, id, opts.isPlatformAdmin);
  record({ action: 'delete', entityType: 'vocab_curriculum', entityId: id });
  // Decks survive with `curriculum_id` set to NULL by the FK — they stop being numbered units and
  // become free-standing decks again, which is far kinder than cascading a book's worth of words.
  // tenant-unscoped: two-tier pool row; `assertWritable` is the fence.
  await db.raw.delete(vocabCurricula).where(eq(vocabCurricula.id, id));
}

/** File a deck as unit N of a curriculum, or unfile it. */
export async function setUnit(db: TenantDb, topicId: string, input: VocabUnitInput): Promise<void> {
  // The deck must be this school's to edit — a library deck is not.
  const owned = await db.raw
    .select({ id: flashcardTopics.id })
    .from(flashcardTopics)
    .where(db.own(flashcardTopics, eq(flashcardTopics.id, topicId)))
    .limit(1);
  if (!owned[0]) throw fail('not_found', 404);
  if (input.curriculumId) {
    // Readable is enough here: filing your own deck under a shared book is the normal case.
    const visible = await db.raw
      .select({ id: vocabCurricula.id })
      .from(vocabCurricula)
      .where(db.pool(vocabCurricula, eq(vocabCurricula.id, input.curriculumId)))
      .limit(1);
    if (!visible[0]) throw fail('curriculum_not_found', 404);
  }
  // A unit number without a curriculum means nothing, so they clear together.
  const curriculumId = input.curriculumId ?? null;
  await db.update(
    flashcardTopics,
    { curriculumId, unitNo: curriculumId ? (input.unitNo ?? null) : null },
    eq(flashcardTopics.id, topicId),
  );
  record({
    action: 'update',
    entityType: 'flashcard_topic',
    entityId: topicId,
    after: { curriculumId, unitNo: input.unitNo ?? null },
  });
}

/**
 * Create or extend the decks of a curriculum from a parsed workbook.
 *
 * A unit already numbered `unitNo` is EXTENDED, not replaced: re-importing a corrected file must not
 * orphan the mastery rows and results already pointing at those decks. Words already in the unit are
 * skipped by headword, so the operation is idempotent and a teacher can re-upload after fixing three
 * rows.
 *
 * Import always writes into THIS SCHOOL's tier, even when the curriculum is a shared one — a school
 * adding its own words to a shared book is normal, and letting an import mutate the library would
 * make one school's typo everybody's.
 */
export async function importUnits(
  db: TenantDb,
  curriculumId: string,
  units: VocabImportUnit[],
  opts: { isPlatformAdmin: boolean; intoLibrary?: boolean },
): Promise<{ units: number; words: number }> {
  if (opts.intoLibrary && !opts.isPlatformAdmin) throw fail('library_read_only', 403);
  const visible = await db.raw
    .select({ id: vocabCurricula.id, tenantId: vocabCurricula.tenantId })
    .from(vocabCurricula)
    .where(db.pool(vocabCurricula, eq(vocabCurricula.id, curriculumId)))
    .limit(1);
  if (!visible[0]) throw fail('curriculum_not_found', 404);

  // Existing units of this curriculum that this school owns, by number.
  const existing = await db.raw
    .select({ id: flashcardTopics.id, unitNo: flashcardTopics.unitNo })
    .from(flashcardTopics)
    .where(
      opts.intoLibrary
        ? // tenant-unscoped: matching library units, which by definition have tenant_id NULL.
          and(eq(flashcardTopics.curriculumId, curriculumId), isNull(flashcardTopics.tenantId))
        : db.own(flashcardTopics, eq(flashcardTopics.curriculumId, curriculumId)),
    );
  const byNo = new Map(existing.filter((r) => r.unitNo != null).map((r) => [r.unitNo!, r.id]));

  const slugs = new Set<string>();
  let unitsTouched = 0;
  let wordsAdded = 0;

  for (const unit of units) {
    let topicId = byNo.get(unit.unitNo);
    if (!topicId) {
      topicId = crypto.randomUUID();
      let slug = await uniqueSlug(db, slugify(`unit-${unit.unitNo}-${unit.name}`));
      // `uniqueSlug` reads committed rows, so two new units in one import could agree on a slug.
      while (slugs.has(slug)) slug = `${slug}-2`;
      slugs.add(slug);
      const topicValues = {
        id: topicId,
        name: unit.name,
        slug,
        description: null,
        color: 'violet',
        curriculumId,
        unitNo: unit.unitNo,
        createdAt: new Date().toISOString(),
      };
      if (opts.intoLibrary) {
        // tenant-unscoped: a library deck is deliberately tenant_id NULL.
        await db.raw.insert(flashcardTopics).values({ ...topicValues, tenantId: null });
      } else {
        await db.insert(flashcardTopics).values(topicValues);
      }
      unitsTouched++;
    }

    // What is already in this unit, so a re-import adds nothing. Compared case-insensitively on the
    // headword, which is how a teacher would judge "already there".
    const present = await db.raw
      .select({ word: flashcardWords.word, sortOrder: flashcardWords.sortOrder })
      .from(flashcardWords)
      .where(eq(flashcardWords.topicId, topicId));
    const seen = new Set(present.map((r) => r.word.trim().toLowerCase()));
    let next = present.reduce((max, r) => Math.max(max, r.sortOrder), 0);

    const fresh = unit.words.filter((w) => {
      const key = w.word.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!fresh.length) continue;
    // A pre-existing unit counts as touched only once it actually gains a word; a newly created one
    // was already counted when it was created.
    if (byNo.has(unit.unitNo)) unitsTouched++;

    const now = new Date().toISOString();
    const ops: BatchItem<'sqlite'>[] = [];
    for (const w of fresh) {
      const id = crypto.randomUUID();
      next += 1;
      // `sortOrder` is computed here rather than with the `nextIndex` SQL expression because this
      // loop already knows the running maximum, and an explicit value keeps the whole unit's
      // numbering contiguous even when a re-import interleaves with a concurrent single-word add.
      // tenant-unscoped: `flashcard_words` has no tenant_id; its deck is the fence, checked above.
      ops.push(
        db.raw.insert(flashcardWords).values({
          id,
          topicId,
          sortOrder: next,
          word: w.word,
          meaningVi: w.meaningVi,
          definitionEn: w.definitionEn ?? null,
          ipa: w.ipa ?? null,
          partOfSpeech: w.partOfSpeech ?? null,
          exampleEn: w.exampleEn ?? null,
          exampleAnswer: w.exampleAnswer ?? null,
          audioUrl: null,
          imageKey: null,
          createdAt: now,
        }),
      );
      const tags = (w.topicIds ?? []).slice(0, 5);
      if (tags.length) {
        ops.push(
          db.raw
            .insert(vocabWordTopics)
            .values(tags.map((vocabTopicId) => ({ wordId: id, vocabTopicId }))),
        );
      }
      wordsAdded++;
    }
    // Chunked so no single batch grows unbounded on a 90-word unit; each statement is a single-row
    // insert of ~12 columns, well inside D1's 100-parameter ceiling.
    for (const part of chunk(ops, rowsPerStatement(1))) {
      await db.batch(part as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
    }
  }

  // One event for the whole import, not N per word — the precedent `questionsSvc.createMany` sets.
  record({
    action: 'create',
    entityType: 'vocab_curriculum',
    entityId: curriculumId,
    meta: { importedUnits: unitsTouched, importedWords: wordsAdded },
  });
  return { units: unitsTouched, words: wordsAdded };
}

/**
 * Which curriculum and unit each visible deck belongs to, as `topicId -> {curriculumId, unitNo}`.
 *
 * One query for the whole screen, so the rail can filter and every card can show its `Bài N` badge
 * without the loader fetching per deck.
 */
export async function unitsByTopic(
  db: TenantDb,
): Promise<Record<string, { curriculumId: string; unitNo: number | null }>> {
  const rows = await db.raw
    .select({
      id: flashcardTopics.id,
      curriculumId: flashcardTopics.curriculumId,
      unitNo: flashcardTopics.unitNo,
    })
    .from(flashcardTopics)
    .where(db.pool(flashcardTopics))
    .orderBy(asc(flashcardTopics.unitNo));
  const out: Record<string, { curriculumId: string; unitNo: number | null }> = {};
  for (const r of rows) {
    if (r.curriculumId) out[r.id] = { curriculumId: r.curriculumId, unitNo: r.unitNo };
  }
  return out;
}
