import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  ALL_MODES,
  MIN_WORDS,
  SPELL_ROUND_SIZE,
  blankExample,
  buildClozeQuestions,
  buildIpaQuestions,
  buildMixItems,
  buildPictureQuestions,
  buildStressQuestions,
  checkTyped,
  decoyLetters,
  exampleEligible,
  imageOf,
  ipaStress,
  isValidModesCsv,
  letterSlots,
  maskWord,
  mixEligibleModes,
  modeAllowed,
  normalizeModesCsv,
  parseModes,
  pickRound,
  pronouncePassed,
  scrambleLetters,
  stressEligible,
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
  it("keeps exactly the word's letters, dropping separators", () => {
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
    expect(
      wordsWithImages([{ imageKey: 'flashcards/a.jpg' }, {}, { imageKey: null }]),
    ).toHaveLength(1);
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

  it('lists pronounce exactly once, before mix, playable from one word', () => {
    expect(ALL_MODES.filter((m) => m === 'pronounce')).toHaveLength(1);
    expect(ALL_MODES.indexOf('pronounce')).toBe(ALL_MODES.indexOf('mix') - 1);
    expect(MIN_WORDS.pronounce).toBe(1);
  });
});

describe('pronouncePassed', () => {
  it('passes at the 70 threshold and fails just under it', () => {
    expect(pronouncePassed(70)).toBe(true);
    expect(pronouncePassed(100)).toBe(true);
    expect(pronouncePassed(69.9)).toBe(false);
    expect(pronouncePassed(0)).toBe(false);
  });
});

describe('ipaStress', () => {
  it('locates the stressed syllable by counting vowel nuclei up to the ˈ mark', () => {
    expect(ipaStress('/ˈwɪskər/')).toEqual({ syllables: 2, stressIndex: 0 });
    expect(ipaStress('/əˈbaʊt/')).toEqual({ syllables: 2, stressIndex: 1 });
    expect(ipaStress('/aɪˈdiə/')).toEqual({ syllables: 3, stressIndex: 1 });
  });

  it('treats a diphthong as one nucleus, not two', () => {
    // "əˈbaʊt" has 4 letters after the stress mark (b,a,ʊ,t) but only 2 syllables: bA-ʊT is one.
    expect(ipaStress('/əˈbaʊt/')?.syllables).toBe(2);
  });

  it('counts a syllabic consonant as its own nucleus', () => {
    expect(ipaStress('/ˈbʌtn̩/')).toEqual({ syllables: 2, stressIndex: 0 });
  });

  it('defaults a monosyllable with no mark to stress 0', () => {
    expect(ipaStress('/kæt/')).toEqual({ syllables: 1, stressIndex: 0 });
  });

  it('refuses to guess a multi-syllable word with no stress mark', () => {
    expect(ipaStress('/kæmərə/')).toBeNull();
  });

  it('returns null for missing or empty input', () => {
    expect(ipaStress(null)).toBeNull();
    expect(ipaStress(undefined)).toBeNull();
    expect(ipaStress('')).toBeNull();
  });
});

describe('stressEligible', () => {
  it('requires 2+ syllables and a parseable mark', () => {
    expect(stressEligible({ ipa: '/ˈwɪskər/' })).toBe(true);
    expect(stressEligible({ ipa: '/kæt/' })).toBe(false); // monosyllable
    expect(stressEligible({ ipa: '/kæmərə/' })).toBe(false); // unmarked multisyllable
    expect(stressEligible({ ipa: null })).toBe(false);
  });
});

describe('blankExample / exampleEligible', () => {
  it('blanks the exact surface form, preserving its casing', () => {
    const w = { exampleEn: 'Yesterday he ran home.', exampleAnswer: 'ran' };
    expect(blankExample(w)).toEqual({ blanked: 'Yesterday he _____ home.', answer: 'ran' });
    expect(exampleEligible(w)).toBe(true);
  });

  it('is ineligible when the sentence does not contain the answer', () => {
    const w = { exampleEn: 'He runs fast.', exampleAnswer: 'run' };
    expect(exampleEligible(w)).toBe(false);
    expect(blankExample(w)).toBeNull();
  });

  it('is ineligible with no sentence or no answer', () => {
    expect(exampleEligible({ exampleEn: null, exampleAnswer: null })).toBe(false);
    expect(exampleEligible({ exampleEn: 'A cat sat.', exampleAnswer: null })).toBe(false);
  });
});

