import { eq, or, and, desc, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import {
  flashcardTopics,
  flashcardWords,
  flashcardResults,
  flashcardMastery,
  students,
} from '../db/schema';
import type { Db } from '../db/index';
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

/** Append -2, -3… until the slug is free (ignoring the row being updated). */
async function uniqueSlug(db: Db, base: string, excludeId?: string): Promise<string> {
  const rows = await db
    .select({ id: flashcardTopics.id, slug: flashcardTopics.slug })
    .from(flashcardTopics);
  const taken = new Set(
    rows.filter((r) => r.id !== excludeId && r.slug).map((r) => r.slug as string),
  );
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
  studentId: string;
  studentName: string;
  studentColor: string;
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
      studentId: flashcardResults.studentId,
      studentName: students.name,
      studentColor: students.color,
      topicId: flashcardResults.topicId,
      mode: flashcardResults.mode,
      score: flashcardResults.score,
      total: flashcardResults.total,
      durationMs: flashcardResults.durationMs,
      playedAt: flashcardResults.playedAt,
    })
    .from(flashcardResults)
    .innerJoin(students, eq(students.id, flashcardResults.studentId))
    .where(eq(flashcardResults.topicId, topicId))
    .orderBy(desc(flashcardResults.playedAt))
    .limit(limit);
  return rows;
}

export async function recordResult(
  db: Db,
  studentId: string,
  input: FlashcardResultInput,
): Promise<void> {
  const now = new Date().toISOString();
  const ops: BatchItem<'sqlite'>[] = [
    db.insert(flashcardResults).values({
      id: crypto.randomUUID(),
      studentId,
      topicId: input.topicId,
      mode: input.mode,
      score: input.score,
      total: input.total,
      durationMs: input.durationMs ?? null,
      playedAt: now,
    }),
    ...input.answers.map((a) =>
      db
        .insert(flashcardMastery)
        .values({
          studentId,
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
    ),
  ];
  await db.batch(ops as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
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
    .groupBy(flashcardResults.studentId);
  return rows.map((r) => ({
    studentId: r.studentId,
    rounds: Number(r.rounds),
    avgPct: Math.round(Number(r.avgPct)),
    lastPlayedAt: r.lastPlayedAt ?? null,
  }));
}
