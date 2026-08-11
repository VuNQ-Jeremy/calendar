/**
 * Ôn tập (spaced repetition) — when a studied word comes back, as pure functions.
 *
 * Every word a student has ever answered carries two numbers: which rung of the interval ladder it
 * sits on, and the ICT day it next falls due. Answer it correctly on or after that day and it climbs
 * a rung, so the gaps stretch 3 → 5 → 7 → 14 → 30 days; get it wrong and it drops a rung and comes
 * back sooner. The ladder itself is admin-tunable (`review-settings`), which is why every function
 * here takes `intervals` rather than reading a constant.
 *
 * THE RULE THAT HOLDS THIS TOGETHER, borrowed from the garden: due-ness is DERIVED, never stored as
 * a flag and never swept. `isDue` compares `dueDay` to today in ICT, so a word falls due at ICT
 * midnight for every reader simultaneously — the badge, the "Ôn tập hôm nay" card and the review
 * round cannot disagree, and there is no cron to fall behind. The only writer is a finished round.
 *
 * No React, no Drizzle, no `new Date()` / `Date.now()` — the caller supplies today, so the whole
 * module is testable and reusable by the mobile app. Days are bare ICT `YYYY-MM-DD` strings.
 */

import { addDaysVn } from './garden';

// ---- Settings ----

export interface ReviewSettings {
  /** Days to wait per rung, ascending. Index = `level`. */
  intervals: number[];
}

/**
 * How many rungs a ladder may have. The admin builds the ladder row by row, so the length is data,
 * not a constant — `level` indexes into whatever the admin saved, and every transition clamps.
 *
 * The floor is 1 because a ladder with no rungs has nothing to schedule from; the ceiling is a
 * sanity bound on a form field, not a pedagogical claim.
 */
export const REVIEW_LADDER_BOUNDS: readonly [number, number] = [1, 12];

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = { intervals: [3, 5, 7, 14, 30] };

/**
 * Guard rails for the admin form; also what `getReviewSettings` validates a stored blob against.
 *
 * The floor is 0, not 1, and deliberately so: a 0-day first rung means "due again today", which is
 * the only way to exercise a whole review cycle in a test — or to demo the feature — without
 * waiting three real days.
 */
export const REVIEW_INTERVAL_BOUNDS: readonly [number, number] = [0, 365];

/** Is this a ladder we are willing to schedule the whole school on? */
export function isValidLadder(intervals: unknown): intervals is number[] {
  if (!Array.isArray(intervals)) return false;
  const [minRungs, maxRungs] = REVIEW_LADDER_BOUNDS;
  if (intervals.length < minRungs || intervals.length > maxRungs) return false;
  const [min, max] = REVIEW_INTERVAL_BOUNDS;
  for (let i = 0; i < intervals.length; i++) {
    const n = intervals[i];
    if (!Number.isInteger(n) || n < min || n > max) return false;
    // Non-decreasing: a ladder that shortens as you climb would send mastered words back sooner
    // than new ones, which is the opposite of the whole idea.
    if (i > 0 && n < intervals[i - 1]) return false;
  }
  return true;
}

// ---- State ----

/** The review half of a `flashcard_mastery` row. */
export interface ReviewState {
  /** Rung index. Clamped to the ladder by every transition. */
  level: number;
  /** ICT day it next falls due, or null when the word is not in the cycle. */
  dueDay: string | null;
}

/** Clamp a stored level to the current ladder — an admin shortening the ladder must not orphan rows. */
function clampLevel(level: number, intervals: number[]): number {
  if (!Number.isInteger(level) || level < 0) return 0;
  return Math.min(level, intervals.length - 1);
}

function scheduleFrom(todayVn: string, level: number, intervals: number[]): ReviewState {
  const rung = clampLevel(level, intervals);
  return { level: rung, dueDay: addDaysVn(todayVn, intervals[rung]) };
}

// ---- Due-ness ----

/**
 * Has this word come round again? Lexical compare, which is what `YYYY-MM-DD` is for.
 *
 * A null `dueDay` is never due: rows written before the review migration are backfilled, so in
 * practice this only guards a word that has somehow escaped scheduling — better silently absent
 * from the review deck than crashing the vocabulary page.
 */
export function isDue(
  state: { dueDay: string | null } | null | undefined,
  todayVn: string,
): boolean {
  return !!state?.dueDay && state.dueDay <= todayVn;
}

/**
 * One answered card, and the whole scheduling policy:
 *
 * - **First ever answer** (no row yet), right or wrong: the word joins the cycle at the bottom rung,
 *   due in `intervals[0]` days. Getting it right first time is not evidence it will still be there
 *   in a week — that is what the first review is for.
 * - **Correct, and due**: climb one rung, capped at the top, and reschedule from today. At the cap
 *   the word keeps returning at the longest interval rather than graduating out; a word nobody ever
 *   sees again is a word that quietly rots.
 * - **Correct, but not yet due**: nothing changes. Practising early is free — it must neither
 *   fast-forward the ladder (the interval is the test, and it hasn't elapsed) nor push the due date
 *   back (a student who re-plays a topic daily would never see a review again).
 * - **Wrong, at any time**: drop one rung, floored at the bottom, and reschedule from today. Even
 *   an early miss is real evidence, so it counts.
 *
 * A missed review needs no rule: its `dueDay` is simply in the past and stays there until answered,
 * so the backlog waits rather than resetting.
 */
export function applyAnswer(
  state: ReviewState | null | undefined,
  correct: boolean,
  intervals: number[],
  todayVn: string,
): ReviewState {
  if (!state || !state.dueDay) return scheduleFrom(todayVn, 0, intervals);
  const level = clampLevel(state.level, intervals);
  if (!correct) return scheduleFrom(todayVn, level - 1, intervals);
  if (!isDue(state, todayVn)) return { level, dueDay: state.dueDay };
  return scheduleFrom(todayVn, level + 1, intervals);
}

/**
 * Fold a finished round's answers onto the prior state of each word.
 *
 * Sequential per word rather than last-answer-wins: no current game mode asks the same word twice
 * in one round, but a mode that did would have to count both answers, and folding is the reading
 * that stays right either way.
 */
export function foldAnswers(
  answers: readonly { wordId: string; correct: boolean }[],
  prior: ReadonlyMap<string, ReviewState>,
  intervals: number[],
  todayVn: string,
): Map<string, ReviewState> {
  const next = new Map<string, ReviewState>();
  for (const a of answers) {
    const current = next.get(a.wordId) ?? prior.get(a.wordId) ?? null;
    next.set(a.wordId, applyAnswer(current, a.correct, intervals, todayVn));
  }
  return next;
}

// ---- Presentation ----

export interface DueGroup<T> {
  topicId: string;
  words: T[];
}

/**
 * Group today's due words by topic, biggest backlog first.
 *
 * Topic-grouped because that is how the student plays: a review round is a normal flashcard game
 * over one topic's due words, not a mixed deck. Ties break on topic id so the card does not
 * reshuffle itself between renders.
 */
export function groupDueByTopic<T extends { topicId: string; dueDay: string | null }>(
  rows: readonly T[],
  todayVn: string,
): DueGroup<T>[] {
  const byTopic = new Map<string, T[]>();
  for (const row of rows) {
    if (!isDue(row, todayVn)) continue;
    const bucket = byTopic.get(row.topicId);
    if (bucket) bucket.push(row);
    else byTopic.set(row.topicId, [row]);
  }
  return [...byTopic.entries()]
    .map(([topicId, words]) => ({ topicId, words }))
    .sort((a, b) => b.words.length - a.words.length || a.topicId.localeCompare(b.topicId));
}
