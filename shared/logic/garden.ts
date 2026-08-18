/**
 * Vườn cây từ vựng (vocabulary garden) — the plant lifecycle, as pure functions.
 *
 * One plant per student, school-wide. It grows one stage per qualifying vocabulary round, wilts
 * when the student stops studying, drops a stage for every further stretch of neglect, and dies if
 * abandoned. At the fruit stage the student harvests, banking a fruit forever and starting a fresh
 * seed.
 *
 * THE RULE THAT HOLDS THIS TOGETHER: time only ever passes inside `settlePlant`, which is
 * deterministic in `(state, settings, vnToday)` and idempotent — `settle(settle(r, d1), d2)`
 * equals `settle(r, d2)` for `d1 <= d2`. Every reader (the student's own widget, the class garden,
 * the month-end snapshot, the notification sweep) settles IN MEMORY and never writes; every writer
 * settles first, then applies its action, then persists. That is why a stage drop takes effect at
 * ICT midnight for everyone simultaneously whether or not the daily cron has run, and why a
 * notification can never announce a plant the student isn't already looking at.
 *
 * No React, no Drizzle, no `new Date()` / `Date.now()` — the caller supplies the instant, so the
 * whole module is testable and reusable by the mobile app. Days are bare ICT `YYYY-MM-DD` strings
 * (see `ictDateOf`); instants are UTC ISO.
 */

import { ictDateOf } from './tests';

// ---- Stages ----

/** Fruit. The top of the ladder; harvesting resets to `SEED_STAGE`. */
export const MAX_STAGE = 5;
/** What a new (or revived, or just-harvested) plant starts at. */
export const SEED_STAGE = 1;

/**
 * 0 empty soil / dead pot, 1 hạt mầm, 2 nảy mầm, 3 cây non, 4 nở hoa (purple), 5 ra quả.
 *
 * Stage 0 means one of two things, and the two are distinguished by whether a row exists at all:
 * no row is an empty pot nobody has planted in; a row at stage 0 (`isDead`) is a plant that died.
 */
export type PlantStage = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * `dev` is an admin test adjustment, not part of the game: it appears in a plant's history so the
 * log never claims a student earned something an admin dialled in.
 */
export type GardenEventType =
  'grow' | 'revive' | 'harvest' | 'wilt' | 'decay_drop' | 'die' | 'deadline_drop' | 'water' | 'dev';

// ---- Settings ----

export interface GardenSettings {
  /** Score % a round must reach to count. Teacher assignments may set a lower bar of their own. */
  freeMinScorePct: number;
  /** N — ICT days of no qualifying play before the plant looks wilted. */
  wiltAfterDays: number;
  /** M — further ICT days per stage drop, repeating, once wilted. */
  dropAfterDays: number;
  /** Stages a student can gain from playing in one ICT day. Watering is exempt. */
  dailyGrowthCap: number;
}

export const DEFAULT_GARDEN_SETTINGS: GardenSettings = {
  freeMinScorePct: 70,
  wiltAfterDays: 3,
  dropAfterDays: 7,
  dailyGrowthCap: 2,
};

/** Guard rails for the admin form; also what `getGardenSettings` validates a stored blob against. */
export const GARDEN_SETTINGS_BOUNDS = {
  freeMinScorePct: [0, 100],
  wiltAfterDays: [1, 30],
  dropAfterDays: [1, 60],
  dailyGrowthCap: [1, 5],
} as const;

// ---- State ----

/** The `garden_plants` row, camelCase. */
export interface PlantState {
  stage: number;
  isDead: boolean;
  wiltedSince: string | null;
  lastCareDay: string;
  growDay: string | null;
  growCount: number;
  /**
   * Stages already lost to neglect since the last care event. The decay fence: what has been
   * taken is recorded rather than re-derived, so settling twice costs nothing and an admin
   * lengthening the wilt intervals cannot retroactively charge a plant twice for the same week.
   */
  dropsTaken: number;
  fruitsTotal: number;
  streakDays: number;
  streakLastDay: string | null;
}

