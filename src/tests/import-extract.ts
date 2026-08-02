/**
 * Read the files the import modal lets a teacher pick: the question sheet, and the separate
 * answer-key file beside it.
 *
 * Nothing here uploads anything. That is the whole shape of the feature now — there is no endpoint
 * that reads a test paper with a model any more, because the reading happens BEFORE the upload, in a
 * conversation with the question-csv skill, and what reaches the app is a twelve-column sheet a
 * teacher can open in Excel and correct. So this file only ever parses: a grid of strings out of the
 * question sheet, and plain text out of a key file.
 *
 * Both parsers are dynamically imported, for the same reason `docx-preview` is in
 * src/calendar/material-preview.tsx: they are large, browser-only, and must never end up in the
 * SSR bundle or the main client chunk.
 */

import { ExtractInputError } from '../../shared/logic/question-csv.js';

/**
 * The error type callers catch to tell "the teacher can fix this themselves" from a real fault.
 *
 * It is defined in shared/logic/question-csv.ts — the parser throws it too and shared/ cannot import
 * from src/, so the dependency has to run that way round — and re-exported here so that every caller
 * still imports it from the module it picked the file with.
 */
export { ExtractInputError };

/** What the question-file picker accepts. All three go through SheetJS — see `readQuestionRows`. */
export const ACCEPT = '.csv,.xlsx,.xls';

/**
 * A ceiling on any picked file.
 *
 * Both readers below are synchronous once the bytes are in hand and both run on the main thread, so
 * this is what keeps a huge workbook from locking the tab up instead of failing cleanly. 10MB is far
 * more than the fifty-question cap can fill; a file anywhere near it was never a question sheet.
 */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
};

/** One merge range as SheetJS records it: start (`s`) and end (`e`) row/column, all 0-based. */
type MergeRange = { s: { r: number; c: number }; e: { r: number; c: number } };

/**
 * Repeat a merged cell's value across every cell it spans.
 *
 * A merge stores its text once, in the top-left cell, and `sheet_to_json` reports the rest of the
 * range as empty. That is fatal for the `context` column in particular: shown the same 400-word
 * passage repeated down seven rows, the natural thing a teacher does in Excel is select those seven
 * cells and merge them — the repetition looks like the mistake, not the format. Questions two to
 * seven of the reading group would then import with no passage at all, and nothing would say so,
 * because a missing context is not one of the things the review screen can flag.
 *
 * Filling the range in is simply the reading the merge was meant to convey.
 */
function fillMergedCells(rows: string[][], merges: MergeRange[] | undefined): void {
  for (const range of merges ?? []) {
    const value = rows[range.s.r]?.[range.s.c] ?? '';
    if (!value) continue;
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row = rows[r];
      if (!row) continue;
      for (let c = range.s.c; c <= range.e.c; c++) {
        if (!row[c]) row[c] = value;
      }
    }
  }
}

/**
 * Read a picked question sheet into the matrix of strings `parseQuestionRows` expects.
 *
 * A .csv goes through SheetJS as well as a workbook, rather than being split on commas here: SheetJS
 * sniffs comma/semicolon/tab, which covers the commonest way the template gets damaged (opened in
 * Excel in a semicolon locale and saved again), and it reads the .xlsx of a teacher who exported
 * instead of saving as CSV. Splitting on commas by hand would fail on the first passage containing
 * one.
 *
 * The .csv is decoded to text FIRST and handed over as a string, though. Given raw bytes with no
 * byte-order mark, SheetJS guesses a single-byte codepage and turns `Hà Nội` into mojibake — and a
 * CSV written by anything other than Excel has no BOM, which includes every file the skill produces.
 * `File.text()` is defined to decode UTF-8 and drop the mark if there is one. The workbook formats
 * record their own encoding, so those go in as bytes and are left to it.
 */
