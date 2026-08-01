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
 * 3. The model returns questions GROUPED (a reading passage and the seven questions under it are
 *    one group), so shared text is emitted once rather than repeated per question. The group's
 *    instruction and passage are flattened into each question's `context` here, because that is
 *    what the rest of the app stores and renders.
 */

import { MAX_IMPORT_QUESTIONS, type QuestionType } from '../schemas';

/** Mirrors QuestionInputBase's `options` cap and the editor's own MAX_OPTIONS. */
const MAX_OPTIONS = 10;
const MAX_PROMPT = 4000;
const MAX_CONTEXT = 8000;
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
  /** The question number printed in the document; 0/absent when it has none. */
  sourceNumber?: number;
  options?: string[];
  correctOptionIndexes?: number[];
  acceptedAnswers?: string[];
  explanation?: string;
  difficulty?: string;
  tags?: string[];
};

/** A run of questions sharing an instruction and/or a passage. */
export type RawExtractedGroup = {
  instruction?: string;
  text?: string;
  questions?: RawExtractedQuestion[];
};

export type ImportedQuestionDraft = {
  type: QuestionType;
  prompt: string;
  /** The group's instruction + passage, or null for a standalone question. */
  context: string | null;
  options: { id: string; text: string }[];
  /** mcq -> option id; multi/text -> string[]; essay -> null. Empty when unknown. */
  answerKey: string | string[] | null;
  explanation: string | null;
  difficulty: 'easy' | 'medium' | 'hard' | null;
  tags: string[];
  /** The number this question carries in the document, for answer-key matching. */
  sourceNumber: number | null;
  /**
   * ORIGINAL option position -> assigned id, `null` where that option was dropped (blank, a
   * duplicate, or past the cap). A separate answer key says "17. C", meaning the third option as
   * PRINTED — resolving that against the filtered `options` array would silently shift the answer.
   * Review-time only; never persisted.
   */
  letterIds: (string | null)[];
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
function sanitizeOne(
  raw: RawExtractedQuestion,
  context: string | null,
  newId: () => string,
): ImportedQuestionDraft | null {
  const prompt = clamp(norm(raw?.prompt), MAX_PROMPT);
  if (!prompt) return null;

  const issues: ImportIssue[] = [];

  // ── Options: trim, drop blanks, dedupe, cap. `keptFrom` maps an ORIGINAL index to the new id
  // so the model's answer indexes survive every one of those filters.
  const keptFrom = new Map<number, string>();
  const options: { id: string; text: string }[] = [];
  const seenText = new Set<string>();
  const rawOptions = Array.isArray(raw?.options) ? raw.options : [];
  const letterIds: (string | null)[] = [];
  let droppedForCap = false;
  rawOptions.forEach((optRaw, originalIndex) => {
    letterIds.push(null);
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
    letterIds[originalIndex] = id;
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

  const sourceNumber = Number(raw?.sourceNumber);

  const choice = type === 'mcq' || type === 'multi';
  return {
    type,
    prompt,
    context,
    // An essay/text question must carry no options at all, or the refine rejects it.
    options: choice ? options : [],
    answerKey,
    explanation: explanation || null,
    difficulty: DIFFICULTIES.has(difficultyRaw)
      ? (difficultyRaw as 'easy' | 'medium' | 'hard')
      : null,
    tags,
    sourceNumber: Number.isInteger(sourceNumber) && sourceNumber > 0 ? sourceNumber : null,
    letterIds: choice ? letterIds : [],
    issues,
  };
}

/** The instruction and the passage, as one block — blank parts dropped, whole thing clamped. */
function groupContext(group: RawExtractedGroup): string | null {
  const joined = [norm(group?.instruction), norm(group?.text)].filter(Boolean).join('\n\n');
  return joined ? clamp(joined, MAX_CONTEXT) : null;
}

/**
 * Throw away every answer on a draft, as if the document had marked nothing.
 *
 * Used when the model has told us — for the document as a whole — that the answers are not in it.
 * A model that has just read forty questions is under enormous pressure to answer them, and asking
 * it forty separate times not to is a losing game; asking it ONCE, up front, whether the paper
 * gives its answers at all is a question it gets right. This is what makes that answer binding.
 */
function withoutAnswers(draft: ImportedQuestionDraft): ImportedQuestionDraft {
  if (draft.type === 'essay') return draft;
  const issues = draft.issues.includes('qi_issue_no_answer')
    ? draft.issues
    : [...draft.issues, 'qi_issue_no_answer' as const];
  return { ...draft, answerKey: draft.type === 'mcq' ? '' : [], issues };
}

/**
 * Normalize a whole model response. Malformed output degrades to `[]` rather than throwing —
 * the review screen should say "nothing found", not crash.
 *
 * Accepts the grouped shape (`{ groups: [{ instruction, text, questions }] }`), and also a bare
 * list of questions: a model that ignores the grouping still produces something importable, and
 * the unit tests exercise single questions without wrapping each one in a group.
 *
 * `answerKeySource: 'none'` on the response means the document does not give its answers anywhere,
 * and every answer that came back with it is discarded — see `withoutAnswers`.
 */
export function sanitizeExtractedQuestions(
  raw: unknown,
  newId: () => string = () => crypto.randomUUID(),
): ImportedQuestionDraft[] {
  const root = raw as { groups?: unknown; questions?: unknown; answerKeySource?: unknown } | null;
  const keyless = root?.answerKeySource === 'none';
  const groups: RawExtractedGroup[] = Array.isArray(root?.groups)
    ? (root.groups as RawExtractedGroup[])
    : Array.isArray(raw)
      ? [{ questions: raw as RawExtractedQuestion[] }]
      : Array.isArray(root?.questions)
        ? [{ questions: root.questions as RawExtractedQuestion[] }]
        : [];

  const out: ImportedQuestionDraft[] = [];
  for (const group of groups) {
    const context = groupContext(group ?? {});
    const rows = Array.isArray(group?.questions) ? group.questions : [];
    for (const row of rows) {
      const draft = sanitizeOne((row ?? {}) as RawExtractedQuestion, context, newId);
      if (draft) out.push(keyless ? withoutAnswers(draft) : draft);
      if (out.length >= MAX_IMPORT_QUESTIONS) return out;
    }
  }
  return out;
}
