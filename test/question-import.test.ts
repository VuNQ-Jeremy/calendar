import { describe, it, expect } from 'vitest';
import { QuestionExtractInput, QuestionsImportInput, QuestionInput } from '../shared/schemas';
import {
  sanitizeExtractedQuestions,
  type ImportedQuestionDraft,
  type RawExtractedQuestion,
} from '../shared/logic/question-import';

// The Anthropic call itself is not tested (network-bound, like enrich.ts and generate.ts). What IS
// tested is everything downstream of it: the request schema, the sanitizer the review UI trusts,
// and the import schema that decides what may reach the question bank.

/** Deterministic ids so a test can assert which option an answer index resolved to. */
const seqIds = () => {
  let n = 0;
  return () => `opt${++n}`;
};

const sanitize = (rows: RawExtractedQuestion[]): ImportedQuestionDraft[] =>
  sanitizeExtractedQuestions(rows, seqIds());

const one = (row: RawExtractedQuestion): ImportedQuestionDraft => {
  const out = sanitize([row]);
  expect(out).toHaveLength(1);
  return out[0];
};

const mcq = (over: Partial<RawExtractedQuestion> = {}): RawExtractedQuestion => ({
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

describe('QuestionExtractInput', () => {
  it('requires text for a text request and base64 for a pdf request', () => {
    expect(QuestionExtractInput.safeParse({ kind: 'text', text: '1. Hi?' }).success).toBe(true);
    expect(QuestionExtractInput.safeParse({ kind: 'text' }).success).toBe(false);
    expect(QuestionExtractInput.safeParse({ kind: 'text', text: '   ' }).success).toBe(false);
    expect(QuestionExtractInput.safeParse({ kind: 'pdf', dataBase64: 'JVBER' }).success).toBe(true);
    expect(QuestionExtractInput.safeParse({ kind: 'pdf' }).success).toBe(false);
  });

  it('rejects an unknown kind and an oversized payload', () => {
    expect(QuestionExtractInput.safeParse({ kind: 'docx', text: 'x' }).success).toBe(false);
    expect(
      QuestionExtractInput.safeParse({ kind: 'text', text: 'x'.repeat(200_001) }).success,
    ).toBe(false);
  });
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

describe('sanitizeExtractedQuestions', () => {
  it('assigns option ids and resolves the answer index against them', () => {
    const q = one(mcq());
    expect(q.options).toEqual([
      { id: 'opt1', text: '3' },
      { id: 'opt2', text: '4' },
      { id: 'opt3', text: '5' },
    ]);
    expect(q.answerKey).toBe('opt2');
    expect(q.issues).toEqual([]);
  });

  it('remaps the answer index after blank and duplicate options are dropped', () => {
    // Raw index 3 ('B') is the answer. Index 0 is blank and index 2 duplicates index 1, so after
    // filtering 'B' is the second surviving option — the key must follow it, not the index.
    const q = one(mcq({ options: ['  ', 'A', 'a', 'B'], correctOptionIndexes: [3] }));
    expect(q.options.map((o) => o.text)).toEqual(['A', 'B']);
    expect(q.answerKey).toBe(q.options[1].id);
    expect(q.issues).toEqual([]);
  });

  it('drops an answer index that pointed at a removed option, flagging the row', () => {
    const q = one(mcq({ options: ['A', '   ', 'B'], correctOptionIndexes: [1] }));
    expect(q.answerKey).toBe('');
    expect(q.issues).toContain('qi_issue_no_answer');
  });

  it('promotes a claimed mcq with several correct options to multi', () => {
    const q = one(mcq({ correctOptionIndexes: [0, 2] }));
    expect(q.type).toBe('multi');
    expect(q.answerKey).toEqual(['opt1', 'opt3']);
    expect(q.issues).toEqual([]);
  });

  it('keeps a choice question whose answer the document never marked, unresolved but intact', () => {
    const q = one(mcq({ correctOptionIndexes: [] }));
    expect(q.type).toBe('mcq');
    expect(q.options).toHaveLength(3);
    expect(q.answerKey).toBe('');
    expect(q.issues).toEqual(['qi_issue_no_answer']);
  });

  it('dedupes repeated correct indexes', () => {
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
    // 'ạ' written as 'a' + U+0323 (combining dot below) — how a PDF text layer often carries it.
    const decomposed = `Bạn nào đúng?`;
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
    );
    expect(q.prompt).toHaveLength(4000);
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

  it('infers a type when the model omits or misnames it', () => {
    expect(one(mcq({ type: undefined })).type).toBe('mcq');
    expect(one(mcq({ type: 'true_false' })).type).toBe('mcq');
    expect(one(mcq({ type: 'weird', options: [], acceptedAnswers: ['x'] })).type).toBe('text');
  });

  it('drops questions with no prompt rather than importing a blank row', () => {
    expect(sanitize([mcq({ prompt: '   ' }), mcq()])).toHaveLength(1);
  });

  it('caps the batch at fifty questions', () => {
    const many = Array.from({ length: 60 }, (_, i) => mcq({ prompt: `Q${i}` }));
    expect(sanitize(many)).toHaveLength(50);
  });

  it('survives malformed model output rather than throwing at the UI', () => {
    expect(sanitizeExtractedQuestions(undefined)).toEqual([]);
    expect(sanitizeExtractedQuestions(null)).toEqual([]);
    expect(sanitizeExtractedQuestions('not an array')).toEqual([]);
    expect(sanitizeExtractedQuestions([null, undefined, {}, 42])).toEqual([]);
    expect(
      sanitizeExtractedQuestions([{ prompt: 'Q', options: 'nope', correctOptionIndexes: 'nope' }]),
    ).toHaveLength(1);
  });

  /**
   * The load-bearing invariant: the review UI pre-checks every issue-free row, so anything the
   * sanitizer returns clean must survive the refined QuestionInput the import intent parses with.
   * If this breaks, teachers get a 400 on a row the UI told them was fine.
   */
  it('returns only rows the server will accept when there are no issues', () => {
    const raws: RawExtractedQuestion[] = [
      mcq(),
      mcq({ correctOptionIndexes: [0, 1] }),
      mcq({ type: 'text', options: [], acceptedAnswers: ['Hà Nội'] }),
      mcq({ type: 'essay', options: [], correctOptionIndexes: [], acceptedAnswers: [] }),
      mcq({ options: ['  ', 'A', 'a', 'B'], correctOptionIndexes: [3] }),
      mcq({ prompt: 'p'.repeat(4200), explanation: 'e'.repeat(2500), tags: ['x'.repeat(80)] }),
      mcq({ type: 'multi', correctOptionIndexes: [1, 1, 2] }),
    ];
    const drafts = sanitize(raws);
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

/**
 * The model returns questions grouped, so a reading passage is emitted once instead of being
 * repeated under each of the seven questions about it. Flattening is where that shared text turns
 * into the per-question `context` the rest of the app stores.
 */
describe('sanitizeExtractedQuestions — groups', () => {
  const grouped = (groups: unknown) => sanitizeExtractedQuestions({ groups }, seqIds());

  it('copies the group instruction and passage onto every question in it', () => {
    const out = grouped([
      {
        instruction: 'Read the passage and answer the questions.',
        text: 'Water covers most of the planet.',
        questions: [mcq({ prompt: 'Q1' }), mcq({ prompt: 'Q2' })],
      },
      { instruction: '', text: '', questions: [mcq({ prompt: 'Q3' })] },
    ]);
    expect(out).toHaveLength(3);
    expect(out[0].context).toBe(
      'Read the passage and answer the questions.\n\nWater covers most of the planet.',
    );
    expect(out[1].context).toBe(out[0].context);
    // A standalone question carries no context at all rather than an empty string.
    expect(out[2].context).toBeNull();
  });

  it('keeps an instruction-only or passage-only group, and clamps a very long passage', () => {
    expect(
      grouped([{ instruction: 'Choose the odd one out.', questions: [mcq()] }])[0].context,
    ).toBe('Choose the odd one out.');
    expect(grouped([{ text: 'Just a passage.', questions: [mcq()] }])[0].context).toBe(
      'Just a passage.',
    );
    expect(grouped([{ text: 'p'.repeat(9000), questions: [mcq()] }])[0].context).toHaveLength(8000);
  });

  it('caps the whole batch at fifty across groups', () => {
    const out = grouped(
      Array.from({ length: 6 }, (_, g) => ({
        text: `passage ${g}`,
        questions: Array.from({ length: 10 }, (_, i) => mcq({ prompt: `G${g}Q${i}` })),
      })),
    );
    expect(out).toHaveLength(50);
  });

  it('still accepts a flat list of questions, in case the model ignores the grouping', () => {
    const out = sanitizeExtractedQuestions({ questions: [mcq()] }, seqIds());
    expect(out).toHaveLength(1);
    expect(out[0].context).toBeNull();
  });

  it('keeps the printed question number and drops a nonsense one', () => {
    expect(one(mcq({ sourceNumber: 17 })).sourceNumber).toBe(17);
    expect(one(mcq({ sourceNumber: 0 })).sourceNumber).toBeNull();
    expect(one(mcq({ sourceNumber: undefined })).sourceNumber).toBeNull();
    expect(one(mcq({ sourceNumber: -3 })).sourceNumber).toBeNull();
  });

  /**
   * The subtle one. "17. C" names the THIRD option AS PRINTED. If a blank or duplicate option was
   * dropped in between, counting into the surviving array would silently shift the answer, so the
   * map has to be keyed on the original position with a hole where an option went.
   */
  it('maps every printed option position to its id, with holes for dropped options', () => {
    const q = one(mcq({ options: ['A', '   ', 'a', 'B'], correctOptionIndexes: [] }));
    expect(q.options.map((o) => o.text)).toEqual(['A', 'B']);
    // Printed A, B(blank), C(duplicate of A), D -> only A and D survive, at their own positions.
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
});
