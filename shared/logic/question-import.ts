/**
 * Turn raw Claude output into question drafts the review screen can show and the import endpoint
 * will accept.
 *
 * Pure functions only (no React, no network, no DOM) so the whole thing is unit-testable — the
 * Anthropic call around it is not. Lives in shared/ rather than server/ because the review modal
 * re-runs the same normalization after the teacher edits a row.
 *
 * Two design choices worth knowing:
 *
 * 1. The model returns option TEXT with 0-based `correctOptionIndexes`, never ids. Asking an LLM
 *    to invent and then consistently reference its own ids is a reliable way to get dangling
 *    answer keys; indexes it can count. Ids are assigned here, and the index→id map is rebuilt
 *    AFTER blanks/duplicates are dropped so a filtered-out option cannot shift the answer.
 * 2. A question whose answer key the document never marked is kept, not discarded — with an entry
 *    in `issues` so the UI can flag it and leave it unchecked. Throwing away a perfectly good
 *    multiple-choice question because the answer sheet lived on another page would be worse than
 *    asking the teacher to click the right radio button.
 */

import { MAX_IMPORT_QUESTIONS, type QuestionType } from '../schemas';

/** Mirrors QuestionInputBase's `options` cap and the editor's own MAX_OPTIONS. */
const MAX_OPTIONS = 10;
const MAX_PROMPT = 4000;
const MAX_OPTION_TEXT = 500;
const MAX_EXPLANATION = 2000;
const MAX_TAGS = 20;
const MAX_TAG_TEXT = 50;

/** Why a draft needs a human look before it can be saved. i18n keys, resolved by the UI. */
export type ImportIssue = 'qi_issue_no_answer' | 'qi_issue_downgraded' | 'qi_issue_options_capped';

/** The shape Claude is asked to return — one entry per question, no ids. */
export type RawExtractedQuestion = {
  type?: string;
  prompt?: string;
  options?: string[];
  correctOptionIndexes?: number[];
  acceptedAnswers?: string[];
  explanation?: string;
  difficulty?: string;
  tags?: string[];
};

export type ImportedQuestionDraft = {
  type: QuestionType;
  prompt: string;
  options: { id: string; text: string }[];
  /** mcq -> option id; multi/text -> string[]; essay -> null. Empty when unknown. */
  answerKey: string | string[] | null;
  explanation: string | null;
  difficulty: 'easy' | 'medium' | 'hard' | null;
  tags: string[];
  /** Non-empty means "do not save this as-is" — the review UI leaves such rows unchecked. */
  issues: ImportIssue[];
};

/**
 * PDF and docx text often arrives with decomposed diacritics (`a` + U+0323 rather than `ạ`).
 * Normalizing to NFC here keeps Vietnamese prompts comparable to everything else in the app —
 * `normalizeText` in shared/logic/tests.ts strips accents at grading time, but the stored text
 * itself should be canonical.
 */
const norm = (s: unknown): string => (typeof s === 'string' ? s.normalize('NFC').trim() : '');

const clamp = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);

const DIFFICULTIES = new Set(['easy', 'medium', 'hard']);

/**
 * Sanitize one raw question. Returns null when there is nothing salvageable (no prompt).
 *
 * `newId` is injected so tests can assert on the index→id mapping without stubbing globals;
 * production callers get `crypto.randomUUID`.
 */
