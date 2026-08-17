/**
 * Batches of ten words — how a deck of a hundred gets handed out as homework a few at a time.
 *
 * Pure data and pure functions, shared verbatim by the web app and the Expo app, in the same spirit
 * as `shared/logic/review.ts`. Nothing here touches a database, React, or storage.
 *
 * THE MODEL, in one paragraph. Every word carries a 1-based `sortOrder` inside its deck
 * (migration 0048), assigned by the INSERT and never rewritten. A *batch* is the fixed window
 * 1-10, 11-20, … over that value — not over rank. So deleting word 5 leaves batch 1 holding nine
 * words, and batch 2 still means words 11-20. That is the whole point: an assignment already given
 * to a class must never silently come to mean a different set of words, and a rank-based scheme
 * would pull word 11 into batch 1 the moment word 5 was deleted, with no error to see. A short
 * batch is visible in the picker; a shifted one is not.
 *
 * An assignment stores its coverage as a canonical CSV of ranges — `'1-10,21-30'` — where NULL or
 * `''` means the whole deck. That is exactly what every assignment written before 0048 means, so
 * there was nothing to backfill. Ranges are always unions of whole windows, which is what lets a
 * teacher's "70 words left to assign" be computed from a grouped per-batch count (~45 rows for a
 * deck) rather than a per-word list.
 */

/** Words per batch. Ten is the teacher-facing unit: the picker never offers a finer slice. */
export const BATCH_SIZE = 10;

/** An inclusive, 1-based range over `flashcardWords.sortOrder`. */
export interface IndexRange {
  from: number;
  to: number;
}

/** A batch as the assign dialog offers it. */
export interface DeckBatch extends IndexRange {
  /** 1-based window number: batch 1 is words 1-10. */
  n: number;
  /** Words still living in the window — ten, or fewer once words have been deleted from it. */
  wordCount: number;
  /** Some word in the window already belongs to another assignment for this class and deck. */
  assigned: boolean;
}

/** Is `n` the start of a batch window? `1, 11, 21 …` */
const isWindowStart = (n: number): boolean => n >= 1 && n % BATCH_SIZE === 1;
/** Is `n` the end of a batch window? `10, 20, 30 …` */
const isWindowEnd = (n: number): boolean => n >= BATCH_SIZE && n % BATCH_SIZE === 0;

/** The 1-based window number containing `sortOrder`. */
export function windowOf(sortOrder: number): number {
  return Math.floor((sortOrder - 1) / BATCH_SIZE) + 1;
}

/** The range covered by window `n`. */
export function windowRange(n: number): IndexRange {
  return { from: (n - 1) * BATCH_SIZE + 1, to: n * BATCH_SIZE };
}

/**
 * `'1-10,21-30'` -> ranges. `null` / `''` -> `null`, meaning the whole deck.
 *
 * Tolerant on the way in — an unparseable or backwards token is dropped rather than thrown — because
 * this also reads rows written by older clients. `isValidRangesCsv` is the strict gate that stops
 * such a value being *stored* in the first place.
 */
export function parseRanges(csv: string | null | undefined): IndexRange[] | null {
  if (!csv) return null;
  const out: IndexRange[] = [];
  for (const tok of csv.split(',')) {
    const t = tok.trim();
    if (!t) continue;
    const m = /^(\d+)-(\d+)$/.exec(t);
    if (!m) continue;
    const from = Number(m[1]);
    const to = Number(m[2]);
    if (from < 1 || to < from) continue;
    out.push({ from, to });
  }
  return out.length ? merge(out) : null;
}

/** Sort, then fuse ranges that overlap or merely touch, so `1-10,11-20` stores as `1-20`. */
function merge(ranges: IndexRange[]): IndexRange[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from || a.to - b.to);
  const out: IndexRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    // `from <= last.to + 1` fuses touching windows as well as overlapping ones.
    if (last && r.from <= last.to + 1) last.to = Math.max(last.to, r.to);
    else out.push({ ...r });
  }
  return out;
}

/** The write-side twin of `parseRanges`: canonical CSV, or null when nothing valid remains. */
export function normalizeRangesCsv(csv: string): string | null {
  const ranges = parseRanges(csv);
  return ranges ? ranges.map(rangeLabel).join(',') : null;
}

/**
 * Input validation. Every non-empty token must be `n-m` with `m >= n`, aligned to a batch window on
 * both ends. `''` is valid and means the whole deck.
 *
 * The alignment check is not cosmetic: every count the teacher sees is computed per batch, so a
 * stored `'3-12'` would straddle two windows and make "70 left to assign" quietly wrong. Rejecting
 * it is better than silently snapping it to a window the teacher did not pick.
 */
export function isValidRangesCsv(csv: string): boolean {
  return csv.split(',').every((tok) => {
    const t = tok.trim();
    if (!t) return true;
    const m = /^(\d+)-(\d+)$/.exec(t);
    if (!m) return false;
    const from = Number(m[1]);
    const to = Number(m[2]);
    return to >= from && isWindowStart(from) && isWindowEnd(to);
  });
}

/** `'1-10'` — a plain ASCII hyphen, so an e2e locator and a Vietnamese string can both spell it. */
export function rangeLabel(r: IndexRange): string {
  return `${r.from}-${r.to}`;
}

