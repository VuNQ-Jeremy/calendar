import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { MAX_IMPORT_QUESTIONS, QuestionInput } from '../shared/schemas';
import {
  TEMPLATE_CSV,
  ExtractInputError,
  parseQuestionRows,
  type ParsedCsv,
} from '../shared/logic/question-csv';
import type { ImportedQuestionDraft } from '../shared/logic/question-import';
import { parseAnswerKey, applyAnswerKey } from '../shared/logic/answer-key';

// The parser is the only thing between a teacher's spreadsheet and the question bank, and almost
// every way it can go wrong produces a question that imports "successfully" and is quietly wrong:
// an answer letter one column off, a row silently dropped, a passage attached to the wrong
// question. So the fixtures here are matrices of strings rather than files — that is exactly what
// SheetJS hands over — and the assertions name the option ID an answer resolved to, never its index.
//
// The one test that matters most is the blank-option case: `letterIds` and `applyAnswerKey` have to
// agree about what the letter "C" means, and nothing but a test forces them to.

const HEADER = [
  'number',
  'type',
  'context',
  'prompt',
  'optionA',
  'optionB',
  'optionC',
  'optionD',
  'answer',
  'explanation',
  'difficulty',
  'tags',
] as const;

type Cells = Partial<Record<(typeof HEADER)[number], string>>;

/** One data row, in canonical column order, with every unmentioned column left blank. */
const dataRow = (cells: Cells): string[] => HEADER.map((column) => cells[column] ?? '');

/** The canonical header plus some data rows — the shape SheetJS produces for the template. */
const sheet = (...rows: Cells[]): string[][] => [[...HEADER], ...rows.map(dataRow)];

/** Deterministic ids, so two parses of the same content are comparable and an id can be named. */
const seqIds = () => {
  let n = 0;
  return () => `opt${++n}`;
};

const parse = (rows: string[][]): ParsedCsv => parseQuestionRows(rows, seqIds());

const only = (cells: Cells): ImportedQuestionDraft => {
  const { drafts } = parse(sheet(cells));
  expect(drafts).toHaveLength(1);
  return drafts[0];
};

describe('TEMPLATE_CSV', () => {
  it('is the canonical twelve-column header with four example rows', () => {
    const lines = TEMPLATE_CSV.split('\n');
    expect(lines[0]).toBe(
      'number,type,context,prompt,optionA,optionB,optionC,optionD,answer,explanation,difficulty,tags',
    );
    // Five lines and one trailing newline, so the split leaves exactly one empty string at the end.
    expect(lines).toHaveLength(6);
    expect(lines[5]).toBe('');
    expect(TEMPLATE_CSV).not.toContain('\r');
    expect(TEMPLATE_CSV.charCodeAt(0)).not.toBe(0xfeff);
  });

  it('parses back into the four questions it demonstrates', () => {
    const book = XLSX.read(TEMPLATE_CSV, { type: 'string' });
    const rows = XLSX.utils.sheet_to_json<string[]>(book.Sheets[book.SheetNames[0]], {
      header: 1,
      raw: false,
      defval: '',
    });
    const { drafts, skipped, truncated } = parse(rows);
    expect(drafts.map((draft) => draft.type)).toEqual(['mcq', 'multi', 'mcq', 'text']);
    expect(drafts.map((draft) => draft.sourceNumber)).toEqual([1, 2, 3, 4]);
    expect(skipped).toEqual([]);
    expect(truncated).toBe(false);
    // Row 3 is the shared-context example; row 4 is the empty-option-columns-plus-piped-key example.
    expect(drafts[2].context).toContain('Sewage pollution');
    expect(drafts[3].options).toEqual([]);
    expect(drafts[3].answerKey).toEqual(['since', 'Since']);
    // Nothing in the template needs a human look — a template that imported with warnings would
    // teach the teacher that warnings are normal.
    for (const draft of drafts) expect(draft.issues).toEqual([]);
  });
});

