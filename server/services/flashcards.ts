import { eq, or, and, asc, desc, sql, isNotNull, inArray, lte } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import {
  flashcardTopics,
  flashcardWords,
  flashcardResults,
  flashcardMastery,
  settings,
  students,
  staff,
  vocabTopics,
  vocabWordTopics,
} from '../db/schema';
import { chunk, SCOPED_MAX_BOUND_PARAMS, type TenantDb } from '../db/index';
import * as gardenSvc from './garden';
import type { GardenOutcome } from './garden';
import { record, recordCreate } from './audit';
import {
  DEFAULT_REVIEW_SETTINGS,
  foldAnswers,
  groupDueByTopic,
  isValidLadder,
  type ReviewSettings,
  type ReviewState,
} from '../../shared/logic/review';
import { ictDateOf } from '../../shared/logic/tests';
import { PRONOUNCE_CURVES, type PronounceCurve } from '../../shared/logic/flashcards';
import type {
  FlashcardTopicInput,
  FlashcardWordInput,
  FlashcardResultInput,
  PronounceSettingsInput,
  ReviewSettingsInput,
} from '../../shared/schemas';

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export type FlashcardTopicRow = {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  color: string;
  createdAt: string | null;
  wordCount: number;
};

export type TopicInfo = {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  color: string;
};

/** Turn a topic name into a URL-friendly slug (ASCII, hyphenated). */
function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // strip diacritics (incl. Vietnamese tones)
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'topic';
}

/**
 * Slugs that would collide with a sibling screen rather than resolve to a topic. The mobile app
 * routes `/vocabulary/new` and `/vocabulary/generate` as static segments, which win over the
 * `[slug]` match — so a topic named "New" would otherwise be unreachable there.
 */
const RESERVED_SLUGS = new Set(['new', 'generate', 'import', 'edit']);

/**
 * Append -2, -3… until the slug is free (ignoring the row being updated).
 *
 * `pool`, not `own`: `getTopicBySlug` resolves across the platform library too, so a school topic
 * that reused a library topic's slug would make that URL ambiguous rather than merely duplicated.
 * Uniqueness therefore has to hold over everything this school can see, not just what it owns.
 */
