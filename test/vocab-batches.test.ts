import { describe, expect, it } from 'vitest';
import {
  BATCH_SIZE,
  coveredWindows,
  coveredWordCount,
  deckBatches,
  foldDeckLearnt,
  isValidRangesCsv,
  normalizeRangesCsv,
  parseRanges,
  rangeCovers,
  rangeLabel,
  windowOf,
  windowRange,
} from '../shared/logic/vocab-batches';

/** A deck with `n` full windows plus an optional short tail, as `deckBatchCounts` returns it. */
const counts = (...windows: number[]) => windows;

describe('windows', () => {
  it('uses ten as the batch size', () => {
    expect(BATCH_SIZE).toBe(10);
  });

  it('maps a word index to its window', () => {
    expect([1, 10, 11, 20, 21, 82].map(windowOf)).toEqual([1, 1, 2, 2, 3, 9]);
  });

  it('maps a window back to its range', () => {
    expect(windowRange(1)).toEqual({ from: 1, to: 10 });
    expect(windowRange(3)).toEqual({ from: 21, to: 30 });
  });
});

describe('parseRanges', () => {
  it('reads a canonical CSV', () => {
    expect(parseRanges('1-10,21-30')).toEqual([
      { from: 1, to: 10 },
      { from: 21, to: 30 },
    ]);
  });

  it('treats null and empty as the whole deck', () => {
    expect(parseRanges(null)).toBeNull();
    expect(parseRanges('')).toBeNull();
    expect(parseRanges(undefined)).toBeNull();
  });

  it('sorts and fuses touching ranges', () => {
    expect(parseRanges('11-20,1-10')).toEqual([{ from: 1, to: 20 }]);
  });

  it('fuses overlapping ranges', () => {
    expect(parseRanges('1-20,11-30')).toEqual([{ from: 1, to: 30 }]);
  });

  it('leaves a genuine gap alone', () => {
    expect(parseRanges('1-10,31-40')).toEqual([
      { from: 1, to: 10 },
      { from: 31, to: 40 },
    ]);
  });

  it('drops junk rather than throwing, since it also reads rows written by older clients', () => {
    expect(parseRanges('1-10,nonsense,20-11,0-10')).toEqual([{ from: 1, to: 10 }]);
    expect(parseRanges('nonsense')).toBeNull();
  });
});

describe('normalizeRangesCsv', () => {
  it('round-trips a canonical value unchanged', () => {
    expect(normalizeRangesCsv('1-10,21-30')).toBe('1-10,21-30');
  });

  it('canonicalises order and merges', () => {
    expect(normalizeRangesCsv('11-20,1-10')).toBe('1-20');
  });

  it('returns null when nothing survives, which the schema stores as the whole deck', () => {
    expect(normalizeRangesCsv('')).toBeNull();
    expect(normalizeRangesCsv('garbage')).toBeNull();
  });
});

describe('isValidRangesCsv', () => {
  it('accepts window-aligned ranges and the empty string', () => {
    expect(isValidRangesCsv('1-10')).toBe(true);
    expect(isValidRangesCsv('1-10,21-30')).toBe(true);
    expect(isValidRangesCsv('1-20')).toBe(true);
    expect(isValidRangesCsv('')).toBe(true);
  });

  it('rejects a range that straddles window boundaries', () => {
    // '3-12' would make every per-batch count wrong, so it is a 400 rather than a silent snap.
    expect(isValidRangesCsv('3-12')).toBe(false);
    expect(isValidRangesCsv('1-15')).toBe(false);
    expect(isValidRangesCsv('5-10')).toBe(false);
  });

  it('rejects malformed and backwards tokens', () => {
    expect(isValidRangesCsv('abc')).toBe(false);
    expect(isValidRangesCsv('20-11')).toBe(false);
    expect(isValidRangesCsv('0-10')).toBe(false);
  });
});

describe('deckBatches', () => {
  it('offers one batch per window with its live word count', () => {
    const b = deckBatches(counts(10, 10, 10), []);
    expect(b.map((x) => [rangeLabel(x), x.wordCount, x.assigned])).toEqual([
      ['1-10', 10, false],
      ['11-20', 10, false],
      ['21-30', 10, false],
    ]);
  });

  it('offers a short tail alone, labelled with its real count', () => {
    // 82 words: eight full windows and a tail of two. Refusing the tail would make the last two
    // words of the deck permanently unassignable.
    const b = deckBatches(counts(10, 10, 10, 10, 10, 10, 10, 10, 2), []);
    expect(b).toHaveLength(9);
    expect(b[8]).toMatchObject({ n: 9, from: 81, to: 90, wordCount: 2 });
  });

  it('shows a window that lost a word as short, and does not shift the others', () => {
    // Word 5 deleted: batch 1 holds nine words, batch 2 still means words 11-20.
    const b = deckBatches(counts(9, 10), []);
    expect(b[0]).toMatchObject({ from: 1, to: 10, wordCount: 9 });
    expect(b[1]).toMatchObject({ from: 11, to: 20, wordCount: 10 });
  });

  it('omits a window emptied by deletions, since there is nothing there to assign', () => {
    const b = deckBatches(counts(10, 0, 10), []);
    expect(b.map((x) => x.n)).toEqual([1, 3]);
  });

  it('flags the windows another assignment already covers', () => {
    const b = deckBatches(counts(10, 10, 10), ['1-10,21-30']);
    expect(b.map((x) => x.assigned)).toEqual([true, false, true]);
  });

  it('flags every window when a legacy whole-deck assignment exists', () => {
    const b = deckBatches(counts(10, 10, 10), [null]);
    expect(b.every((x) => x.assigned)).toBe(true);
  });
});

