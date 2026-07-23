import Anthropic from '@anthropic-ai/sdk';

export type TranslateItem = { word: string; definitionEn?: string | null };
export type Translation = { word: string; meaningVi: string };

// Claude Haiku 4.5 — cheap, fast, and supports structured outputs. This is a
// short, non-agentic classification-style call, so no thinking/effort/sampling
// params (effort would error on this pre-4.7 model).
const MODEL = 'claude-haiku-4-5';

const SYSTEM = `You translate English vocabulary words into Vietnamese for
flashcards used by Vietnamese students learning English. For each word, return
a concise Vietnamese gloss (typically 1-5 words, like a dictionary entry — not
a full sentence). When an English definition is provided, translate the word in
THAT sense. Prefer the everyday Vietnamese equivalent a teacher would put on a
flashcard.`;

/**
 * Translate a batch of English words into Vietnamese flashcard glosses via the
 * Claude API. Runs server-side only (the API key is a Worker secret and must
 * never reach the browser). Structured outputs guarantee valid JSON.
 *
 * Errors are allowed to throw — the calling route catches them and returns a
 * 502 so the client can degrade gracefully.
 */
export async function translateWords(
  apiKey: string,
  items: TranslateItem[],
): Promise<Translation[]> {
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
            translations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  word: { type: 'string' },
                  meaningVi: { type: 'string' },
                },
                required: ['word', 'meaningVi'],
                additionalProperties: false,
              },
            },
          },
          required: ['translations'],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: 'user',
        content:
          'Translate each word (JSON list of {word, definitionEn}):\n' + JSON.stringify(items),
      },
    ],
  });
  if (response.stop_reason === 'refusal') return [];
  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') return [];
  return (JSON.parse(text.text) as { translations: Translation[] }).translations;
}