function sanitizeOne(raw: RawExtractedQuestion, newId: () => string): ImportedQuestionDraft | null {
  const prompt = clamp(norm(raw?.prompt), MAX_PROMPT);
  if (!prompt) return null;

  const issues: ImportIssue[] = [];

  // ── Options: trim, drop blanks, dedupe, cap. `keptFrom` maps an ORIGINAL index to the new id
  // so the model's answer indexes survive every one of those filters.
  const keptFrom = new Map<number, string>();
  const options: { id: string; text: string }[] = [];
  const seenText = new Set<string>();
  const rawOptions = Array.isArray(raw?.options) ? raw.options : [];
  let droppedForCap = false;
  rawOptions.forEach((optRaw, originalIndex) => {
    const text = clamp(norm(optRaw), MAX_OPTION_TEXT);
    if (!text) return;
    const dedupeKey = text.toLowerCase();
    if (seenText.has(dedupeKey)) return;
    if (options.length >= MAX_OPTIONS) {
      droppedForCap = true;
      return;
    }
    seenText.add(dedupeKey);
    const id = newId();
    keptFrom.set(originalIndex, id);
    options.push({ id, text });
  });
  if (droppedForCap) issues.push('qi_issue_options_capped');

  const correctIds = (Array.isArray(raw?.correctOptionIndexes) ? raw.correctOptionIndexes : [])
    .map((i) => keptFrom.get(Number(i)))
    .filter((id): id is string => id != null);
  const uniqueCorrectIds = [...new Set(correctIds)];

  const acceptedAnswers = [
    ...new Set(
      (Array.isArray(raw?.acceptedAnswers) ? raw.acceptedAnswers : [])
        .map((a) => clamp(norm(a), MAX_OPTION_TEXT))
        .filter((a) => a !== ''),
    ),
  ];

  // ── Type reconciliation. The model's `type` is a hint; the surviving data decides, because
  // QuestionInput's superRefine will reject any combination that disagrees with itself.
  const claimed = norm(raw?.type).toLowerCase();
  let type: QuestionType =
    claimed === 'mcq' || claimed === 'multi' || claimed === 'text' || claimed === 'essay'
      ? claimed
      : options.length >= 2
        ? 'mcq'
        : acceptedAnswers.length > 0
          ? 'text'
          : 'essay';

  if ((type === 'mcq' || type === 'multi') && options.length < 2) {
    // Not enough options to be a choice question at all.
    type = acceptedAnswers.length > 0 ? 'text' : 'essay';
    issues.push('qi_issue_downgraded');
  } else if (type === 'mcq' && uniqueCorrectIds.length > 1) {
    // Several options marked correct — that is a multi-select, whatever the model called it.
    type = 'multi';
  }

  let answerKey: string | string[] | null;
  if (type === 'mcq') {
    answerKey = uniqueCorrectIds[0] ?? '';
    if (!answerKey) issues.push('qi_issue_no_answer');
  } else if (type === 'multi') {
    answerKey = uniqueCorrectIds;
    if (!uniqueCorrectIds.length) issues.push('qi_issue_no_answer');
  } else if (type === 'text') {
    answerKey = acceptedAnswers;
    if (!acceptedAnswers.length) issues.push('qi_issue_no_answer');
  } else {
    answerKey = null;
  }

  const explanation = clamp(norm(raw?.explanation), MAX_EXPLANATION);
  const difficultyRaw = norm(raw?.difficulty).toLowerCase();
  const tags = [
    ...new Set(
      (Array.isArray(raw?.tags) ? raw.tags : [])
        .map((tag) => clamp(norm(tag), MAX_TAG_TEXT))
        .filter((tag) => tag !== ''),
    ),
  ].slice(0, MAX_TAGS);

  return {
    type,
    prompt,
    // An essay/text question must carry no options at all, or the refine rejects it.
    options: type === 'mcq' || type === 'multi' ? options : [],
    answerKey,
    explanation: explanation || null,
    difficulty: DIFFICULTIES.has(difficultyRaw)
      ? (difficultyRaw as 'easy' | 'medium' | 'hard')
      : null,
    tags,
    issues,
  };
}

/**
 * Normalize a whole model response. Malformed output degrades to `[]` rather than throwing —
 * the review screen should say "nothing found", not crash.
 */
export function sanitizeExtractedQuestions(
  raw: unknown,
  newId: () => string = () => crypto.randomUUID(),
): ImportedQuestionDraft[] {
  const rows = Array.isArray(raw) ? raw : [];
  const out: ImportedQuestionDraft[] = [];
  for (const row of rows) {
    const draft = sanitizeOne((row ?? {}) as RawExtractedQuestion, newId);
    if (draft) out.push(draft);
    if (out.length >= MAX_IMPORT_QUESTIONS) break;
  }
  return out;
}
