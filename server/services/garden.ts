import { asc, desc, eq, gte, inArray, lt, lte, like, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import {
  classStudents,
  classTrees,
  classes,
  flashcardResults,
  flashcardTopics,
  flashcardWords,
  gardenEvents,
  gardenPlants,
  gardenSnapshots,
  settings,
  staff,
  students,
  vocabAssignments,
  vocabAssignmentStudents,
} from '../db/schema';
import { chunk, SCOPED_MAX_BOUND_PARAMS, type TenantDb } from '../db/index';
import {
  BATCH_SIZE,
  deckBatches,
  foldDeckLearnt,
  type DeckBatch,
  type DeckLearnt,
  type LearntBlock,
} from '../../shared/logic/vocab-batches';
import type {
  GardenSettingsInput,
  PlantPatchInput,
  VocabAssignmentInput,
} from '../../shared/schemas';
import {
  DEFAULT_GARDEN_SETTINGS,
  addDaysVn,
  applyDeadlineCheck,
  applyHarvest,
  applyQualifyingPlay,
  applyWatering,
  classTreeLevel,
  effectiveStreak,
  emptyMonthTally,
  growthThresholdPct,
  isQualifying,
  monthOfVn,
  plantView,
  settlePlant,
  tallyGardenMonth,
  titleForFruit,
  type GardenEventDraft,
  type GardenMonthTally,
  type GardenOutcome,
  type GardenSettings,
  type GardenSnapshotData,
  type GardenSnapshotMember,
  type HarvestError,
  type PlantState,
  type PlantTransition,
  type PlantView,
} from '../../shared/logic/garden';
import { speciesOf } from '../../shared/garden-art';
import { composeUtcFromIct, ictDateOf } from '../../shared/logic/tests';
import { modeAllowed, parseModes } from '../../shared/logic/flashcards';
import { record } from './audit';

/**
 * Vườn cây từ vựng — the garden's data layer.
 *
 * All lifecycle rules live in `shared/logic/garden.ts`; this file only loads rows, hands them to
 * those pure functions, and writes back what they produce. Two rules keep it honest:
 *
 * 1. **Reads never write.** Every screen settles the plant in memory (`plantView`) and leaves the
 *    row alone. A stage drop therefore lands at ICT midnight for everybody at once, with or
 *    without the cron, and the widget can never disagree with the class garden or a push.
 * 2. **Every write is idempotent through `garden_events`.** The partial unique index on
 *    `(student_id, type, ref_id)` means a replayed harvest, a re-run deadline sweep or two
 *    simultaneous taps make the *whole batch* fail rather than double-count. That, not a lock, is
 *    the concurrency control — see `writeTransition`.
 */

const SETTINGS_KEY = 'garden-settings';

// ---- Settings ----

/** Same store and defaulting shape as `getRankingWeights`. */
export async function getGardenSettings(db: TenantDb): Promise<GardenSettings> {
  const rows = await db.raw
    .select()
    .from(settings)
    .where(db.own(settings, eq(settings.key, SETTINGS_KEY)));
  const row = rows[0];
  if (!row) return { ...DEFAULT_GARDEN_SETTINGS };
  try {
    const parsed = JSON.parse(row.value) as Partial<GardenSettings>;
    const merged = { ...DEFAULT_GARDEN_SETTINGS, ...parsed };
    // A stored blob out of range would distort every plant in the school, so fall back rather
    // than grow on it.
    const sane =
      Number.isInteger(merged.freeMinScorePct) &&
      merged.freeMinScorePct >= 0 &&
      merged.freeMinScorePct <= 100 &&
      Number.isInteger(merged.wiltAfterDays) &&
      merged.wiltAfterDays >= 1 &&
      Number.isInteger(merged.dropAfterDays) &&
      merged.dropAfterDays >= 1 &&
      Number.isInteger(merged.dailyGrowthCap) &&
      merged.dailyGrowthCap >= 1;
    return sane ? merged : { ...DEFAULT_GARDEN_SETTINGS };
  } catch {
    return { ...DEFAULT_GARDEN_SETTINGS };
  }
}

export async function setGardenSettings(
  db: TenantDb,
  input: GardenSettingsInput,
): Promise<GardenSettings> {
  const before = await getGardenSettings(db);
  const value = JSON.stringify(input);
  // Conflict target is the full primary key `(tenant_id, key)` — one garden config per school.
  await db
    .insert(settings)
    .values({ key: SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: [settings.tenantId, settings.key], set: { value } });
  // Replaces rather than merges, unlike the other settings modules — before/after can therefore
  // genuinely differ in shape if a stored blob had drifted from the current defaults.
  record({ action: 'update', entityType: 'setting', entityId: SETTINGS_KEY, before, after: input });
  return input;
}

// ---- Row <-> state ----

type PlantRow = typeof gardenPlants.$inferSelect;

export interface PlantRecord {
  state: PlantState;
  plantName: string | null;
  potColor: string;
  /** Species id from shared/garden-art.ts. Appearance, not lifecycle — see `rowToState`. */
  species: string;
  updatedAt: string;
}

function rowToState(row: PlantRow): PlantState {
  return {
    stage: row.stage,
    isDead: row.isDead,
    wiltedSince: row.wiltedSince,
    lastCareDay: row.lastCareDay,
    growDay: row.growDay,
    growCount: row.growCount,
    dropsTaken: row.dropsTaken,
    fruitsTotal: row.fruitsTotal,
    streakDays: row.streakDays,
    streakLastDay: row.streakLastDay,
  };
}

export async function getPlant(db: TenantDb, studentId: string): Promise<PlantRecord | null> {
  const rows = await db.raw
    .select()
    .from(gardenPlants)
    .where(db.own(gardenPlants, eq(gardenPlants.studentId, studentId)));
  const row = rows[0];
  if (!row) return null;
  return {
    state: rowToState(row),
    plantName: row.plantName,
    potColor: row.potColor,
    species: row.species,
    updatedAt: row.updatedAt,
  };
}

/**
 * The statements for one transition: upsert the plant, append its events.
 *
 * The upsert is deliberately unguarded — no `WHERE updated_at = ?`. A guarded update that matched
 * nothing would silently succeed and leave the row disagreeing with the events it was written
 * beside, which is worse than the race it guards. Instead every consequential transition carries a
 * natural key in `refId` (the result id, the fruit ordinal, the due day, the assignment id), so a
 * duplicate fails the unique index and takes its whole batch down. What that leaves unprotected is
 * two *different* plays landing in the same instant, where the loser's growth is simply lost — a
 * stage the student earns back on the next round.
 */
function transitionOps(
  db: TenantDb,
  studentId: string,
  t: PlantTransition,
  nowIso: string,
): BatchItem<'sqlite'>[] {
  const s = t.state;
  const values = {
    studentId,
    stage: s.stage,
    isDead: s.isDead,
    wiltedSince: s.wiltedSince,
    lastCareDay: s.lastCareDay,
    growDay: s.growDay,
    growCount: s.growCount,
    dropsTaken: s.dropsTaken,
    fruitsTotal: s.fruitsTotal,
    streakDays: s.streakDays,
    streakLastDay: s.streakLastDay,
    updatedAt: nowIso,
  };
  const { studentId: _omit, ...updatable } = values;
  return [
    db
      .insert(gardenPlants)
      .values(values)
      .onConflictDoUpdate({ target: gardenPlants.studentId, set: updatable }),
    ...t.events.map((e: GardenEventDraft) =>
      db.insert(gardenEvents).values({
        id: crypto.randomUUID(),
        studentId,
        type: e.type,
        stageBefore: e.stageBefore,
        stageAfter: e.stageAfter,
        vnDay: e.vnDay,
        refId: e.refId ?? null,
        actorStaffId: e.actorStaffId ?? null,
        note: e.note ?? null,
        createdAt: nowIso,
      }),
    ),
  ];
}

async function writeTransition(
  db: TenantDb,
  studentId: string,
  t: PlantTransition,
  nowIso: string,
): Promise<void> {
  const ops = transitionOps(db, studentId, t, nowIso);
  await db.batch(ops as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
}

// ---- Assignments ----

export type VocabAssignmentRow = {
  id: string;
  classId: string;
  className: string;
  /** The class's palette key from /classes, so its chip reads the same colour everywhere. */
  classColor: string;
  topicId: string;
  topicName: string;
  topicSlug: string | null;
  requiredCount: number;
  minScorePct: number;
  /** Questions per round for every mode but flip; null = default sizes (see 0036). */
  questionCount: number | null;
  deadline: string;
  /** ICT 'HH:MM' the deadline expires at, or null for end of day (see 0036). */
  deadlineTime: string | null;
  note: string | null;
  /** CSV of game modes that count, canonical order; null = any (see 0034). */
  modes: string | null;
  /**
   * CSV of index ranges over `flashcardWords.sortOrder` this assignment covers ('1-10,21-30'), or
   * null for the whole deck — which is what every row before 0048 means. See
   * shared/logic/vocab-batches.ts.
   */
  batches: string | null;
  createdAt: string;
  /** Narrowed-to students; empty = the whole class. */
  studentIds: string[];
};

export async function listAssignments(
  db: TenantDb,
  opts: { classId?: string; activeFrom?: string } = {},
): Promise<VocabAssignmentRow[]> {
  const where = [
    opts.classId ? eq(vocabAssignments.classId, opts.classId) : undefined,
    opts.activeFrom ? gte(vocabAssignments.deadline, opts.activeFrom) : undefined,
  ];
  const rows = await db.raw
    .select({
      id: vocabAssignments.id,
      classId: vocabAssignments.classId,
      className: classes.name,
      classColor: classes.color,
      topicId: vocabAssignments.topicId,
      topicName: flashcardTopics.name,
      topicSlug: flashcardTopics.slug,
      requiredCount: vocabAssignments.requiredCount,
      minScorePct: vocabAssignments.minScorePct,
      questionCount: vocabAssignments.questionCount,
      deadline: vocabAssignments.deadline,
      deadlineTime: vocabAssignments.deadlineTime,
      note: vocabAssignments.note,
      modes: vocabAssignments.modes,
      batches: vocabAssignments.batches,
      createdAt: vocabAssignments.createdAt,
    })
    .from(vocabAssignments)
    .innerJoin(classes, eq(classes.id, vocabAssignments.classId))
    .innerJoin(flashcardTopics, eq(flashcardTopics.id, vocabAssignments.topicId))
    // The assignment is the scoped root, and its class and topic joins ride along on FKs the
    // school already owns. The topic may be a library one — that is what the pool is for.
    .where(db.own(vocabAssignments, ...where))
    .orderBy(asc(vocabAssignments.deadline), asc(flashcardTopics.name));
  const narrow = await narrowMap(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({ ...r, studentIds: [...(narrow.get(r.id) ?? [])] }));
}

/** One assignment with its topic and class names, or null. */
export async function getAssignment(db: TenantDb, id: string): Promise<VocabAssignmentRow | null> {
  const rows = await db.raw
    .select({
      id: vocabAssignments.id,
      classId: vocabAssignments.classId,
      className: classes.name,
      classColor: classes.color,
      topicId: vocabAssignments.topicId,
      topicName: flashcardTopics.name,
      topicSlug: flashcardTopics.slug,
      requiredCount: vocabAssignments.requiredCount,
      minScorePct: vocabAssignments.minScorePct,
      questionCount: vocabAssignments.questionCount,
      deadline: vocabAssignments.deadline,
      deadlineTime: vocabAssignments.deadlineTime,
      note: vocabAssignments.note,
      modes: vocabAssignments.modes,
      batches: vocabAssignments.batches,
      createdAt: vocabAssignments.createdAt,
    })
    .from(vocabAssignments)
    .innerJoin(classes, eq(classes.id, vocabAssignments.classId))
    .innerJoin(flashcardTopics, eq(flashcardTopics.id, vocabAssignments.topicId))
    .where(db.own(vocabAssignments, eq(vocabAssignments.id, id)));
  if (!rows[0]) return null;
  const narrow = await narrowMap(db, [rows[0].id]);
  return { ...rows[0], studentIds: [...(narrow.get(rows[0].id) ?? [])] };
}

export async function createAssignment(
  db: TenantDb,
  input: VocabAssignmentInput,
  staffId: string | null,
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(vocabAssignments).values({
    id,
    classId: input.classId,
    topicId: input.topicId,
    staffId,
    requiredCount: input.requiredCount,
    minScorePct: input.minScorePct,
    questionCount: input.questionCount ?? null,
    deadline: input.deadline,
    deadlineTime: input.deadlineTime ?? null,
    note: input.note ?? null,
    modes: input.modes ?? null,
    batches: input.batches ?? null,
    createdAt: new Date().toISOString(),
  });
  if (input.studentIds?.length) {
    // tenant-unscoped: vocab_assignment_students has no tenant_id — fenced by the tenant-scoped
    // assignment insert above.
    await db.raw
      .insert(vocabAssignmentStudents)
      .values(input.studentIds.map((studentId) => ({ assignmentId: id, studentId })))
      .onConflictDoNothing();
  }
  return id;
}

export async function updateAssignment(
  db: TenantDb,
  id: string,
  patch: Partial<VocabAssignmentInput>,
): Promise<void> {
  const set: Partial<typeof vocabAssignments.$inferInsert> = {};
  if (patch.classId !== undefined) set.classId = patch.classId;
  if (patch.topicId !== undefined) set.topicId = patch.topicId;
  if (patch.requiredCount !== undefined) set.requiredCount = patch.requiredCount;
  if (patch.minScorePct !== undefined) set.minScorePct = patch.minScorePct;
  if (patch.questionCount !== undefined) set.questionCount = patch.questionCount ?? null;
  if (patch.deadline !== undefined) set.deadline = patch.deadline;
  if (patch.deadlineTime !== undefined) set.deadlineTime = patch.deadlineTime ?? null;
  if (patch.note !== undefined) set.note = patch.note ?? null;
  if (patch.modes !== undefined) set.modes = patch.modes ?? null;
  if (patch.batches !== undefined) set.batches = patch.batches ?? null;
  if (Object.keys(set).length) {
    await db.update(vocabAssignments, set, eq(vocabAssignments.id, id));
  }
  if (patch.studentIds !== undefined) {
    // Replace-set, the event-materials pattern: join rows carry no children of their own.
    // tenant-unscoped: fenced by the caller's own-scoped assignment update above.
    await db.raw
      .delete(vocabAssignmentStudents)
      .where(eq(vocabAssignmentStudents.assignmentId, id));
    if (patch.studentIds?.length) {
      await db.raw
        .insert(vocabAssignmentStudents)
        .values(patch.studentIds.map((studentId) => ({ assignmentId: id, studentId })))
        .onConflictDoNothing();
    }
  }
}

export async function deleteAssignment(db: TenantDb, id: string): Promise<void> {
  await db.delete(vocabAssignments, eq(vocabAssignments.id, id));
}

/* ── Batches ────────────────────────────────────────────────────────────────────────────────────
 *
 * A deck of a hundred words is handed out ten at a time, and a batch already given to a class is
 * never offered again. All of that is derived at read time from two facts: how many live words sit in
 * each ten-window of a deck, and which windows the class's existing assignments already cover.
 *
 * Nothing is materialised. The pure rules live in shared/logic/vocab-batches.ts so the web app, the
 * Expo app and the unit tests share one definition — the same relationship shared/logic/review.ts
 * has with the review functions above.
 */

/**
 * Per-batch live word counts for a set of decks. Returns `topicId -> counts[]`, index 0 = words 1-10.
 *
 * Grouped in SQL rather than in memory: a school's decks add up to thousands of words but only a few
 * hundred batches, and every number this feature reports is a sum over batches. That is exact rather
 * than approximate only because a stored range is always a union of whole windows, which
 * `VocabAssignmentInput` is what guarantees.
 *
 * tenant-unscoped: `flashcard_words` carries no `tenant_id` — a word is fenced by its deck — and
 * every id here comes from an already `own`-scoped assignment or topic read.
 */
export async function deckBatchCounts(
  db: TenantDb,
  topicIds: string[],
): Promise<Record<string, number[]>> {
  const out: Record<string, number[]> = {};
  const wanted = [...new Set(topicIds)];
  if (!wanted.length) return out;
  // Integer division in SQLite, because both operands are INTEGER. BATCH_SIZE is interpolated from
  // the shared module so there is one source of truth for the window width.
  const batchExpr = sql<number>`(${flashcardWords.sortOrder} - 1) / ${BATCH_SIZE}`;
  for (const ids of chunk(wanted, SCOPED_MAX_BOUND_PARAMS)) {
    const rows = await db.raw
      .select({ topicId: flashcardWords.topicId, batch: batchExpr, n: sql<number>`count(*)` })
      .from(flashcardWords)
      .where(inArray(flashcardWords.topicId, ids))
      .groupBy(flashcardWords.topicId, batchExpr);
    for (const r of rows) {
      const list = (out[r.topicId] ??= []);
      // A window emptied by deletions leaves a gap in the grouping, so backfill it as zero rather
      // than leaving a hole an array index would read as `undefined`.
      const at = Number(r.batch);
      while (list.length <= at) list.push(0);
      list[at] = Number(r.n);
    }
  }
  return out;
}

/**
 * What the assign dialog needs for one class and deck: every batch, its live size, and whether an
 * existing assignment already covers it.
 *
 * `excludeAssignmentId` is what makes EDITING an assignment possible — its own batches are not a
 * duplicate of themselves, and without this the dialog could not be saved unchanged.
 */
export async function deckAssignState(
  db: TenantDb,
  topicId: string,
  classId: string,
  opts: { excludeAssignmentId?: string } = {},
): Promise<{
  batches: DeckBatch[];
  totalWords: number;
  assignedWords: number;
  unassignedWords: number;
}> {
  const [counts, covers] = await Promise.all([
    deckBatchCounts(db, [topicId]),
    db.raw
      .select({ id: vocabAssignments.id, batches: vocabAssignments.batches })
      .from(vocabAssignments)
      .where(
        db.own(
          vocabAssignments,
          eq(vocabAssignments.classId, classId),
          eq(vocabAssignments.topicId, topicId),
        ),
      ),
  ]);
  const list = counts[topicId] ?? [];
  const others = covers.filter((c) => c.id !== opts.excludeAssignmentId).map((c) => c.batches);
  const batches = deckBatches(list, others);
  const totalWords = list.reduce((a, c) => a + c, 0);
  const assignedWords = batches.filter((b) => b.assigned).reduce((a, b) => a + b.wordCount, 0);
  return { batches, totalWords, assignedWords, unassignedWords: totalWords - assignedWords };
}

/**
 * "30 learnt · 70 left to assign", for every class-and-deck pair the teacher has homework on.
 *
 * Adds ONE statement to a loader regardless of how many assignments there are: completion is
 * `done >= requiredCount`, which the caller has already computed for its progress table, and a
 * batch's size comes from the single grouped read above. So there is nothing to materialise and
 * nothing to keep in sync — raising `minScorePct` re-reads honestly, exactly as the progress counts
 * already do.
 *
 * Keyed `${classId}:${topicId}`.
 */
export async function deckLearntFor(
  db: TenantDb,
  blocks: readonly LearntBlock[],
): Promise<Record<string, DeckLearnt>> {
  const counts = await deckBatchCounts(
    db,
    blocks.map((b) => b.topicId),
  );
  return foldDeckLearnt(blocks, counts);
}

/**
 * The instant an assignment stops accepting work, as a UTC ISO bound to compare `playedAt` to.
 *
 * Exclusive: `countQualifying` uses `playedAt < end`. A null `deadlineTime` — every row before
 * 0036, and every assignment a teacher leaves unset — means the whole ICT day counts, so the bound
 * is the following midnight, exactly as it was before times existed.
 */
function deadlineEndUtc(deadline: string, deadlineTime: string | null = null): string {
  return deadlineTime
    ? composeUtcFromIct(deadline, deadlineTime)
    : composeUtcFromIct(addDaysVn(deadline, 1), '00:00');
}

/**
 * assignmentId -> the students it is narrowed to. An absent key means the whole class — the
 * meaning of zero join rows. Filtered in JS on purpose: a class has a handful of assignments
 * and this avoids a correlated subquery in the several readers that need it.
 */
async function narrowMap(db: TenantDb, assignmentIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (!assignmentIds.length) return out;
  // tenant-unscoped: vocab_assignment_students has no tenant_id — every id here comes from an
  // already own-scoped vocab_assignments read.
  const rows = await db.raw
    .select()
    .from(vocabAssignmentStudents)
    .where(inArray(vocabAssignmentStudents.assignmentId, assignmentIds));
  for (const r of rows) {
    let s = out.get(r.assignmentId);
    if (!s) out.set(r.assignmentId, (s = new Set()));
    s.add(r.studentId);
  }
  return out;
}

/** Does this assignment apply to this student, given its narrow set (absent = whole class)? */
function appliesTo(narrow: Set<string> | undefined, studentId: string): boolean {
  return !narrow || narrow.has(studentId);
}

/**
 * How many qualifying rounds each member has banked against one assignment.
 *
 * Counted from `flashcard_results` rather than stored, so raising or lowering the bar re-reads
 * honestly instead of leaving a stale tally behind. Rounds played before the assignment existed do
 * not count — the teacher asked for work, not for history.
 */
export async function assignmentProgress(
  db: TenantDb,
  assignmentId: string,
  known?: VocabAssignmentRow,
): Promise<{
  assignment: VocabAssignmentRow;
  rows: { studentId: string; name: string; color: string; done: number }[];
} | null> {
  // `known` lets a caller that has already listed the assignments skip the lookup entirely. The
  // /vocabulary loader reads progress for every open assignment, and re-listing (a three-table
  // join) once per row made that loader visibly slow — slow enough that the UI took seconds to
  // catch up after a teacher pressed Save.
  const assignment = known ?? (await getAssignment(db, assignmentId));
  if (!assignment) return null;

  const members = await db.raw
    .select({ id: students.id, name: students.name, color: students.color })
    .from(classStudents)
    .innerJoin(students, eq(students.id, classStudents.studentId))
    .where(db.own(classStudents, eq(classStudents.classId, assignment.classId)))
    .orderBy(asc(students.name));

  const narrow = (await narrowMap(db, [assignment.id])).get(assignment.id);
  const scoped = members.filter((m) => appliesTo(narrow, m.id));

  const counts = await countQualifying(
    db,
    assignment.topicId,
    scoped.map((m) => m.id),
    assignment.minScorePct,
    assignment.createdAt,
    deadlineEndUtc(assignment.deadline, assignment.deadlineTime),
    parseModes(assignment.modes),
  );

  return {
    assignment,
    rows: scoped.map((m) => ({
      studentId: m.id,
      name: m.name,
      color: m.color,
      done: counts.get(m.id) ?? 0,
    })),
  };
}

/**
 * Qualifying-round counts per student for one topic inside a time window. `modes` narrows the
 * count to rounds played in those game modes; null (every assignment created before 0034, and
 * any assignment the teacher left unrestricted) counts every mode, exactly as before.
 */
async function countQualifying(
  db: TenantDb,
  topicId: string,
  studentIds: string[],
  minScorePct: number,
  fromIso: string,
  toIso: string,
  modes: string[] | null = null,
): Promise<Map<string, number>> {
  if (studentIds.length === 0) return new Map();
  const rows = await db.raw
    .select({
      studentId: flashcardResults.studentId,
      n: sql<number>`count(*)`,
    })
    .from(flashcardResults)
    .where(
      db.own(
        flashcardResults,
        eq(flashcardResults.topicId, topicId),
        inArray(flashcardResults.studentId, studentIds),
        gte(flashcardResults.playedAt, fromIso),
        lt(flashcardResults.playedAt, toIso),
        sql`${flashcardResults.score} * 100 >= ${minScorePct} * ${flashcardResults.total}`,
        modes && modes.length ? inArray(flashcardResults.mode, modes) : undefined,
      ),
    )
    .groupBy(flashcardResults.studentId);
  const out = new Map<string, number>();
  for (const r of rows) if (r.studentId) out.set(r.studentId, Number(r.n));
  return out;
}

/**
 * Qualifying-round counts for one assignment over its own window — the checkin service's way
 * into `countQualifying` without re-deriving the created_at..deadlineEndUtc window rules.
 */
export async function qualifyingCounts(
  db: TenantDb,
  a: {
    topicId: string;
    minScorePct: number;
    createdAt: string;
    deadline: string;
    deadlineTime: string | null;
    modes: string | null;
  },
  studentIds: string[],
): Promise<Map<string, number>> {
  return countQualifying(
    db,
    a.topicId,
    studentIds,
    a.minScorePct,
    a.createdAt,
    deadlineEndUtc(a.deadline, a.deadlineTime),
    parseModes(a.modes),
  );
}

/**
 * Assignments covering `topicId` for the classes this student is in, still inside their deadline.
 *
 * The SQL gate is the deadline DAY (that is what the index covers); the exact instant is applied
 * in memory afterwards, so a round played at 8pm does not set the bar for an assignment that
 * expired at 6pm. `nowIso` rather than a day string for exactly that reason.
 */
export async function activeAssignmentsFor(
  db: TenantDb,
  studentId: string,
  topicId: string,
  nowIso: string,
): Promise<
  {
    id: string;
    minScorePct: number;
    requiredCount: number;
    deadline: string;
    deadlineTime: string | null;
    modes: string | null;
  }[]
> {
  const rows = await db.raw
    .select({
      id: vocabAssignments.id,
      minScorePct: vocabAssignments.minScorePct,
      requiredCount: vocabAssignments.requiredCount,
      deadline: vocabAssignments.deadline,
      deadlineTime: vocabAssignments.deadlineTime,
      modes: vocabAssignments.modes,
    })
    .from(vocabAssignments)
    .innerJoin(classStudents, eq(classStudents.classId, vocabAssignments.classId))
    .where(
      db.own(
        vocabAssignments,
        eq(classStudents.studentId, studentId),
        eq(vocabAssignments.topicId, topicId),
        gte(vocabAssignments.deadline, ictDateOf(nowIso)),
      ),
    );
  const open = rows.filter((a) => nowIso < deadlineEndUtc(a.deadline, a.deadlineTime));
  const narrow = await narrowMap(
    db,
    open.map((a) => a.id),
  );
  return open.filter((a) => appliesTo(narrow.get(a.id), studentId));
}

/**
 * Every open assignment for a student, with their progress — the chips on /vocabulary.
 *
 * "Open" is the same instant test as `activeAssignmentsFor`: an assignment that expired at 6pm
 * stops being listed at 6pm, not at midnight, because after 6pm no further round can count
 * toward it.
 */
export async function studentAssignments(
  db: TenantDb,
  studentId: string,
  nowIso: string,
): Promise<
  {
    id: string;
    topicId: string;
    topicName: string;
    topicSlug: string | null;
    className: string;
    deadline: string;
    /** ICT 'HH:MM' the deadline expires at, or null for end of day. */
    deadlineTime: string | null;
    requiredCount: number;
    minScorePct: number;
    /** Questions per round for every mode but flip; null = default sizes. */
    questionCount: number | null;
    /** The assignment's modes CSV, for the chip's mode badges. Null = any. */
    modes: string | null;
    done: number;
  }[]
> {
  const vnToday = ictDateOf(nowIso);
  const rows = await db.raw
    .select({
      id: vocabAssignments.id,
      topicId: vocabAssignments.topicId,
      topicName: flashcardTopics.name,
      topicSlug: flashcardTopics.slug,
      className: classes.name,
      deadline: vocabAssignments.deadline,
      deadlineTime: vocabAssignments.deadlineTime,
      requiredCount: vocabAssignments.requiredCount,
      minScorePct: vocabAssignments.minScorePct,
      questionCount: vocabAssignments.questionCount,
      modes: vocabAssignments.modes,
      createdAt: vocabAssignments.createdAt,
    })
    .from(vocabAssignments)
    .innerJoin(classStudents, eq(classStudents.classId, vocabAssignments.classId))
    .innerJoin(flashcardTopics, eq(flashcardTopics.id, vocabAssignments.topicId))
    .innerJoin(classes, eq(classes.id, vocabAssignments.classId))
    .where(
      db.own(
        vocabAssignments,
        eq(classStudents.studentId, studentId),
        gte(vocabAssignments.deadline, vnToday),
      ),
    )
    .orderBy(asc(vocabAssignments.deadline));

  const openAll = rows.filter((a) => nowIso < deadlineEndUtc(a.deadline, a.deadlineTime));
  const narrow = await narrowMap(
    db,
    openAll.map((a) => a.id),
  );
  const open = openAll.filter((a) => appliesTo(narrow.get(a.id), studentId));

  const out = [];
  for (const a of open) {
    const counts = await countQualifying(
      db,
      a.topicId,
      [studentId],
      a.minScorePct,
      a.createdAt,
      deadlineEndUtc(a.deadline, a.deadlineTime),
      parseModes(a.modes),
    );
    const { createdAt: _unused, ...rest } = a;
    out.push({ ...rest, done: counts.get(studentId) ?? 0 });
  }
  return out;
}

export type StudentMonthAssignment = {
  id: string;
  topicName: string;
  className: string;
  deadline: string;
  requiredCount: number;
  done: number;
  /** done >= requiredCount — what the slip prints as hoàn thành. */
  completed: boolean;
};

/**
 * Every assignment whose DEADLINE falls inside one ICT month, for one student, with progress —
 * the homework block on the monthly report slip. Contrast `studentAssignments` above, which is
 * forward-looking (deadline >= today) for the /vocabulary chips; a report describes a finished
 * window, missed deadlines included. Same per-assignment `countQualifying` loop, kept on
 * purpose: a student has a handful of assignments a month, and the loop is what lets this share
 * the module-private window logic (created_at .. deadlineEndUtc) with everything else that counts.
 */
export async function studentAssignmentsInMonth(
  db: TenantDb,
  studentId: string,
  month: string,
): Promise<StudentMonthAssignment[]> {
  const list = await db.raw
    .select({
      id: vocabAssignments.id,
      topicId: vocabAssignments.topicId,
      topicName: flashcardTopics.name,
      className: classes.name,
      deadline: vocabAssignments.deadline,
      deadlineTime: vocabAssignments.deadlineTime,
      requiredCount: vocabAssignments.requiredCount,
      minScorePct: vocabAssignments.minScorePct,
      modes: vocabAssignments.modes,
      createdAt: vocabAssignments.createdAt,
    })
    .from(vocabAssignments)
    .innerJoin(classStudents, eq(classStudents.classId, vocabAssignments.classId))
    .innerJoin(flashcardTopics, eq(flashcardTopics.id, vocabAssignments.topicId))
    .innerJoin(classes, eq(classes.id, vocabAssignments.classId))
    .where(
      db.own(
        vocabAssignments,
        eq(classStudents.studentId, studentId),
        gte(vocabAssignments.deadline, `${month}-01`),
        lte(vocabAssignments.deadline, `${month}-31`),
      ),
    )
    .orderBy(asc(vocabAssignments.deadline));

  const narrow = await narrowMap(
    db,
    list.map((a) => a.id),
  );
  const scoped = list.filter((a) => appliesTo(narrow.get(a.id), studentId));

  const out: StudentMonthAssignment[] = [];
  for (const a of scoped) {
    const counts = await countQualifying(
      db,
      a.topicId,
      [studentId],
      a.minScorePct,
      a.createdAt,
      deadlineEndUtc(a.deadline, a.deadlineTime),
      parseModes(a.modes),
    );
    const done = counts.get(studentId) ?? 0;
    out.push({
      id: a.id,
      topicName: a.topicName,
      className: a.className,
      deadline: a.deadline,
      requiredCount: a.requiredCount,
      done,
      completed: done >= a.requiredCount,
    });
  }
  return out;
}

// ---- The play hook ----

// `GardenOutcome` moved to shared/logic/garden.ts so the mobile client can import it too (it may
// only reach `@mochi/shared/*`). Re-exported here because that is where every caller looks for it.
export type { GardenOutcome };

/**
 * A student finished a round: grow the plant if it qualified, and credit their classes' trees.
 *
 * Called from `recordResult` AFTER the result row is safely written, deliberately in its own batch.
 * Sharing the result's batch would mean a garden hiccup could roll back the score itself; keeping
 * them apart costs nothing in correctness because `resultId` is the idempotency key — a retry
 * writes the same event or none at all.
 */
export async function onStudentResult(
  db: TenantDb,
  studentId: string,
  input: { topicId: string; mode: string; score: number; total: number },
  resultId: string,
  nowIso: string,
): Promise<GardenOutcome> {
  const vnToday = ictDateOf(nowIso);
  const settings = await getGardenSettings(db);
  const assignments = await activeAssignmentsFor(db, studentId, input.topicId, nowIso);
  // Only assignments this round's mode counts toward set the bar. A round in an excluded mode
  // is still free study: it grows the plant at the free-study threshold, it just doesn't tick
  // the assignment's counter (countQualifying applies the same filter when it recounts).
  const matching = assignments.filter((a) => modeAllowed(a.modes, input.mode));
  const thresholdPct = growthThresholdPct(
    matching.map((a) => a.minScorePct),
    settings,
  );

  const existing = await getPlant(db, studentId);
  if (!isQualifying(input.score, input.total, thresholdPct)) {
    const view = plantView(existing?.state ?? null, settings, vnToday);
    return {
      qualified: false,
      grew: false,
      stage: view.stage,
      harvestReady: view.harvestReady,
      streak: view.streak,
      thresholdPct,
    };
  }

  const t = applyQualifyingPlay(existing?.state ?? null, settings, nowIso, resultId);
  const memberClasses = await db.raw
    .select({ classId: classStudents.classId })
    .from(classStudents)
    .where(db.own(classStudents, eq(classStudents.studentId, studentId)));

  const ops = [
    ...transitionOps(db, studentId, t, nowIso),
    // The class tree counts effort, so a capped or already-ripe plant still scores for the class.
    ...memberClasses.map((c) =>
      db
        .insert(classTrees)
        .values({ classId: c.classId, points: 1, updatedAt: nowIso })
        .onConflictDoUpdate({
          target: classTrees.classId,
          set: { points: sql`${classTrees.points} + 1`, updatedAt: nowIso },
        }),
    ),
  ];

  try {
    await db.batch(ops as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
  } catch (err) {
    // A concurrent write got there first (its settle events carry the same natural keys). Recompute
    // from the row it wrote and try once more; if that fails too, the round is still recorded and
    // the next one will grow the plant.
    if (!String(err).includes('UNIQUE')) throw err;
    const fresh = await getPlant(db, studentId);
    const retry = applyQualifyingPlay(fresh?.state ?? null, settings, nowIso, resultId);
    try {
      await writeTransition(db, studentId, retry, nowIso);
    } catch (again) {
      if (!String(again).includes('UNIQUE')) throw again;
      const view = plantView(fresh?.state ?? null, settings, vnToday);
      return {
        qualified: true,
        grew: false,
        stage: view.stage,
        harvestReady: view.harvestReady,
        streak: view.streak,
        thresholdPct,
      };
    }
  }

  const view = plantView(t.state, settings, vnToday);
  const grew = t.events.some(
    (e) => (e.type === 'grow' || e.type === 'revive') && e.stageAfter > e.stageBefore,
  );
  return {
    qualified: true,
    grew,
    stage: view.stage,
    harvestReady: view.harvestReady,
    streak: view.streak,
    thresholdPct,
  };
}

// ---- Student actions ----

export async function harvest(
  db: TenantDb,
  studentId: string,
  nowIso: string = new Date().toISOString(),
): Promise<{ ok: true; fruitsTotal: number } | { ok: false; error: HarvestError }> {
  const settings = await getGardenSettings(db);
  const existing = await getPlant(db, studentId);
  const t = applyHarvest(existing?.state ?? null, settings, nowIso);
  if ('error' in t) return { ok: false, error: t.error };
  try {
    await writeTransition(db, studentId, t, nowIso);
  } catch (err) {
    // The fruit ordinal is the idempotency key, so a double tap lands here rather than banking
    // a second fruit.
    if (String(err).includes('UNIQUE')) return { ok: false, error: 'not_ripe' };
    throw err;
  }
  return { ok: true, fruitsTotal: t.state.fruitsTotal };
}

/** Why a species change was refused. Name and pot colour are never refused. */
export type PlantPatchError = 'growing' | 'locked' | 'unknown_species';

/**
 * Rename the plant / repaint the pot / choose a species. Only meaningful once a plant exists.
 *
 * Name and colour are pure decoration and always allowed. The species is not: it is the shape of
 * the thing being grown, so it may only be chosen at planting — while the pot is empty, while the
 * plant is dead, or while it is still a seed. Stage 1 is what makes the reward loop work, because
 * a harvest re-seeds the plant: the harvest that earns a species is also the moment its window
 * opens. From stage 2 the student is growing something, and swapping it mid-growth would make the
 * plant a skin rather than a plant.
 *
 * Two rules keep the guard honest:
 *
 *  1. **The plant is settled in memory first.** A row that still says stage 3 but has been
 *     neglected for a month IS dead, whether or not the cron has written that down yet — every
 *     other garden read derives it the same way.
 *  2. **The unlock is checked against the stored `fruitsTotal`, never a number from the client.**
 *     With no row at all there is provably no fruit, so only the starter is available — and since
 *     the column defaults to it, that case needs no write at all.
 */
export async function updatePlant(
  db: TenantDb,
  studentId: string,
  patch: PlantPatchInput,
  nowIso: string = new Date().toISOString(),
): Promise<{ ok: true } | { ok: false; error: PlantPatchError }> {
  const set: Partial<typeof gardenPlants.$inferInsert> = {};
  if (patch.plantName !== undefined) set.plantName = patch.plantName ?? null;
  if (patch.potColor !== undefined) set.potColor = patch.potColor;

  if (patch.species !== undefined) {
    const art = speciesOf(patch.species);
    if (art.id !== patch.species) return { ok: false, error: 'unknown_species' };
    const record = await getPlant(db, studentId);
    if (!record) {
      // An empty pot: nothing to write, and nothing but the starter to write it with.
      return art.unlockAt === 0 ? { ok: true } : { ok: false, error: 'locked' };
    }
    const settings = await getGardenSettings(db);
    const view = plantView(record.state, settings, ictDateOf(nowIso));
    if (!view.dead && view.stage >= 2) return { ok: false, error: 'growing' };
    if (art.unlockAt > record.state.fruitsTotal) return { ok: false, error: 'locked' };
    set.species = patch.species;
  }

  if (!Object.keys(set).length) return { ok: true };
  set.updatedAt = nowIso;
  await db.update(gardenPlants, set, eq(gardenPlants.studentId, studentId));
  return { ok: true };
}

export async function water(
  db: TenantDb,
  staffId: string,
  studentId: string,
  note: string | null,
  nowIso: string = new Date().toISOString(),
): Promise<PlantState> {
  const settings = await getGardenSettings(db);
  const existing = await getPlant(db, studentId);
  const t = applyWatering(existing?.state ?? null, settings, nowIso, staffId, note);
  await writeTransition(db, studentId, t, nowIso);
  return t.state;
}

/**
 * Admin test tool — put a plant at a stage, and optionally backdate its last care.
 *
 * Deliberately NOT a shortcut around the lifecycle: it writes a legal `PlantState` and then lets
 * `settlePlant` do the rest. Asking for stage 4 with 10 idle days therefore does not paint a
 * wilted stage-4 plant; it plants a real stage-4 plant ten days ago and every reader derives the
 * wilt, the stage drop and (given enough days) the death from that, exactly as a neglected plant
 * would. Otherwise the tool would only ever prove that the tool works.
 *
 * Stage 0 means the dead pot, because a live row at stage 0 is not a state the game can produce.
 * Every call appends a `dev` event, so a plant's history never claims a student earned this.
 */
export async function devSetPlant(
  db: TenantDb,
  staffId: string,
  input: { studentId: string; stage: number; idleDays: number },
  nowIso: string = new Date().toISOString(),
): Promise<PlantState> {
  const vnToday = ictDateOf(nowIso);
  const existing = await getPlant(db, input.studentId);
  const settings = await getGardenSettings(db);
  const before = plantView(existing?.state ?? null, settings, vnToday).stage;

  const dead = input.stage <= 0;
  const careDay = addDaysVn(vnToday, -input.idleDays);
  const state: PlantState = {
    stage: dead ? 0 : input.stage,
    isDead: dead,
    // Left null on purpose: if the backdated care day is old enough to wilt, `settlePlant` will
    // set it on the next read, at the day it was really due.
    wiltedSince: null,
    lastCareDay: careDay,
    growDay: careDay,
    growCount: 0,
    dropsTaken: 0,
    fruitsTotal: existing?.state.fruitsTotal ?? 0,
    streakDays: existing?.state.streakDays ?? 0,
    streakLastDay: existing?.state.streakLastDay ?? null,
  };

  await writeTransition(
    db,
    input.studentId,
    {
      state,
      events: [
        {
          type: 'dev',
          stageBefore: before,
          stageAfter: state.stage,
          vnDay: vnToday,
          actorStaffId: staffId,
          note: `stage ${input.stage}, idle ${input.idleDays}d`,
        },
      ],
    },
    nowIso,
  );
  return state;
}

/** Admin test tool — back to an unplanted pot, history and all. */
export async function devResetPlant(db: TenantDb, studentId: string): Promise<void> {
  // The events go too. Keeping them would leave a history whose first row starts mid-air, and the
  // point of the reset is a student who has never planted anything.
  await db.batch([
    db.delete(gardenEvents, eq(gardenEvents.studentId, studentId)),
    db.delete(gardenPlants, eq(gardenPlants.studentId, studentId)),
  ]);
}

export type GardenEventRow = {
  id: string;
  type: string;
  stageBefore: number;
  stageAfter: number;
  vnDay: string;
  note: string | null;
  staffName: string | null;
  createdAt: string;
};

/** Recent history for one plant — what the audit popover shows. */
export async function plantHistory(
  db: TenantDb,
  studentId: string,
  limit = 20,
): Promise<GardenEventRow[]> {
  return db.raw
    .select({
      id: gardenEvents.id,
      type: gardenEvents.type,
      stageBefore: gardenEvents.stageBefore,
      stageAfter: gardenEvents.stageAfter,
      vnDay: gardenEvents.vnDay,
      note: gardenEvents.note,
      staffName: staff.name,
      createdAt: gardenEvents.createdAt,
    })
    .from(gardenEvents)
    .leftJoin(staff, eq(staff.id, gardenEvents.actorStaffId))
    .where(db.own(gardenEvents, eq(gardenEvents.studentId, studentId)))
    .orderBy(desc(gardenEvents.createdAt))
    .limit(limit);
}

// ---- Views ----

/** One student's garden month, for the monthly report. Null plant when nothing was ever planted. */
export interface GardenMonthSummary extends GardenMonthTally {
  /** ICT month 'YYYY-MM' this summarises. */
  month: string;
  /** The plant as it stands today, or null when the student has never planted. */
  plant: PlantView | null;
  plantName: string | null;
  potColor: string;
  /** Species id — see shared/garden-art.ts. */
  species: string;
  /** Lifetime fruit, for context beside the month's own count. */
  fruitsTotal: number;
}

/**
 * One student's garden activity for one ICT month, plus their plant as it stands now.
 *
 * The month's numbers are folded by `tallyGardenMonth` (pure, in shared/logic); the plant is
 * settled through `plantView` against `vnToday` like every other garden read — so a neglected
 * plant reads as wilted here for the same reason it does on /vocabulary.
 */
export async function studentGardenMonth(
  db: TenantDb,
  studentId: string,
  month: string,
  vnToday: string,
  settings?: GardenSettings,
): Promise<GardenMonthSummary> {
  const byStudent = await gardenMonthByStudent(db, month, vnToday, {
    studentIds: [studentId],
    settings,
  });
  return byStudent[studentId] ?? emptyGardenMonth(month);
}

/** A student with no events and no plant — what the report shows before they ever play. */
function emptyGardenMonth(month: string): GardenMonthSummary {
  return {
    month,
    ...emptyMonthTally(),
    plant: null,
    plantName: null,
    potColor: 'orange',
    species: 'classic',
    fruitsTotal: 0,
  };
}

/**
 * `studentGardenMonth` for many students at once, keyed by student id.
 *
 * Two queries regardless of roll size — one month-scoped events sweep, one plants read — since
 * the assessments screen loads the whole school up front and switches student in the client. The
 * per-student function above delegates here so there is exactly one definition of what these
 * numbers mean.
 *
 * Every requested student gets an entry, so a student who has never touched the garden reads as
 * zeros rather than a missing key the caller has to defend against.
 */
export async function gardenMonthByStudent(
  db: TenantDb,
  month: string,
  vnToday: string,
  opts: { studentIds?: string[]; settings?: GardenSettings } = {},
): Promise<Record<string, GardenMonthSummary>> {
  const { studentIds } = opts;
  if (studentIds && studentIds.length === 0) return {};
  const cfg = opts.settings ?? (await getGardenSettings(db));

  const scope = studentIds ? inArray(gardenEvents.studentId, studentIds) : undefined;
  const [events, plants] = await Promise.all([
    db.raw
      .select({
        studentId: gardenEvents.studentId,
        type: gardenEvents.type,
        stageBefore: gardenEvents.stageBefore,
        stageAfter: gardenEvents.stageAfter,
        vnDay: gardenEvents.vnDay,
      })
      .from(gardenEvents)
      .where(db.own(gardenEvents, like(gardenEvents.vnDay, `${month}-%`), scope)),
    // The no-`studentIds` branch is the whole-school read the assessments screen makes, and `own`
    // is what now keeps "the whole school" from meaning "every school".
    db.raw
      .select()
      .from(gardenPlants)
      .where(
        db.own(gardenPlants, studentIds ? inArray(gardenPlants.studentId, studentIds) : undefined),
      ),
  ]);

  // Group first, then fold each student's events with the shared pure function — one definition
  // of what these numbers mean, for both this and the single-student path.
  const byId = new Map<string, typeof events>();
  for (const e of events) {
    const list = byId.get(e.studentId);
    if (list) list.push(e);
    else byId.set(e.studentId, [e]);
  }

  const out: Record<string, GardenMonthSummary> = {};
  const at = (id: string) => (out[id] ??= emptyGardenMonth(month));
  for (const [id, list] of byId) Object.assign(at(id), tallyGardenMonth(list));

  for (const row of plants) {
    const s = at(row.studentId);
    s.plant = plantView(rowToState(row), cfg, vnToday);
    s.plantName = row.plantName;
    s.potColor = row.potColor;
    s.species = row.species;
    s.fruitsTotal = row.fruitsTotal;
  }

  // Requested-but-silent students still get an entry.
  if (studentIds) for (const id of studentIds) at(id);
  return out;
}

export interface GardenMember extends PlantView {
  studentId: string;
  name: string;
  color: string;
  plantName: string | null;
  potColor: string;
  /** Species id — see shared/garden-art.ts. */
  species: string;
  fruitMonth: number;
}

export interface ClassGarden {
  classId: string;
  className: string;
  members: GardenMember[];
  tree: { points: number; level: number };
}

/** Harvest counts for one ICT month, per student. */
async function monthFruit(
  db: TenantDb,
  studentIds: string[],
  month: string,
): Promise<Map<string, number>> {
  if (studentIds.length === 0) return new Map();
  const rows = await db.raw
    .select({ studentId: gardenEvents.studentId, n: sql<number>`count(*)` })
    .from(gardenEvents)
    .where(
      db.own(
        gardenEvents,
        eq(gardenEvents.type, 'harvest'),
        inArray(gardenEvents.studentId, studentIds),
        like(gardenEvents.vnDay, `${month}-%`),
      ),
    )
    .groupBy(gardenEvents.studentId);
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.studentId, Number(r.n));
  return out;
}

/**
 * One class's garden, as of `vnToday`. Every plant is settled in memory — this is a read.
 */
export async function classGarden(
  db: TenantDb,
  classId: string,
  vnToday: string,
  settings?: GardenSettings,
): Promise<ClassGarden | null> {
  // Another school's class id reads as "no such class" — the 404 the routes already render.
  const cls = (
    await db.raw
      .select()
      .from(classes)
      .where(db.own(classes, eq(classes.id, classId)))
  )[0];
  if (!cls) return null;
  const cfg = settings ?? (await getGardenSettings(db));

  const rows = await db.raw
    .select({
      studentId: students.id,
      name: students.name,
      color: students.color,
      plant: gardenPlants,
    })
    .from(classStudents)
    .innerJoin(students, eq(students.id, classStudents.studentId))
    .leftJoin(gardenPlants, eq(gardenPlants.studentId, students.id))
    .where(db.own(classStudents, eq(classStudents.classId, classId)))
    .orderBy(asc(students.name));

  const fruit = await monthFruit(
    db,
    rows.map((r) => r.studentId),
    monthOfVn(vnToday),
  );
  const treeRow = (
    await db.raw
      .select()
      .from(classTrees)
      .where(db.own(classTrees, eq(classTrees.classId, classId)))
  )[0];
  const points = treeRow?.points ?? 0;

  return {
    classId,
    className: cls.name,
    members: rows.map((r) => ({
      studentId: r.studentId,
      name: r.name,
      color: r.color,
      plantName: r.plant?.plantName ?? null,
      potColor: r.plant?.potColor ?? 'orange',
      // A student with no plant row still needs a species to draw the empty pot's hint with.
      species: r.plant?.species ?? 'classic',
      fruitMonth: fruit.get(r.studentId) ?? 0,
      ...plantView(r.plant ? rowToState(r.plant) : null, cfg, vnToday),
    })),
    tree: { points, level: classTreeLevel(points) },
  };
}

/** The classes a student belongs to, for routing them to their own garden. */
export async function studentClasses(
  db: TenantDb,
  studentId: string,
): Promise<{ id: string; name: string }[]> {
  return db.raw
    .select({ id: classes.id, name: classes.name })
    .from(classStudents)
    .innerJoin(classes, eq(classes.id, classStudents.classId))
    .where(db.own(classStudents, eq(classStudents.studentId, studentId)))
    .orderBy(asc(classes.name));
}

// ---- Snapshots (album) ----

/**
 * Freeze one class's garden for a finished month.
 *
 * Evaluated at the last ICT day of that month, not today, so an album made late still shows the
 * plants as they stood when the month ended. Idempotent by primary key: an existing month is left
 * exactly as it was — a keepsake is not something to overwrite.
 */
export async function snapshotMonth(
  db: TenantDb,
  month: string,
  classId?: string,
): Promise<number> {
  const asOf = lastDayOfMonth(month);
  const settings = await getGardenSettings(db);
  const targets = await db.raw
    .select({ id: classes.id })
    .from(classes)
    .where(db.own(classes, classId ? eq(classes.id, classId) : undefined));

  const existing = await db.raw
    .select({ classId: gardenSnapshots.classId })
    .from(gardenSnapshots)
    .where(db.own(gardenSnapshots, eq(gardenSnapshots.month, month)));
  const already = new Set(existing.map((e) => e.classId));

  let written = 0;
  for (const t of targets) {
    if (already.has(t.id)) continue;
    const garden = await classGarden(db, t.id, asOf, settings);
    if (!garden) continue;
    const data: GardenSnapshotData = {
      members: garden.members.map((m): GardenSnapshotMember => ({
        studentId: m.studentId,
        name: m.name,
        color: m.color,
        plantName: m.plantName,
        potColor: m.potColor,
        species: m.species,
        stage: m.stage,
        wilted: m.wilted,
        dead: m.dead,
        streak: m.streak,
        fruitMonth: m.fruitMonth,
        fruitTotal: m.fruitsTotal,
        titleId: m.titleId,
      })),
      classTree: { level: garden.tree.level, points: garden.tree.points },
    };
    await db.insert(gardenSnapshots).values({
      classId: t.id,
      month,
      className: garden.className,
      data: JSON.stringify(data),
      createdAt: new Date().toISOString(),
    });
    written++;
  }
  return written;
}

/** '2026-02' -> '2026-02-28'. */
function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export async function listSnapshots(
  db: TenantDb,
  classId: string,
): Promise<{ month: string; createdAt: string }[]> {
  return db.raw
    .select({ month: gardenSnapshots.month, createdAt: gardenSnapshots.createdAt })
    .from(gardenSnapshots)
    .where(db.own(gardenSnapshots, eq(gardenSnapshots.classId, classId)))
    .orderBy(desc(gardenSnapshots.month));
}

export async function getSnapshot(
  db: TenantDb,
  classId: string,
  month: string,
): Promise<{ className: string; month: string; data: GardenSnapshotData } | null> {
  const row = (
    await db.raw
      .select()
      .from(gardenSnapshots)
      .where(
        db.own(
          gardenSnapshots,
          eq(gardenSnapshots.classId, classId),
          eq(gardenSnapshots.month, month),
        ),
      )
  )[0];
  if (!row) return null;
  try {
    return { className: row.className, month: row.month, data: JSON.parse(row.data) };
  } catch {
    return null;
  }
}

/** The previous ICT month, as 'YYYY-MM'. */
export function previousMonth(vnToday: string): string {
  return monthOfVn(addDaysVn(`${monthOfVn(vnToday)}-01`, -1));
}

// ---- Daily sweep (database side; the pushes live in notify.ts) ----

export interface SweepResult {
  /** Students newly penalized, with the assignment that cost them the stage. */
  penalties: { studentId: string; assignmentId: string; topicName: string }[];
  /** Plants whose wilt begins today. */
  wiltingToday: { studentId: string; nextDropDate: string | null }[];
  /** Plants dropping a stage tomorrow. */
  droppingTomorrow: { studentId: string; nextDropDate: string }[];
  snapshotsWritten: number;
}

/**
 * The once-a-day work: charge missed deadlines, persist overdue decay, and report who needs
 * telling. Nothing here changes what a screen already shows — the decay it writes down is the
 * decay every reader has been deriving all along — so a skipped run costs notifications, never
 * correctness.
 */
export async function runGardenSweep(db: TenantDb, nowIso: string): Promise<SweepResult> {
  return sweepCore(db, nowIso, true);
}

/**
 * The same enumeration, writing nothing — what the /logs notification forecast needs.
 *
 * Garden alerts are the one job whose subjects cannot be learned by asking: the cron discovers them
 * as a by-product of charging penalties and persisting decay. So the sweep takes a `persist` flag
 * and the forecast runs it with `false`: identical queries, identical `applyDeadlineCheck` /
 * `plantView` derivation, zero `writeTransition` and zero `snapshotMonth`.
 *
 * **One known divergence.** If a student misses TWO deadlines the same morning, the real sweep's
 * second `applyDeadlineCheck` sees the state its own first penalty already wrote, while the forecast
 * evaluates both against the untouched plant — so the forecast can predict one penalty the real run
 * will decline to charge. Rare (it needs two assignments expiring on the same day for one student)
 * and it only ever over-reports, which is why the UI labels this section a forecast rather than a
 * schedule.
 */
export async function forecastGardenSweep(db: TenantDb, nowIso: string): Promise<SweepResult> {
  return sweepCore(db, nowIso, false);
}

/**
 * Scoped to ONE school. The cron used to sweep the deployment in a single pass; it now needs a
 * per-school loop with a `TenantDb` each, because every read below is fenced to `db.tenantId`.
 */
async function sweepCore(db: TenantDb, nowIso: string, persist: boolean): Promise<SweepResult> {
  const vnToday = ictDateOf(nowIso);
  const settings = await getGardenSettings(db);
  const out: SweepResult = {
    penalties: [],
    wiltingToday: [],
    droppingTomorrow: [],
    snapshotsWritten: 0,
  };

  // 1. Missed deadlines. Bounded to the recent past: anything older was either charged already or
  // predates the feature, and the unique index makes a re-run a no-op either way.
  //
  // The gate stays the deadline DAY even for assignments with a clock time: the penalty is a daily
  // job, so an assignment that shut at 6pm is charged by the run after ICT midnight, not at 6pm.
  // What the time does change is `countQualifying` below — a round played at 8pm does not save the
  // student from the drop, exactly as the closed chip told them at 6.
  const overdue = await db.raw
    .select({
      id: vocabAssignments.id,
      classId: vocabAssignments.classId,
      topicId: vocabAssignments.topicId,
      topicName: flashcardTopics.name,
      requiredCount: vocabAssignments.requiredCount,
      minScorePct: vocabAssignments.minScorePct,
      deadline: vocabAssignments.deadline,
      deadlineTime: vocabAssignments.deadlineTime,
      modes: vocabAssignments.modes,
      createdAt: vocabAssignments.createdAt,
    })
    .from(vocabAssignments)
    .innerJoin(flashcardTopics, eq(flashcardTopics.id, vocabAssignments.topicId))
    .where(
      db.own(
        vocabAssignments,
        lt(vocabAssignments.deadline, vnToday),
        gte(vocabAssignments.deadline, addDaysVn(vnToday, -35)),
      ),
    );

  for (const a of overdue) {
    const members = await db.raw
      .select({ studentId: classStudents.studentId })
      .from(classStudents)
      .where(db.own(classStudents, eq(classStudents.classId, a.classId)));
    if (!members.length) continue;

    // Narrowed assignments must only penalize the students they were actually assigned to —
    // without this an assignment scoped to 3 kids would drop the whole class's plants.
    const narrow = (await narrowMap(db, [a.id])).get(a.id);

    const charged = await db.raw
      .select({ studentId: gardenEvents.studentId })
      .from(gardenEvents)
      .where(
        db.own(gardenEvents, eq(gardenEvents.type, 'deadline_drop'), eq(gardenEvents.refId, a.id)),
      );
    const done = new Set(charged.map((c) => c.studentId));

    const counts = await countQualifying(
      db,
      a.topicId,
      members.map((m) => m.studentId),
      a.minScorePct,
      a.createdAt,
      deadlineEndUtc(a.deadline, a.deadlineTime),
      parseModes(a.modes),
    );

    for (const m of members) {
      if (!appliesTo(narrow, m.studentId)) continue;
      if (done.has(m.studentId)) continue;
      if ((counts.get(m.studentId) ?? 0) >= a.requiredCount) continue;
      const plant = await getPlant(db, m.studentId);
      const t = applyDeadlineCheck(plant?.state ?? null, settings, nowIso, a.id);
      if (!t) continue;
      if (!persist) {
        out.penalties.push({ studentId: m.studentId, assignmentId: a.id, topicName: a.topicName });
        continue;
      }
      try {
        await writeTransition(db, m.studentId, t, nowIso);
        out.penalties.push({ studentId: m.studentId, assignmentId: a.id, topicName: a.topicName });
      } catch (err) {
        if (!String(err).includes('UNIQUE')) throw err;
      }
    }
  }

  // 2. Persist overdue decay, and note who to tell. Only plants that have gone quiet long enough
  // to matter are touched.
  const stale = await db.raw
    .select()
    .from(gardenPlants)
    .where(
      db.own(
        gardenPlants,
        eq(gardenPlants.isDead, false),
        lt(gardenPlants.lastCareDay, addDaysVn(vnToday, -settings.wiltAfterDays + 1)),
      ),
    );

  const tomorrow = addDaysVn(vnToday, 1);
  for (const row of stale) {
    const state = rowToState(row);
    const t = settlePlant(state, settings, vnToday);
    if (persist && t.events.length) {
      try {
        await writeTransition(db, row.studentId, t, nowIso);
      } catch (err) {
        if (!String(err).includes('UNIQUE')) throw err;
      }
    }
    // Derived from the UNSETTLED state either way, so the reported wilt/drop days are the same
    // whether or not the decay above was persisted.
    const view = plantView(state, settings, vnToday);
    if (view.wiltStartDate === vnToday) {
      out.wiltingToday.push({ studentId: row.studentId, nextDropDate: view.nextDropDate });
    }
    if (view.nextDropDate === tomorrow) {
      out.droppingTomorrow.push({ studentId: row.studentId, nextDropDate: tomorrow });
    }
  }

  // 3. Month rollover. Checked every day rather than only on the 1st, so a cron that missed the
  // rollover heals itself the next morning. Nothing to forecast: an album is not a notification.
  out.snapshotsWritten = persist ? await snapshotMonth(db, previousMonth(vnToday)) : 0;

  return out;
}

/** Streak for one student, for the widget header. Exported for the JSON API. */
export function streakOf(state: PlantState | null, vnToday: string): number {
  return state ? effectiveStreak(state, vnToday) : 0;
}

/** Title for a fruit count. Re-exported so routes need only this module. */
export { titleForFruit };
