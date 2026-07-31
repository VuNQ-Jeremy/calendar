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
    max_tokens: 8000,
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
                },
                required: ['word', 'meaningVi', 'definitionEn'],
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
    out.push({
      word,
      meaningVi: (row.meaningVi ?? '').trim().slice(0, 500),
      definitionEn: definitionEn || null,
    });
    if (out.length >= count) break;
  }
  return out;
}