describe('finding the header', () => {
  it('reads a header in mixed case, with padding and a byte-order mark on its first cell', () => {
    const rows = [
      [
        '﻿ Number ',
        'Type',
        ' CONTEXT',
        'Prompt ',
        'OptionA',
        'option B',
        'OPTIONC',
        'optionD',
        'Answer',
        'Explanation',
        ' Difficulty',
        'TAGS',
      ],
      ['1', 'mcq', '', 'What is 2 + 2?', '3', '4', '5', '', 'B', 'Two and two.', 'easy', 'maths'],
    ];
    const draft = parse(rows).drafts[0];
    expect(draft.sourceNumber).toBe(1);
    expect(draft.prompt).toBe('What is 2 + 2?');
    expect(draft.answerKey).toBe(draft.options[1].id);
    expect(draft.explanation).toBe('Two and two.');
    expect(draft.difficulty).toBe('easy');
    expect(draft.tags).toEqual(['maths']);
  });

  it('discards preamble rows above the header', () => {
    const rows = [
      ['ĐỀ KIỂM TRA GIỮA KỲ — ANH 9', '', ''],
      [],
      [...HEADER],
      dataRow({ number: '1', prompt: 'Q1', optionA: 'a', optionB: 'b', answer: 'B' }),
    ];
    const { drafts, skipped } = parse(rows);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].prompt).toBe('Q1');
    // The title row is above the header, so it is preamble rather than a row that lost its prompt.
    expect(skipped).toEqual([]);
  });

  it('accepts the documented aliases for every column', () => {
    const rows = [
      [
        'no',
        'type',
        'passage',
        'question',
        'option A',
        'option b',
        'key',
        'explain',
        'level',
        'tag',
      ],
      [
        '12',
        '',
        'A shared passage.',
        'Pick one',
        'wrong',
        'right',
        'b',
        'because',
        'hard',
        'unit 3',
      ],
    ];
    const draft = parse(rows).drafts[0];
    expect(draft.sourceNumber).toBe(12);
    expect(draft.context).toBe('A shared passage.');
    expect(draft.prompt).toBe('Pick one');
    expect(draft.type).toBe('mcq');
    expect(draft.answerKey).toBe(draft.options[1].id);
    expect(draft.explanation).toBe('because');
    expect(draft.difficulty).toBe('hard');
    expect(draft.tags).toEqual(['unit 3']);
  });

  it('ignores columns it has no use for', () => {
    const rows = [
      ['prompt', 'points', 'optionA', 'optionB', 'answer', 'written by'],
      ['Pick one', '2.5', 'wrong', 'right', 'B', 'Ms Lan'],
    ];
    const draft = parse(rows).drafts[0];
    expect(draft.prompt).toBe('Pick one');
    expect(draft.answerKey).toBe(draft.options[1].id);
    expect(draft.tags).toEqual([]);
  });

  it('throws a bad-header error when no column names the prompt', () => {
    // `question_text` is deliberately not an alias: matching on a substring would claim a column
    // whose author meant something else by it.
    const rows = [
      ['number', 'type', 'context', 'question_text', 'optionA', 'optionB', 'answer'],
      ['1', 'mcq', '', 'Pick one', 'wrong', 'right', 'B'],
    ];
    expect(() => parse(rows)).toThrow(ExtractInputError);
    expect(() => parse(rows)).toThrow('qi_err_bad_header');
    expect(() => parse([])).toThrow('qi_err_bad_header');
  });

  it('gives up rather than scanning a whole sheet of prose for a header', () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => [`note ${i}`]),
      [...HEADER],
      dataRow({ prompt: 'Q1', answer: 'x' }),
    ];
    expect(() => parse(rows)).toThrow('qi_err_bad_header');
  });

  it('takes the filled column when a header letter repeats', () => {
    // A teacher inserts a column and copies its heading across, leaving one of the two empty. Taking
    // the first COLUMN rather than the first filled one would read this as a single-option question,
    // downgrade it to a short answer, and store the letter "B" as the text a student must type.
    const rows = [
      ['number', 'prompt', 'optionA', 'optionB', 'optionB', 'answer'],
      ['1', 'Pick one', 'wrong', '', 'right', 'B'],
    ];
    const draft = parse(rows).drafts[0];
    expect(draft.type).toBe('mcq');
    expect(draft.options.map((o) => o.text)).toEqual(['wrong', 'right']);
    expect(draft.answerKey).toBe(draft.options[1].id);
    expect(draft.issues).toEqual([]);
  });
});