describe('buildClozeQuestions', () => {
  const words = [
    { id: '1', word: 'run', exampleEn: 'Yesterday he ran home.', exampleAnswer: 'ran' },
    { id: '2', word: 'jump', exampleEn: 'She can jump high.', exampleAnswer: 'jump' },
    { id: '3', word: 'walk', exampleEn: 'They walk to school.', exampleAnswer: 'walk' },
    { id: '4', word: 'swim', exampleEn: null, exampleAnswer: null }, // no sentence
    { id: '5', word: 'read', exampleEn: 'He reads books.', exampleAnswer: 'read' }, // mismatched form
  ];

  it('only asks words with a usable sentence, and the answer is a real option', () => {
    const qs = buildClozeQuestions(words, 10);
    expect(qs.map((q) => q.word.id).sort()).toEqual(['1', '2', '3']);
    for (const q of qs) {
      expect(q.options).toContain(q.answer);
      expect(q.blanked).not.toContain(q.answer);
    }
  });

  it('distractors are other topic words, never the answer itself', () => {
    const qs = buildClozeQuestions(words, 10);
    for (const q of qs) {
      for (const opt of q.options) {
        if (opt !== q.answer) expect(opt).not.toBe(q.word.word);
      }
    }
  });
});

describe('buildIpaQuestions', () => {
  const words = [
    { id: '1', word: 'cat', ipa: '/kæt/' },
    { id: '2', word: 'dog', ipa: '/dɔɡ/' },
    { id: '3', word: 'fish', ipa: null },
  ];

  afterEach(() => vi.restoreAllMocks());

  it('only asks words with IPA', () => {
    const qs = buildIpaQuestions(words, 10);
    expect(qs.map((q) => q.word.id).sort()).toEqual(['1', '2']);
  });

  it('never runs word-to-ipa without 3 distinct distractor transcriptions', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // always try the reverse direction
    const qs = buildIpaQuestions(words, 10); // only 2 words have IPA -> 1 distractor at most
    for (const q of qs) expect(q.direction).toBe('ipa-to-word');
  });

  it('the answer is always among the options', () => {
    const qs = buildIpaQuestions(words, 10);
    for (const q of qs) expect(q.options).toContain(q.answer);
  });
});

describe('buildStressQuestions', () => {
  // whisker is the only stress-0 word; about/ago/away all share stress-1 — exactly the 3 peers
  // an odd-one-out board needs to pick whisker as the odd word out.
  const words = [
    { id: '1', word: 'whisker', ipa: '/ˈwɪskər/' }, // stress 0
    { id: '2', word: 'about', ipa: '/əˈbaʊt/' }, // stress 1
    { id: '3', word: 'ago', ipa: '/əˈɡoʊ/' }, // stress 1
    { id: '4', word: 'away', ipa: '/əˈweɪ/' }, // stress 1
    { id: '5', word: 'cat', ipa: '/kæt/' }, // monosyllable, excluded
  ];

  afterEach(() => vi.restoreAllMocks());

  it('only asks multi-syllable words with a parseable stress mark', () => {
    const qs = buildStressQuestions(words, 10);
    const ids = new Set(qs.map((q) => (q.kind === 'odd' ? q.answerId : q.word.id)));
    for (const id of ids) expect(id).not.toBe('5');
  });

  it('odd-one-out questions have 4 words and a valid answerId among them', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // force the odd-one-out branch when possible
    const qs = buildStressQuestions(words, 10);
    const oddQs = qs.filter((q) => q.kind === 'odd');
    expect(oddQs.length).toBeGreaterThan(0); // whisker must produce one, given the peers above
    for (const q of oddQs) {
      expect(q.words).toHaveLength(4);
      expect(q.words.map((w) => w.id)).toContain(q.answerId);
    }
  });

  it("syllable questions answer within the word's syllable count", () => {
    const qs = buildStressQuestions(words, 10);
    for (const q of qs) {
      if (q.kind !== 'syllable') continue;
      expect(q.answer).toBeGreaterThanOrEqual(0);
      expect(q.answer).toBeLessThan(q.syllables);
    }
  });
});

