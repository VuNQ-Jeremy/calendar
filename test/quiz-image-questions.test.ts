import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildQuizQuestions as buildQuestions } from '../shared/logic/flashcards';
import type { FlashcardWordRow } from '../server/services/flashcards.js';

/**
 * The picture question inverts the quiz: the image is the prompt and the options are English
 * spellings, so the student names the thing instead of translating it.
 *
 * The variant is picked at random, so `Math.random` is pinned rather than the UI driven — a
 * UI-level test would only exercise whichever variant the dice happened to produce.
 */

function word(id: string, w: string, imageKey: string | null): FlashcardWordRow {
  return {
    id,
    topicId: 't1',
    sortOrder: 0,
    word: w,
    meaningVi: `nghĩa ${w}`,
    definitionEn: null,
    ipa: null,
    partOfSpeech: null,
    exampleEn: null,
    exampleAnswer: null,
    audioUrl: null,
    imageKey,
    topicIds: [],
    createdAt: null,
  };
}

/** shuffle() and the variant roll both consume Math.random; a constant keeps both deterministic. */
function pinRandom(value: number) {
  vi.spyOn(Math, 'random').mockReturnValue(value);
}

afterEach(() => vi.restoreAllMocks());

const KEY = 'flashcards/3f2504e0-4f89-41d3-9a0c-0305e82c3301.jpg';

describe('buildQuestions — picture questions', () => {
  it('asks for the WORD, with other spellings as distractors', () => {
    // 0 is below IMAGE_SHARE, so every word that has a picture becomes a picture question.
    pinRandom(0);
    const words = [
      word('1', 'kitchen', KEY),
      word('2', 'garden', KEY),
      word('3', 'bedroom', KEY),
      word('4', 'garage', KEY),
    ];
    const qs = buildQuestions(words);

    expect(qs).toHaveLength(4);
    for (const q of qs) {
      expect(q.prompt).toBe('image');
      // The answer is the spelling, NOT the Vietnamese meaning — that is the whole inversion.
      expect(q.answer).toBe(q.word.word);
      expect(q.options).toHaveLength(4);
      expect(q.options).toContain(q.word.word);
      expect(new Set(q.options).size).toBe(4);
      // Every option is a real word from the deck, so nothing gives the answer away by being odd.
      for (const o of q.options) expect(words.map((w) => w.word)).toContain(o);
    }
  });

  it('never asks a picture question for a word with no picture', () => {
    pinRandom(0);
    const words = [
      word('1', 'kitchen', null),
      word('2', 'garden', KEY),
      word('3', 'bedroom', null),
      word('4', 'garage', null),
    ];
    const byWord = new Map(buildQuestions(words).map((q) => [q.word.id, q]));
    expect(byWord.get('2')!.prompt).toBe('image');
    for (const id of ['1', '3', '4']) {
      expect(byWord.get(id)!.prompt).not.toBe('image');
    }
  });

  it('falls back to a meaning question when there are too few other spellings', () => {
    // Three distinct spellings are needed for the three distractors. Here there are only two
    // others, so the picture variant must stand down rather than emit a short option list.
    pinRandom(0);
    const words = [word('1', 'kitchen', KEY), word('2', 'garden', KEY), word('3', 'bedroom', KEY)];
    for (const q of buildQuestions(words)) {
      expect(q.prompt).not.toBe('image');
      expect(q.answer).toBe(`nghĩa ${q.word.word}`);
    }
  });

  it('leaves imageless decks exactly as they were', () => {
    // 0.9 is above both the image and audio thresholds, so every question is a plain text one.
    pinRandom(0.9);
    const words = [
      word('1', 'kitchen', null),
      word('2', 'garden', null),
      word('3', 'bedroom', null),
      word('4', 'garage', null),
    ];
    for (const q of buildQuestions(words)) {
      expect(q.prompt).toBe('text');
      expect(q.answer).toBe(`nghĩa ${q.word.word}`);
    }
  });
});