describe('the column letter is the printed letter', () => {
  /** optionB left blank on purpose: C must still mean the THIRD printed option. */
  const gapped: Cells = {
    number: '1',
    type: 'mcq',
    prompt: 'Which underlined sound is different?',
    optionA: 'st_o_p',
    optionC: 'g_o_',
    optionD: 'h_o_me',
  };

  it('resolves an answer letter across a blank option column', () => {
    const draft = only({ ...gapped, answer: 'C' });
    expect(draft.options.map((option) => option.text)).toEqual(['st_o_p', 'g_o_', 'h_o_me']);
    // The id, not the index: an index assertion would still pass if the answer had shifted along
    // with the options, which is the exact bug this whole arrangement exists to prevent.
    const printedC = draft.options[1];
    expect(printedC.text).toBe('g_o_');
    expect(draft.answerKey).toBe(printedC.id);
    expect(draft.issues).toEqual([]);
    expect(draft.letterIds).toEqual([draft.options[0].id, null, printedC.id, draft.options[2].id]);
  });

  it('agrees with a separate answer key that says "1. C"', () => {
    // The cross-check: the answer column and a pasted key are two independent readers of the same
    // letter, and they have to land on the same option id or one of them is lying to the teacher.
    const draft = only({ ...gapped, answer: 'C' });
    const { applied, unresolvedNumbers } = applyAnswerKey(
      [{ type: draft.type, letterIds: draft.letterIds, sourceNumber: draft.sourceNumber }],
      parseAnswerKey('1. C'),
    );
    expect(unresolvedNumbers).toEqual([]);
    expect(applied).toEqual([{ index: 0, type: 'mcq', answerKey: draft.answerKey }]);
  });

  it('leaves the row unanswered when the letter names a blank column', () => {
    const draft = only({ ...gapped, answer: 'B' });
    expect(draft.issues).toContain('qi_issue_no_answer');
    expect(draft.answerKey).toBe('');
    // Nothing half-applied: the option that now sits where B would have been is not the answer.
    expect(draft.options.map((option) => option.id)).not.toContain(draft.answerKey);
  });

  it('leaves the row unanswered when the letter names a column the file does not have', () => {
    const draft = only({ prompt: 'Pick one', optionA: 'wrong', optionB: 'right', answer: 'E' });
    expect(draft.issues).toContain('qi_issue_no_answer');
    expect(draft.answerKey).toBe('');
  });

  it('leaves the row unanswered when the answer cell holds option text instead of a letter', () => {
    const draft = only({ prompt: 'Pick one', optionA: 'wrong', optionB: 'right', answer: 'right' });
    expect(draft.issues).toContain('qi_issue_no_answer');
    expect(draft.answerKey).toBe('');
  });

  it('promotes two letters to a multi-select naming both printed options', () => {
    const draft = only({
      type: 'mcq',
      prompt: 'Which TWO of these animals are mammals?',
      optionA: 'Dolphin',
      optionB: 'Shark',
      optionC: 'Bat',
      optionD: 'Tuna',
      answer: 'B,D',
    });
    expect(draft.type).toBe('multi');
    expect(draft.answerKey).toEqual([draft.options[1].id, draft.options[3].id]);
    expect(draft.issues).toEqual([]);
  });

  it('reads a lowercase letter with trailing punctuation', () => {
    const draft = only({ prompt: 'Pick one', optionA: 'wrong', optionB: 'right', answer: 'b.' });
    expect(draft.answerKey).toBe(draft.options[1].id);
  });

  it('reads two letters however the teacher joined them', () => {
    for (const answer of ['A,C', 'A;C', 'A/C', 'A & C', 'A + C', 'A C']) {
      const draft = only({
        type: 'multi',
        prompt: 'Pick two',
        optionA: 'a',
        optionB: 'b',
        optionC: 'c',
        answer,
      });
      expect(draft.answerKey, answer).toEqual([draft.options[0].id, draft.options[2].id]);
    }
  });
});

