import Anthropic from '@anthropic-ai/sdk';
import type { AiUsage } from '../../shared/logic/usage';
import type { EnrichedWord, VocabEnrichItem } from '../../shared/schemas';
import { exampleContainsAnswer } from '../../shared/logic/flashcards';

// Claude Haiku 4.5 — cheap, fast, and supports structured outputs. This is a
// short, non-agentic classification-style call, so no thinking/effort/sampling
// params (effort would error on this pre-4.7 model).
const MODEL = 'claude-haiku-4-5';

/**
 * Explicit request timeout, which ALSO lifts an SDK guard we need lifted.
 *
 * `messages.create` refuses a non-streaming request whose projected duration exceeds the SDK's
 * 10-minute default — it extrapolates `60min × max_tokens / 128000` and throws
 * `AnthropicError: Streaming is required…` locally, before opening a socket. That caps
 * non-streaming `max_tokens` at 21,333, and this call asks for 32,000 (see below), so every
 * enrichment threw client-side and surfaced as "AI fill failed" — no request, no tokens, nothing
 * in the usage counters to explain it.
 *
 * The projection is what's wrong, not the budget: `max_tokens` is a ceiling sized for the
 * schema's 200-item batch, while real calls arrive in 50-word chunks and finish in well under a
 * minute. The guard only runs when the client has no explicit timeout, so setting one deliberately
 * hands the pacing decision back to us. 10 minutes matches what the SDK would have used anyway.
 */
const TIMEOUT_MS = 10 * 60 * 1000;

const SYSTEM = `You fill in flashcard entries for English vocabulary studied by
Vietnamese students learning English. For each word you are given, return:
- "word": the word exactly as it was given to you, so the caller can match it up
- "meaningVi": a concise Vietnamese gloss (typically 1-5 words, like a dictionary
  entry — not a full sentence). Prefer the everyday Vietnamese equivalent a
  teacher would put on a flashcard.
- "definitionEn": a simple English definition of at most 15 words, written for
  learners
- "ipa": the General American pronunciation as a broad IPA transcription in
  slashes, with primary stress marked — for example /ˈwɪskər/. Transcribe the
  headword exactly as spelled in "word".
- "exampleEn": one simple example sentence of 8-14 words that uses the word
  naturally exactly once, written for learners (match the register of the
  definition). No quotation marks around the sentence.
- "exampleAnswer": the exact form of the word as it appears in exampleEn —
  copy it character for character, including any inflection ("ran" for "run").
Rules:
- When an English definition is provided with the word, use THAT sense for both
  the Vietnamese gloss and your own definition. Otherwise pick the most common
  everyday sense.
- Return one entry for every word you were given, in the same order, and no
  extras.
- If a word is misspelled or not English, still return an entry: gloss what the
  author most likely meant rather than leaving fields empty.`;

/**
 * Fill in the Vietnamese gloss, English definition and IPA for a batch of English words via the
 * Claude API. This is the app's only vocabulary-enrichment path: it replaced a per-word lookup
 * against the free dictionaryapi.dev, which only worked in the browser and could not supply a
 * Vietnamese meaning.
 *
 * Server-side only (the API key is a Worker secret and must never reach the browser), and only
 * ever called from inside the TranslateProxy Durable Object so the request egresses from a region
 * Anthropic allows. Structured outputs guarantee valid JSON.
 *
 * Errors are allowed to throw — the DO catches them and returns a 502 so the client can degrade
 * to hand-editing.
 */
