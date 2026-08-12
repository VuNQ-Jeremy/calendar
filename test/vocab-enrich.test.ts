import { describe, it, expect } from 'vitest';
import { VocabEnrichInput } from '../shared/schemas';
import { sanitizeEnrichedWords } from '../server/services/enrich';
import type { EnrichedWord } from '../shared/schemas';

// The Anthropic call itself is not tested (it is network-bound). What IS tested is everything the
// import and word-editor screens trust: the request schema, and the post-processing that turns raw
// model output into values the word endpoints will accept.

describe('VocabEnrichInput', () => {
  it('accepts a bare word list — the sense hint is optional', () => {
    const parsed = VocabEnrichInput.parse({ items: [{ word: 'whisk' }] });
    expect(parsed.items[0].word).toBe('whisk');
    expect(parsed.items[0].definitionEn ?? null).toBeNull();
  });

  it('carries the definition through as the sense hint', () => {
    const parsed = VocabEnrichInput.parse({
      items: [{ word: 'bank', definitionEn: 'the land alongside a river' }],
    });
    expect(parsed.items[0].definitionEn).toBe('the land alongside a river');
  });

  it('rejects an empty list, a blank word, and a batch past the 200 cap', () => {
    expect(VocabEnrichInput.safeParse({ items: [] }).success).toBe(false);
    expect(VocabEnrichInput.safeParse({ items: [{ word: '  ' }] }).success).toBe(false);
    const tooMany = Array.from({ length: 201 }, (_, i) => ({ word: `w${i}` }));
    expect(VocabEnrichInput.safeParse({ items: tooMany }).success).toBe(false);
  });
});

describe('sanitizeEnrichedWords', () => {
  const w = (
    word: string,
    meaningVi = 'nghĩa',
    definitionEn = 'a definition',
    ipa = '/wɜːd/',
    exampleEn = `The ${word} is here.`,
    exampleAnswer = word,
  ): EnrichedWord => ({ word, meaningVi, definitionEn, ipa, exampleEn, exampleAnswer });

  it('passes a well-formed row through unchanged', () => {
    const out = sanitizeEnrichedWords([
      w('whisk', 'đánh trứng', 'to beat', '/wɪsk/', 'She used a whisk.', 'whisk'),
    ]);
    expect(out).toEqual([
      {
        word: 'whisk',
        meaningVi: 'đánh trứng',
        definitionEn: 'to beat',
        ipa: '/wɪsk/',
        exampleEn: 'She used a whisk.',
        exampleAnswer: 'whisk',
      },
    ]);
  });

  it('clamps fields to the FlashcardWordInput limits', () => {
    const out = sanitizeEnrichedWords([
      w(
        'sky',
        'x'.repeat(600),
        'y'.repeat(1200),
        'ˈ'.repeat(300),
        `The sky is ${'blue '.repeat(100)}today.`,
        'sky',
      ),
    ]);
    expect(out[0].meaningVi).toHaveLength(500);
    expect(out[0].definitionEn).toHaveLength(1000);
    expect(out[0].ipa).toHaveLength(200);
    expect(out[0].exampleEn).toHaveLength(300);
  });

  it('nulls blank optional fields so a card renders as having none', () => {
    const out = sanitizeEnrichedWords([w('sky', 'trời', '', '   ', '', '')]);
    expect(out[0].definitionEn).toBeNull();
    expect(out[0].ipa).toBeNull();
    expect(out[0].exampleEn).toBeNull();
    expect(out[0].exampleAnswer).toBeNull();
  });

  it('nulls BOTH example fields when the sentence does not contain the answer', () => {
    const out = sanitizeEnrichedWords([
      w('run', 'chạy', 'to move fast', '/rʌn/', 'He runs fast.', 'run'),
    ]);
    // exampleAnswer "run" is not a substring of "runs" as typed (different inflection) — the model
    // was supposed to copy the exact form; a mismatch means the pair is unusable by the games.
    expect(out[0].exampleEn).toBeNull();
    expect(out[0].exampleAnswer).toBeNull();
  });

  it('keeps an inflected exampleAnswer when it really appears in the sentence', () => {
    const out = sanitizeEnrichedWords([
      w('run', 'chạy', 'to move fast', '/rʌn/', 'Yesterday he ran home.', 'ran'),
    ]);
    expect(out[0].exampleEn).toBe('Yesterday he ran home.');
    expect(out[0].exampleAnswer).toBe('ran');
  });

  it('drops rows with no word — they cannot be matched back to a request', () => {
    const out = sanitizeEnrichedWords([w(''), w('  '), w('rain')]);
    expect(out.map((r) => r.word)).toEqual(['rain']);
  });

  it('keeps duplicates: callers match answers by word, and dropping one loses an answer', () => {
    const out = sanitizeEnrichedWords([w('rain'), w('rain', 'mưa')]);
    expect(out).toHaveLength(2);
  });

  it('survives malformed model output rather than throwing at the UI', () => {
    expect(sanitizeEnrichedWords(undefined)).toEqual([]);
    expect(sanitizeEnrichedWords([{} as EnrichedWord])).toEqual([]);
  });
});