describe('short-answer and essay rows', () => {
  it('splits a piped answer into accepted spellings', () => {
    const draft = only({
      type: 'text',
      prompt: 'Complete the sentence: She has lived here ___ 2010.',
      answer: 'since | Since',
    });
    expect(draft.type).toBe('text');
    expect(draft.options).toEqual([]);
    expect(draft.letterIds).toEqual([]);
    expect(draft.answerKey).toEqual(['since', 'Since']);
    expect(draft.issues).toEqual([]);
  });

  it('takes a single short answer as written, diacritics and all', () => {
    const draft = only({ type: 'text', prompt: 'Capital of Vietnam?', answer: 'Hà Nội' });
    expect(draft.answerKey).toEqual(['Hà Nội']);
  });

  it('leaves an essay row with no options and no answer key at all', () => {
    const draft = only({
      type: 'essay',
      prompt: 'Write about 120 words on reducing plastic waste.',
      explanation: 'Any reasoned answer with two suggestions.',
      difficulty: 'hard',
    });
    expect(draft.type).toBe('essay');
    expect(draft.options).toEqual([]);
    expect(draft.answerKey).toBeNull();
    expect(draft.explanation).toBe('Any reasoned answer with two suggestions.');
    expect(draft.issues).toEqual([]);
  });
});

describe('inferring the type from the row itself', () => {
  it('reads two or more filled option cells as a multiple choice', () => {
    expect(only({ prompt: 'Q', optionA: 'a', optionB: 'b', answer: 'A' }).type).toBe('mcq');
  });

  it('reads a filled answer with no options as a short answer', () => {
    const draft = only({ prompt: 'Q', answer: 'Hanoi' });
    expect(draft.type).toBe('text');
    expect(draft.answerKey).toEqual(['Hanoi']);
  });

  it('reads a row with neither options nor an answer as an essay', () => {
    expect(only({ prompt: 'Q' }).type).toBe('essay');
  });

  it('takes an explicit type over the inference, because it changes what the answer cell means', () => {
    // Inference would call this an mcq and read "B" as a letter. The row says text, so "B" is the
    // accepted spelling instead — a fill-in-the-blank answer really can be a single letter.
    const text = only({
      type: 'text',
      prompt: 'Write the letter that is silent in "knee".',
      answer: 'B',
    });
    expect(text.type).toBe('text');
    expect(text.answerKey).toEqual(['B']);

    // And a row that calls itself multi keeps that even with one letter in the answer.
    const multi = only({ type: 'multi', prompt: 'Q', optionA: 'a', optionB: 'b', answer: 'A' });
    expect(multi.type).toBe('multi');
    expect(multi.answerKey).toEqual([multi.options[0].id]);
  });

  it('downgrades a row that claims a choice type but has fewer than two options', () => {
    const draft = only({ type: 'mcq', prompt: 'Q', optionA: 'the only one', answer: 'A' });
    expect(draft.type).toBe('essay');
    expect(draft.options).toEqual([]);
    expect(draft.issues).toContain('qi_issue_downgraded');
  });
});