async function uniqueSlug(db: TenantDb, base: string, excludeId?: string): Promise<string> {
  const rows = await db.raw
    .select({ id: flashcardTopics.id, slug: flashcardTopics.slug })
    .from(flashcardTopics)
    .where(db.pool(flashcardTopics));
  const taken = new Set(
    rows.filter((r) => r.id !== excludeId && r.slug).map((r) => r.slug as string),
  );
  for (const reserved of RESERVED_SLUGS) taken.add(reserved);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/* ── The two-tier topic pool ────────────────────────────────────────────────────────────────
 *
 * `flashcard_topics.tenant_id` is the one nullable discriminator in the schema: NULL means the
 * platform library, readable by every school and writable by nobody but a platform admin, and a
 * non-null value means the topic belongs to that school alone. So topic READS go through
 * `db.pool` and topic WRITES through `db.update`/`db.delete`, which are `own`-scoped and
 * therefore refuse a library row and another school's row alike — the first because it is not
 * ours to edit, the second because it must look like it does not exist.
 *
 * `flashcard_words` carries no `tenant_id` at all (see schema.ts): a word is fenced by its topic.
 * That fence is not automatic, so every word statement names it explicitly through one of the two
 * subqueries below — written as subqueries rather than a preceding round trip so a word read or
 * write stays a single statement, batchable like it was before scoping.
 */

/** Topic ids this school may READ: its own, plus the platform library. */
function readableTopicIds(db: TenantDb) {
  return db.raw
    .select({ id: flashcardTopics.id })
    .from(flashcardTopics)
    .where(db.pool(flashcardTopics));
}

/** Topic ids this school may WRITE: its own only — the library is read-only to every school. */
function writableTopicIds(db: TenantDb) {
  return db.raw
    .select({ id: flashcardTopics.id })
    .from(flashcardTopics)
    .where(db.own(flashcardTopics));
}

/**
 * The same set, widened to the platform library for a platform admin.
 *
 * `writableTopicIds` alone made the library *immutable rather than read-only*: it is `own`-scoped, so
 * a library deck (`tenant_id NULL`) matched nobody — a platform admin included. That was invisible
 * until a book was actually imported into the library and a word in it needed a correction, at which
 * point `updateWord` silently updated zero rows and returned success.
 *
 * `pool` for a platform admin, `own` for everyone else. The caller must pass the flag from the
 * session — a service has no session, and defaulting it to false keeps every existing call site
 * (school staff) exactly as strict as it was.
 */
function editableTopicIds(db: TenantDb, isPlatformAdmin: boolean) {
  return isPlatformAdmin
    ? db.raw
        .select({ id: flashcardTopics.id })
        .from(flashcardTopics)
        .where(db.pool(flashcardTopics))
    : writableTopicIds(db);
}

/**
 * Refuse a topic this school may not write to, before inserting words into it.
 *
 * An insert has no `where` to fence, so the ownership test has to be its own read. `own`, not
 * `pool`: a library topic is visible to everyone and editable by nobody, so adding words to one
 * is refused here even though `listWords` reads it happily.
 */
async function assertWritableTopic(db: TenantDb, topicId: string): Promise<void> {
  const rows = await db.raw
    .select({ id: flashcardTopics.id })
    .from(flashcardTopics)
    .where(db.own(flashcardTopics, eq(flashcardTopics.id, topicId)))
    .limit(1);
  if (!rows[0]) throw new Error(`flashcards: topic ${topicId} is not this school's to edit`);
}

export type FlashcardWordRow = {
  id: string;
  topicId: string;
  /** 1-based position inside the deck — what a batch label like "11-20" is computed from. */
  sortOrder: number;
  word: string;
  meaningVi: string;
  definitionEn: string | null;
  ipa: string | null;
  partOfSpeech: string | null;
  exampleEn: string | null;
  exampleAnswer: string | null;
  audioUrl: string | null;
  /** R2 object key for the word's picture, or null. Resolve with `flashcardImagePath`. */
  imageKey: string | null;
  /** Global semantic tags (`vocab_topics.id`). */
  topicIds: string[];
  createdAt: string | null;
};

/** The global tag catalog. No `tenantId` on the table — it is one list for the deployment. */
export type VocabTopicRow = {
  id: string;
  slug: string;
  nameEn: string;
  nameVi: string;
  active: boolean;
  sortOrder: number;
};

export type FlashcardResultRow = {
  id: string;
  playerId: string;
  playerName: string;
  playerColor: string;
  isStaff: boolean;
  topicId: string;
  mode: string;
  score: number;
  total: number;
  durationMs: number | null;
  playedAt: string;
};

export type MasteryRow = {
  wordId: string;
  correct: number;
  wrong: number;
  lastSeen: string | null;
  /** Review rung; see shared/logic/review.ts. */
  level: number;
  /** ICT day the word next falls due, or null when it is not in the review cycle. */
  dueDay: string | null;
};

export type StudentFlashcardStats = {
  studentId: string;
  rounds: number;
  avgPct: number;
  lastPlayedAt: string | null;
};

/** `tags` is the whole deck's junction, fetched once by `listWords`; absent means "no tags read". */
function mapWord(
  r: typeof flashcardWords.$inferSelect,
  tags?: Map<string, string[]>,
): FlashcardWordRow {
  return {
    id: r.id,
    topicId: r.topicId,
    sortOrder: r.sortOrder,
    word: r.word,
    meaningVi: r.meaningVi,
    definitionEn: r.definitionEn,
    ipa: r.ipa,
    partOfSpeech: r.partOfSpeech,
    exampleEn: r.exampleEn,
    exampleAnswer: r.exampleAnswer,
    audioUrl: r.audioUrl,
    imageKey: r.imageKey,
    topicIds: tags?.get(r.id) ?? [],
    createdAt: r.createdAt,
  };
}

/**
 * The next free index in `topicId`, as a SQL expression rather than a value.
 *
 * Computed inside the INSERT so there is no read-modify-write to race. D1 runs a batch's statements
 * sequentially inside one transaction, so the N inserts of an import each see the previous one's row
 * and land on N consecutive indexes; and two teachers adding a word in the same instant cannot both
 * claim the same number, because the loser of the race reads the winner's max. That is also what lets
 * `uq_flashcard_words_order` be UNIQUE with no application-level locking.
 *
 * Aliased `w` rather than using the qualified column names drizzle would emit, so nothing in the
 * subquery can be read as referring to the row being inserted.
 */
const nextIndex = (topicId: string) =>
  sql<number>`(select coalesce(max(w.sort_order), 0) + 1 from flashcard_words w where w.topic_id = ${topicId})`;

/**
 * The global tag catalog, active rows first in catalog order.
 *
 * tenant-unscoped: `vocab_topics` has no `tenant_id` — it is one list for the whole deployment
 * (migration 0046), so there is nothing to fence.
 */
export async function listVocabTopics(db: TenantDb): Promise<VocabTopicRow[]> {
  return db.raw
    .select()
    .from(vocabTopics)
    .orderBy(desc(vocabTopics.active), asc(vocabTopics.sortOrder), asc(vocabTopics.nameEn));
}

/**
 * Tag ids that actually exist. Unknown ids are DROPPED, not rejected: a workbook import with one
 * typo'd tag must still land its word, and the review screen already flags the row.
 *
 * tenant-unscoped: `vocab_topics` is global reference data with no `tenant_id`.
 */
async function resolveTagIds(db: TenantDb, ids: string[]): Promise<string[]> {
  const wanted = [...new Set(ids)].slice(0, 5);
  if (!wanted.length) return [];
  const rows = await db.raw
    .select({ id: vocabTopics.id })
    .from(vocabTopics)
    .where(inArray(vocabTopics.id, wanted));
  const ok = new Set(rows.map((r) => r.id));
  return wanted.filter((id) => ok.has(id));
}

/** Every tag of every given word, as `wordId -> topicIds`. One query, never one per word. */
async function tagsFor(db: TenantDb, wordIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!wordIds.length) return out;
  for (const ids of chunk(wordIds, SCOPED_MAX_BOUND_PARAMS)) {
    // tenant-unscoped: no `tenant_id` on `vocab_word_topics`; the ids come from an already-fenced
    // word read, and a word is reachable only through its deck.
    const rows = await db.raw
      .select({ wordId: vocabWordTopics.wordId, tagId: vocabWordTopics.vocabTopicId })
      .from(vocabWordTopics)
      .where(inArray(vocabWordTopics.wordId, ids));
    for (const r of rows) {
      const list = out.get(r.wordId) ?? [];
      list.push(r.tagId);
      out.set(r.wordId, list);
    }
  }
  return out;
}

/**
 * Replace-set semantics, like `class_materials`: delete then insert, in one batch.
 *
 * Returns the ops rather than running them, so a caller writing several words can put every tag
 * change in the same batch as the words themselves.
 */
function setTagOps(db: TenantDb, wordId: string, tagIds: string[]): BatchItem<'sqlite'>[] {
  // tenant-unscoped: no `tenant_id` on `vocab_word_topics`; the word's deck is the fence.
  const ops: BatchItem<'sqlite'>[] = [
    db.raw.delete(vocabWordTopics).where(eq(vocabWordTopics.wordId, wordId)),
  ];
  if (tagIds.length) {
    ops.push(
      db.raw
        .insert(vocabWordTopics)
        .values(tagIds.map((vocabTopicId) => ({ wordId, vocabTopicId }))),
    );
  }
  return ops;
}

