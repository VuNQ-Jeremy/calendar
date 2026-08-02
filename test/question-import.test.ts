import { describe, it, expect } from 'vitest';
import { QuestionsImportInput, QuestionInput } from '../shared/schemas';
import {
  sanitizeQuestion,
  type ImportedQuestionDraft,
  type RawQuestionRow,
} from '../shared/logic/question-import';

// Everything here is about ONE row. `sanitizeQuestion` is where a parsed spreadsheet row becomes
// something the question bank will accept, and the only place option ids exist — so this is where
// the answer-remapping, the type reconciliation and the letter map are pinned down. Reading a file
// into rows is question-csv.test.ts; the import schema that decides what may reach the bank is at
// the bottom of this file.

/** Deterministic ids so a test can assert which option an answer position resolved to. */
const seqIds = () => {
  let n = 0;
  return () => `opt${++n}`;
};

const one = (row: RawQuestionRow, context: string | null = null): ImportedQuestionDraft => {
  const draft = sanitizeQuestion(row, context, seqIds());
  if (!draft) throw new Error('the row produced no draft');
  return draft;
};

const mcq = (over: Partial<RawQuestionRow> = {}): RawQuestionRow => ({
  type: 'mcq',
  prompt: 'What is 2 + 2?',
  options: ['3', '4', '5'],
  correctOptionIndexes: [1],
  acceptedAnswers: [],
  explanation: '',
  difficulty: 'unknown',
  tags: [],
  ...over,
});

describe('QuestionsImportInput', () => {
  const valid = {
    type: 'mcq',
    prompt: 'Pick one',
    options: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ],
    answerKey: 'a',
    tags: [],
  };

  it('accepts a batch and enforces the 100-question cap', () => {
    expect(QuestionsImportInput.safeParse({ questions: [valid] }).success).toBe(true);
    expect(QuestionsImportInput.safeParse({ questions: [] }).success).toBe(false);
    const many = Array.from({ length: 101 }, () => valid);
    expect(QuestionsImportInput.safeParse({ questions: many }).success).toBe(false);
  });

  it('rejects the whole batch when any item has a bad answer key', () => {
    const bad = { ...valid, answerKey: 'nope' };
    expect(QuestionsImportInput.safeParse({ questions: [valid, bad] }).success).toBe(false);
  });
});

