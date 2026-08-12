import Anthropic from '@anthropic-ai/sdk';
import type { GeneratedWord, VocabGenerateInput } from '../../shared/schemas';

// Same model as translate.ts — cheap, fast, supports structured outputs. A short,
// non-agentic generation call, so no thinking/effort/sampling params.
const MODEL = 'claude-haiku-4-5';

const SYSTEM = `You create English vocabulary lists for flashcards used by
Vietnamese students learning English. Given a topic, produce common, genuinely
useful English words a teacher would put on flashcards for that topic. For each
word return:
- "word": the English word or short phrase (lowercase unless it is a proper noun)
- "meaningVi": a concise Vietnamese gloss (typically 1-5 words, like a dictionary
  entry — not a full sentence)
- "definitionEn": a simple English definition of at most 15 words, written for
  learners
- "ipa": the General American pronunciation as a broad IPA transcription in
  slashes, with primary stress marked — for example /ˈwɪskər/. Transcribe the
  headword exactly as spelled in "word".
- "exampleEn": one simple example sentence of 8-14 words that uses the word
  naturally exactly once, written for learners (match the requested level). No
  quotation marks around the sentence.
- "exampleAnswer": the exact form of the word as it appears in exampleEn —
  copy it character for character, including any inflection ("ran" for "run").
- "imageQuery": 2-4 concrete English keywords for a stock-photo search that would
  return a picture a student instantly recognises as this word — for "whisker",
  "cat whiskers closeup". For abstract words, describe a photographable scene
  that shows it happening rather than the concept itself: for "generosity",
  "person sharing food". Nouns and scenes only, no adjectives about mood or style.
Rules:
- Every word must be clearly relevant to the topic.
- No duplicates, and never include a word from the exclude list nor a plural or
  inflected form of one.
- Match the requested level: beginner is everyday basic words (CEFR A1-A2),
  intermediate is B1-B2, advanced is C1-C2. When level is null, favour a mix of
  beginner and intermediate words.
- Return exactly the requested number of words.`;

/**
 * Generate flashcard vocabulary for a topic via the Claude API. Server-side only (the API key
 * is a Worker secret) and, like translateWords, only ever called from inside the TranslateProxy
 * Durable Object so the request egresses from a region Anthropic allows.
 *
 * Errors are allowed to throw — the DO catches them and returns a 502.
 */
export async function generateVocabWords(
  apiKey: string,
  input: VocabGenerateInput,
): Promise<GeneratedWord[]> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: MODEL,
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
                  exampleEn: { type: 'string' },
                  exampleAnswer: { type: 'string' },
                  imageQuery: { type: 'string' },
                },
                required: [
                  'word',
                  'meaningVi',
                  'definitionEn',
                  'ipa',
                  'exampleEn',
                  'exampleAnswer',
                  'imageQuery',
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
        content:
          'Generate vocabulary (JSON request of {topic, count, level, exclude}):\n' +
          JSON.stringify({
            topic: input.topic,
            count: input.count,
            level: input.level ?? null,
            exclude: input.exclude,
          }),
      },
    ],
  });
  if (response.stop_reason === 'refusal') return [];
  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') return [];
  const raw = (JSON.parse(text.text) as { words?: GeneratedWord[] }).words;
  return sanitizeGeneratedWords(raw, input.exclude, input.count);
}

/**
 * Make model output safe for the review UI and for FlashcardWordInput: drop blanks, anything on
 * the exclude list (case-insensitive), and duplicates; clamp fields to the schema's limits; cap
 * at the requested count. Exported on its own so it is unit-testable without a network call.
 *
 * Blank optional fields become null rather than '' so a card with no IPA renders as having none,
 * instead of as an empty pronunciation line.
 */
export function sanitizeGeneratedWords(
  raw: GeneratedWord[] | undefined,
  exclude: string[],
  count: number,
): GeneratedWord[] {
  const excluded = new Set(exclude.map((w) => w.trim().toLowerCase()));
  const seen = new Set<string>();
  const out: GeneratedWord[] = [];
  for (const row of Array.isArray(raw) ? raw : []) {
    const word = (row?.word ?? '').trim();
    const key = word.toLowerCase();
    if (!word || word.length > 100 || excluded.has(key) || seen.has(key)) continue;
    seen.add(key);
    const definitionEn = (row.definitionEn ?? '').trim().slice(0, 1000);
    const ipa = (row.ipa ?? '').trim().slice(0, 200);
    const exampleEn = (row.exampleEn ?? '').trim().slice(0, 300);
    const exampleAnswer = (row.exampleAnswer ?? '').trim().slice(0, 100);
    // A sentence that does not actually contain its own answer is unusable by the cloze/listen
    // games — null BOTH fields rather than save a sentence the games could never blank.
    const exampleOk =
      exampleEn !== '' &&
      exampleAnswer !== '' &&
      exampleEn.toLowerCase().includes(exampleAnswer.toLowerCase());
    const imageQuery = (row.imageQuery ?? '').trim().slice(0, 200);
    out.push({
      word,
      meaningVi: (row.meaningVi ?? '').trim().slice(0, 500),
      definitionEn: definitionEn || null,
      ipa: ipa || null,
      exampleEn: exampleOk ? exampleEn : null,
      exampleAnswer: exampleOk ? exampleAnswer : null,
      // Not a card field — search keywords for the review screen's picture lookup. Null when the
      // model skipped it; callers fall back to the word itself.
      imageQuery: imageQuery || null,
    });
    if (out.length >= count) break;
  }
  return out;
}