// ---- Topics ----

export async function listTopics(db: TenantDb): Promise<FlashcardTopicRow[]> {
  const rows = await db.raw
    .select({
      id: flashcardTopics.id,
      name: flashcardTopics.name,
      slug: flashcardTopics.slug,
      description: flashcardTopics.description,
      color: flashcardTopics.color,
      createdAt: flashcardTopics.createdAt,
      wordCount: sql<number>`count(${flashcardWords.id})`,
    })
    .from(flashcardTopics)
    .leftJoin(flashcardWords, eq(flashcardWords.topicId, flashcardTopics.id))
    .where(db.pool(flashcardTopics))
    .groupBy(flashcardTopics.id)
    .orderBy(desc(flashcardTopics.createdAt));
  return rows.map((r) => ({ ...r, wordCount: Number(r.wordCount) }));
}

/** Resolve a topic by its slug, falling back to its id so old UUID links work. */
export async function getTopicBySlug(db: TenantDb, slugOrId: string): Promise<TopicInfo | null> {
  const rows = await db.raw
    .select()
    .from(flashcardTopics)
    .where(
      db.pool(
        flashcardTopics,
        or(eq(flashcardTopics.slug, slugOrId), eq(flashcardTopics.id, slugOrId)),
      ),
    );
  // Prefer an exact slug match when both a slug row and an id row could match.
  const r = rows.find((x) => x.slug === slugOrId) ?? rows[0];
  if (!r) return null;
  return { id: r.id, name: r.name, slug: r.slug, description: r.description, color: r.color };
}

export async function createTopic(db: TenantDb, input: FlashcardTopicInput): Promise<void> {
  const id = crypto.randomUUID();
  const slug = await uniqueSlug(db, slugify(input.name));
  await db.insert(flashcardTopics).values({
    id,
    name: input.name,
    slug,
    description: input.description ?? null,
    color: input.color,
    createdAt: new Date().toISOString(),
  });
  recordCreate('flashcard', id, { name: input.name, slug, color: input.color });
}

/**
 * Create a topic and its first words in one call, returning the new topic.
 *
 * This is what the AI generator saves through: the words already exist client-side by the time
 * the teacher confirms, so doing both writes here avoids leaving an empty topic behind if the
 * second call were to fail. Unlike `createTopic` it returns the row, since the caller needs the
 * slug to navigate to the new topic.
 */
export async function createTopicWithWords(
  db: TenantDb,
  input: FlashcardTopicInput,
  words: FlashcardWordInput[],
): Promise<TopicInfo> {
  const slug = await uniqueSlug(db, slugify(input.name));
  const id = crypto.randomUUID();
  await db.insert(flashcardTopics).values({
    id,
    name: input.name,
    slug,
    description: input.description ?? null,
    color: input.color,
    createdAt: new Date().toISOString(),
  });
  // Straight to the private insert: the topic was created one statement ago and is this school's
  // by construction, so `importWords`'s ownership read would only re-prove that.
  await insertWords(db, id, words);
  const row = {
    id,
    name: input.name,
    slug,
    description: input.description ?? null,
    color: input.color,
  };
  recordCreate('flashcard', id, { ...row, wordCount: words.length });
  return row;
}

/**
 * Rename / recolour a topic.
 *
 * `pool` for a platform admin, `own` for everyone else — the row predicate `editableTopicIds`
 * draws for words, drawn here for the topic itself. `own` alone made a library deck *immutable
 * rather than read-only*: `listTopics` reads through `db.pool`, so a library topic (`tenant_id
 * NULL`) is listed to every school and to the platform admin who owns it, but the update matched
 * nobody — zero rows changed, and the route still answered `{ ok: true }`. A recolour from
 * /vocabulary therefore closed its dialog and did nothing at all.
 *
 * The fence is spelled out at both use sites rather than hoisted into a helper so that
 * `test/tenant-scope.test.ts` can see it, and so a reader of this function never has to go
 * looking for what scopes it.
 *
 * The before/after snapshots read through the same predicate as the write: snapshotting a row
 * this caller may not edit would put it in the activity log anyway, and NOT snapshotting one
 * they may edit would drop a real library edit out of the log.
 */
export async function updateTopic(
  db: TenantDb,
  id: string,
  patch: Partial<FlashcardTopicInput>,
  opts: { isPlatformAdmin?: boolean } = {},
): Promise<void> {
  const fence = opts.isPlatformAdmin
    ? db.pool(flashcardTopics, eq(flashcardTopics.id, id))
    : db.own(flashcardTopics, eq(flashcardTopics.id, id));
  const readRow = () => db.raw.select().from(flashcardTopics).where(fence);
  const before = (await readRow())[0];
  const set: Partial<typeof flashcardTopics.$inferInsert> = {};
  if (patch.name !== undefined) {
    set.name = patch.name;
    set.slug = await uniqueSlug(db, slugify(patch.name), id);
  }
  if (patch.description !== undefined) set.description = patch.description ?? null;
  if (patch.color !== undefined) set.color = patch.color;
  if (Object.keys(set).length) {
    // `db.raw.update`, not `db.update`: the sanctioned wrapper is hard-wired to `own`, which is
    // exactly the predicate a platform admin needs widened. `fence` above is the replacement,
    // and it is never weaker — `pool` only ever adds the library, never another school.
    await db.raw.update(flashcardTopics).set(set).where(fence);
  }
  const after = (await readRow())[0];
  if (!sameJson(before, after)) {
    record({ action: 'update', entityType: 'flashcard', entityId: id, before, after });
  }
}

