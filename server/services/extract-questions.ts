import Anthropic from '@anthropic-ai/sdk';
import { MAX_IMPORT_QUESTIONS, type QuestionExtractInput } from '../../shared/schemas';
import {
  sanitizeExtractedQuestions,
  type ImportedQuestionDraft,
} from '../../shared/logic/question-import';

// Same model as generate.ts — cheap, fast, supports structured outputs, and reads PDFs natively.
// A short non-agentic extraction call, so no thinking/effort/sampling params.
const MODEL = 'claude-haiku-4-5';

/** Thrown when the model ran out of output tokens mid-JSON; the route turns this into a 502. */
export class ExtractTruncatedError extends Error {
  constructor() {
    super('extraction output was truncated');
    this.name = 'ExtractTruncatedError';
  }
}

const SYSTEM = `You extract exam questions from a teacher's test paper so they can be imported
into a question bank. The input is one test document: plain text, HTML converted from a Word
file, tab-separated spreadsheet rows, or a PDF.

Return the questions in GROUPS. A group is a run of consecutive questions that share something:
a section instruction ("Choose the word whose underlined part is pronounced differently"), a
reading passage, a cloze paragraph, an announcement, or a single set of options used by several
questions. A question that shares nothing with its neighbours is its own group of one.

For each group return:
- "instruction": the section instruction introducing these questions, verbatim, or "" if none
- "text": the passage, paragraph, letter, chart caption or announcement the questions are about,
  copied VERBATIM and in full, or "" if there is none
- "questions": the questions in that group

For each question return:
- "type": "mcq" (one correct option), "multi" (several correct options), "text" (short written
  answer), or "essay" (long written answer, graded by hand)
- "sourceNumber": the question number printed in the document (13 for "Question 13" or "Câu 13"),
  or 0 if it has none
- "prompt": the question text, without its leading number or letter
- "options": the answer choices in document order, each WITHOUT its "A."/"B."/"1)" label.
  Empty for text and essay questions.
- "correctOptionIndexes": 0-based positions into "options" of the correct choices. Empty when
  the document does not say which is correct.
- "acceptedAnswers": for "text" questions only, the accepted answers. Empty otherwise.
- "explanation": the answer explanation if the document gives one, otherwise ""
- "difficulty": "easy", "medium" or "hard" if the document labels it, otherwise "unknown"
- "tags": short topic labels if the document groups questions under headings, otherwise empty

Rules for groups:
- The shared passage belongs in the group's "text", ONCE. Do NOT copy it into each question's
  "prompt" — but never drop it either. A prompt like "According to the passage, what happened?"
  is unanswerable on its own, so the passage MUST appear in "text".
- Copy the passage word for word, including its title and every paragraph. Do not summarise it.
- When several questions share ONE list of options (a "match the sentence to A/B/C/D" block),
  repeat that list in every question's "options" — each question is imported on its own.
- Every question in the document gets returned, in document order, with its printed number. Do
  not skip one because it looks similar to another.

Rules for content:
- Extract only what is in the document. NEVER invent an answer key: if the correct answer is not
  marked anywhere, leave "correctOptionIndexes" and "acceptedAnswers" empty. A teacher will fill
  it in. Guessing is worse than leaving it blank.
- This applies even when you know the answer yourself. You are transcribing a document, not
  answering it: report the answer the DOCUMENT gives, and nothing else. If the paper asks for the
  capital of Vietnam and never marks an option, leave the answer empty even though you know it.
  A key you supplied rather than read would be graded as the teacher's own, unnoticed.
- An answer key may appear as a marked option (bold, underlined, highlighted, starred, or
  parenthesised), as "Answer: B" next to the question, or in an answer list at the end of the
  document.
- Formatting is a MARKED ANSWER only when it marks exactly one whole option and the same
  convention repeats across the paper. Bold or underlined question numbers, headings, section
  titles, quoted words inside a prompt, a single underlined syllable inside a word, and stray
  bold spaces are NOT answer marks — if that is all you see, the paper marks no answers at all.
  When in doubt, leave the answer empty.
- Underlining inside a word or phrase is part of the question (pronunciation and stress items
  depend on it). Transcribe it with underscores around the underlined part: "pleas_ed_",
  "_ch_emistry". Options are plain text, so this is the only way it survives.
- Keep the original language exactly as written — Vietnamese stays Vietnamese. Do not translate,
  reword, or fix spelling.
- Preserve mathematical and scientific notation as written.
- Skip anything that is not part of a question: page headers and footers, page numbers, score
  boxes, name/date lines, and advertising.
- Return at most ${MAX_IMPORT_QUESTIONS} questions in total. If the document has more, return the
  first ${MAX_IMPORT_QUESTIONS} in document order.`;