describe('sanitizeQuestion', () => {
  it('assigns option ids and resolves the answer position against them', () => {
    const q = one(mcq());
    expect(q.options).toEqual([
      { id: 'opt1', text: '3' },
      { id: 'opt2', text: '4' },
      { id: 'opt3', text: '5' },
    ]);
    expect(q.answerKey).toBe('opt2');
    expect(q.issues).toEqual([]);
  });

  it('remaps the answer position after blank and duplicate options are dropped', () => {
    // Position 3 ('D' as printed) is the answer. Position 0 is blank and position 2 repeats position
    // 1 exactly, so after filtering it is the second surviving option — the key must follow it.
    const q = one(mcq({ options: ['  ', 'A', 'A', 'B'], correctOptionIndexes: [3] }));
    expect(q.options.map((o) => o.text)).toEqual(['A', 'B']);
    expect(q.answerKey).toBe(q.options[1].id);
    expect(q.issues).toEqual([]);
  });

  it('keeps options that differ only in capitalisation — that is the whole question', () => {
    // "Choose the correct capitalisation" is a routine item on a Vietnamese English paper. Folding
    // these into one option would delete the distractors, leave a two-option question that looks
    // deliberate, and — with the answer naming one of the deleted letters — resolve to nothing.
    const q = one(
      mcq({ options: ['hanoi', 'Hanoi', 'HANOI', 'HaNoi'], correctOptionIndexes: [1] }),
    );
    expect(q.options.map((o) => o.text)).toEqual(['hanoi', 'Hanoi', 'HANOI', 'HaNoi']);
    expect(q.answerKey).toBe(q.options[1].id);
    expect(q.issues).toEqual([]);
  });

  it('drops an answer position that pointed at a removed option, flagging the row', () => {
    const q = one(mcq({ options: ['A', '   ', 'B'], correctOptionIndexes: [1] }));
    expect(q.answerKey).toBe('');
    expect(q.issues).toContain('qi_issue_no_answer');
  });

  it('flags a multi whose answer named a position that is not there', () => {
    // The file has three option columns and the answer says "C,D" — D resolves to nothing. Keeping
    // the C that DID resolve, silently, is the dangerous outcome: the row looks answered, so the
    // review screen pre-checks it and saves it, and multi grading is all-or-nothing — a student who
    // picks every printed correct option is then marked wrong.
    const q = one(
      mcq({ type: 'multi', options: ['Dolphin', 'Shark', 'Bat'], correctOptionIndexes: [2, 3] }),
    );
    expect(q.type).toBe('multi');
    expect(q.answerKey).toEqual([q.options[2].id]);
    expect(q.issues).toContain('qi_issue_partial_answer');
  });

  it('flags an mcq whose two answer letters only half resolved', () => {
    const q = one(mcq({ options: ['A', '  ', 'C'], correctOptionIndexes: [1, 2] }));
    expect(q.answerKey).toBe(q.options[1].id);
    expect(q.issues).toContain('qi_issue_partial_answer');
  });

  it('does not flag a partial answer when nothing resolved at all', () => {
    // That is the ordinary "the key lives in another file" case, and it has its own flag; carrying
    // both would tell the teacher two different things about one row.
    const q = one(mcq({ options: ['A', 'B'], correctOptionIndexes: [7] }));
    expect(q.issues).toEqual(['qi_issue_no_answer']);
  });

  it('promotes a claimed mcq with several correct options to multi', () => {
    const q = one(mcq({ correctOptionIndexes: [0, 2] }));
    expect(q.type).toBe('multi');
    expect(q.answerKey).toEqual(['opt1', 'opt3']);
    expect(q.issues).toEqual([]);
  });

  it('keeps a choice question whose answer the file never gave, unresolved but intact', () => {
    const q = one(mcq({ correctOptionIndexes: [] }));
    expect(q.type).toBe('mcq');
    expect(q.options).toHaveLength(3);
    expect(q.answerKey).toBe('');
    expect(q.issues).toEqual(['qi_issue_no_answer']);
  });

  it('dedupes repeated correct positions', () => {
    const q = one(mcq({ type: 'multi', correctOptionIndexes: [1, 1, 2] }));
    expect(q.answerKey).toEqual(['opt2', 'opt3']);
  });

  it('downgrades a choice question with too few options', () => {
    const toText = one(mcq({ options: ['only one'], acceptedAnswers: ['Paris'] }));
    expect(toText.type).toBe('text');
    expect(toText.options).toEqual([]);
    expect(toText.answerKey).toEqual(['Paris']);
    expect(toText.issues).toContain('qi_issue_downgraded');

    const toEssay = one(mcq({ options: [], acceptedAnswers: [] }));
    expect(toEssay.type).toBe('essay');
    expect(toEssay.answerKey).toBeNull();
  });

  it('caps options at ten and flags that some were dropped', () => {
    const options = Array.from({ length: 13 }, (_, i) => `option ${i}`);
    const q = one(mcq({ options, correctOptionIndexes: [0] }));
    expect(q.options).toHaveLength(10);
    expect(q.issues).toContain('qi_issue_options_capped');
  });

  it('strips options and the answer key from an essay question', () => {
    const q = one(
      mcq({
        type: 'essay',
        options: ['A', 'B'],
        correctOptionIndexes: [0],
        acceptedAnswers: ['x'],
      }),
    );
    expect(q.options).toEqual([]);
    expect(q.answerKey).toBeNull();
  });

  it('flags a short-answer question with no accepted answers', () => {
    const q = one(mcq({ type: 'text', options: [], acceptedAnswers: ['  ', ''] }));
    expect(q.type).toBe('text');
    expect(q.answerKey).toEqual([]);
    expect(q.issues).toEqual(['qi_issue_no_answer']);
  });

  it('dedupes accepted answers and keeps Vietnamese diacritics', () => {
    const q = one(mcq({ type: 'text', options: [], acceptedAnswers: ['Hà Nội', 'Hà Nội', 'Huế'] }));
    expect(q.answerKey).toEqual(['Hà Nội', 'Huế']);
  });

  it('normalizes decomposed Vietnamese diacritics to NFC', () => {
    // 'ạ' written as 'a' + U+0323 (combining dot below) — how a cell pasted out of a PDF often
    // carries it, and Excel preserves whatever it was given.
    const decomposed = `Bạn nào đúng?`;
    const q = one(mcq({ prompt: decomposed }));
    expect(q.prompt).toBe(decomposed.normalize('NFC'));
    expect(q.prompt).toBe('Bạn nào đúng?');
  });

  it('clamps overlong fields to the schema limits', () => {
    const q = one(
      mcq({
        prompt: 'p'.repeat(4200),
        options: ['o'.repeat(600), 'B'],
        correctOptionIndexes: [1],
        explanation: 'e'.repeat(2500),
        tags: ['t'.repeat(80)],
      }),
      'c'.repeat(9000),
    );
    expect(q.prompt).toHaveLength(4000);
    expect(q.context).toHaveLength(8000);
    expect(q.options[0].text).toHaveLength(500);
    expect(q.explanation).toHaveLength(2000);
    expect(q.tags[0]).toHaveLength(50);
  });

  it('caps tags at twenty and drops blanks and duplicates', () => {
    const tags = ['a', 'a', '  ', ...Array.from({ length: 25 }, (_, i) => `tag${i}`)];
    const q = one(mcq({ tags }));
    expect(q.tags).toHaveLength(20);
    expect(new Set(q.tags).size).toBe(20);
  });

  it('nulls a blank explanation and an unrecognized difficulty', () => {
    const q = one(mcq({ explanation: '   ', difficulty: 'unknown' }));
    expect(q.explanation).toBeNull();
    expect(q.difficulty).toBeNull();
    expect(one(mcq({ difficulty: 'HARD' })).difficulty).toBe('hard');
  });

  it('infers a type when the row omits or misnames it', () => {
    expect(one(mcq({ type: undefined })).type).toBe('mcq');
    expect(one(mcq({ type: 'true_false' })).type).toBe('mcq');
    expect(one(mcq({ type: 'weird', options: [], acceptedAnswers: ['x'] })).type).toBe('text');
  });

  it('carries the shared context through, and has none rather than an empty one', () => {
    const passage = 'Read the passage and answer.\n\nWater covers most of the planet.';
    expect(one(mcq(), passage).context).toBe(passage);
    expect(one(mcq(), '   ').context).toBeNull();
    expect(one(mcq(), null).context).toBeNull();
  });

  it('keeps the printed question number and drops a nonsense one', () => {
    expect(one(mcq({ sourceNumber: 17 })).sourceNumber).toBe(17);
    expect(one(mcq({ sourceNumber: 0 })).sourceNumber).toBeNull();
    expect(one(mcq({ sourceNumber: undefined })).sourceNumber).toBeNull();
    expect(one(mcq({ sourceNumber: -3 })).sourceNumber).toBeNull();
  });

  it('returns null for a row with no prompt rather than importing a blank question', () => {
    expect(sanitizeQuestion(mcq({ prompt: '   ' }), null, seqIds())).toBeNull();
    expect(sanitizeQuestion({}, null, seqIds())).toBeNull();
  });

  it('survives a row whose fields are not the shape they should be', () => {
    // Nothing upstream guarantees these shapes — a hand-edited sheet, or the review modal
    // re-normalizing a draft it has been editing, can hand over anything. Degrade, never throw.
    const malformed = {
      prompt: 'Q',
      options: 'nope',
      correctOptionIndexes: 'nope',
      tags: 'nope',
    } as unknown as RawQuestionRow;
    const q = one(malformed);
    expect(q.type).toBe('essay');
    expect(q.options).toEqual([]);
    expect(q.tags).toEqual([]);
    expect(sanitizeQuestion(undefined as unknown as RawQuestionRow, null, seqIds())).toBeNull();
  });

  /**
   * The subtle one. "17. C" names the THIRD option AS PRINTED. If a blank or duplicate option was
   * dropped in between, counting into the surviving array would silently shift the answer, so the
   * map has to be keyed on the original position with a hole where an option went. `applyAnswerKey`
   * in shared/logic/answer-key.ts reads nothing else.
   */
  it('maps every printed option position to its id, with holes for dropped options', () => {
    const q = one(mcq({ options: ['A', '   ', 'A', 'B'], correctOptionIndexes: [] }));
    expect(q.options.map((o) => o.text)).toEqual(['A', 'B']);
    // Printed A, B(blank), C(repeats A), D -> only A and D survive, at their own positions.
    expect(q.letterIds).toEqual([q.options[0].id, null, null, q.options[1].id]);
  });

  it('has no letter map for a question with no options', () => {
    expect(one(mcq({ type: 'essay', options: [] })).letterIds).toEqual([]);
    expect(one(mcq({ type: 'text', options: [], acceptedAnswers: ['x'] })).letterIds).toEqual([]);
  });

  it('leaves a hole for an option dropped by the ten-option cap', () => {
    const options = Array.from({ length: 12 }, (_, i) => `option ${i}`);
    const q = one(mcq({ options, correctOptionIndexes: [0] }));
    expect(q.letterIds).toHaveLength(12);
    expect(q.letterIds.slice(10)).toEqual([null, null]);
  });

  /**
   * The load-bearing invariant: the review UI pre-checks every issue-free row, so anything the
   * sanitizer returns clean must survive the refined QuestionInput the import intent parses with.
   * If this breaks, teachers get a 400 on a row the UI told them was fine.
   */
  it('returns only rows the server will accept when there are no issues', () => {
    const raws: RawQuestionRow[] = [
      mcq(),
      mcq({ correctOptionIndexes: [0, 1] }),
      mcq({ type: 'text', options: [], acceptedAnswers: ['Hà Nội'] }),
      mcq({ type: 'essay', options: [], correctOptionIndexes: [], acceptedAnswers: [] }),
      mcq({ options: ['  ', 'A', 'a', 'B'], correctOptionIndexes: [3] }),
      mcq({ prompt: 'p'.repeat(4200), explanation: 'e'.repeat(2500), tags: ['x'.repeat(80)] }),
      mcq({ type: 'multi', correctOptionIndexes: [1, 1, 2] }),
    ];
    // One id generator across the batch, so no two rows can share an option id.
    const newId = seqIds();
    const drafts = raws
      .map((raw) => sanitizeQuestion(raw, 'A shared passage.', newId))
      .filter((draft): draft is ImportedQuestionDraft => draft != null);
    expect(drafts.length).toBe(raws.length);
    for (const draft of drafts) {
      if (draft.issues.length) continue;
      const parsed = QuestionInput.safeParse({
        type: draft.type,
        prompt: draft.prompt,
        context: draft.context,
        gradeLevelId: null,
        difficulty: draft.difficulty,
        tags: draft.tags,
        options: draft.options,
        answerKey: draft.answerKey,
        explanation: draft.explanation,
      });
      expect(parsed.success, `${draft.type}: ${JSON.stringify(parsed.error?.flatten())}`).toBe(
        true,
      );
    }
  });
});
