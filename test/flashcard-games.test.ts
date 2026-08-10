import { describe, it, expect } from 'vitest';
import {
  ALL_MODES,
  MIN_WORDS,
  SPELL_ROUND_SIZE,
  buildPictureQuestions,
  checkTyped,
  decoyLetters,
  imageOf,
  isValidModesCsv,
  letterSlots,
  maskWord,
  modeAllowed,
  normalizeModesCsv,
  parseModes,
  pickRound,
  scrambleLetters,
  typeEligible,
  wordsWithImages,
} from '../shared/logic/flashcards.js';

describe('letterSlots', () => {
  it('marks separators as fixed and letters as playable', () => {
    expect(letterSlots('ice cream')).toEqual([
      { ch: 'i', letter: true },
      { ch: 'c', letter: true },
      { ch: 'e', letter: true },
      { ch: ' ', letter: false },
      { ch: 'c', letter: true },
      { ch: 'r', letter: true },
      { ch: 'e', letter: true },
      { ch: 'a', letter: true },
      { ch: 'm', letter: true },
    ]);
    expect(letterSlots("don't").map((s) => s.letter)).toEqual([true, true, true, false, true]);
    expect(letterSlots('well-known').filter((s) => !s.letter)).toEqual([
      { ch: '-', letter: false },
    ]);
  });
});

describe('scrambleLetters', () => {
  it('keeps exactly the word\'s letters, dropping separators', () => {
    const tiles = scrambleLetters('ice cream');
    expect([...tiles].sort().join('')).toBe('acceeimr');
  });

  it('never returns the identity order when another order exists', () => {
    for (let i = 0; i < 200; i++) {
      expect(scrambleLetters('apple').join('')).not.toBe('apple');
      expect(scrambleLetters('at').join('')).not.toBe('at');
    }
  });

  it('tolerates identity when only one order exists', () => {
    expect(scrambleLetters('oo')).toEqual(['o', 'o']);
    expect(scrambleLetters('a')).toEqual(['a']);
    expect(scrambleLetters('')).toEqual([]);
  });
});

describe('maskWord', () => {
  it('hides ceil(40%) of the letters, at least one, never all (len >= 2)', () => {
    for (const [word, letters] of [
      ['at', 2],
      ['cat', 3],
      ['dictionary', 10],
    ] as const) {
      const slots = maskWord(word);
      const hidden = slots.filter((s) => s.hidden).length;
      const expected = Math.min(Math.max(1, Math.ceil(letters * 0.4)), letters - 1);
      expect(hidden).toBe(expected);
      expect(slots.filter((s) => !s.hidden).length).toBeGreaterThan(0);
    }
  });

  it('fully hides a one-letter word', () => {
    expect(maskWord('a')).toEqual([{ ch: 'a', hidden: true }]);
  });

  it('never hides a separator', () => {
    for (let i = 0; i < 50; i++) {
      const space = maskWord('ice cream').find((s) => s.ch === ' ');
      expect(space?.hidden).toBe(false);
      const dash = maskWord('well-known').find((s) => s.ch === '-');
      expect(dash?.hidden).toBe(false);
    }
  });

  it('reassembles to the original word', () => {
    expect(
      maskWord('vocabulary')
        .map((s) => s.ch)
        .join(''),
    ).toBe('vocabulary');
  });

  it('leaves a word with no letters untouched', () => {
    expect(maskWord('--')).toEqual([
      { ch: '-', hidden: false },
      { ch: '-', hidden: false },
    ]);
  });
});

describe('decoyLetters', () => {
  it('returns n lowercase letters', () => {
    const out = decoyLetters(2);
    expect(out).toHaveLength(2);
    for (const ch of out) expect(ch).toMatch(/^[a-z]$/);
  });
});

describe('checkTyped', () => {
  it('forgives case, whitespace and diacritics — the school rules', () => {
    expect(checkTyped('  Apple ', 'apple')).toBe(true);
    expect(checkTyped('cafe', 'café')).toBe(true);
    expect(checkTyped('do   an', 'do an')).toBe(true);
    expect(checkTyped('đa', 'da')).toBe(true);
  });

  it('rejects a different word', () => {
    expect(checkTyped('appel', 'apple')).toBe(false);
    expect(checkTyped('', 'apple')).toBe(false);
  });
});