const SCHEMA = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          instruction: { type: 'string' },
          text: { type: 'string' },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['mcq', 'multi', 'text', 'essay'] },
                sourceNumber: { type: 'integer' },
                prompt: { type: 'string' },
                options: { type: 'array', items: { type: 'string' } },
                correctOptionIndexes: { type: 'array', items: { type: 'integer' } },
                acceptedAnswers: { type: 'array', items: { type: 'string' } },
                explanation: { type: 'string' },
                difficulty: { type: 'string', enum: ['easy', 'medium', 'hard', 'unknown'] },
                tags: { type: 'array', items: { type: 'string' } },
              },
              required: [
                'type',
                'sourceNumber',
                'prompt',
                'options',
                'correctOptionIndexes',
                'acceptedAnswers',
                'explanation',
                'difficulty',
                'tags',
              ],
              additionalProperties: false,
            },
          },
        },
        required: ['instruction', 'text', 'questions'],
        additionalProperties: false,
      },
    },
  },
  required: ['groups'],
  additionalProperties: false,
} as const;

/**
 * Extract questions from an uploaded test paper via the Claude API. Server-side only (the API key
 * is a Worker secret) and, like generateVocabWords, only ever called from inside the
 * TranslateProxy Durable Object so the request egresses from a region Anthropic allows.
 *
 * A PDF is sent as a native document block rather than parsed client-side: Claude reads each page
 * as both text and image, which is what makes scanned papers and two-column layouts work at all.
 * Everything else arrives as text the browser already extracted.
 *
 * Errors are allowed to throw — the DO catches them and returns a 502.
 */
export async function extractQuestions(
  apiKey: string,
  input: QuestionExtractInput,
): Promise<ImportedQuestionDraft[]> {
  const client = new Anthropic({ apiKey });

  // Language handling lives in the system prompt ("keep the original language exactly as
  // written") rather than in a per-request hint: the paper itself is the only reliable signal,
  // and a mixed-language paper would defeat any single flag.
  const instruction = 'Extract the exam questions from this test paper.';

  const content: Anthropic.ContentBlockParam[] =
    input.kind === 'pdf'
      ? [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: input.dataBase64! },
          },
          { type: 'text', text: instruction },
        ]
      : [{ type: 'text', text: `${instruction}\n\n---\n${input.text!}` }];

  // Streamed, and awaited whole. The budget has to be generous — 50 questions with options is a
  // lot of JSON, and reading passages are copied out verbatim on top of that (once per group, not
  // once per question) — and past roughly 16k output tokens the SDK refuses a non-streaming
  // request outright, on the grounds that it could exceed its 10-minute ceiling. Streaming lifts
  // that limit; nothing here consumes the events, so `finalMessage` reassembles the whole reply
  // and the rest of this function is unchanged.
  const response = await client.messages
    .stream({
      model: MODEL,
      max_tokens: 24000,
      system: SYSTEM,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content }],
    })
    .finalMessage();

  if (response.stop_reason === 'refusal') return [];
  // Out of output budget means the JSON object is cut off mid-token; there is no partial result
  // worth salvaging, so tell the teacher to split the file rather than importing half a question.
  if (response.stop_reason === 'max_tokens') throw new ExtractTruncatedError();

  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.text);
  } catch {
    throw new ExtractTruncatedError();
  }
  return sanitizeExtractedQuestions(parsed);
}
