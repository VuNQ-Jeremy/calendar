/**
 * Turn one row of a teacher's question spreadsheet into a draft the review screen can show and the
 * import endpoint will accept.
 *
 * Pure functions only (no React, no network, no DOM) so the whole thing is unit-testable. Lives in
 * shared/ rather than src/ because the review modal re-runs the same normalization after the teacher
 * edits a row, and `question-csv.ts` — which splits the upload into rows — has to reach it too.
 *
 * Three design choices worth knowing, all of them about the ways a row can quietly lie:
 *
 * 1. Option ids are assigned HERE, and the position→id map is rebuilt AFTER blanks, duplicates and
 *    anything past the ten-option cap have been dropped. The answer arrives as a POSITION (the
 *    letter written in the answer column, counted from A), so resolving it against the filtered
 *    array instead would shift the answer onto whichever option closed the gap.
 * 2. `letterIds` maps the PRINTED option position to the id that position was given, with a null
 *    where the option was dropped. A separate answer key says "17. C" and means the third option AS
 *    PRINTED; the letter is only resolvable against the original positions, which is why the holes
 *    are kept open rather than closed up. See shared/logic/answer-key.ts.
 * 3. A question whose answer the file leaves blank is kept and flagged, never discarded. That is not
 *    an edge case but the normal case: a Vietnamese school paper prints its answers in a second
 *    file, so a whole import legitimately arrives with every answer cell empty and is fixed in one
 *    click by pasting the key.
 */

import type { QuestionType } from '../schemas';

/** Mirrors QuestionInputBase's `options` cap and the editor's own MAX_OPTIONS. */
const MAX_OPTIONS = 10;
const MAX_PROMPT = 4000;
const MAX_CONTEXT = 8000;
const MAX_OPTION_TEXT = 500;
const MAX_EXPLANATION = 2000;
const MAX_TAGS = 20;
const MAX_TAG_TEXT = 50;

/** Why a draft needs a human look before it can be saved. i18n keys, resolved by the UI. */
export type ImportIssue =
  | 'qi_issue_no_answer'
  | 'qi_issue_partial_answer'
  | 'qi_issue_downgraded'
  | 'qi_issue_options_capped';

/**
 * One parsed spreadsheet row, split into fields and not yet normalized — what the CSV reader hands
 * over per question.
 *
 * `options` is in PRINTED LETTER ORDER AND INCLUDES BLANKS: position 1 is whatever optionB held,
 * empty string and all. `correctOptionIndexes` are positions into that same array (A→0 … J→9), so
 * an answer letter naming a blank cell finds nothing rather than finding the wrong option.
 */
export type RawQuestionRow = {
  type?: string;
  prompt?: string;
  /** The question number printed on the paper; 0/absent when the row has none. */
  sourceNumber?: number;
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
  /** The instruction and/or passage this row shares with its neighbours, or null when standalone. */
  context: string | null;
  options: { id: string; text: string }[];
  /** mcq -> option id; multi/text -> string[]; essay -> null. Empty when unknown. */
  answerKey: string | string[] | null;
  explanation: string | null;
  difficulty: 'easy' | 'medium' | 'hard' | null;
  tags: string[];
  /** The number this question carries on the paper, for answer-key matching. */
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
 * A cell pasted out of a PDF or a Word file often arrives with decomposed diacritics (`a` + U+0323
 * rather than `ạ`), and Excel preserves whatever it was given. Normalizing to NFC here keeps
 * Vietnamese prompts comparable to everything else in the app — `normalizeText` in
 * shared/logic/tests.ts strips accents at grading time, but the stored text itself should be
 * canonical.
 */
const norm = (s: unknown): string => (typeof s === 'string' ? s.normalize('NFC').trim() : '');

const clamp = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);

const DIFFICULTIES = new Set(['easy', 'medium', 'hard']);