describe('rows the parser will not guess at', () => {
  it('skips a fully blank row in silence', () => {
    const rows = [
      [...HEADER],
      dataRow({ prompt: 'Q1', answer: 'a' }),
      HEADER.map(() => ''),
      [],
      dataRow({ prompt: 'Q2', answer: 'b' }),
    ];
    const { drafts, skipped } = parse(rows);
    expect(drafts.map((draft) => draft.prompt)).toEqual(['Q1', 'Q2']);
    expect(skipped).toEqual([]);
  });

  it('reports a row with content but no prompt, by its spreadsheet row number', () => {
    // A preamble row above the header, so the arithmetic is actually exercised: the header is
    // spreadsheet row 2, and the promptless row is row 4 — which is what the teacher sees in Excel.
    const rows = [
      ['Mid-term test — Grade 9'],
      [...HEADER],
      dataRow({ number: '1', prompt: 'Q1', optionA: 'a', optionB: 'b', answer: 'A' }),
      dataRow({ number: '2', optionA: 'a', optionB: 'b', answer: 'B' }),
      dataRow({ number: '3', prompt: 'Q3', optionA: 'a', optionB: 'b', answer: 'A' }),
    ];
    const { drafts, skipped } = parse(rows);
    expect(drafts.map((draft) => draft.prompt)).toEqual(['Q1', 'Q3']);
    expect(skipped).toEqual([4]);
  });

  it('truncates at the import cap, and does not call an exactly-full file truncated', () => {
    const question = (n: number): Cells => ({
      number: String(n),
      prompt: `Question ${n}`,
      optionA: 'a',
      optionB: 'b',
      answer: 'A',
    });
    const over = sheet(
      ...Array.from({ length: MAX_IMPORT_QUESTIONS + 1 }, (_, i) => question(i + 1)),
    );
    const overParsed = parse(over);
    expect(overParsed.drafts).toHaveLength(MAX_IMPORT_QUESTIONS);
    expect(overParsed.truncated).toBe(true);

    const exact = parse(over.slice(0, MAX_IMPORT_QUESTIONS + 1));
    expect(exact.drafts).toHaveLength(MAX_IMPORT_QUESTIONS);
    expect(exact.truncated).toBe(false);
  });
});