/**
 * Every batch of a deck, given each window's live word count (index 0 = words 1-10, as
 * `deckBatchCounts` returns it) and the coverage of the *other* assignments for this class and deck.
 *
 * Windows with no live words are omitted — a window emptied by deletions is not a thing to assign.
 * A trailing partial window IS offered, alone, labelled with its real count: refusing it would make
 * the last two words of a deck permanently unassignable, and "minimum ten" is about granularity, not
 * about refusing a short tail.
 */
export function deckBatches(
  counts: readonly number[],
  otherCsvs: (string | null | undefined)[],
): DeckBatch[] {
  const covered = coveredWindows(otherCsvs, counts.length);
  const out: DeckBatch[] = [];
  for (let i = 0; i < counts.length; i++) {
    const wordCount = counts[i] ?? 0;
    if (wordCount === 0) continue;
    const n = i + 1;
    out.push({ n, ...windowRange(n), wordCount, assigned: covered.has(n) });
  }
  return out;
}

/**
 * The union of coverage across several assignments, as window numbers.
 *
 * A `null` member is a whole-deck assignment and therefore expands to *every* window — which is why
 * a class with one legacy whole-deck assignment correctly shows nothing left to assign. That is
 * truthful rather than convenient: everything was assigned.
 */
export function coveredWindows(
  csvs: (string | null | undefined)[],
  windowCount: number,
): Set<number> {
  const out = new Set<number>();
  const all = () => {
    for (let n = 1; n <= windowCount; n++) out.add(n);
  };
  for (const csv of csvs) {
    const ranges = parseRanges(csv);
    if (ranges === null) {
      all();
      return out;
    }
    for (const r of ranges) {
      for (let n = windowOf(r.from); n <= windowOf(r.to); n++) {
        if (n >= 1 && n <= windowCount) out.add(n);
      }
    }
  }
  return out;
}

/** Does this assignment's coverage include the word at `sortOrder`? Null CSV = whole deck = yes. */
export function rangeCovers(csv: string | null | undefined, sortOrder: number): boolean {
  const ranges = parseRanges(csv);
  if (ranges === null) return true;
  return ranges.some((r) => sortOrder >= r.from && sortOrder <= r.to);
}

/** How many live words a coverage CSV actually accounts for, given per-window counts. */
export function coveredWordCount(
  csv: string | null | undefined,
  counts: readonly number[],
): number {
  let total = 0;
  for (const n of coveredWindows([csv], counts.length)) total += counts[n - 1] ?? 0;
  return total;
}

/** One assignment plus the per-student round tally the caller already computed. */
export interface LearntBlock {
  classId: string;
  topicId: string;
  batches: string | null | undefined;
  requiredCount: number;
  rows: { studentId: string; done: number }[];
}

export interface DeckLearnt {
  totalWords: number;
  /** Union of coverage across every assignment for this class and deck — "100 minus 70 left". */
  assignedWords: number;
  /** Per student: words covered by the assignments they have COMPLETED. */
  perStudent: Record<string, number>;
}

/**
 * "30 learnt · 70 left to assign", folded from data the caller already has on the wire.
 *
 * A word is *learnt* by a student when some assignment covering it is one they COMPLETED — the
 * existing rule, `done >= requiredCount`. Deliberately not intersected with `flashcardMastery`: a
 * ten-question round over a twenty-word batch leaves half the batch with no mastery row, so a
 * student who did exactly what was asked would show 10/20 and the number could never reach what was
 * assigned. A teacher stops believing a number like that within a week. Words the student has
 * actually answered are a different fact and get their own, separately labelled surface.
 *
 * Keyed `${classId}:${topicId}`.
 */
export function foldDeckLearnt(
  blocks: readonly LearntBlock[],
  batchCounts: Record<string, number[]>,
): Record<string, DeckLearnt> {
  const assignedSets = new Map<string, Set<number>>();
  const learntSets = new Map<string, Set<number>>();
  const out: Record<string, DeckLearnt> = {};

  for (const b of blocks) {
    const counts = batchCounts[b.topicId] ?? [];
    const key = `${b.classId}:${b.topicId}`;
    out[key] ??= {
      totalWords: counts.reduce((a, c) => a + c, 0),
      assignedWords: 0,
      perStudent: {},
    };

    const windows = coveredWindows([b.batches], counts.length);
    const assigned = assignedSets.get(key) ?? new Set<number>();
    assignedSets.set(key, assigned);
    for (const n of windows) assigned.add(n);

    for (const r of b.rows) {
      if (r.done < b.requiredCount) continue; // the completion rule, unchanged
      const lk = `${key} ${r.studentId}`;
      const learnt = learntSets.get(lk) ?? new Set<number>();
      learntSets.set(lk, learnt);
      for (const n of windows) learnt.add(n);
    }
  }

  // Size every window set through the live counts, so a batch that has lost words counts what is
  // left rather than a notional ten.
  const size = (topicId: string, windows: Set<number>): number => {
    const counts = batchCounts[topicId] ?? [];
    let total = 0;
    for (const n of windows) total += counts[n - 1] ?? 0;
    return total;
  };
  for (const [key, windows] of assignedSets) {
    out[key].assignedWords = size(key.split(':')[1], windows);
  }
  for (const [lk, windows] of learntSets) {
    const [key, studentId] = lk.split(' ');
    out[key].perStudent[studentId] = size(key.split(':')[1], windows);
  }
  return out;
}