/** One row to append to `garden_events`. The service stamps id/createdAt. */
export interface GardenEventDraft {
  type: GardenEventType;
  stageBefore: number;
  stageAfter: number;
  vnDay: string;
  refId?: string | null;
  actorStaffId?: string | null;
  note?: string | null;
}

export interface PlantTransition {
  state: PlantState;
  events: GardenEventDraft[];
}

/** What the UI renders: the settled plant plus the derived bits nothing needs to store. */
export interface PlantView {
  stage: PlantStage;
  /** Looks wilted — either from neglect, or from a missed assignment deadline. */
  wilted: boolean;
  dead: boolean;
  /** 0 when the run has lapsed, so a stale `streakDays` never shows. */
  streak: number;
  fruitsTotal: number;
  /** ICT days since the last care event. */
  daysIdle: number;
  /** ICT day the current wilt began, or null when healthy. */
  wiltStartDate: string | null;
  /** ICT day the next stage drop falls due, or null when dead. Drives the warning and the push. */
  nextDropDate: string | null;
  /** True at `MAX_STAGE`: the "Thu hoạch" button is live. */
  harvestReady: boolean;
  /** Stages still available today under the daily cap. */
  growthLeftToday: number;
  titleId: FruitTitleId | null;
}

/**
 * What one finished round did to the plant — the end screen's whole story.
 *
 * Lives here rather than beside `onStudentResult` in `server/services/garden.ts` because both
 * clients render it: the web reads it off its route action, and the mobile app off the batch
 * results reply. The server re-exports it so its own import graph is unchanged.
 */
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

// ---- ICT day arithmetic ----
//
// Bare 'YYYY-MM-DD' strings, compared lexically and stepped through UTC epoch days. Deliberately
// NOT the local-time helpers in ./dates — those read the device clock, and a plant must not grow
// a day faster on a phone set to Sydney.

function dayToUtcMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** ICT day + n days. */
export function addDaysVn(day: string, n: number): string {
  return new Date(dayToUtcMs(day) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetweenVn(from: string, to: string): number {
  return Math.round((dayToUtcMs(to) - dayToUtcMs(from)) / 86_400_000);
}

/** 'YYYY-MM-DD' -> 'YYYY-MM'. */
export function monthOfVn(day: string): string {
  return day.slice(0, 7);
}

// ---- Qualifying ----

/** Integer-safe score percentage. `flashcard_results.score`/`total` are both integers. */
export function scorePct(score: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((score * 100) / total);
}

/** Does this round count? Integer comparison, so 8/10 exactly meets a 80% bar. */
export function isQualifying(score: number, total: number, thresholdPct: number): boolean {
  if (total <= 0) return false;
  return score * 100 >= thresholdPct * total;
}

/**
 * The bar a round must clear to GROW the plant: the most forgiving of the free-study default and
 * any assignment covering this topic.
 *
 * Taking the minimum, not the assignment's own bar, is deliberate. A teacher who assigns a topic at
 * 90% is raising the bar for *finishing the assignment*, and it would be perverse if that also made
 * the assigned topic the hardest way to water your own plant. Assignment completion is counted
 * separately, against `minScorePct`.
 */
export function growthThresholdPct(assignmentMins: number[], settings: GardenSettings): number {
  return assignmentMins.reduce((lo, m) => Math.min(lo, m), settings.freeMinScorePct);
}

// ---- Titles ----

export type FruitTitleId = 'gardener5' | 'gardener10' | 'gardener25';

/** Fruit milestones. Shown beside the student's name in the class garden. */
export const FRUIT_TITLES: { id: FruitTitleId; at: number }[] = [
  { id: 'gardener25', at: 25 },
  { id: 'gardener10', at: 10 },
  { id: 'gardener5', at: 5 },
];

export function titleForFruit(fruitsTotal: number): FruitTitleId | null {
  return FRUIT_TITLES.find((t) => fruitsTotal >= t.at)?.id ?? null;
}

// ---- Month rollup ----

/** Event types that cost the plant a stage — the "stages lost" line on the monthly report. */
const SETBACK_TYPES = new Set(['decay_drop', 'deadline_drop', 'die']);

/** The month's activity, folded out of `garden_events`. No plant state, no dates. */
export interface GardenMonthTally {
  /** Qualifying rounds played — every `grow` event, capped ones included. */
  playDays: number;
  /** Distinct ICT days with a qualifying round. The habit number, not the volume one. */
  activeDays: number;
  /** Stages actually gained (a capped play contributes 0). */
  stagesGained: number;
  fruits: number;
  /** Stages lost to neglect or a missed deadline. */
  setbacks: number;
}

export function emptyMonthTally(): GardenMonthTally {
  return { playDays: 0, activeDays: 0, stagesGained: 0, fruits: 0, setbacks: 0 };
}

/**
 * Fold one student's month of garden events into the numbers the monthly report shows.
 *
 * Counted from events, never from the plant row: the row only knows today's stage, while a report
 * may describe a month that ended weeks ago. Because a `grow` row exists for EVERY qualifying play
 * — with `stageAfter === stageBefore` when the daily cap was already spent — `playDays` and
 * `stagesGained` can honestly differ, which is what makes "practised 14 rounds, grew 9 stages"
 * tellable instead of implied.
 *
 * Pure, and caller-filtered: it folds exactly the events it is handed, so the month scope lives in
 * the query. Events outside the month would be counted as if they were inside it.
 */
export function tallyGardenMonth(
  events: { type: string; stageBefore: number; stageAfter: number; vnDay: string }[],
): GardenMonthTally {
  const out = emptyMonthTally();
  const days = new Set<string>();
  for (const e of events) {
    if (e.type === 'grow') {
      out.playDays += 1;
      days.add(e.vnDay);
      out.stagesGained += Math.max(0, e.stageAfter - e.stageBefore);
    } else if (e.type === 'harvest') {
      out.fruits += 1;
    } else if (SETBACK_TYPES.has(e.type)) {
      out.setbacks += Math.max(0, e.stageBefore - e.stageAfter);
    }
  }
  out.activeDays = days.size;
  return out;
}

// ---- Class tree ----

/**
 * Cumulative qualifying plays by the whole class for each level; index = level, so level 0 needs
 * nothing and the last entry is the top. Steps widen (20, 30, 50, 70, …): a class of a dozen
 * students studying most days sees the first few levels within a month, then roughly one a month.
 */
export const CLASS_TREE_THRESHOLDS = [0, 20, 50, 100, 170, 260, 380, 530, 710, 920, 1160];
export const MAX_CLASS_TREE_LEVEL = CLASS_TREE_THRESHOLDS.length - 1;

export function classTreeLevel(points: number): number {
  let level = 0;
  for (let i = 1; i < CLASS_TREE_THRESHOLDS.length; i++) {
    if (points >= CLASS_TREE_THRESHOLDS[i]) level = i;
  }
  return level;
}

/** Points needed for the next level, or null at the top. */
export function classTreeNext(points: number): number | null {
  const next = classTreeLevel(points) + 1;
  return next > MAX_CLASS_TREE_LEVEL ? null : CLASS_TREE_THRESHOLDS[next];
}

// ---- Construction ----

/** A fresh plant, mid-transition: the caller emits the event that planted it. */
export function newSeedState(vnToday: string, from?: Partial<PlantState>): PlantState {
  return {
    stage: SEED_STAGE,
    isDead: false,
    wiltedSince: null,
    lastCareDay: vnToday,
    growDay: vnToday,
    growCount: 0,
    dropsTaken: 0,
    fruitsTotal: 0,
    streakDays: 0,
    streakLastDay: null,
    ...from,
  };
}

function clone(s: PlantState): PlantState {
  return { ...s };
}

// ---- Time: the one place it passes ----

/**
 * How many stages neglect has cost in total by `day` — including drops already taken. The k-th
 * drop falls due `wiltAfterDays + k * dropAfterDays` after the last care event.
 */
function dropsDueThrough(state: PlantState, settings: GardenSettings, day: string): number {
  const past = daysBetweenVn(state.lastCareDay, day) - settings.wiltAfterDays;
  if (past < 0) return 0;
  return Math.floor(past / settings.dropAfterDays);
}

/** The ICT day the k-th drop since the last care event falls due. */
function dropDueDay(state: PlantState, settings: GardenSettings, k: number): string {
  return addDaysVn(state.lastCareDay, settings.wiltAfterDays + k * settings.dropAfterDays);
}

/**
 * Apply elapsed time: mark the wilt, then take one stage for every `dropAfterDays` of continued
 * neglect, then die.
 *
 * Idempotent and composable — `dropsTaken` records what has already been charged, so settling
 * twice, or settling in steps, produces the same state and the same events. Recording the count
 * rather than a "settled through" date is what keeps an admin lengthening the intervals from
 * charging a plant a second time for a week it has already paid for.
 *
 * Never increases the stage, and never touches fruit, streak or the daily growth counter.
 */
export function settlePlant(
  state: PlantState,
  settings: GardenSettings,
  vnToday: string,
): PlantTransition {
  const events: GardenEventDraft[] = [];
  // A dead plant has hit the floor; it does not rot further.
  if (state.isDead) return { state, events };

  const next = clone(state);

  // Wilt onset is a fixed day, not "the day we noticed".
  const wiltDay = addDaysVn(next.lastCareDay, settings.wiltAfterDays);
  if (vnToday >= wiltDay && next.wiltedSince === null) {
    next.wiltedSince = wiltDay;
    events.push({
      type: 'wilt',
      stageBefore: next.stage,
      stageAfter: next.stage,
      vnDay: wiltDay,
    });
  }

  const dueNow = dropsDueThrough(state, settings, vnToday);
  for (let k = state.dropsTaken + 1; k <= dueNow; k++) {
    const dueDay = dropDueDay(state, settings, k);
    const before = next.stage;
    next.dropsTaken = k;
    if (before > SEED_STAGE) {
      next.stage = before - 1;
      events.push({
        type: 'decay_drop',
        stageBefore: before,
        stageAfter: next.stage,
        vnDay: dueDay,
        refId: dueDay,
      });
    } else {
      next.stage = 0;
      next.isDead = true;
      events.push({
        type: 'die',
        stageBefore: before,
        stageAfter: 0,
        vnDay: dueDay,
        refId: dueDay,
      });
      break;
    }
  }

  return { state: next, events };
}

/**
 * The settled plant plus everything the UI and the notification sweep derive rather than store.
 * A student who has never played has no row: pass `null` and get the empty pot.
 */
export function plantView(
  state: PlantState | null,
  settings: GardenSettings,
  vnToday: string,
): PlantView {
  if (!state) {
    return {
      stage: 0,
      wilted: false,
      dead: false,
      streak: 0,
      fruitsTotal: 0,
      daysIdle: 0,
      wiltStartDate: null,
      nextDropDate: null,
      harvestReady: false,
      growthLeftToday: settings.dailyGrowthCap,
      titleId: null,
    };
  }

  const s = settlePlant(state, settings, vnToday).state;
  const growsToday = s.growDay === vnToday ? s.growCount : 0;

  return {
    stage: Math.max(0, Math.min(MAX_STAGE, s.stage)) as PlantStage,
    wilted: !s.isDead && s.wiltedSince !== null,
    dead: s.isDead,
    streak: effectiveStreak(s, vnToday),
    fruitsTotal: s.fruitsTotal,
    daysIdle: daysBetweenVn(s.lastCareDay, vnToday),
    wiltStartDate: s.isDead ? null : s.wiltedSince,
    nextDropDate: s.isDead ? null : dropDueDay(s, settings, s.dropsTaken + 1),
    harvestReady: !s.isDead && s.stage >= MAX_STAGE,
    growthLeftToday: Math.max(0, settings.dailyGrowthCap - growsToday),
    titleId: titleForFruit(s.fruitsTotal),
  };
}

// ---- Streak ----

/**
 * The streak to show. `streakDays` is stored as of `streakLastDay` and never expired by a write,
 * so that a read can stay a read; the lapse is derived here instead.
 */
export function effectiveStreak(state: PlantState, vnToday: string): number {
  const last = state.streakLastDay;
  if (!last) return 0;
  if (last === vnToday || last === addDaysVn(vnToday, -1)) return state.streakDays;
  return 0;
}

/**
 * Every form of care — a qualifying play, a harvest, a teacher's watering — resets the same three
 * things together: the wilt, the day the decay clock counts from, and the drops charged since.
 * They are set in one place because letting them drift apart is how a cared-for plant would keep
 * decaying (or stop decaying forever).
 */
function markCared(state: PlantState, vnToday: string): void {
  state.wiltedSince = null;
  state.lastCareDay = vnToday;
  state.dropsTaken = 0;
}

function bumpStreak(state: PlantState, vnToday: string): void {
  if (state.streakLastDay === vnToday) return;
  state.streakDays = state.streakLastDay === addDaysVn(vnToday, -1) ? state.streakDays + 1 : 1;
  state.streakLastDay = vnToday;
}

// ---- Transitions ----

/**
 * A qualifying round was played.
 *
 * Order matters and is fixed: elapsed time resolves FIRST (so a student returning after three
 * weeks sees the wilt and the drops that really happened), then the play revives and grows. A play
 * that lands over the daily cap, or on a plant already at fruit, still counts as care — it clears
 * the wilt, extends the streak and feeds the class tree — it just doesn't add a stage.
 *
 * `state` is null for a student who has never played: their first round plants the seed.
 */
export function applyQualifyingPlay(
  state: PlantState | null,
  settings: GardenSettings,
  nowUtcIso: string,
  resultId: string,
): PlantTransition {
  const vnToday = ictDateOf(nowUtcIso);

  if (!state) {
    const next = newSeedState(vnToday, { growCount: 1, streakDays: 1, streakLastDay: vnToday });
    return {
      state: next,
      events: [
        { type: 'grow', stageBefore: 0, stageAfter: SEED_STAGE, vnDay: vnToday, refId: resultId },
      ],
    };
  }

  const settled = settlePlant(state, settings, vnToday);
  const next = clone(settled.state);
  const events = [...settled.events];

  if (next.isDead) {
    // Withered pot: the round plants a new seed rather than resuming the old plant.
    events.push({
      type: 'revive',
      stageBefore: 0,
      stageAfter: SEED_STAGE,
      vnDay: vnToday,
      refId: resultId,
    });
    next.stage = SEED_STAGE;
    next.isDead = false;
    next.growDay = vnToday;
    next.growCount = 1;
  } else {
    if (next.growDay !== vnToday) {
      next.growDay = vnToday;
      next.growCount = 0;
    }
    const before = next.stage;
    const canGrow = next.growCount < settings.dailyGrowthCap && before < MAX_STAGE;
    if (canGrow) {
      next.stage = before + 1;
      next.growCount += 1;
    }
    events.push({
      type: 'grow',
      stageBefore: before,
      stageAfter: next.stage,
      vnDay: vnToday,
      refId: resultId,
    });
  }

  markCared(next, vnToday);
  bumpStreak(next, vnToday);
  return { state: next, events };
}

export type HarvestError = 'not_ripe' | 'dead';

/**
 * Bank a fruit and start again from seed.
 *
 * Ripeness is judged AFTER settling, so a fruit left to rot past a drop is genuinely no longer
 * harvestable — which is also what the student's screen shows, because it settles too. The fruit
 * ordinal doubles as the event's idempotency key, so a double tap can only ever bank one.
 */
export function applyHarvest(
  state: PlantState | null,
  settings: GardenSettings,
  nowUtcIso: string,
): PlantTransition | { error: HarvestError } {
  const vnToday = ictDateOf(nowUtcIso);
  if (!state) return { error: 'not_ripe' };

  const settled = settlePlant(state, settings, vnToday);
  const next = clone(settled.state);
  if (next.isDead) return { error: 'dead' };
  if (next.stage < MAX_STAGE) return { error: 'not_ripe' };

  const events = [...settled.events];
  next.fruitsTotal += 1;
  events.push({
    type: 'harvest',
    stageBefore: next.stage,
    stageAfter: SEED_STAGE,
    vnDay: vnToday,
    refId: String(next.fruitsTotal),
  });
  next.stage = SEED_STAGE;
  // Harvesting is care: the new seed starts its wilt clock today rather than inheriting the old
  // plant's. The growth counter is untouched — resetting to seed is not growth.
  markCared(next, vnToday);
  return { state: next, events };
}

/**
 * A teacher's reward. One stage, wilt cleared, daily cap ignored, and a dead plant replanted.
 *
 * There is no per-day limit: the `actorStaffId` on the event is the accountability, and a
 * teacher handing out plants they didn't earn is a conversation, not a validation error. At fruit
 * it clamps rather than auto-harvesting — the harvest tap belongs to the student.
 *
 * Deliberately does NOT touch the streak, which counts the student's own study days.
 */
export function applyWatering(
  state: PlantState | null,
  settings: GardenSettings,
  nowUtcIso: string,
  staffId: string,
  note?: string | null,
): PlantTransition {
  const vnToday = ictDateOf(nowUtcIso);

  if (!state) {
    return {
      state: newSeedState(vnToday),
      events: [
        {
          type: 'water',
          stageBefore: 0,
          stageAfter: SEED_STAGE,
          vnDay: vnToday,
          actorStaffId: staffId,
          note: note ?? null,
        },
      ],
    };
  }

  const settled = settlePlant(state, settings, vnToday);
  const next = clone(settled.state);
  const events = [...settled.events];

  const before = next.isDead ? 0 : next.stage;
  if (next.isDead) {
    next.stage = SEED_STAGE;
    next.isDead = false;
  } else if (next.stage < MAX_STAGE) {
    next.stage = next.stage + 1;
  }
  markCared(next, vnToday);
  events.push({
    type: 'water',
    stageBefore: before,
    stageAfter: next.stage,
    vnDay: vnToday,
    actorStaffId: staffId,
    note: note ?? null,
  });
  return { state: next, events };
}

/**
 * An assignment deadline passed with the work unfinished.
 *
 * Costs one stage and shows the wilt, but never kills — death is reserved for prolonged neglect,
 * and a missed exercise shouldn't be able to wipe out a plant. `lastCareDay` is untouched, so the
 * inactivity clock keeps its own schedule and the two penalties stay independent.
 *
 * The caller dedupes on `(studentId, 'deadline_drop', assignmentId)`, so this can be re-run for
 * every sweep without stacking.
 */
export function applyDeadlineCheck(
  state: PlantState | null,
  settings: GardenSettings,
  nowUtcIso: string,
  assignmentId: string,
): PlantTransition | null {
  const vnToday = ictDateOf(nowUtcIso);
  // An empty pot has nothing to lose, and neither has a dead plant.
  if (!state) return null;

  const settled = settlePlant(state, settings, vnToday);
  const next = clone(settled.state);
  if (next.isDead) return null;

  const events = [...settled.events];
  const before = next.stage;
  next.stage = Math.max(SEED_STAGE, before - 1);
  if (next.wiltedSince === null) next.wiltedSince = vnToday;
  events.push({
    type: 'deadline_drop',
    stageBefore: before,
    stageAfter: next.stage,
    vnDay: vnToday,
    refId: assignmentId,
  });
  return { state: next, events };
}

// ---- Snapshot payload ----

export interface GardenSnapshotMember {
  studentId: string;
  name: string;
  color: string;
  plantName: string | null;
  potColor: string;
  /**
   * Species id — see shared/garden-art.ts. Optional because albums frozen before species existed
   * have no such key, and those plants were the classic drawing: read it as `?? 'classic'`.
   */
  species?: string;
  stage: PlantStage;
  wilted: boolean;
  dead: boolean;
  streak: number;
  fruitMonth: number;
  fruitTotal: number;
  titleId: FruitTitleId | null;
}

export interface GardenSnapshotData {
  members: GardenSnapshotMember[];
  classTree: { level: number; points: number };
}