export async function enrichWords(
  apiKey: string,
  items: VocabEnrichItem[],
): Promise<{ words: EnrichedWord[]; usage: AiUsage }> {
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS });
  const response = await client.messages.create({
    model: MODEL,
    // Six fields per word instead of the one the old translate call returned, so ~100 output
    // tokens per word (the example sentence roughly doubled it). Sized for the schema's 200-item
    // ceiling with headroom — above the SDK's non-streaming limit, hence TIMEOUT_MS.
    max_tokens: 32000,
    system: SYSTEM,
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            words: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  word: { type: 'string' },
                  meaningVi: { type: 'string' },
                  definitionEn: { type: 'string' },
                  ipa: { type: 'string' },
                  exampleEn: { type: 'string' },
                  exampleAnswer: { type: 'string' },
                },
                required: [
                  'word',
                  'meaningVi',
                  'definitionEn',
                  'ipa',
                  'exampleEn',
                  'exampleAnswer',
                ],
                additionalProperties: false,
              },
            },
          },
          required: ['words'],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: 'user',
        content: 'Fill in each word (JSON list of {word, definitionEn}):\n' + JSON.stringify(items),
      },
    ],
  });
  const usage = readAiUsage(response.usage);
  if (response.stop_reason === 'refusal') return { words: [], usage };
  // Raising the ceiling makes truncation the new failure mode: a batch that runs out of budget
  // returns half a JSON document, which would surface as an opaque `JSON.parse` crash. Throw
  // something the DO log can be read at face value instead. Anthropic still bills this call and
  // the counters miss it — the DO only tracks usage on the success path — so treat a spike in
  // these log lines, not the Usage card, as the signal that the ceiling is being hit.
  if (response.stop_reason === 'max_tokens') {
    throw new Error(`enrich: output truncated at max_tokens (${usage.outputTokens} output tokens)`);
  }
  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') return { words: [], usage };
  const raw = (JSON.parse(text.text) as { words?: EnrichedWord[] }).words;
  return { words: sanitizeEnrichedWords(raw), usage };
}

/**
 * Token spend of one call, for the usage counters. Cache reads/writes count as input — these
 * calls set no cache_control today, so the cache fields are zero, but if caching ever appears
 * the counter should still see the whole prompt rather than silently shrinking.
 */
export function readAiUsage(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}): AiUsage {
  return {
    inputTokens:
      usage.input_tokens +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0),
    outputTokens: usage.output_tokens,
  };
}

/**
 * Make model output safe for the review UI and for FlashcardWordInput: drop rows with no word,
 * clamp every field to the schema's limits, and turn blank optional fields into null so a card
 * with no IPA renders as having none instead of as an empty pronunciation line.
 *
 * Unlike sanitizeGeneratedWords there is no dedupe or cap: callers ask about a specific list of
 * words and match the answers back by word, so a stray duplicate is harmless and a dropped row
 * would silently lose an answer.
 *
 * Exported on its own so it is unit-testable without a network call.
 */
export function sanitizeEnrichedWords(raw: EnrichedWord[] | undefined): EnrichedWord[] {
  const out: EnrichedWord[] = [];
  for (const row of Array.isArray(raw) ? raw : []) {
    const word = (row?.word ?? '').trim();
    if (!word || word.length > 100) continue;
    const definitionEn = (row.definitionEn ?? '').trim().slice(0, 1000);
    const ipa = (row.ipa ?? '').trim().slice(0, 200);
    const exampleEn = (row.exampleEn ?? '').trim().slice(0, 300);
    const exampleAnswer = (row.exampleAnswer ?? '').trim().slice(0, 100);
    // A sentence that does not actually contain its own answer is unusable by the cloze/listen
    // games — null BOTH fields rather than save a sentence the games could never blank.
    // WHOLE-WORD via the games' own helper: a bare `.includes()` accepted "run" inside "He runs
    // fast.", which is the model returning the uninflected form the prompt told it not to.
    const exampleOk =
      exampleEn !== '' && exampleAnswer !== '' && exampleContainsAnswer(exampleEn, exampleAnswer);
    out.push({
      word,
      meaningVi: (row.meaningVi ?? '').trim().slice(0, 500),
      definitionEn: definitionEn || null,
      ipa: ipa || null,
      exampleEn: exampleOk ? exampleEn : null,
      exampleAnswer: exampleOk ? exampleAnswer : null,
    });
  }
  return out;
}
