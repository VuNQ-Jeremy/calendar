/**
 * Read a teacher's question spreadsheet into drafts for the review screen.
 *
 * This replaces handing a whole test paper to a model and asking it to read the questions out. The
 * questions now arrive in a twelve-column sheet and the app only ever PARSES it: nothing is guessed,
 * no import costs anything, and — the part that actually matters — the file is a thing a teacher can
 * open and correct before uploading it. An answer letter pointing at the wrong option is visible in
 * Excel in a second; the identical mistake buried in a model's output was only visible to whoever
 * re-read all forty questions on the review screen, which nobody does.
 *
 * The reader takes a matrix of strings rather than file bytes, because EVERYTHING — .csv included —
 * is read through SheetJS on the way in. `XLSX.read` sniffs comma/semicolon/tab and strips the BOM,
 * which covers the commonest way the template gets damaged: opened in Excel in a semicolon locale
 * and saved again. A hand-rolled CSV splitter would have to re-learn all of that and still would not
 * read the .xlsx a teacher exports instead.
 *
 * Pure functions only (no React, no network, no DOM), so the parse runs client-side and the teacher
 * sees exactly what would be imported before anything is saved.
 */

import { MAX_IMPORT_QUESTIONS } from '../schemas';
import {
  sanitizeQuestion,
  type ImportedQuestionDraft,
  type RawQuestionRow,
} from './question-import';

/**
 * The file a teacher downloads, and the format the question-csv skill writes.
 *
 * Assembled line by line rather than as a multi-line template literal on purpose: this repo is
 * checked out on Windows with `core.autocrlf`, so the source file's own line endings are not
 * something to bet a byte-exact download on. Excel is happy with LF, and a stray CR would end up
 * inside the last cell of every row.
 *
 * Row 3 shows a shared context (repeated verbatim on every row of its group). Row 4 shows the shape
 * that trips people up most: four EMPTY option columns, still present, followed by a short-answer
 * key whose accepted spellings are separated by pipes.
 */
export const TEMPLATE_CSV: string =
  [
    'number,type,context,prompt,optionA,optionB,optionC,optionD,answer,explanation,difficulty,tags',
    '1,mcq,,"Choose the word whose underlined part is pronounced differently.",pleas_ed_,wash_ed_,lik_ed_,laugh_ed_,A,,easy,pronunciation',
    '2,multi,,"Which TWO of these animals are mammals?",Dolphin,Shark,Bat,Tuna,"A,C",,medium,biology',
    '3,mcq,"Read the passage and answer.  Sewage pollution harms marine life in many ways.","According to the passage, sewage pollution can ___.","harm marine life","improve farming","clean rivers","reduce costs",A,,medium,reading',
    '4,text,,"Complete the sentence: She has lived here ___ 2010.",,,,,since|Since,,easy,grammar',
  ].join('\n') + '\n';

/**
 * Thrown with an i18n key as its message so the modal can render it directly.
 *
 * It lives here rather than beside the file-reading code in src/tests/import-extract.ts because the
 * parser below throws it too and shared/ cannot import from src/, so the dependency has to run this
 * way round. import-extract.ts re-exports it, which is why its own callers did not have to change.
 */
export class ExtractInputError extends Error {
  constructor(key: string) {
    super(key);
    this.name = 'ExtractInputError';
  }
}

export type ParsedCsv = {
  drafts: ImportedQuestionDraft[];
  /** 1-based spreadsheet row numbers (the header is row 1) that had content but no usable prompt. */
  skipped: number[];
  /** True when the question cap cut the file short, so the teacher knows rows were left behind. */
  truncated: boolean;
};

/** Printed option letters, in order. The index into this string IS the option's printed position. */
const LETTERS = 'ABCDEFGHIJ';

const TYPES = new Set(['mcq', 'multi', 'text', 'essay']);

/**
 * How far down the sheet to look for the header. A file exported from a school's own template often
 * carries a title and a blank line above the table; ten rows is generous enough for that and short
 * enough that a sheet of prose can never accidentally qualify.
 */
const HEADER_SCAN_ROWS = 10;

/** Every column the parser reads, apart from the ten option columns. */
export type FieldKey =
  'number' | 'type' | 'context' | 'prompt' | 'answer' | 'explanation' | 'difficulty' | 'tags';