export async function readQuestionRows(file: File): Promise<string[][]> {
  const ext = extensionOf(file.name);
  if (file.size > MAX_FILE_BYTES) throw new ExtractInputError('qi_err_too_big');
  if (ext !== 'csv' && ext !== 'xlsx' && ext !== 'xls') {
    throw new ExtractInputError('qi_err_unsupported');
  }

  const XLSX = await import('xlsx');
  let book: import('xlsx').WorkBook;
  if (ext === 'csv') {
    const text = await file.text();
    // `File.text()` decodes as UTF-8, and a byte it cannot decode becomes U+FFFD. Excel's Save As
    // list still offers plain "CSV (Comma delimited)" above "CSV UTF-8", and that legacy save writes
    // a single-byte codepage — so a teacher who fills in the template and picks the wrong one would
    // otherwise import every accented cell as replacement characters. Reading it as bytes instead is
    // not the fix (that mojibakes the UTF-8 files the skill produces); saying so is.
    if (text.includes('�')) throw new ExtractInputError('qi_err_not_utf8');
    book = XLSX.read(text, { type: 'string' });
  } else {
    book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  }

  // The first sheet only. The template has one, and walking the rest would silently append whatever
  // a teacher keeps on sheet 2 — a marking scheme, last year's paper — to this year's questions.
  const sheet = book.Sheets[book.SheetNames[0] ?? ''];
  // `header: 1` asks for a row per array and `raw: false` for the cell as DISPLAYED, so a number
  // typed into the answer column arrives as the string the teacher sees rather than as a float. The
  // mapping is only here to make the types honest and to survive a ragged row.
  const rows = (
    sheet ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' }) : []
  ).map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : []));

  if (sheet) fillMergedCells(rows, sheet['!merges']);

  // Emptiness is judged on the cells, not the row count: SheetJS reads a zero-byte file as one row
  // holding one empty string, so `rows.length` alone would let a blank file through to the parser and
  // come back as "no prompt column", which sends the teacher looking for a header that isn't missing.
  if (!rows.some((row) => row.some((cell) => cell.trim() !== ''))) {
    throw new ExtractInputError('qi_err_empty');
  }
  return rows;
}

/**
 * Word → HTML rather than raw text. Teachers very often mark an answer by bolding or underlining it,
 * and `extractRawText` would throw exactly that away; `stripHtml` in shared/logic/answer-key.ts turns
 * the tags back into the line and cell boundaries the key parser reads.
 *
 * The style map is NOT optional. mammoth's default map has no rule for underline, so `<u>` is
 * dropped silently — which loses the "the underlined letter is the answer" convention a key written
 * over the paper itself relies on. One rule restores it; bold and italic are already mapped.
 */
async function fromDocx(file: File): Promise<string> {
  const mammoth = await import('mammoth');
  const { value } = await mammoth.convertToHtml(
    { arrayBuffer: await file.arrayBuffer() },
    { styleMap: ['u => u'] },
  );
  return value;
}

/**
 * Every sheet as tab-separated rows under its own heading. Tabs (rather than commas) because a key
 * kept in a spreadsheet puts the number in one column and the letter in the next, and `parseAnswerKey`
 * reads "1\tB" as question 1 answered B; the sheet headings keep a multi-sheet workbook from reading
 * as one run-on table.
 */
async function fromSpreadsheet(file: File): Promise<string> {
  const XLSX = await import('xlsx');
  const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  return book.SheetNames.map((name) => {
    const sheet = book.Sheets[name];
    if (!sheet) return '';
    const rows = XLSX.utils.sheet_to_csv(sheet, { FS: '\t', blankrows: false }).trim();
    return rows ? `## Sheet: ${name}\n${rows}` : '';
  })
    .filter(Boolean)
    .join('\n\n');
}

/** What the answer-key picker accepts — everything `extractKeyText` can turn into text. */
export const KEY_ACCEPT = '.docx,.xlsx,.xls,.md,.txt';

/**
 * Read a separate answer-key file as text, for `parseAnswerKey`.
 *
 * PDF is neither offered nor handled: a key is a dozen letters, nothing in the app can read a scan
 * any more, and opening the file and pasting the letters is faster than any alternative would have
 * been. The refusal by extension is kept even though the picker's accept list already excludes the
 * types it names — a file dragged in, or picked through an "All files" dialog, must fail with a
 * message the teacher can act on rather than be handed to mammoth as bytes.
 */
export async function extractKeyText(file: File): Promise<string> {
  const ext = extensionOf(file.name);
  if (file.size > MAX_FILE_BYTES) throw new ExtractInputError('qi_err_too_big');

  let text: string;
  if (ext === 'docx') {
    text = await fromDocx(file);
  } else if (ext === 'xlsx' || ext === 'xls') {
    text = await fromSpreadsheet(file);
  } else if (ext === 'md' || ext === 'txt') {
    text = await file.text();
  } else if (ext === 'doc') {
    // Pre-2007 Word is a binary OLE container, not a zip of XML — mammoth cannot read it.
    throw new ExtractInputError('qi_err_doc_legacy');
  } else {
    throw new ExtractInputError('qi_err_unsupported');
  }

  const trimmed = text.trim();
  if (!trimmed) throw new ExtractInputError('qi_err_empty');
  return trimmed;
}