describe('typeEligible', () => {
  it('skips words whose hint would be the answer itself', () => {
    // meaningOf falls back to the word when both meaning fields are blank.
    expect(typeEligible({ word: 'apple', meaningVi: '', definitionEn: null })).toBe(false);
    expect(typeEligible({ word: 'apple', meaningVi: 'Apple', definitionEn: null })).toBe(false);
    expect(typeEligible({ word: 'apple', meaningVi: 'quả táo', definitionEn: null })).toBe(true);
  });
});

describe('pickRound', () => {
  it('caps at the round size and returns everything when the deck is small', () => {
    const items = Array.from({ length: 30 }, (_, i) => i);
    expect(pickRound(items)).toHaveLength(SPELL_ROUND_SIZE);
    expect(pickRound([1, 2, 3])).toHaveLength(3);
  });
});

describe('imageOf / wordsWithImages', () => {
  it('builds the serving URL through flashcardImagePath, absolute when a base is given', () => {
    // The route re-adds the `flashcards/` prefix, so only the filename travels in the path.
    const w = { imageKey: 'flashcards/abc.webp' };
    expect(imageOf(w)).toBe('/flashcard-images/abc.webp');
    expect(imageOf(w, 'https://x.test')).toBe('https://x.test/flashcard-images/abc.webp');
  });

  it('reads rows without the column as imageless', () => {
    expect(imageOf({})).toBeNull();
    expect(imageOf({ imageKey: null })).toBeNull();
    expect(wordsWithImages([{ imageKey: 'flashcards/a.jpg' }, {}, { imageKey: null }])).toHaveLength(
      1,
    );
  });
});

describe('buildPictureQuestions', () => {
  const words = [
    { id: '1', word: 'cat', imageKey: 'flashcards/cat.jpg' },
    { id: '2', word: 'dog', imageKey: 'flashcards/dog.jpg' },
    { id: '3', word: 'fish', imageKey: null },
    { id: '4', word: 'bird' },
    { id: '5', word: 'cat' }, // duplicate word string, no image
  ];

  it('asks only words with images, drawing distractors from the whole topic', () => {
    const qs = buildPictureQuestions(words);
    expect(qs.map((q) => q.word.id).sort()).toEqual(['1', '2']);
    for (const q of qs) {
      expect(q.options).toContain(q.answer);
      // Distractors dedupe by word string and never repeat the answer.
      expect(new Set(q.options).size).toBe(q.options.length);
      expect(q.options.filter((o) => o === q.answer)).toHaveLength(1);
    }
  });

  it('returns no questions when nothing has an image', () => {
    expect(buildPictureQuestions([{ id: '1', word: 'cat' }])).toEqual([]);
  });
});

describe('modes CSV', () => {
  it('parses to canonical order, deduped, dropping unknown ids', () => {
    expect(parseModes('type,scramble,type')).toEqual(['scramble', 'type']);
    expect(parseModes(' match , flip ')).toEqual(['flip', 'match']);
    expect(parseModes('flip,bogus')).toEqual(['flip']);
  });

  it('treats null, empty and all-garbage as "any mode"', () => {
    expect(parseModes(null)).toBeNull();
    expect(parseModes(undefined)).toBeNull();
    expect(parseModes('')).toBeNull();
    expect(parseModes('bogus, ,')).toBeNull();
  });

  it('round-trips through normalizeModesCsv', () => {
    expect(normalizeModesCsv(['type', 'scramble'])).toBe('scramble,type');
    expect(normalizeModesCsv([])).toBeNull();
    expect(normalizeModesCsv([''])).toBeNull();
    expect(parseModes(normalizeModesCsv(ALL_MODES as string[]))).toEqual(ALL_MODES);
  });

  it('validates tokens strictly for input checking', () => {
    expect(isValidModesCsv('flip,quiz')).toBe(true);
    expect(isValidModesCsv('')).toBe(true);
    expect(isValidModesCsv('flip,bogus')).toBe(false);
  });

  it('modeAllowed: null CSV admits everything, a list admits only itself', () => {
    expect(modeAllowed(null, 'quiz')).toBe(true);
    expect(modeAllowed('', 'quiz')).toBe(true);
    expect(modeAllowed('type,fill', 'fill')).toBe(true);
    expect(modeAllowed('type,fill', 'quiz')).toBe(false);
  });
});

describe('mode constants', () => {
  it('every mode has a MIN_WORDS entry', () => {
    for (const m of ALL_MODES) expect(MIN_WORDS[m]).toBeGreaterThanOrEqual(1);
  });
});