/**
 * Sanitize one parsed row. Returns null when there is nothing salvageable (no prompt), which the
 * caller reports as a skipped row rather than importing a blank question.
 *
 * `newId` is injected so tests can assert which option an answer position resolved to without
 * stubbing globals; production callers get `crypto.randomUUID`.
 */
export function sanitizeQuestion(
  raw: RawQuestionRow,
  context: string | null,
  newId: () => string = () => crypto.randomUUID(),
): ImportedQuestionDraft | null {
  const prompt = clamp(norm(raw?.prompt), MAX_PROMPT);
  if (!prompt) return null;

  const issues: ImportIssue[] = [];

  // ── Options: trim, drop blanks, dedupe, cap. `keptFrom` maps an ORIGINAL position to the new id
  // so the answer's printed letter survives every one of those filters.
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
    // Compared EXACTLY, not case-insensitively. Two cells reading "English" and "english" are two
    // printed options — that is the whole question in "choose the correct capitalisation" — and
    // folding them together would delete the distractors and leave a two-option question that looks
    // deliberate. Only a genuinely repeated cell (the usual copy-paste slip) is a duplicate.
    if (seenText.has(text)) return;
    if (options.length >= MAX_OPTIONS) {
      droppedForCap = true;
      return;
    }
    seenText.add(text);
    const id = newId();
    keptFrom.set(originalIndex, id);
    letterIds[originalIndex] = id;
    options.push({ id, text });
  });
  if (droppedForCap) issues.push('qi_issue_options_capped');

  // Each surviving position yields its own id, so a shortfall here means one of the answer letters
  // named a position that is not there — a blank cell, a repeated cell, or a column the file never
  // had. Counting is the only way to notice: the ids that DID resolve look like a complete answer.
  const wantedPositions = [
    ...new Set(
      (Array.isArray(raw?.correctOptionIndexes) ? raw.correctOptionIndexes : []).map((i) =>
        Number(i),
      ),
    ),
  ];
  const uniqueCorrectIds = [
    ...new Set(
      wantedPositions.map((i) => keptFrom.get(i)).filter((id): id is string => id != null),
    ),
  ];
  const lostAnswerPositions = wantedPositions.length > uniqueCorrectIds.length;

  const acceptedAnswers = [
    ...new Set(
      (Array.isArray(raw?.acceptedAnswers) ? raw.acceptedAnswers : [])
        .map((a) => clamp(norm(a), MAX_OPTION_TEXT))
        .filter((a) => a !== ''),
    ),
  ];

  // ── Type reconciliation. The row's `type` cell is a hint; the surviving data decides, because
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
    // Several letters in the answer cell — that is a multi-select, whatever the row called itself.
    type = 'multi';
  }

  // A partly-resolved answer is flagged separately from a missing one, because the two need
  // different things from the teacher: an empty answer wants the key pasted, while a half-read one
  // wants somebody to look at THIS row. Both leave `issues` non-empty, which is what keeps the
  // review screen from pre-checking the row and importing it unseen — and for a multi-select that
  // matters twice over, since grading is all-or-nothing: a student who picks every printed correct
  // option would be marked wrong by a key that lost one of them.
  let answerKey: string | string[] | null;
  if (type === 'mcq') {
    answerKey = uniqueCorrectIds[0] ?? '';
    if (!answerKey) issues.push('qi_issue_no_answer');
    else if (lostAnswerPositions) issues.push('qi_issue_partial_answer');
  } else if (type === 'multi') {
    answerKey = uniqueCorrectIds;
    if (!uniqueCorrectIds.length) issues.push('qi_issue_no_answer');
    else if (lostAnswerPositions) issues.push('qi_issue_partial_answer');
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

  // The shared text is clamped here rather than by the caller because a passage is repeated
  // verbatim on every row of its group, and the app dedupes consecutive identical contexts when it
  // renders them. Two rows clamped in two places could differ by a character and stop matching.
  const shared = clamp(norm(context), MAX_CONTEXT);

  const choice = type === 'mcq' || type === 'multi';
  return {
    type,
    prompt,
    context: shared || null,
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
