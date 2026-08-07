import { and, asc, desc, eq, gte, inArray, lt, like, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import {
  classStudents,
  classTrees,
  classes,
  flashcardResults,
  flashcardTopics,
  gardenEvents,
  gardenPlants,
  gardenSnapshots,
  settings,
  staff,
  students,
  vocabAssignments,
} from '../db/schema';
import type { Db } from '../db/index';
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
  growthThresholdPct,
  isQualifying,
  monthOfVn,
  plantView,
  settlePlant,
  titleForFruit,
  type GardenEventDraft,
  type GardenSettings,
  type GardenSnapshotData,
  type GardenSnapshotMember,
  type HarvestError,
  type PlantState,
  type PlantTransition,
  type PlantView,
} from '../../shared/logic/garden';
import { composeUtcFromIct, ictDateOf } from '../../shared/logic/tests';

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
export async function getGardenSettings(db: Db): Promise<GardenSettings> {
  const rows = await db.select().from(settings).where(eq(settings.key, SETTINGS_KEY));
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
  db: Db,
  input: GardenSettingsInput,
): Promise<GardenSettings> {
  const value = JSON.stringify(input);
  await db
    .insert(settings)
    .values({ key: SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
  return input;
}

// ---- Row <-> state ----

type PlantRow = typeof gardenPlants.$inferSelect;

export interface PlantRecord {
  state: PlantState;
  plantName: string | null;
  potColor: string;
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

export async function getPlant(db: Db, studentId: string): Promise<PlantRecord | null> {
  const rows = await db.select().from(gardenPlants).where(eq(gardenPlants.studentId, studentId));
  const row = rows[0];
  if (!row) return null;
  return {
    state: rowToState(row),
    plantName: row.plantName,
    potColor: row.potColor,
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
  db: Db,
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
  db: Db,
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
  topicId: string;
  topicName: string;
  topicSlug: string | null;
  requiredCount: number;
  minScorePct: number;
  deadline: string;
  note: string | null;
  createdAt: string;
};

export async function listAssignments(
  db: Db,
  opts: { classId?: string; activeFrom?: string } = {},
): Promise<VocabAssignmentRow[]> {
  const where = [
    opts.classId ? eq(vocabAssignments.classId, opts.classId) : undefined,
    opts.activeFrom ? gte(vocabAssignments.deadline, opts.activeFrom) : undefined,
  ].filter(Boolean);
  return db
    .select({
      id: vocabAssignments.id,
      classId: vocabAssignments.classId,
      className: classes.name,
      topicId: vocabAssignments.topicId,
      topicName: flashcardTopics.name,
      topicSlug: flashcardTopics.slug,
      requiredCount: vocabAssignments.requiredCount,
      minScorePct: vocabAssignments.minScorePct,
      deadline: vocabAssignments.deadline,
      note: vocabAssignments.note,
      createdAt: vocabAssignments.createdAt,
    })
    .from(vocabAssignments)
    .innerJoin(classes, eq(classes.id, vocabAssignments.classId))
    .innerJoin(flashcardTopics, eq(flashcardTopics.id, vocabAssignments.topicId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(vocabAssignments.deadline), asc(flashcardTopics.name));
}

/** One assignment with its topic and class names, or null. */
export async function getAssignment(db: Db, id: string): Promise<VocabAssignmentRow | null> {
  const rows = await db
    .select({
      id: vocabAssignments.id,
      classId: vocabAssignments.classId,
      className: classes.name,
      topicId: vocabAssignments.topicId,
      topicName: flashcardTopics.name,
      topicSlug: flashcardTopics.slug,
      requiredCount: vocabAssignments.requiredCount,
      minScorePct: vocabAssignments.minScorePct,
      deadline: vocabAssignments.deadline,
      note: vocabAssignments.note,
      createdAt: vocabAssignments.createdAt,
    })
    .from(vocabAssignments)
    .innerJoin(classes, eq(classes.id, vocabAssignments.classId))
    .innerJoin(flashcardTopics, eq(flashcardTopics.id, vocabAssignments.topicId))
    .where(eq(vocabAssignments.id, id));
  return rows[0] ?? null;
}

export async function createAssignment(
  db: Db,
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
    deadline: input.deadline,
    note: input.note ?? null,
    createdAt: new Date().toISOString(),
  });
  return id;
}

export async function updateAssignment(
  db: Db,
  id: string,
  patch: Partial<VocabAssignmentInput>,
): Promise<void> {
  const set: Partial<typeof vocabAssignments.$inferInsert> = {};
  if (patch.classId !== undefined) set.classId = patch.classId;
  if (patch.topicId !== undefined) set.topicId = patch.topicId;
  if (patch.requiredCount !== undefined) set.requiredCount = patch.requiredCount;
  if (patch.minScorePct !== undefined) set.minScorePct = patch.minScorePct;
  if (patch.deadline !== undefined) set.deadline = patch.deadline;
  if (patch.note !== undefined) set.note = patch.note ?? null;
  if (Object.keys(set).length) {
    await db.update(vocabAssignments).set(set).where(eq(vocabAssignments.id, id));
  }
}

export async function deleteAssignment(db: Db, id: string): Promise<void> {
  await db.delete(vocabAssignments).where(eq(vocabAssignments.id, id));
}

/** The last instant an ICT deadline day still counts, as a UTC ISO bound to compare `playedAt` to. */
function deadlineEndUtc(deadline: string): string {
  return composeUtcFromIct(addDaysVn(deadline, 1), '00:00');
}

/**
 * How many qualifying rounds each member has banked against one assignment.
 *
 * Counted from `flashcard_results` rather than stored, so raising or lowering the bar re-reads
 * honestly instead of leaving a stale tally behind. Rounds played before the assignment existed do
 * not count — the teacher asked for work, not for history.
 */
export async function assignmentProgress(
  db: Db,
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

  const members = await db
    .select({ id: students.id, name: students.name, color: students.color })
    .from(classStudents)
    .innerJoin(students, eq(students.id, classStudents.studentId))
    .where(eq(classStudents.classId, assignment.classId))
    .orderBy(asc(students.name));

  const counts = await countQualifying(
    db,
    assignment.topicId,
    members.map((m) => m.id),
    assignment.minScorePct,
    assignment.createdAt,
    deadlineEndUtc(assignment.deadline),
  );

  return {
    assignment,
    rows: members.map((m) => ({
      studentId: m.id,
      name: m.name,
      color: m.color,
      done: counts.get(m.id) ?? 0,
    })),
  };
}

/** Qualifying-round counts per student for one topic inside a time window. */
async function countQualifying(
  db: Db,
  topicId: string,
  studentIds: string[],
  minScorePct: number,
  fromIso: string,
  toIso: string,
): Promise<Map<string, number>> {
  if (studentIds.length === 0) return new Map();
  const rows = await db
    .select({
      studentId: flashcardResults.studentId,
      n: sql<number>`count(*)`,
    })
    .from(flashcardResults)
    .where(
      and(
        eq(flashcardResults.topicId, topicId),
        inArray(flashcardResults.studentId, studentIds),
        gte(flashcardResults.playedAt, fromIso),
        lt(flashcardResults.playedAt, toIso),
        sql`${flashcardResults.score} * 100 >= ${minScorePct} * ${flashcardResults.total}`,
      ),
    )
    .groupBy(flashcardResults.studentId);
  const out = new Map<string, number>();
  for (const r of rows) if (r.studentId) out.set(r.studentId, Number(r.n));
  return out;
}

/** Assignments covering `topicId` for the classes this student is in, still inside their deadline. */
export async function activeAssignmentsFor(
  db: Db,
  studentId: string,
  topicId: string,
  vnToday: string,
): Promise<{ id: string; minScorePct: number; requiredCount: number; deadline: string }[]> {
  return db
    .select({
      id: vocabAssignments.id,
      minScorePct: vocabAssignments.minScorePct,
      requiredCount: vocabAssignments.requiredCount,
      deadline: vocabAssignments.deadline,
    })
    .from(vocabAssignments)
    .innerJoin(classStudents, eq(classStudents.classId, vocabAssignments.classId))
    .where(
      and(
        eq(classStudents.studentId, studentId),
        eq(vocabAssignments.topicId, topicId),
        gte(vocabAssignments.deadline, vnToday),
      ),
    );
}

/** Every open assignment for a student, with their progress — the chips on /vocabulary. */
export async function studentAssignments(
  db: Db,
  studentId: string,
  vnToday: string,
): Promise<
  {
    id: string;
    topicId: string;
    topicName: string;
    topicSlug: string | null;
    className: string;
    deadline: string;
    requiredCount: number;
    minScorePct: number;
    done: number;
  }[]
> {
  const open = await db
    .select({
      id: vocabAssignments.id,
      topicId: vocabAssignments.topicId,
      topicName: flashcardTopics.name,
      topicSlug: flashcardTopics.slug,
      className: classes.name,
      deadline: vocabAssignments.deadline,
      requiredCount: vocabAssignments.requiredCount,
      minScorePct: vocabAssignments.minScorePct,
      createdAt: vocabAssignments.createdAt,
    })
    .from(vocabAssignments)
    .innerJoin(classStudents, eq(classStudents.classId, vocabAssignments.classId))
    .innerJoin(flashcardTopics, eq(flashcardTopics.id, vocabAssignments.topicId))
    .innerJoin(classes, eq(classes.id, vocabAssignments.classId))
    .where(and(eq(classStudents.studentId, studentId), gte(vocabAssignments.deadline, vnToday)))
    .orderBy(asc(vocabAssignments.deadline));

  const out = [];
  for (const a of open) {
    const counts = await countQualifying(
      db,
      a.topicId,
      [studentId],
      a.minScorePct,
      a.createdAt,
      deadlineEndUtc(a.deadline),
    );
    const { createdAt: _unused, ...rest } = a;
    out.push({ ...rest, done: counts.get(studentId) ?? 0 });
  }
  return out;
}

// ---- The play hook ----

export interface GardenOutcome {
  qualified: boolean;
  /** The plant gained a stage (false when the daily cap was already spent). */
  grew: boolean;
  stage: number;
  harvestReady: boolean;
  streak: number;
  /** The bar this round had to clear, so the end screen can explain a near miss. */
  thresholdPct: number;
}

/**
 * A student finished a round: grow the plant if it qualified, and credit their classes' trees.
 *
 * Called from `recordResult` AFTER the result row is safely written, deliberately in its own batch.
 * Sharing the result's batch would mean a garden hiccup could roll back the score itself; keeping
 * them apart costs nothing in correctness because `resultId` is the idempotency key — a retry
 * writes the same event or none at all.
 */
export async function onStudentResult(
  db: Db,
  studentId: string,
  input: { topicId: string; score: number; total: number },
  resultId: string,
  nowIso: string,
): Promise<GardenOutcome> {
  const vnToday = ictDateOf(nowIso);
  const settings = await getGardenSettings(db);
  const assignments = await activeAssignmentsFor(db, studentId, input.topicId, vnToday);
  const thresholdPct = growthThresholdPct(
    assignments.map((a) => a.minScorePct),
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
  const memberClasses = await db
    .select({ classId: classStudents.classId })
    .from(classStudents)
    .where(eq(classStudents.studentId, studentId));

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
  db: Db,
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

/** Rename the plant / repaint the pot. Only meaningful once a plant exists. */
export async function updatePlant(
  db: Db,
  studentId: string,
  patch: PlantPatchInput,
): Promise<void> {
  const set: Partial<typeof gardenPlants.$inferInsert> = {};
  if (patch.plantName !== undefined) set.plantName = patch.plantName ?? null;
  if (patch.potColor !== undefined) set.potColor = patch.potColor;
  if (!Object.keys(set).length) return;
  set.updatedAt = new Date().toISOString();
  await db.update(gardenPlants).set(set).where(eq(gardenPlants.studentId, studentId));
}

export async function water(
  db: Db,
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
  db: Db,
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
export async function devResetPlant(db: Db, studentId: string): Promise<void> {
  // The events go too. Keeping them would leave a history whose first row starts mid-air, and the
  // point of the reset is a student who has never planted anything.
  await db.batch([
    db.delete(gardenEvents).where(eq(gardenEvents.studentId, studentId)),
    db.delete(gardenPlants).where(eq(gardenPlants.studentId, studentId)),
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
  db: Db,
  studentId: string,
  limit = 20,
): Promise<GardenEventRow[]> {
  return db
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
    .where(eq(gardenEvents.studentId, studentId))
    .orderBy(desc(gardenEvents.createdAt))
    .limit(limit);
}

// ---- Views ----

export interface GardenMember extends PlantView {
  studentId: string;
  name: string;
  color: string;
  plantName: string | null;
  potColor: string;
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
  db: Db,
  studentIds: string[],
  month: string,
): Promise<Map<string, number>> {
  if (studentIds.length === 0) return new Map();
  const rows = await db
    .select({ studentId: gardenEvents.studentId, n: sql<number>`count(*)` })
    .from(gardenEvents)
    .where(
      and(
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
  db: Db,
  classId: string,
  vnToday: string,
  settings?: GardenSettings,
): Promise<ClassGarden | null> {
  const cls = (await db.select().from(classes).where(eq(classes.id, classId)))[0];
  if (!cls) return null;
  const cfg = settings ?? (await getGardenSettings(db));

  const rows = await db
    .select({
      studentId: students.id,
      name: students.name,
      color: students.color,
      plant: gardenPlants,
    })
    .from(classStudents)
    .innerJoin(students, eq(students.id, classStudents.studentId))
    .leftJoin(gardenPlants, eq(gardenPlants.studentId, students.id))
    .where(eq(classStudents.classId, classId))
    .orderBy(asc(students.name));

  const fruit = await monthFruit(
    db,
    rows.map((r) => r.studentId),
    monthOfVn(vnToday),
  );
  const treeRow = (await db.select().from(classTrees).where(eq(classTrees.classId, classId)))[0];
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
      fruitMonth: fruit.get(r.studentId) ?? 0,
      ...plantView(r.plant ? rowToState(r.plant) : null, cfg, vnToday),
    })),
    tree: { points, level: classTreeLevel(points) },
  };
}

/** The classes a student belongs to, for routing them to their own garden. */
export async function studentClasses(
  db: Db,
  studentId: string,
): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: classes.id, name: classes.name })
    .from(classStudents)
    .innerJoin(classes, eq(classes.id, classStudents.classId))
    .where(eq(classStudents.studentId, studentId))
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
export async function snapshotMonth(db: Db, month: string, classId?: string): Promise<number> {
  const asOf = lastDayOfMonth(month);
  const settings = await getGardenSettings(db);
  const targets = classId
    ? await db.select({ id: classes.id }).from(classes).where(eq(classes.id, classId))
    : await db.select({ id: classes.id }).from(classes);

  const existing = await db
    .select({ classId: gardenSnapshots.classId })
    .from(gardenSnapshots)
    .where(eq(gardenSnapshots.month, month));
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
  db: Db,
  classId: string,
): Promise<{ month: string; createdAt: string }[]> {
  return db
    .select({ month: gardenSnapshots.month, createdAt: gardenSnapshots.createdAt })
    .from(gardenSnapshots)
    .where(eq(gardenSnapshots.classId, classId))
    .orderBy(desc(gardenSnapshots.month));
}

export async function getSnapshot(
  db: Db,
  classId: string,
  month: string,
): Promise<{ className: string; month: string; data: GardenSnapshotData } | null> {
  const row = (
    await db
      .select()
      .from(gardenSnapshots)
      .where(and(eq(gardenSnapshots.classId, classId), eq(gardenSnapshots.month, month)))
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
export async function runGardenSweep(db: Db, nowIso: string): Promise<SweepResult> {
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
  const overdue = await db
    .select({
      id: vocabAssignments.id,
      classId: vocabAssignments.classId,
      topicId: vocabAssignments.topicId,
      topicName: flashcardTopics.name,
      requiredCount: vocabAssignments.requiredCount,
      minScorePct: vocabAssignments.minScorePct,
      deadline: vocabAssignments.deadline,
      createdAt: vocabAssignments.createdAt,
    })
    .from(vocabAssignments)
    .innerJoin(flashcardTopics, eq(flashcardTopics.id, vocabAssignments.topicId))
    .where(
      and(
        lt(vocabAssignments.deadline, vnToday),
        gte(vocabAssignments.deadline, addDaysVn(vnToday, -35)),
      ),
    );

  for (const a of overdue) {
    const members = await db
      .select({ studentId: classStudents.studentId })
      .from(classStudents)
      .where(eq(classStudents.classId, a.classId));
    if (!members.length) continue;

    const charged = await db
      .select({ studentId: gardenEvents.studentId })
      .from(gardenEvents)
      .where(and(eq(gardenEvents.type, 'deadline_drop'), eq(gardenEvents.refId, a.id)));
    const done = new Set(charged.map((c) => c.studentId));

    const counts = await countQualifying(
      db,
      a.topicId,
      members.map((m) => m.studentId),
      a.minScorePct,
      a.createdAt,
      deadlineEndUtc(a.deadline),
    );

    for (const m of members) {
      if (done.has(m.studentId)) continue;
      if ((counts.get(m.studentId) ?? 0) >= a.requiredCount) continue;
      const plant = await getPlant(db, m.studentId);
      const t = applyDeadlineCheck(plant?.state ?? null, settings, nowIso, a.id);
      if (!t) continue;
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
  const stale = await db
    .select()
    .from(gardenPlants)
    .where(
      and(
        eq(gardenPlants.isDead, false),
        lt(gardenPlants.lastCareDay, addDaysVn(vnToday, -settings.wiltAfterDays + 1)),
      ),
    );

  const tomorrow = addDaysVn(vnToday, 1);
  for (const row of stale) {
    const state = rowToState(row);
    const t = settlePlant(state, settings, vnToday);
    if (t.events.length) {
      try {
        await writeTransition(db, row.studentId, t, nowIso);
      } catch (err) {
        if (!String(err).includes('UNIQUE')) throw err;
      }
    }
    const view = plantView(state, settings, vnToday);
    if (view.wiltStartDate === vnToday) {
      out.wiltingToday.push({ studentId: row.studentId, nextDropDate: view.nextDropDate });
    }
    if (view.nextDropDate === tomorrow) {
      out.droppingTomorrow.push({ studentId: row.studentId, nextDropDate: tomorrow });
    }
  }

  // 3. Month rollover. Checked every day rather than only on the 1st, so a cron that missed the
  // rollover heals itself the next morning.
  out.snapshotsWritten = await snapshotMonth(db, previousMonth(vnToday));

  return out;
}

/** Streak for one student, for the widget header. Exported for the JSON API. */
export function streakOf(state: PlantState | null, vnToday: string): number {
  return state ? effectiveStreak(state, vnToday) : 0;
}

/** Title for a fruit count. Re-exported so routes need only this module. */
export { titleForFruit };
