import { eq, or, and, desc, sql, isNotNull, inArray, lte } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import {
  flashcardTopics,
  flashcardWords,
  flashcardResults,
  flashcardMastery,
  settings,
  students,
  staff,
} from '../db/schema';
import type { Db } from '../db/index';
import * as gardenSvc from './garden';
import type { GardenOutcome } from './garden';
import { record, recordCreate, recordDelete } from './audit';
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
  exampleEn: string | null;
  exampleAnswer: string | null;
  audioUrl: string | null;
  /** R2 object key for the word's picture, or null. Resolve with `flashcardImagePath`. */
  imageKey: string | null;
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

function mapWord(r: typeof flashcardWords.$inferSelect): FlashcardWordRow {
  return {
    id: r.id,
    topicId: r.topicId,
    word: r.word,
    meaningVi: r.meaningVi,
    definitionEn: r.definitionEn,
    ipa: r.ipa,
    exampleEn: r.exampleEn,
    exampleAnswer: r.exampleAnswer,
    audioUrl: r.audioUrl,
    imageKey: r.imageKey,
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

export async function updateTopic(
  db: Db,
  id: string,
  patch: Partial<FlashcardTopicInput>,
): Promise<void> {
  const beforeRows = await db.select().from(flashcardTopics).where(eq(flashcardTopics.id, id));
  const before = beforeRows[0];
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
  const afterRows = await db.select().from(flashcardTopics).where(eq(flashcardTopics.id, id));
  const after = afterRows[0];
  if (!sameJson(before, after)) {
    record({ action: 'update', entityType: 'flashcard', entityId: id, before, after });
  }
}

export async function removeTopic(db: Db, id: string): Promise<void> {
  // FK cascade clears words, results, and mastery rows.
  await recordDelete(db, 'flashcard', flashcardTopics, id);
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
    exampleEn: input.exampleEn ?? null,
    exampleAnswer: input.exampleAnswer ?? null,
    audioUrl: input.audioUrl ?? null,
    imageKey: input.imageKey ?? null,
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
  if (patch.exampleEn !== undefined) set.exampleEn = patch.exampleEn ?? null;
  if (patch.exampleAnswer !== undefined) set.exampleAnswer = patch.exampleAnswer ?? null;
  if (patch.audioUrl !== undefined) set.audioUrl = patch.audioUrl ?? null;
  if (patch.imageKey !== undefined) set.imageKey = patch.imageKey ?? null;
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
      exampleEn: w.exampleEn ?? null,
      exampleAnswer: w.exampleAnswer ?? null,
      audioUrl: w.audioUrl ?? null,
      imageKey: w.imageKey ?? null,
      createdAt: now,
    }),
  );
  if (ops.length > 0) await db.batch(ops as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
}

/**
 * Batch-write AI-backfilled example sentences. Scoped to one topic so a stale id from another
 * topic (or a crafted one) cannot touch rows this screen does not own.
 */
export async function updateWordExamples(
  db: Db,
  topicId: string,
  items: { id: string; exampleEn: string; exampleAnswer: string }[],
): Promise<void> {
  const ops: BatchItem<'sqlite'>[] = items.map((it) =>
    db
      .update(flashcardWords)
      .set({ exampleEn: it.exampleEn, exampleAnswer: it.exampleAnswer })
      .where(and(eq(flashcardWords.id, it.id), eq(flashcardWords.topicId, topicId))),
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

  // Reschedule every answered word before the batch is built, so mastery and review state land in
  // the same write. The clientId check above is what keeps a replayed offline flush from advancing
  // the ladder twice — same guarantee the score counters rely on.
  let review = new Map<string, ReviewState>();
  if (isStudent && input.answers.length) {
    const wordIds = [...new Set(input.answers.map((a) => a.wordId))];
    const [{ intervals }, prior] = await Promise.all([
      getReviewSettings(db),
      db
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
          return db
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
  db: Db,
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
  db: Db,
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
export async function getReviewSettings(db: Db): Promise<ReviewSettings> {
  const rows = await db.select().from(settings).where(eq(settings.key, REVIEW_SETTINGS_KEY));
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
  db: Db,
  input: ReviewSettingsInput,
): Promise<ReviewSettings> {
  const before = await getReviewSettings(db);
  const intervals = [...input.intervals];
  const after = { intervals };
  const value = JSON.stringify(after);
  await db
    .insert(settings)
    .values({ key: REVIEW_SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
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
export async function getPronounceSettings(db: Db): Promise<PronounceSettings> {
  const rows = await db.select().from(settings).where(eq(settings.key, PRONOUNCE_SETTINGS_KEY));
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
  db: Db,
  input: PronounceSettingsInput,
): Promise<PronounceSettings> {
  const before = await getPronounceSettings(db);
  const after = { curve: input.curve };
  const value = JSON.stringify(after);
  await db
    .insert(settings)
    .values({ key: PRONOUNCE_SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
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
  db: Db,
  studentId: string,
  todayVn: string,
): Promise<{ groups: DueTopicGroup[]; total: number }> {
  const rows = await db
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
    .where(and(eq(flashcardMastery.studentId, studentId), lte(flashcardMastery.dueDay, todayVn)));

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
  db: Db,
  studentId: string,
  todayVn: string,
): Promise<number> {
  const rows = await db
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
  db: Db,
  opts: { studentId?: string | null; limit?: number } = {},
): Promise<ScheduledWordRow[]> {
  const where = opts.studentId
    ? and(isNotNull(flashcardMastery.dueDay), eq(flashcardMastery.studentId, opts.studentId))
    : isNotNull(flashcardMastery.dueDay);
  const rows = await db
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
