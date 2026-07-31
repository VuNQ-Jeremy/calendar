import Anthropic from '@anthropic-ai/sdk';
import type { EnrichedWord, VocabEnrichItem } from '../../shared/schemas';

// Claude Haiku 4.5 — cheap, fast, and supports structured outputs. This is a
// short, non-agentic classification-style call, so no thinking/effort/sampling
// params (effort would error on this pre-4.7 model).
const MODEL = 'claude-haiku-4-5';

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
): Promise<EnrichedWord[]> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: MODEL,
    // Four fields per word instead of the one the old translate call returned, so ~50 output
    // tokens per word. Sized for the schema's 200-item ceiling with headroom.
    max_tokens: 16000,
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
                },
                required: ['word', 'meaningVi', 'definitionEn', 'ipa'],
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
  if (response.stop_reason === 'refusal') return [];
  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') return [];
  const raw = (JSON.parse(text.text) as { words?: EnrichedWord[] }).words;
  return sanitizeEnrichedWords(raw);
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
    out.push({
      word,
      meaningVi: (row.meaningVi ?? '').trim().slice(0, 500),
      definitionEn: definitionEn || null,
      ipa: ipa || null,
    });
  }
  return out;
}