/**
 * Delete a topic. Same two-tier fence as `updateTopic` — a school deletes only its own, a
 * platform admin may also delete from the library; another school's topic matches neither and
 * so deletes nothing AND logs nothing, which is the "looks like it does not exist" answer it
 * should get. FK cascade clears words, results, and mastery rows.
 *
 * The snapshot is taken here rather than through `recordDelete`, whose own read is `own`-scoped:
 * routed through it, a platform admin's library delete would have succeeded silently and left
 * no activity-log entry behind.
 */
export async function removeTopic(
  db: TenantDb,
  id: string,
  opts: { isPlatformAdmin?: boolean } = {},
): Promise<void> {
  const fence = opts.isPlatformAdmin
    ? db.pool(flashcardTopics, eq(flashcardTopics.id, id))
    : db.own(flashcardTopics, eq(flashcardTopics.id, id));
  const before = (await db.raw.select().from(flashcardTopics).where(fence).limit(1))[0];
  if (!before) return;
  record({ action: 'delete', entityType: 'flashcard', entityId: id, before });
  await db.raw.delete(flashcardTopics).where(fence);
}

// ---- Words ----

// tenant-unscoped: `flashcard_words` has no `tenant_id` — a word is fenced by its topic, and the
// `readableTopicIds` subquery is that fence. `topicId` arrives from a query string on
// /api/flashcards/words, so the visibility test cannot be left to the caller.
export async function listWords(db: TenantDb, topicId: string): Promise<FlashcardWordRow[]> {
  const rows = await db.raw
    .select()
    .from(flashcardWords)
    .where(
      and(
        eq(flashcardWords.topicId, topicId),
        inArray(flashcardWords.topicId, readableTopicIds(db)),
      ),
    )
    // By `sortOrder`, NOT `createdAt`: `insertWords` stamps one timestamp for a whole import, so a
    // hundred-word paste has a hundred identical timestamps and `createdAt` is not an order at all.
    // The `id` tiebreak is unreachable given `uq_flashcard_words_order`, and is here so a straggler
    // still at the default 0 lists deterministically instead of shuffling between reads. Deliberately
    // not `rowid`: VACUUM may renumber it for a table whose primary key is TEXT.
    .orderBy(asc(flashcardWords.sortOrder), asc(flashcardWords.id));
  const tags = await tagsFor(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => mapWord(r, tags));
}

