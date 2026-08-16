import { describe, it, expect, afterEach, vi } from 'vitest';
import { VocabEnrichInput } from '../shared/schemas';
import { enrichWords, sanitizeEnrichedWords } from '../server/services/enrich';
import type { EnrichedWord } from '../shared/schemas';

// The model's answers are not tested (they are network-bound). What IS tested is everything the
// import and word-editor screens trust: the request schema, the post-processing that turns raw
// model output into values the word endpoints will accept, and — against a stubbed `fetch` — that
// the request is actually built and sent.

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

describe('enrichWords request', () => {
  // Regression cover for a bug that made AI fill fail 100% of the time while looking like an API
  // outage: the SDK refuses a non-streaming request whose projected duration exceeds its default
  // timeout (`max_tokens` over 21,333) and throws BEFORE opening a socket. Nothing here asserts on
  // model behaviour — the point is that `fetch` is reached at all.
  const reply = (over: Record<string, unknown>) =>
    new Response(
      JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-4-5',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 12, output_tokens: 34 },
        ...over,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );

  const stubFetch = (res: Response) => {
    // enrichWords only ever runs inside a Durable Object, where there is no `window`. These tests
    // run under the suite's jsdom environment, which has one — and the SDK constructor refuses to
    // build a client in anything that looks like a browser (it would expose the API key). Removing
    // `window` restores the Worker's shape; afterEach unstubs it.
    vi.stubGlobal('window', undefined);
    const mock = vi.fn(async (_url: unknown, _init?: RequestInit) => res);
    vi.stubGlobal('fetch', mock);
    return mock;
  };

  afterEach(() => vi.unstubAllGlobals());

  it('reaches the network with the full token ceiling', async () => {
    const words = [
      {
        word: 'dog',
        meaningVi: 'con chó',
        definitionEn: 'a common pet animal',
        ipa: '/dɔːɡ/',
        exampleEn: 'The dog barks loudly at night.',
        exampleAnswer: 'dog',
      },
    ];
    const mock = stubFetch(reply({ content: [{ type: 'text', text: JSON.stringify({ words }) }] }));

    const out = await enrichWords('sk-ant-test', [{ word: 'dog', definitionEn: null }]);

    expect(mock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(mock.mock.calls[0][1]?.body)) as {
      max_tokens: number;
      stream?: boolean;
    };
    expect(body.max_tokens).toBe(32000);
    expect(body.stream ?? false).toBe(false);
    expect(out.words[0].word).toBe('dog');
    expect(out.usage).toEqual({ inputTokens: 12, outputTokens: 34 });
  });

  it('throws a legible error when the batch is truncated instead of crashing in JSON.parse', async () => {
    stubFetch(
      reply({
        stop_reason: 'max_tokens',
        content: [{ type: 'text', text: '{"words":[{"word":"do' }],
      }),
    );

    await expect(enrichWords('sk-ant-test', [{ word: 'dog', definitionEn: null }])).rejects.toThrow(
      /truncated at max_tokens/,
    );
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