/**
 * Every header name accepted for each field, lowercased.
 *
 * The aliases are not decoration. A teacher who already keeps questions in a spreadsheet should be
 * able to import that sheet instead of rebuilding it, and `no`/`q`/`question`/`key`/`level` are what
 * those files actually say.
 *
 * Exported as data because the Claude skill documents this same table for teachers in prose, and
 * `test/skill-validator.test.ts` holds the two to each other. An alias the parser accepts but the
 * table omits — or one the table promises and the parser ignores — is exactly how a spec drifts away
 * from the thing implementing it.
 */
export const HEADER_ALIASES: Record<FieldKey, readonly string[]> = {
  number: ['number', 'no', '#', 'q'],
  type: ['type'],
  context: ['context', 'passage'],
  prompt: ['prompt', 'question'],
  answer: ['answer', 'key', 'correct'],
  explanation: ['explanation', 'explain'],
  difficulty: ['difficulty', 'level'],
  tags: ['tags', 'tag'],
};

/**
 * Drop a leading byte-order mark. SheetJS strips the file's own BOM, but a cell that was assembled
 * by hand can still start with one, and left in place it makes `number` stop matching `number` —
 * silently losing the whole first column.
 */
const stripBom = (s: string): string => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

const headerCell = (raw: unknown): string =>
  stripBom(String(raw ?? ''))
    .trim()
    .toLowerCase();

/**
 * Map one header cell to the field it names, or null for a column we ignore.
 *
 * Matching is exact after lowercasing, never a substring: a column headed `question_text` is NOT the
 * prompt column, and reading it as one would import a file whose author meant something else by it.
 */
function fieldOf(cell: string): FieldKey | null {
  for (const field of Object.keys(HEADER_ALIASES) as FieldKey[]) {
    if (HEADER_ALIASES[field].includes(cell)) return field;
  }
  return null;
}

const OPTION_HEADER = /^option\s*([a-j])$/;

type Header = {
  /** Index of the header row. A data row at index `i` is spreadsheet row `i + 1`. */
  row: number;
  /**
   * Every column bearing each name, in sheet order — a list rather than one index because a header
   * can legitimately repeat when a teacher inserts a column and copies its heading across.
   */
  fields: Partial<Record<FieldKey, number[]>>;
  /**
   * Columns per printed letter, empty for a letter this file has no column for, trimmed to the last
   * letter it does have. Keyed on the LETTER rather than packed, so a sheet with optionA and optionC
   * but no optionB still reads optionC as the third printed option.
   */
  optionColumns: number[][];
};

/**
 * Find the header row and map its columns.
 *
 * A prompt column is what makes a row the header: it is the one column without which not a single
 * question can be read, so its absence is the one failure the parser cannot work around. Everything
 * above the header is a title, a note to the class, or Excel's idea of a spacer, and is discarded.
 */
function findHeader(rows: string[][]): Header | null {
  const limit = Math.min(rows.length, HEADER_SCAN_ROWS);
  for (let row = 0; row < limit; row++) {
    const cells = (rows[row] ?? []).map(headerCell);
    const fields: Partial<Record<FieldKey, number[]>> = {};
    const optionColumns: number[][] = Array.from({ length: LETTERS.length }, () => []);
    let letters = 0;
    cells.forEach((cell, column) => {
      const option = OPTION_HEADER.exec(cell);
      if (option) {
        const at = LETTERS.indexOf(option[1].toUpperCase());
        optionColumns[at].push(column);
        if (at + 1 > letters) letters = at + 1;
        return;
      }
      const field = fieldOf(cell);
      if (field) (fields[field] ??= []).push(column);
    });
    if (fields.prompt) {
      return { row, fields, optionColumns: optionColumns.slice(0, letters) };
    }
  }
  return null;
}

/**
 * The option positions an answer cell names: "B" → [1], "b." → [1], "B,D" / "B D" / "B+D" → [1, 3].
 *
 * A token that is not a single letter A–J once its punctuation comes off is dropped rather than
 * guessed at — an answer cell holding option TEXT should leave the row unanswered and flagged, not
 * half-answered. A letter naming a blank or absent column resolves to nothing further down, because
 * `sanitizeQuestion` finds no id at that position.
 */
function answerLetters(answer: string): number[] {
  const out: number[] = [];
  for (const token of answer.split(/[,;/&+\s]+/)) {
    const letter = token
      .replace(/^[^A-Za-z]+/, '')
      .replace(/[^A-Za-z]+$/, '')
      .toUpperCase();
    const at = letter.length === 1 ? LETTERS.indexOf(letter) : -1;
    if (at >= 0) out.push(at);
  }
  return out;
}

