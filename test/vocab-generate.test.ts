import { describe, it, expect } from 'vitest';
import { VocabGenerateInput } from '../shared/schemas';
import { VOCAB_TOPICS, vocabTopicLabel } from '../shared/logic/vocab-topics';
import { sanitizeGeneratedWords } from '../server/services/generate';
import type { GeneratedWord } from '../shared/schemas';

// The Anthropic call itself is not tested (it is network-bound, like enrich.ts). What IS
// tested is everything the review UI trusts: the request schema and the post-processing that
// turns raw model output into rows the import endpoint will accept.

describe('VocabGenerateInput', () => {
  it('defaults to 20 words, no level, and an empty exclude list', () => {
    const parsed = VocabGenerateInput.parse({ topic: 'Weather' });
    expect(parsed.count).toBe(20);
    expect(parsed.exclude).toEqual([]);
    expect(parsed.level ?? null).toBeNull();
  });

  it('coerces the numeric-string count the FormData path sends', () => {
    expect(VocabGenerateInput.parse({ topic: 'Weather', count: '30' }).count).toBe(30);
  });

  it('rejects a count past the cap, a blank topic, and an unknown level', () => {
    expect(VocabGenerateInput.safeParse({ topic: 'Weather', count: 51 }).success).toBe(false);
    expect(VocabGenerateInput.safeParse({ topic: '  ' }).success).toBe(false);
    expect(VocabGenerateInput.safeParse({ topic: 'Weather', level: 'expert' }).success).toBe(false);
  });

  it('accepts a free-text topic — the curated catalog is a UI convenience only', () => {
    expect(VocabGenerateInput.safeParse({ topic: 'Volcanoes of Iceland' }).success).toBe(true);
  });
});

describe('VOCAB_TOPICS', () => {
  it('has a unique id and both labels on every entry', () => {
    const ids = VOCAB_TOPICS.map((topic) => topic.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const topic of VOCAB_TOPICS) {
      expect(topic.en.length).toBeGreaterThan(0);
      expect(topic.vi.length).toBeGreaterThan(0);
    }
  });

  it('labels in Vietnamese only for vi', () => {
    const topic = VOCAB_TOPICS[0];
    expect(vocabTopicLabel(topic, 'vi')).toBe(topic.vi);
    expect(vocabTopicLabel(topic, 'en')).toBe(topic.en);
  });
});

describe('sanitizeGeneratedWords', () => {
  const w = (
    word: string,
    meaningVi = 'nghĩa',
    definitionEn = 'a definition',
    ipa = '/wɜːd/',
    imageQuery = 'a photo subject',
    exampleEn = `The ${word} is here.`,
    exampleAnswer = word,
  ): GeneratedWord => ({
    word,
    meaningVi,
    definitionEn,
    ipa,
    imageQuery,
    exampleEn,
    exampleAnswer,
  });

  it('drops words the deck already has, ignoring case', () => {
    const out = sanitizeGeneratedWords([w('Rain'), w('cloud')], ['rain'], 10);
    expect(out.map((r) => r.word)).toEqual(['cloud']);
  });

  it('drops duplicates and blanks, then stops at the requested count', () => {
    const out = sanitizeGeneratedWords([w('sun'), w('Sun'), w(''), w('wind'), w('storm')], [], 2);
    expect(out.map((r) => r.word)).toEqual(['sun', 'wind']);
  });

  it('clamps fields to the FlashcardWordInput limits and nulls blank optional fields', () => {
    const out = sanitizeGeneratedWords([w('sky', 'x'.repeat(600), '', '', '')], [], 10);
    expect(out[0].meaningVi).toHaveLength(500);
    expect(out[0].definitionEn).toBeNull();
    expect(out[0].ipa).toBeNull();
    expect(out[0].imageQuery).toBeNull();
  });

  it('clamps a long imageQuery and keeps it off the card fields', () => {
    const out = sanitizeGeneratedWords(
      [w('sky', 'nghĩa', 'a definition', '/skaɪ/', 'y'.repeat(300))],
      [],
      10,
    );
    expect(out[0].imageQuery).toHaveLength(200);
    // The picture keywords are for the review screen's lookup, never shown on the card itself.
    expect(out[0].word).toBe('sky');
    expect(out[0].meaningVi).toBe('nghĩa');
  });

  it('keeps the IPA transcription the model returned', () => {
    const out = sanitizeGeneratedWords([w('whisk', 'đánh trứng', 'to beat', '/wɪsk/')], [], 10);
    expect(out[0].ipa).toBe('/wɪsk/');
  });

  it('clamps an overlong IPA to the FlashcardWordInput limit', () => {
    const out = sanitizeGeneratedWords([w('sky', 'trời', 'the air', 'ˈ'.repeat(300))], [], 10);
    expect(out[0].ipa).toHaveLength(200);
  });

  it('survives malformed model output rather than throwing at the UI', () => {
    expect(sanitizeGeneratedWords(undefined, [], 10)).toEqual([]);
    expect(sanitizeGeneratedWords([{} as GeneratedWord], [], 10)).toEqual([]);
  });

  it('keeps a well-formed example sentence and its answer', () => {
    const out = sanitizeGeneratedWords(
      [w('whisk', 'đánh trứng', 'to beat', '/wɪsk/', 'kitchen tool', 'She used a whisk.', 'whisk')],
      [],
      10,
    );
    expect(out[0].exampleEn).toBe('She used a whisk.');
    expect(out[0].exampleAnswer).toBe('whisk');
  });

  it('nulls BOTH example fields when the sentence does not contain the answer', () => {
    const out = sanitizeGeneratedWords(
      [w('run', 'chạy', 'to move fast', '/rʌn/', 'a person running', 'He runs fast.', 'run')],
      [],
      10,
    );
    expect(out[0].exampleEn).toBeNull();
    expect(out[0].exampleAnswer).toBeNull();
  });
});
