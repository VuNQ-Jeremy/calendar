import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { readQuestionRows } from '../src/tests/import-extract';
import { ExtractInputError } from '../shared/logic/question-csv';

/**
 * The browser half of the question import: turning a picked file into the matrix of strings the
 * parser reads. Everything here is about the ways a real teacher's file differs from the one the
 * skill writes — the encoding Excel chose, and the cells they merged to tidy it up — because those
 * are the failures that produce a plausible-looking import rather than an error.
 */

const HEADER = ['number', 'type', 'context', 'prompt', 'optionA', 'optionB', 'answer'];

const csvFile = (text: string, name = 'questions.csv'): File =>
  new File([text], name, { type: 'text/csv' });

const bytesFile = (bytes: Uint8Array<ArrayBuffer>, name: string): File => new File([bytes], name);

/** An .xlsx built in memory, optionally with merge ranges the way Excel records them. */
function xlsxFile(rows: string[][], merges?: XLSX.Range[]): File {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  if (merges) sheet['!merges'] = merges;
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Sheet1');
  const out = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return bytesFile(new Uint8Array(out), 'questions.xlsx');
}

describe('readQuestionRows', () => {
  it('reads a comma CSV into a matrix of strings', async () => {
    const rows = await readQuestionRows(csvFile(`${HEADER.join(',')}\n1,mcq,,Pick one,no,yes,B\n`));
    expect(rows[0]).toEqual(HEADER);
    expect(rows[1]).toEqual(['1', 'mcq', '', 'Pick one', 'no', 'yes', 'B']);
  });

  it('keeps Vietnamese intact in a UTF-8 file with no byte-order mark', async () => {
    // The shape every file the skill writes has. Handed to SheetJS as BYTES this comes back as
    // `HÃ  Ná»™i`, which is why the reader decodes to text first — and why this test exists at all.
    const rows = await readQuestionRows(
      csvFile(`${HEADER.join(',')}\n1,text,,"Thủ đô của Việt Nam?",,,Hà Nội\n`),
    );
    expect(rows[1][3]).toBe('Thủ đô của Việt Nam?');
    expect(rows[1][6]).toBe('Hà Nội');
  });

  it('refuses a file whose accents did not survive decoding, instead of importing mojibake', async () => {
    // Excel's Save As list still offers plain "CSV (Comma delimited)" above "CSV UTF-8", and that
    // writes a single-byte codepage. Decoded as UTF-8 those bytes become U+FFFD, and since the review
    // screen never shows option text, garbled options would reach the question bank unnoticed.
    const head = new TextEncoder().encode(`${HEADER.join(',')}\n1,text,,Thu do,,,H`);
    const latin1Tail = new Uint8Array([0xe0, 0x20, 0x4e, 0xf5, 0x69, 0x0a]); // "à Nội" in one byte each
    const bytes = new Uint8Array([...head, ...latin1Tail]);
    await expect(readQuestionRows(bytesFile(bytes, 'questions.csv'))).rejects.toThrow(
      'qi_err_not_utf8',
    );
  });

  it('reads an .xlsx workbook', async () => {
    const rows = await readQuestionRows(
      xlsxFile([HEADER, ['1', 'mcq', '', 'Pick one', 'no', 'yes', 'B']]),
    );
    expect(rows[1][3]).toBe('Pick one');
  });

  /**
   * R3's catch, and the most natural thing a teacher does to a reading group: shown the same passage
   * repeated down seven rows, they select those cells and merge them. A merge stores its text once,
   * so without filling the range back in, questions two onwards import with no passage — and nothing
   * flags it, because a missing context is not something the review screen can report.
   */
  it('repeats a merged passage down every row it spans', async () => {
    const passage = 'Sewage pollution harms marine life in many ways.';
    const file = xlsxFile(
      [
        HEADER,
        ['1', 'mcq', passage, 'According to the passage, A?', 'no', 'yes', 'B'],
        ['2', 'mcq', '', 'According to the passage, B?', 'no', 'yes', 'B'],
        ['3', 'mcq', '', 'According to the passage, C?', 'no', 'yes', 'B'],
      ],
      [{ s: { r: 1, c: 2 }, e: { r: 3, c: 2 } }],
    );

    // First, what the reader is up against: SheetJS reports the merged range as empty below its
    // top-left cell. Asserting that here is what makes the assertion after it a real guard rather
    // than a test that would pass with the fill removed.
    const book = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
    const bare = XLSX.utils.sheet_to_json<string[]>(book.Sheets[book.SheetNames[0]], {
      header: 1,
      raw: false,
      defval: '',
    });
    expect(bare.slice(1).map((row) => row[2])).toEqual([passage, '', '']);

    const rows = await readQuestionRows(file);
    expect(rows.slice(1).map((row) => row[2])).toEqual([passage, passage, passage]);
  });

  it('leaves an unmerged blank cell blank', async () => {
    const rows = await readQuestionRows(
      xlsxFile([
        HEADER,
        ['1', 'mcq', 'a passage', 'Q1', 'no', 'yes', 'B'],
        ['2', 'mcq', '', 'Q2', 'no', 'yes', 'B'],
      ]),
    );
    expect(rows[2][2]).toBe('');
  });

  it('rejects a file type it cannot read, and one with nothing in it', async () => {
    await expect(readQuestionRows(csvFile('x', 'paper.docx'))).rejects.toThrow(
      'qi_err_unsupported',
    );
    await expect(readQuestionRows(csvFile(''))).rejects.toThrow('qi_err_empty');
    await expect(readQuestionRows(csvFile('\n\n,,\n'))).rejects.toThrow(ExtractInputError);
  });
});