describe('coveredWindows', () => {
  it('unions coverage across assignments', () => {
    expect([...coveredWindows(['1-10', '21-30'], 3)].sort()).toEqual([1, 3]);
  });

  it('expands a null member to every window', () => {
    expect([...coveredWindows(['1-10', null], 3)].sort()).toEqual([1, 2, 3]);
  });

  it('ignores windows beyond the deck', () => {
    expect([...coveredWindows(['91-100'], 3)]).toEqual([]);
  });
});

describe('rangeCovers', () => {
  it('includes a word inside a covered range', () => {
    expect(rangeCovers('11-20', 15)).toBe(true);
  });

  it('excludes a word outside every range', () => {
    expect(rangeCovers('11-20', 21)).toBe(false);
  });

  it('treats a null CSV as the whole deck', () => {
    expect(rangeCovers(null, 999)).toBe(true);
  });
});

describe('coveredWordCount', () => {
  it('counts live words, not notional tens', () => {
    // Batch 1 has lost a word; the count must say nine.
    expect(coveredWordCount('1-10', counts(9, 10))).toBe(9);
    expect(coveredWordCount('1-20', counts(9, 10))).toBe(19);
  });

  it('counts the whole deck for a null CSV', () => {
    expect(coveredWordCount(null, counts(10, 10, 2))).toBe(22);
  });
});

describe('foldDeckLearnt', () => {
  const deck = { t1: counts(10, 10, 10, 10, 10, 10, 10, 10, 2) }; // 82 words

  it('reports what is assigned and what each student has learnt', () => {
    const out = foldDeckLearnt(
      [
        {
          classId: 'c1',
          topicId: 't1',
          batches: '1-10',
          requiredCount: 2,
          rows: [
            { studentId: 's1', done: 2 }, // completed
            { studentId: 's2', done: 1 }, // not yet
          ],
        },
      ],
      deck,
    );
    expect(out['c1:t1']).toMatchObject({ totalWords: 82, assignedWords: 10 });
    expect(out['c1:t1'].perStudent).toEqual({ s1: 10 });
  });

  it('counts only the assignments a student actually completed', () => {
    const out = foldDeckLearnt(
      [
        {
          classId: 'c1',
          topicId: 't1',
          batches: '1-10',
          requiredCount: 1,
          rows: [{ studentId: 's1', done: 1 }],
        },
        {
          classId: 'c1',
          topicId: 't1',
          batches: '11-20',
          requiredCount: 1,
          rows: [{ studentId: 's1', done: 0 }],
        },
      ],
      deck,
    );
    expect(out['c1:t1'].assignedWords).toBe(20); // both were assigned
    expect(out['c1:t1'].perStudent.s1).toBe(10); // only one was finished
  });

  it('does not double-count a word two assignments both cover', () => {
    const out = foldDeckLearnt(
      [
        {
          classId: 'c1',
          topicId: 't1',
          batches: '1-10',
          requiredCount: 1,
          rows: [{ studentId: 's1', done: 1 }],
        },
        {
          classId: 'c1',
          topicId: 't1',
          batches: '1-10',
          requiredCount: 1,
          rows: [{ studentId: 's1', done: 1 }],
        },
      ],
      deck,
    );
    expect(out['c1:t1'].assignedWords).toBe(10);
    expect(out['c1:t1'].perStudent.s1).toBe(10);
  });

  it('treats a legacy whole-deck assignment as covering everything', () => {
    const out = foldDeckLearnt(
      [
        {
          classId: 'c1',
          topicId: 't1',
          batches: null,
          requiredCount: 1,
          rows: [{ studentId: 's1', done: 1 }],
        },
      ],
      deck,
    );
    expect(out['c1:t1'].assignedWords).toBe(82);
    expect(out['c1:t1'].perStudent.s1).toBe(82);
  });

  it('counts a short tail batch as its live size', () => {
    const out = foldDeckLearnt(
      [
        {
          classId: 'c1',
          topicId: 't1',
          batches: '81-90',
          requiredCount: 1,
          rows: [{ studentId: 's1', done: 1 }],
        },
      ],
      deck,
    );
    expect(out['c1:t1'].perStudent.s1).toBe(2);
  });

  it('keeps classes separate', () => {
    const out = foldDeckLearnt(
      [
        { classId: 'c1', topicId: 't1', batches: '1-10', requiredCount: 1, rows: [] },
        { classId: 'c2', topicId: 't1', batches: '11-30', requiredCount: 1, rows: [] },
      ],
      deck,
    );
    expect(out['c1:t1'].assignedWords).toBe(10);
    expect(out['c2:t1'].assignedWords).toBe(20);
  });
});
