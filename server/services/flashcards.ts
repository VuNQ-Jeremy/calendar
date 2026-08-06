import { eq, or, and, desc, sql, isNotNull } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import {
  flashcardTopics,
  flashcardWords,
  flashcardResults,
  flashcardMastery,
  students,
  staff,
} from '../db/schema';
import type { Db } from '../db/index';
import * as gardenSvc from './garden';
import type { GardenOutcome } from './garden';
import type {
  FlashcardTopicInput,
  FlashcardWordInput,
  FlashcardResultInput,
} from '../../shared/schemas';

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

/** Append -2, -3… until the slug is free (ignoring the row being updated). */
async function uniqueSlug(db: Db, base: string, excludeId?: string): Promise<string> {
  const rows = await db
    .select({ id: flashcardTopics.id, slug: flashcardTopics.slug })
    .from(flashcardTopics);
  const taken = new Set(
    rows.filter((r) => r.id !== excludeId && r.slug).map((r) => r.slug as string),
  );
  for (const reserved of RESERVED_SLUGS) taken.add(reserved);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export type FlashcardWordRow = {
  id: string;
  topicId: string;
  word: string;
  meaningVi: string;
  definitionEn: string | null;
  ipa: string | null;
  audioUrl: string | null;
  createdAt: string | null;
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
};

export type StudentFlashcardStats = {
  studentId: string;
  rounds: number;
  avgPct: number;
  lastPlayedAt: string | null;
};

function mapWord(r: typeof flashcardWords.$inferSelect): FlashcardWordRow {
  return {
    id: r.id,
    topicId: r.topicId,
    word: r.word,
    meaningVi: r.meaningVi,
    definitionEn: r.definitionEn,
    ipa: r.ipa,
    audioUrl: r.audioUrl,
    createdAt: r.createdAt,
  };
}

// ---- Topics ----

export async function listTopics(db: Db): Promise<FlashcardTopicRow[]> {
  const rows = await db
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
    .groupBy(flashcardTopics.id)
    .orderBy(desc(flashcardTopics.createdAt));
  return rows.map((r) => ({ ...r, wordCount: Number(r.wordCount) }));
}

/** Resolve a topic by its slug, falling back to its id so old UUID links work. */
export async function getTopicBySlug(db: Db, slugOrId: string): Promise<TopicInfo | null> {
  const rows = await db
    .select()
    .from(flashcardTopics)
    .where(or(eq(flashcardTopics.slug, slugOrId), eq(flashcardTopics.id, slugOrId)));
  // Prefer an exact slug match when both a slug row and an id row could match.
  const r = rows.find((x) => x.slug === slugOrId) ?? rows[0];
  if (!r) return null;
  return { id: r.id, name: r.name, slug: r.slug, description: r.description, color: r.color };
}

export async function createTopic(db: Db, input: FlashcardTopicInput): Promise<void> {
  const slug = await uniqueSlug(db, slugify(input.name));
  await db.insert(flashcardTopics).values({
    id: crypto.randomUUID(),
    name: input.name,
    slug,
    description: input.description ?? null,
    color: input.color,
    createdAt: new Date().toISOString(),
  });
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
  db: Db,
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
  await importWords(db, id, words);
  return { id, name: input.name, slug, description: input.description ?? null, color: input.color };
}

export async function updateTopic(
  db: Db,
  id: string,
  patch: Partial<FlashcardTopicInput>,
): Promise<void> {
  const set: Partial<typeof flashcardTopics.$inferInsert> = {};
  if (patch.name !== undefined) {
    set.name = patch.name;
    set.slug = await uniqueSlug(db, slugify(patch.name), id);
  }
  if (patch.description !== undefined) set.description = patch.description ?? null;
  if (patch.color !== undefined) set.color = patch.color;
  if (Object.keys(set).length) {
    await db.update(flashcardTopics).set(set).where(eq(flashcardTopics.id, id));
  }
}

export async function removeTopic(db: Db, id: string): Promise<void> {
  // FK cascade clears words, results, and mastery rows.
  await db.delete(flashcardTopics).where(eq(flashcardTopics.id, id));
}

// ---- Words ----

export async function listWords(db: Db, topicId: string): Promise<FlashcardWordRow[]> {
  const rows = await db
    .select()
    .from(flashcardWords)
    .where(eq(flashcardWords.topicId, topicId))
    .orderBy(flashcardWords.createdAt);
  return rows.map(mapWord);
}

export async function createWord(
  db: Db,
  topicId: string,
  input: FlashcardWordInput,
): Promise<void> {
  await db.insert(flashcardWords).values({
    id: crypto.randomUUID(),
    topicId,
    word: input.word,
    meaningVi: input.meaningVi,
    definitionEn: input.definitionEn ?? null,
    ipa: input.ipa ?? null,
    audioUrl: input.audioUrl ?? null,
    createdAt: new Date().toISOString(),
  });
}

export async function updateWord(
  db: Db,
  id: string,
  patch: Partial<FlashcardWordInput>,
): Promise<void> {
  const set: Partial<typeof flashcardWords.$inferInsert> = {};
  if (patch.word !== undefined) set.word = patch.word;
  if (patch.meaningVi !== undefined) set.meaningVi = patch.meaningVi;
  if (patch.definitionEn !== undefined) set.definitionEn = patch.definitionEn ?? null;
  if (patch.ipa !== undefined) set.ipa = patch.ipa ?? null;
  if (patch.audioUrl !== undefined) set.audioUrl = patch.audioUrl ?? null;
  if (Object.keys(set).length) {
    await db.update(flashcardWords).set(set).where(eq(flashcardWords.id, id));
  }
}

export async function removeWord(db: Db, id: string): Promise<void> {
  await db.delete(flashcardWords).where(eq(flashcardWords.id, id));
}

export async function importWords(
  db: Db,
  topicId: string,
  words: FlashcardWordInput[],
): Promise<void> {
  const now = new Date().toISOString();
  const ops: BatchItem<'sqlite'>[] = words.map((w) =>
    db.insert(flashcardWords).values({
      id: crypto.randomUUID(),
      topicId,
      word: w.word,
      meaningVi: w.meaningVi,
      definitionEn: w.definitionEn ?? null,
      ipa: w.ipa ?? null,
      audioUrl: w.audioUrl ?? null,
      createdAt: now,
    }),
  );
  if (ops.length > 0) await db.batch(ops as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
}

// ---- Results & mastery ----

export async function listTopicResults(
  db: Db,
  topicId: string,
  limit = 30,
): Promise<FlashcardResultRow[]> {
  const rows = await db
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
    .where(eq(flashcardResults.topicId, topicId))
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
  db: Db,
  player: { kind: 'staff' | 'student'; id: string },
  input: FlashcardResultInput,
): Promise<{ recorded: boolean; garden: GardenOutcome | null }> {
  if (input.clientId) {
    const existing = await db.query.flashcardResults.findFirst({
      where: eq(flashcardResults.clientId, input.clientId),
    });
    if (existing) return { recorded: false, garden: null };
  }
  const now = new Date().toISOString();
  const isStudent = player.kind === 'student';
  const resultId = crypto.randomUUID();
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
    // Mastery tracks per-student adaptive ordering; staff plays don't feed it.
    ...(isStudent
      ? input.answers.map((a) =>
          db
            .insert(flashcardMastery)
            .values({
              studentId: player.id,
              wordId: a.wordId,
              correct: a.correct ? 1 : 0,
              wrong: a.correct ? 0 : 1,
              lastSeen: now,
            })
            .onConflictDoUpdate({
              target: [flashcardMastery.studentId, flashcardMastery.wordId],
              set: {
                correct: sql`${flashcardMastery.correct} + ${a.correct ? 1 : 0}`,
                wrong: sql`${flashcardMastery.wrong} + ${a.correct ? 0 : 1}`,
                lastSeen: now,
              },
            }),
        )
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
  db: Db,
  player: { kind: 'staff' | 'student'; id: string },
  input: FlashcardResultInput,
): Promise<boolean> {
  return (await recordResultWithGarden(db, player, input)).recorded;
}

/**
 * Flush a batch of offline results. Each is independently idempotent, and each grows the garden on
 * its own — the count is all the phone asks for, so the return shape stays a number.
 */
export async function recordResults(
  db: Db,
  player: { kind: 'staff' | 'student'; id: string },
  inputs: FlashcardResultInput[],
): Promise<number> {
  let recorded = 0;
  for (const input of inputs) {
    if (await recordResult(db, player, input)) recorded++;
  }
  return recorded;
}

export async function listMasteryForStudent(
  db: Db,
  studentId: string,
  topicId: string,
): Promise<MasteryRow[]> {
  const rows = await db
    .select({
      wordId: flashcardMastery.wordId,
      correct: flashcardMastery.correct,
      wrong: flashcardMastery.wrong,
      lastSeen: flashcardMastery.lastSeen,
    })
    .from(flashcardMastery)
    .innerJoin(flashcardWords, eq(flashcardWords.id, flashcardMastery.wordId))
    .where(and(eq(flashcardMastery.studentId, studentId), eq(flashcardWords.topicId, topicId)));
  return rows;
}

export async function studentFlashcardStats(db: Db): Promise<StudentFlashcardStats[]> {
  const rows = await db
    .select({
      studentId: flashcardResults.studentId,
      rounds: sql<number>`count(*)`,
      avgPct: sql<number>`avg(${flashcardResults.score} * 100.0 / ${flashcardResults.total})`,
      lastPlayedAt: sql<string>`max(${flashcardResults.playedAt})`,
    })
    .from(flashcardResults)
    .where(isNotNull(flashcardResults.studentId))
    .groupBy(flashcardResults.studentId);
  return rows.map((r) => ({
    studentId: r.studentId as string,
    rounds: Number(r.rounds),
    avgPct: Math.round(Number(r.avgPct)),
    lastPlayedAt: r.lastPlayedAt ?? null,
  }));
}