describe('the remaining columns', () => {
  it('splits tags on either separator, and caps their number and length', () => {
    expect(
      only({ prompt: 'Q', answer: 'x', tags: ' reading ; grammar, unit 3 ,, reading ' }).tags,
    ).toEqual(['reading', 'grammar', 'unit 3']);
    const tags = Array.from({ length: 25 }, (_, i) => `tag${i}`).join(',');
    expect(only({ prompt: 'Q', answer: 'x', tags }).tags).toHaveLength(20);
    expect(only({ prompt: 'Q', answer: 'x', tags: 't'.repeat(80) }).tags[0]).toHaveLength(50);
  });

  it('reads the printed number however the paper writes it, and null when it is not a number', () => {
    expect(only({ number: '1.', prompt: 'Q', answer: 'x' }).sourceNumber).toBe(1);
    expect(only({ number: 'Câu 12', prompt: 'Q', answer: 'x' }).sourceNumber).toBe(12);
    expect(only({ number: 'Question 7:', prompt: 'Q', answer: 'x' }).sourceNumber).toBe(7);
    expect(only({ number: '—', prompt: 'Q', answer: 'x' }).sourceNumber).toBeNull();
    expect(only({ prompt: 'Q', answer: 'x' }).sourceNumber).toBeNull();
  });

  it('rejects an unrecognized difficulty rather than the row', () => {
    expect(only({ prompt: 'Q', answer: 'x', difficulty: 'MEDIUM' }).difficulty).toBe('medium');
    expect(only({ prompt: 'Q', answer: 'x', difficulty: 'quite hard' }).difficulty).toBeNull();
  });

  it('clamps an overlong prompt, context, option and explanation rather than rejecting the row', () => {
    const draft = only({
      prompt: 'p'.repeat(4200),
      context: 'c'.repeat(9000),
      optionA: 'o'.repeat(600),
      optionB: 'B',
      answer: 'B',
      explanation: 'e'.repeat(2500),
    });
    expect(draft.prompt).toHaveLength(4000);
    expect(draft.context).toHaveLength(8000);
    expect(draft.options[0].text).toHaveLength(500);
    expect(draft.explanation).toHaveLength(2000);
    expect(draft.issues).toEqual([]);
  });

  it('repeats a shared context verbatim on every row of its group', () => {
    const passage =
      'Read the passage and answer questions 3 and 4.\n\nBees pollinate a third of the food we eat.';
    const { drafts } = parse(
      sheet(
        { number: '3', prompt: 'Q3', context: passage, optionA: 'a', optionB: 'b', answer: 'A' },
        { number: '4', prompt: 'Q4', context: passage, answer: 'a third of our food' },
        { number: '5', prompt: 'Q5', answer: 'x' },
      ),
    );
    expect(drafts[0].context).toBe(passage);
    expect(drafts[1].context).toBe(drafts[0].context);
    // A standalone question carries no context at all rather than an empty string.
    expect(drafts[2].context).toBeNull();
  });

  /**
   * The standing invariant, kept identical to the one in question-import.test.ts: the review UI
   * pre-checks every issue-free row, so anything the parser returns clean must survive the refined
   * QuestionInput the import intent parses with. If this breaks, teachers get a 400 on a row the UI
   * told them was fine.
   */
  it('returns only rows the server will accept when there are no issues', () => {
    const { drafts } = parse(
      sheet(
        {
          number: '1',
          type: 'mcq',
          prompt: 'Pick one',
          optionA: 'wrong',
          optionB: 'right',
          answer: 'B',
          difficulty: 'easy',
          tags: 'grammar',
        },
        {
          number: '2',
          type: 'multi',
          prompt: 'Pick two',
          optionA: 'a',
          optionB: 'b',
          optionC: 'c',
          answer: 'A,C',
        },
        { number: '3', type: 'text', prompt: 'Capital of Vietnam?', answer: 'Hà Nội|Ha Noi' },
        { number: '4', type: 'essay', prompt: 'Write about 120 words on plastic waste.' },
        {
          number: '5',
          prompt: 'A blank option column in the middle',
          context: 'A shared passage.',
          optionA: 'a',
          optionC: 'c',
          answer: 'C',
        },
        { number: '6', prompt: 'p'.repeat(4200), optionA: 'a', optionB: 'b', answer: 'A' },
      ),
    );
    expect(drafts).toHaveLength(6);
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
 * The upload path reads .csv, .xlsx and .xls through SheetJS and hands the parser a matrix of
 * strings, so the delimiter sniffing and the BOM stripping are SheetJS's job rather than ours. This
 * is the test that says so: the same logical content as a comma file, as the semicolon file Excel
 * writes in a Vietnamese locale, and as a real worksheet must all reach identical drafts.
 */
describe('read the way an upload is read', () => {
  // No cell contains a delimiter or a quote, so the same rows can be joined with either delimiter
  // without any quoting — which keeps the comparison about SheetJS rather than about our fixtures.
  const CELLS: string[][] = [
    [...HEADER],
    ['1', 'mcq', '', 'Pick one', 'wrong', 'right', '', '', 'B', '', 'easy', 'grammar'],
    ['2', 'text', '', 'Capital of Vietnam?', '', '', '', '', 'Hà Nội', '', 'medium', 'geography'],
  ];

  const rowsOf = (sheetToRead: XLSX.WorkSheet): string[][] =>
    XLSX.utils.sheet_to_json<string[]>(sheetToRead, { header: 1, raw: false, defval: '' });

  const firstSheet = (book: XLSX.WorkBook): XLSX.WorkSheet => book.Sheets[book.SheetNames[0]];

  const joined = (delimiter: string): string =>
    CELLS.map((row) => row.join(delimiter)).join('\n') + '\n';

  it('reaches the same drafts from a comma file, a semicolon re-save and a workbook', () => {
    // Both text fixtures carry a byte-order mark, because that is what Excel writes on a UTF-8 CSV
    // export and it is what tells SheetJS the encoding. Read as raw bytes with no BOM, SheetJS
    // guesses a single-byte codepage and turns "Hà Nội" into mojibake — so whatever reads the
    // uploaded file has to give it either a BOM or an explicit codepage.
    const comma = parse(rowsOf(firstSheet(XLSX.read('﻿' + joined(','), { type: 'string' }))));
    const semicolon = parse(
      rowsOf(firstSheet(XLSX.read(Buffer.from('﻿' + joined(';'), 'utf8'), { type: 'buffer' }))),
    );
    const workbook = parse(rowsOf(XLSX.utils.aoa_to_sheet(CELLS)));

    expect(comma.drafts).toHaveLength(2);
    expect(comma.drafts[0].answerKey).toBe(comma.drafts[0].options[1].id);
    expect(comma.drafts[1].answerKey).toEqual(['Hà Nội']);
    // Ids are deterministic per parse, so equal drafts really means equal — including the answer
    // keys, which are ids and would not match if any reader had shifted a column.
    expect(semicolon).toEqual(comma);
    expect(workbook).toEqual(comma);
  });
});