describe('mixEligibleModes', () => {
  const words = [
    {
      id: '1',
      word: 'cat',
      meaningVi: 'con mèo',
      ipa: '/kæt/',
      exampleEn: null,
      exampleAnswer: null,
    },
    {
      id: '2',
      word: 'dog',
      meaningVi: 'con chó',
      ipa: '/dɔɡ/',
      exampleEn: null,
      exampleAnswer: null,
    },
    {
      id: '3',
      word: 'fish',
      meaningVi: 'con cá',
      ipa: '/fɪʃ/',
      exampleEn: null,
      exampleAnswer: null,
    },
    {
      id: '4',
      word: 'bird',
      meaningVi: 'con chim',
      ipa: '/bɜrd/',
      exampleEn: null,
      exampleAnswer: null,
    },
  ];

  it('with no restriction, returns every mode the deck supports', () => {
    const modes = mixEligibleModes(words, null);
    expect(modes).toContain('quiz');
    expect(modes).toContain('ipa');
    expect(modes).toContain('type');
    // No example sentences and no images in this deck.
    expect(modes).not.toContain('cloze');
    expect(modes).not.toContain('listen');
    expect(modes).not.toContain('picture');
  });

  it('falls back to the full pool when the restriction leaves nothing usable', () => {
    // "stress" alone: nothing in this deck is stress-eligible (no multi-syllable IPA) -> fall back.
    const modes = mixEligibleModes(words, ['stress']);
    expect(modes.length).toBeGreaterThan(0);
    expect(modes).toContain('quiz');
  });

  it('intersects with an allowed list that IS usable', () => {
    const modes = mixEligibleModes(words, ['ipa', 'quiz']);
    expect(new Set(modes)).toEqual(new Set(['ipa', 'quiz']));
  });

  it('never mixes in pronounce — it needs the network and a mic', () => {
    expect(mixEligibleModes(words, null)).not.toContain('pronounce');
    // "pronounce" alone leaves nothing usable in the pool -> fall back, still without it.
    const modes = mixEligibleModes(words, ['pronounce']);
    expect(modes.length).toBeGreaterThan(0);
    expect(modes).not.toContain('pronounce');
    const items = buildMixItems(words, ['pronounce'], 5);
    expect(items.map((i) => i.mode as string)).not.toContain('pronounce');
  });
});

describe('buildMixItems', () => {
  const words = [
    {
      id: '1',
      word: 'cat',
      meaningVi: 'con mèo',
      ipa: '/kæt/',
      exampleEn: null,
      exampleAnswer: null,
    },
    {
      id: '2',
      word: 'dog',
      meaningVi: 'con chó',
      ipa: '/dɔɡ/',
      exampleEn: null,
      exampleAnswer: null,
    },
    {
      id: '3',
      word: 'fish',
      meaningVi: 'con cá',
      ipa: '/fɪʃ/',
      exampleEn: null,
      exampleAnswer: null,
    },
    {
      id: '4',
      word: 'bird',
      meaningVi: 'con chim',
      ipa: '/bɜrd/',
      exampleEn: null,
      exampleAnswer: null,
    },
  ];

  it('returns exactly `count` items when the data supports it', () => {
    const items = buildMixItems(words, ['quiz', 'ipa', 'type'], 6);
    expect(items).toHaveLength(6);
    for (const item of items) expect(['quiz', 'ipa', 'type']).toContain(item.mode);
  });

  it('never asks a mode a word does not support (e.g. cloze with no sentence)', () => {
    const items = buildMixItems(words, ['quiz', 'cloze'], 8);
    for (const item of items) expect(item.mode).not.toBe('cloze');
  });
});