export async function createWord(
  db: TenantDb,
  topicId: string,
  input: FlashcardWordInput,
): Promise<void> {
  await assertWritableTopic(db, topicId);
  const id = crypto.randomUUID();
  const tagIds = await resolveTagIds(db, input.topicIds ?? []);
  // tenant-unscoped: no `tenant_id` on the row; the check above is the fence.
  const ops: BatchItem<'sqlite'>[] = [
    db.raw.insert(flashcardWords).values({
      id,
      topicId,
      sortOrder: nextIndex(topicId),
      word: input.word,
      meaningVi: input.meaningVi,
      definitionEn: input.definitionEn ?? null,
      ipa: input.ipa ?? null,
      partOfSpeech: input.partOfSpeech ?? null,
      exampleEn: input.exampleEn ?? null,
      exampleAnswer: input.exampleAnswer ?? null,
      audioUrl: input.audioUrl ?? null,
      imageKey: input.imageKey ?? null,
      createdAt: new Date().toISOString(),
    }),
  ];
  // The word has to exist before the junction can reference it, and one batch is one transaction, so
  // a word can never be left tagless by a half-failure.
  if (tagIds.length) ops.push(...setTagOps(db, id, tagIds).slice(1));
  await db.batch(ops as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
}

export async function updateWord(
  db: TenantDb,
  id: string,
  patch: Partial<FlashcardWordInput>,
  opts: { isPlatformAdmin?: boolean } = {},
): Promise<void> {
  const editable = editableTopicIds(db, opts.isPlatformAdmin ?? false);
  const set: Partial<typeof flashcardWords.$inferInsert> = {};
  if (patch.word !== undefined) set.word = patch.word;
  if (patch.meaningVi !== undefined) set.meaningVi = patch.meaningVi;
  if (patch.definitionEn !== undefined) set.definitionEn = patch.definitionEn ?? null;
  if (patch.ipa !== undefined) set.ipa = patch.ipa ?? null;
  if (patch.partOfSpeech !== undefined) set.partOfSpeech = patch.partOfSpeech ?? null;
  if (patch.exampleEn !== undefined) set.exampleEn = patch.exampleEn ?? null;
  if (patch.exampleAnswer !== undefined) set.exampleAnswer = patch.exampleAnswer ?? null;
  if (patch.audioUrl !== undefined) set.audioUrl = patch.audioUrl ?? null;
  if (patch.imageKey !== undefined) set.imageKey = patch.imageKey ?? null;
  if (Object.keys(set).length) {
    // tenant-unscoped: no `tenant_id` on the row. `writableTopicIds` is the fence, and it excludes
    // the platform library, so a word in a library topic is not editable from a school.
    await db.raw
      .update(flashcardWords)
      .set(set)
      .where(and(eq(flashcardWords.id, id), inArray(flashcardWords.topicId, editable)));
  }
  // Only when the caller actually sent tags: a PATCH that omits `topicIds` must leave them alone,
  // which is why this is not folded into the `set` block above.
  if (patch.topicIds !== undefined) {
    // Re-check ownership, since the junction write does not go through `writableTopicIds`.
    const owned = await db.raw
      .select({ id: flashcardWords.id })
      .from(flashcardWords)
      .where(and(eq(flashcardWords.id, id), inArray(flashcardWords.topicId, editable)))
      .limit(1);
    if (owned[0]) {
      const tagIds = await resolveTagIds(db, patch.topicIds ?? []);
      const ops = setTagOps(db, id, tagIds);
      await db.batch(ops as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
    }
  }
}

export async function removeWord(db: TenantDb, id: string): Promise<void> {
  // tenant-unscoped: same fence as `updateWord`. A word outside it deletes nothing, which is the
  // "looks like it does not exist" answer both a library row and another school's row should get.
  await db.raw
    .delete(flashcardWords)
    .where(and(eq(flashcardWords.id, id), inArray(flashcardWords.topicId, writableTopicIds(db))));
}

export async function importWords(
  db: TenantDb,
  topicId: string,
  words: FlashcardWordInput[],
): Promise<void> {
  await assertWritableTopic(db, topicId);
  await insertWords(db, topicId, words);
}

/** The insert half of `importWords`, for callers that have just created the topic themselves. */
async function insertWords(
  db: TenantDb,
  topicId: string,
  words: FlashcardWordInput[],
): Promise<void> {
  // One timestamp for the whole import — which is exactly why `sort_order` exists. Do not "fix" this
  // by stamping per row: the order would still not be recoverable from it, and the column is the
  // answer.
  const now = new Date().toISOString();
  const wanted = [...new Set(words.flatMap((w) => w.topicIds ?? []))];
  const known = new Set(await resolveTagIds(db, wanted.slice(0, 100)));

  // tenant-unscoped: no `tenant_id` on the row; the caller's ownership check is the fence.
  const ops: BatchItem<'sqlite'>[] = [];
  for (const w of words) {
    const id = crypto.randomUUID();
    ops.push(
      db.raw.insert(flashcardWords).values({
        id,
        topicId,
        // Each statement sees the previous one's row, so N words land on N consecutive indexes.
        sortOrder: nextIndex(topicId),
        word: w.word,
        meaningVi: w.meaningVi,
        definitionEn: w.definitionEn ?? null,
        ipa: w.ipa ?? null,
        partOfSpeech: w.partOfSpeech ?? null,
        exampleEn: w.exampleEn ?? null,
        exampleAnswer: w.exampleAnswer ?? null,
        audioUrl: w.audioUrl ?? null,
        imageKey: w.imageKey ?? null,
        createdAt: now,
      }),
    );
    const tagIds = (w.topicIds ?? []).filter((t) => known.has(t)).slice(0, 5);
    if (tagIds.length) {
      ops.push(
        db.raw
          .insert(vocabWordTopics)
          .values(tagIds.map((vocabTopicId) => ({ wordId: id, vocabTopicId }))),
      );
    }
  }
  if (ops.length > 0) await db.batch(ops as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
}

/**
 * Batch-write AI-backfilled example sentences. Scoped to one topic so a stale id from another
 * topic (or a crafted one) cannot touch rows this screen does not own.
 */
export async function updateWordExamples(
  db: TenantDb,
  topicId: string,
  items: { id: string; exampleEn: string; exampleAnswer: string }[],
): Promise<void> {
  await assertWritableTopic(db, topicId);
  // tenant-unscoped: no `tenant_id` on the row. The topic check above plus the per-statement
  // `topicId` equality are the fence, exactly as they were the fence against a stale id before.
  const ops: BatchItem<'sqlite'>[] = items.map((it) =>
    db.raw
      .update(flashcardWords)
      .set({ exampleEn: it.exampleEn, exampleAnswer: it.exampleAnswer })
      .where(and(eq(flashcardWords.id, it.id), eq(flashcardWords.topicId, topicId))),
  );
  if (ops.length > 0) await db.batch(ops as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
}

// ---- Results & mastery ----

export async function listTopicResults(
  db: TenantDb,
  topicId: string,
  limit = 30,
): Promise<FlashcardResultRow[]> {
  const rows = await db.raw
    .select({
      id: flashcardResults.id,
      playerId: sql<string>`coalesce(${flashcardResults.studentId}, ${flashcardResults.staffId})`,
      playerName: sql<string>`coalesce(${students.name}, ${staff.name})`,
      playerColor: sql<string>`coalesce(${students.color}, ${staff.color})`,
      isStaff: sql<number>`${flashcardResults.staffId} is not null`,
      topicId: flashcardResults.topicId,
      mode: flashcardResults.mode,
      score: flashcardResults.score,
      total: flashcardResults.total,
      durationMs: flashcardResults.durationMs,
      playedAt: flashcardResults.playedAt,
    })
    .from(flashcardResults)
    .leftJoin(students, eq(students.id, flashcardResults.studentId))
    .leftJoin(staff, eq(staff.id, flashcardResults.staffId))
    // Own, not pool: a library topic is shared, but a leaderboard is not — each school sees only
    // the rounds its own players have banked on it.
    .where(db.own(flashcardResults, eq(flashcardResults.topicId, topicId)))
    .orderBy(desc(flashcardResults.playedAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, isStaff: Boolean(r.isStaff) }));
}

/**
 * Record one completed game, and report what it did to the student's plant.
 *
 * `recorded` is false when `clientId` had already been seen. Idempotency matters because the
 * mobile offline outbox retries blindly: a flush that succeeds server-side but drops on the way
 * back would otherwise double-count the score. The whole batch is skipped on replay, not just the
 * result row — re-applying the mastery increments would inflate the student's stats even if the
 * result row were deduped.
 *
 * The garden grows in a SECOND batch, after this one has committed, keyed on the result id. Two
 * reasons: a garden hiccup must never roll back a score the student actually earned, and on the
 * minutes after a deploy where the migration has not landed yet the plant is simply absent rather
 * than the vocabulary screen being broken.
 */
export async function recordResultWithGarden(
  db: TenantDb,
  player: { kind: 'staff' | 'student'; id: string },
  input: FlashcardResultInput,
): Promise<{ recorded: boolean; garden: GardenOutcome | null }> {
  if (input.clientId) {
    const existing = await db.raw
      .select({ id: flashcardResults.id })
      .from(flashcardResults)
      .where(db.own(flashcardResults, eq(flashcardResults.clientId, input.clientId)))
      .limit(1);
    if (existing[0]) return { recorded: false, garden: null };
  }
  const now = new Date().toISOString();
  const isStudent = player.kind === 'student';
  const resultId = crypto.randomUUID();

  // Reschedule every answered word before the batch is built, so mastery and review state land in
  // the same write. The clientId check above is what keeps a replayed offline flush from advancing
  // the ladder twice — same guarantee the score counters rely on.
  let review = new Map<string, ReviewState>();
  if (isStudent && input.answers.length) {
    const wordIds = [...new Set(input.answers.map((a) => a.wordId))];
    const [{ intervals }, prior] = await Promise.all([
      getReviewSettings(db),
      // tenant-unscoped: `flashcard_mastery` is keyed on `(student_id, word_id)` and carries no
      // `tenant_id` — the student id is the fence, and it comes from the session, never the body.
      db.raw
        .select({
          wordId: flashcardMastery.wordId,
          level: flashcardMastery.level,
          dueDay: flashcardMastery.dueDay,
        })
        .from(flashcardMastery)
        .where(
          and(eq(flashcardMastery.studentId, player.id), inArray(flashcardMastery.wordId, wordIds)),
        ),
    ]);
    review = foldAnswers(
      input.answers,
      new Map(prior.map((r) => [r.wordId, { level: r.level, dueDay: r.dueDay }])),
      intervals,
      ictDateOf(now),
    );
  }

  const ops: BatchItem<'sqlite'>[] = [
    db.insert(flashcardResults).values({
      id: resultId,
      studentId: isStudent ? player.id : null,
      staffId: isStudent ? null : player.id,
      topicId: input.topicId,
      mode: input.mode,
      score: input.score,
      total: input.total,
      durationMs: input.durationMs ?? null,
      playedAt: now,
      clientId: input.clientId ?? null,
    }),
    // Mastery tracks per-student adaptive ordering and the review schedule; staff plays don't feed
    // it. The counters are SQL increments (two devices flushing at once must both be counted); the
    // review state is a computed value, where last-write-wins is the right and harmless answer.
    ...(isStudent
      ? input.answers.map((a) => {
          const next = review.get(a.wordId);
          // tenant-unscoped: keyed on `(student_id, word_id)`, and the student is already scoped.
          return db.raw
            .insert(flashcardMastery)
            .values({
              studentId: player.id,
              wordId: a.wordId,
              correct: a.correct ? 1 : 0,
              wrong: a.correct ? 0 : 1,
              lastSeen: now,
              level: next?.level ?? 0,
              dueDay: next?.dueDay ?? null,
            })
            .onConflictDoUpdate({
              target: [flashcardMastery.studentId, flashcardMastery.wordId],
              set: {
                correct: sql`${flashcardMastery.correct} + ${a.correct ? 1 : 0}`,
                wrong: sql`${flashcardMastery.wrong} + ${a.correct ? 0 : 1}`,
                lastSeen: now,
                level: next?.level ?? 0,
                dueDay: next?.dueDay ?? null,
              },
            });
        })
      : []),
  ];
  try {
    await db.batch(ops as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
  } catch (err) {
    // Two concurrent flushes of the same clientId race past the check above; the unique
    // partial index then rejects the loser. That is the desired outcome, not an error.
    if (input.clientId && String(err).includes('UNIQUE')) return { recorded: false, garden: null };
    throw err;
  }

  let garden: GardenOutcome | null = null;
  if (isStudent) {
    try {
      garden = await gardenSvc.onStudentResult(db, player.id, input, resultId, now);
    } catch (err) {
      // Never let the garden take a recorded score down with it.
      console.error('garden: growth skipped for result', resultId, err);
    }
  }
  return { recorded: true, garden };
}

/** The plain "did it record?" form. Staff plays never touch the garden, exactly as with mastery. */
export async function recordResult(
  db: TenantDb,
  player: { kind: 'staff' | 'student'; id: string },
  input: FlashcardResultInput,
): Promise<boolean> {
  return (await recordResultWithGarden(db, player, input)).recorded;
}

/** One entry per submitted result, correlated back to the device by its own `clientId`. */
export interface BatchResultOutcome {
  clientId: string | null;
  recorded: boolean;
  garden: GardenOutcome | null;
}

/**
 * Flush a batch of offline results. Each is independently idempotent, and each grows the garden on
 * its own.
 *
 * The per-result `garden` rides back out so the phone can show the same "your plant grew" note the
 * web shows. It is `null` for a staff play, for a replayed `clientId`, and when the garden write
 * failed — all three mean "say nothing", which is exactly what the note renders for null. A
 * `clientId` is the only handle the caller has on its own round: results are not positionally
 * addressable once the outbox batches several together.
 */
export async function recordResults(
  db: TenantDb,
  player: { kind: 'staff' | 'student'; id: string },
  inputs: FlashcardResultInput[],
): Promise<{ recorded: number; outcomes: BatchResultOutcome[] }> {
  const outcomes: BatchResultOutcome[] = [];
  let recorded = 0;
  for (const input of inputs) {
    const r = await recordResultWithGarden(db, player, input);
    if (r.recorded) recorded++;
    outcomes.push({ clientId: input.clientId ?? null, recorded: r.recorded, garden: r.garden });
  }
  return { recorded, outcomes };
}

// tenant-unscoped: `flashcard_mastery` and `flashcard_words` both carry no `tenant_id`. The
// student id fences the mastery rows and the topic id fences the words; both come from a caller
// that has already resolved them against the school (session id, `getTopicBySlug`).
export async function listMasteryForStudent(
  db: TenantDb,
  studentId: string,
  topicId: string,
): Promise<MasteryRow[]> {
  const rows = await db.raw
    .select({
      wordId: flashcardMastery.wordId,
      correct: flashcardMastery.correct,
      wrong: flashcardMastery.wrong,
      lastSeen: flashcardMastery.lastSeen,
      level: flashcardMastery.level,
      dueDay: flashcardMastery.dueDay,
    })
    .from(flashcardMastery)
    .innerJoin(flashcardWords, eq(flashcardWords.id, flashcardMastery.wordId))
    .where(and(eq(flashcardMastery.studentId, studentId), eq(flashcardWords.topicId, topicId)));
  return rows;
}

/* ── Ôn tập (spaced-repetition review) ──────────────────────────────────────────────────────
 *
 * The scheduling rules live in shared/logic/review.ts; this section only loads rows, hands them to
 * those pure functions, and writes back what they produce. Due-ness is never stored as a flag and
 * never swept: it is `due_day <= today in ICT`, evaluated by whoever is reading. There is no cron.
 */

const REVIEW_SETTINGS_KEY = 'review-settings';

/** Same store and defaulting shape as `getGardenSettings`. */
export async function getReviewSettings(db: TenantDb): Promise<ReviewSettings> {
  const rows = await db.raw
    .select()
    .from(settings)
    .where(db.own(settings, eq(settings.key, REVIEW_SETTINGS_KEY)));
  const row = rows[0];
  if (!row) return { intervals: [...DEFAULT_REVIEW_SETTINGS.intervals] };
  try {
    const parsed = JSON.parse(row.value) as Partial<ReviewSettings>;
    // A stored blob out of range would reschedule every word in the school, so fall back rather
    // than schedule on it.
    return isValidLadder(parsed?.intervals)
      ? { intervals: parsed.intervals }
      : { intervals: [...DEFAULT_REVIEW_SETTINGS.intervals] };
  } catch {
    return { intervals: [...DEFAULT_REVIEW_SETTINGS.intervals] };
  }
}

/**
 * Store the ladder the admin built. Its length is theirs to choose, so a save can shorten it —
 * words parked on a rung that no longer exists are not rewritten here: `clampLevel` pulls them down
 * to the new top the next time they are answered, which keeps the write cheap and the read correct.
 */
export async function setReviewSettings(
  db: TenantDb,
  input: ReviewSettingsInput,
): Promise<ReviewSettings> {
  const before = await getReviewSettings(db);
  const intervals = [...input.intervals];
  const after = { intervals };
  const value = JSON.stringify(after);
  // The conflict target is the whole primary key `(tenant_id, key)` now, not the bare key — one
  // ladder per school, not one per deployment.
  await db
    .insert(settings)
    .values({ key: REVIEW_SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: [settings.tenantId, settings.key], set: { value } });
  if (!sameJson(before, after)) {
    record({
      action: 'update',
      entityType: 'setting',
      entityId: REVIEW_SETTINGS_KEY,
      before,
      after,
    });
  }
  return after;
}

const PRONOUNCE_SETTINGS_KEY = 'pronounce-settings';

export type PronounceSettings = { curve: PronounceCurve };

/**
 * Which forgiveness curve the pronounce game applies (shared/logic/flashcards.ts
 * `forgiveScore`). Same store and defaulting shape as `getReviewSettings`; the default is
 * 'off' — raw Azure scores — until the admin turns a curve on from /config.
 */
export async function getPronounceSettings(db: TenantDb): Promise<PronounceSettings> {
  const rows = await db.raw
    .select()
    .from(settings)
    .where(db.own(settings, eq(settings.key, PRONOUNCE_SETTINGS_KEY)));
  const row = rows[0];
  if (!row) return { curve: 'off' };
  try {
    const parsed = JSON.parse(row.value) as Partial<PronounceSettings>;
    return parsed.curve && (PRONOUNCE_CURVES as readonly string[]).includes(parsed.curve)
      ? { curve: parsed.curve }
      : { curve: 'off' };
  } catch {
    return { curve: 'off' };
  }
}

export async function setPronounceSettings(
  db: TenantDb,
  input: PronounceSettingsInput,
): Promise<PronounceSettings> {
  const before = await getPronounceSettings(db);
  const after = { curve: input.curve };
  const value = JSON.stringify(after);
  await db
    .insert(settings)
    .values({ key: PRONOUNCE_SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: [settings.tenantId, settings.key], set: { value } });
  if (!sameJson(before, after)) {
    record({
      action: 'update',
      entityType: 'setting',
      entityId: PRONOUNCE_SETTINGS_KEY,
      before,
      after,
    });
  }
  return after;
}

/** One topic with the words the student owes a review on today. */
export type DueTopicGroup = {
  topic: TopicInfo;
  wordIds: string[];
};

/**
 * Everything the student is due to review, grouped by topic.
 *
 * Words a student has never answered have no mastery row and so are not in the cycle — you cannot
 * be due to *re*-study something you never studied. New words are found by browsing topics, which
 * is what the rest of the vocabulary screen is for.
 */
export async function listDueForStudent(
  db: TenantDb,
  studentId: string,
  todayVn: string,
): Promise<{ groups: DueTopicGroup[]; total: number }> {
  // tenant-unscoped on `flashcard_mastery`/`flashcard_words` (neither carries `tenant_id`); the
  // student id is the fence there. The topic join adds `pool`, so a mastery row that somehow
  // pointed at another school's topic would drop out rather than name it in the due list.
  const rows = await db.raw
    .select({
      wordId: flashcardMastery.wordId,
      dueDay: flashcardMastery.dueDay,
      topicId: flashcardWords.topicId,
      topicName: flashcardTopics.name,
      topicSlug: flashcardTopics.slug,
      topicDescription: flashcardTopics.description,
      topicColor: flashcardTopics.color,
    })
    .from(flashcardMastery)
    .innerJoin(flashcardWords, eq(flashcardWords.id, flashcardMastery.wordId))
    .innerJoin(flashcardTopics, eq(flashcardTopics.id, flashcardWords.topicId))
    .where(
      db.pool(
        flashcardTopics,
        eq(flashcardMastery.studentId, studentId),
        lte(flashcardMastery.dueDay, todayVn),
      ),
    );

  const topics = new Map<string, TopicInfo>();
  for (const r of rows) {
    if (!topics.has(r.topicId)) {
      topics.set(r.topicId, {
        id: r.topicId,
        name: r.topicName,
        slug: r.topicSlug,
        description: r.topicDescription,
        color: r.topicColor,
      });
    }
  }
  const groups = groupDueByTopic(rows, todayVn).flatMap((g) => {
    const topic = topics.get(g.topicId);
    return topic ? [{ topic, wordIds: g.words.map((w) => w.wordId) }] : [];
  });
  return { groups, total: groups.reduce((n, g) => n + g.wordIds.length, 0) };
}

/** Just the number, for the sidebar badge. Index-only against `idx_flashcard_mastery_due`. */
export async function countDueForStudent(
  db: TenantDb,
  studentId: string,
  todayVn: string,
): Promise<number> {
  // tenant-unscoped: `flashcard_mastery` has no `tenant_id`; the student id is the fence, and it
  // comes from the session. Kept index-only on purpose — joining topics for a pool check would
  // cost the badge its index.
  const rows = await db.raw
    .select({ n: sql<number>`count(*)` })
    .from(flashcardMastery)
    .where(and(eq(flashcardMastery.studentId, studentId), lte(flashcardMastery.dueDay, todayVn)));
  return Number(rows[0]?.n ?? 0);
}

/** One scheduled word, as the admin log lists it. */
export type ScheduledWordRow = {
  studentId: string;
  studentName: string;
  studentColor: string;
  wordId: string;
  word: string;
  meaningVi: string;
  topicId: string;
  topicName: string;
  topicColor: string;
  /** Rung on the ladder — index into the review settings' intervals. */
  level: number;
  /** ICT day it next falls due. Never null here: unscheduled rows are excluded. */
  dueDay: string;
  correct: number;
  wrong: number;
  lastSeen: string | null;
};

/** Nobody needs to scroll more than this to diagnose a schedule, and D1 has a response ceiling. */
export const SCHEDULED_WORDS_LIMIT = 500;

/**
 * Every word currently on the review ladder, most overdue first — the admin log's read.
 *
 * A diagnostic view, not a student-facing one: it reports the schedule exactly as stored, so a
 * row with a `dueDay` far in the past is a real backlog rather than a rendering artefact. Rows
 * with no `dueDay` are excluded because they are not on the ladder at all; `level` is reported raw
 * rather than clamped to the current ladder, so shortening the ladder is visible here as a level
 * past its end instead of being silently hidden.
 *
 * Ordering is (dueDay, student, word) and fully deterministic — a log that reshuffles between
 * reloads is useless for comparing two looks at the same data.
 */
export async function listScheduledWords(
  db: TenantDb,
  opts: { studentId?: string | null; limit?: number } = {},
): Promise<ScheduledWordRow[]> {
  // The school comes from the `students` join — mastery and words carry no `tenant_id`, and this
  // is the one read here that is not already fenced by a session-supplied student id.
  const where = db.own(
    students,
    isNotNull(flashcardMastery.dueDay),
    opts.studentId ? eq(flashcardMastery.studentId, opts.studentId) : undefined,
  );
  const rows = await db.raw
    .select({
      studentId: flashcardMastery.studentId,
      studentName: students.name,
      studentColor: students.color,
      wordId: flashcardMastery.wordId,
      word: flashcardWords.word,
      meaningVi: flashcardWords.meaningVi,
      topicId: flashcardTopics.id,
      topicName: flashcardTopics.name,
      topicColor: flashcardTopics.color,
      level: flashcardMastery.level,
      dueDay: flashcardMastery.dueDay,
      correct: flashcardMastery.correct,
      wrong: flashcardMastery.wrong,
      lastSeen: flashcardMastery.lastSeen,
    })
    .from(flashcardMastery)
    .innerJoin(students, eq(students.id, flashcardMastery.studentId))
    .innerJoin(flashcardWords, eq(flashcardWords.id, flashcardMastery.wordId))
    .innerJoin(flashcardTopics, eq(flashcardTopics.id, flashcardWords.topicId))
    .where(where)
    .orderBy(flashcardMastery.dueDay, students.name, flashcardWords.word)
    .limit(opts.limit ?? SCHEDULED_WORDS_LIMIT);
  // dueDay is nullable on the column but never null in this result — isNotNull is in the WHERE.
  return rows.map((r) => ({ ...r, dueDay: r.dueDay as string }));
}

export async function studentFlashcardStats(db: TenantDb): Promise<StudentFlashcardStats[]> {
  const rows = await db.raw
    .select({
      studentId: flashcardResults.studentId,
      rounds: sql<number>`count(*)`,
      avgPct: sql<number>`avg(${flashcardResults.score} * 100.0 / ${flashcardResults.total})`,
      lastPlayedAt: sql<string>`max(${flashcardResults.playedAt})`,
    })
    .from(flashcardResults)
    .where(db.own(flashcardResults, isNotNull(flashcardResults.studentId)))
    .groupBy(flashcardResults.studentId);
  return rows.map((r) => ({
    studentId: r.studentId as string,
    rounds: Number(r.rounds),
    avgPct: Math.round(Number(r.avgPct)),
    lastPlayedAt: r.lastPlayedAt ?? null,
  }));
}