/**
 * The question number as PRINTED on the paper: the first run of one to three digits, so "1." reads
 * as 1 and "Câu 12" as 12. Anything with no digits in it has no number, which is allowed — the
 * number only drives the answer-key box and the numbering-gap warning, and is never persisted.
 */
function printedNumber(cell: string): number | undefined {
  const digits = /\d{1,3}/.exec(cell);
  return digits ? Number(digits[0]) : undefined;
}

/**
 * Parse a sheet of rows into question drafts.
 *
 * Throws `ExtractInputError('qi_err_bad_header')` when there is no prompt column to read, which is
 * the one thing a teacher must fix in the file itself. Every other defect degrades: a row with no
 * prompt is reported in `skipped`, an unreadable answer leaves the row flagged for review, and a
 * file over the cap is truncated rather than refused.
 *
 * `newId` is injectable, and passed straight through to `sanitizeQuestion`, so a test can assert
 * that an answer letter resolved to the id of the option it actually named.
 */
export function parseQuestionRows(
  rows: string[][],
  newId: () => string = () => crypto.randomUUID(),
): ParsedCsv {
  const header = findHeader(rows);
  if (!header) throw new ExtractInputError('qi_err_bad_header');

  const { fields, optionColumns } = header;
  const drafts: ImportedQuestionDraft[] = [];
  const skipped: number[] = [];
  let truncated = false;

  for (let i = header.row + 1; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    // A fully blank row is skipped in silence. Excel adds them, and a teacher who separates two
    // sections of the paper with an empty line has not made a mistake.
    if (cells.every((c) => String(c ?? '').trim() === '')) continue;

    // Take the first candidate column that actually holds something. When a header repeats — an
    // inserted column whose heading was copied across — only one of the two carries the value, and
    // taking the first COLUMN instead would let a stray empty duplicate shadow the real option: a
    // four-choice question then arrives with one option, gets downgraded to a short answer, and the
    // answer letter is stored as the text a student must type.
    const cell = (columns: number[] | undefined): string => {
      for (const column of columns ?? []) {
        const text = String(cells[column] ?? '').trim();
        if (text) return text;
      }
      return '';
    };

    // THE load-bearing line of the whole feature: the option cells go in PRINTED LETTER order and
    // the blanks go with them. A blank optionB between a filled optionA and a filled optionC must
    // arrive as an empty string at position 1, so that "C" still means the third printed option —
    // `sanitizeQuestion` drops the blank and records a null in `letterIds` at that position. Packing
    // the gap out here would instead hand it three options and point every answer letter after the
    // gap one option too far left, which is a wrong answer rather than a missing one.
    const options = optionColumns.map(cell);

    const answer = cell(fields.answer);
    const declared = cell(fields.type).toLowerCase();
    // The type has to be settled BEFORE the answer cell is read, because the same cell means two
    // different things: printed letters on a choice question, accepted spellings on a short answer.
    // An explicit type is passed through as written; sanitizeQuestion still gets the final word on
    // it, and will downgrade a row whose options did not survive.
    const type = TYPES.has(declared)
      ? declared
      : options.filter(Boolean).length >= 2
        ? 'mcq'
        : answer
          ? 'text'
          : 'essay';
    const choice = type === 'mcq' || type === 'multi';

    const raw: RawQuestionRow = {
      type,
      prompt: cell(fields.prompt),
      sourceNumber: printedNumber(cell(fields.number)),
      options,
      correctOptionIndexes: choice ? answerLetters(answer) : [],
      acceptedAnswers: type === 'text' ? answer.split('|') : [],
      explanation: cell(fields.explanation),
      difficulty: cell(fields.difficulty),
      tags: cell(fields.tags).split(/[,;]/),
    };

    const draft = sanitizeQuestion(raw, cell(fields.context), newId);
    if (!draft) {
      // Content but no prompt. Reported by SPREADSHEET row number, because the next thing the
      // teacher does is open the file and look at that row.
      skipped.push(i + 1);
      continue;
    }
    if (drafts.length >= MAX_IMPORT_QUESTIONS) {
      truncated = true;
      break;
    }
    drafts.push(draft);
  }

  return { drafts, skipped, truncated };
}
