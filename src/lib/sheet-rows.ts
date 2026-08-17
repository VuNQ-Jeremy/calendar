/**
 * Read a picked spreadsheet into a matrix of strings.
 *
 * Lifted verbatim out of src/tests/import-extract.ts, which is where it grew, once a second importer
 * needed it: the question sheet and the vocabulary workbook have nothing in common except this step.
 * `src/tests/import-extract.ts` re-exports it under its old names, so every existing caller is
 * unchanged.
 *
 * SheetJS is dynamically imported, for the same reason `docx-preview` is in
 * src/calendar/material-preview.tsx: it is large, browser-only, and must never end up in the SSR
 * bundle or the main client chunk.
 */

import { ExtractInputError } from '../../shared/logic/import-error';

/** What a sheet picker accepts. All three go through SheetJS — see `readSheetRows`. */
export const SHEET_ACCEPT = '.csv,.xlsx,.xls';

/**
 * A ceiling on any picked file.
 *
 * The reader is synchronous once the bytes are in hand and runs on the main thread, so this is what
 * keeps a huge workbook from locking the tab up instead of failing cleanly. 10MB is far more than any
 * import cap can fill; a file anywhere near it was never a question sheet or a word list.
 */
export const MAX_SHEET_BYTES = 10 * 1024 * 1024;

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
 * range as empty. That is fatal for any column a teacher naturally merges — a reading passage
 * repeated down seven rows, or a unit name repeated down eighty. The repetition looks like the
 * mistake, not the format, so selecting the cells and merging them is the obvious thing to do; the
 * rows would then import with no passage and no unit, and nothing would say so.
 *
 * Filling the range in is simply the reading the merge was meant to convey.
 */
export function fillMergedCells(rows: string[][], merges: MergeRange[] | undefined): void {
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
 * Read a picked sheet into a matrix of strings.
 *
 * A .csv goes through SheetJS as well as a workbook, rather than being split on commas here: SheetJS
 * sniffs comma/semicolon/tab, which covers the commonest way a template gets damaged (opened in
 * Excel in a semicolon locale and saved again), and it reads the .xlsx of a teacher who exported
 * instead of saving as CSV. Splitting on commas by hand would fail on the first example sentence
 * containing one.
 *
 * The .csv is decoded to text FIRST and handed over as a string, though. Given raw bytes with no
 * byte-order mark, SheetJS guesses a single-byte codepage and turns `Hà Nội` into mojibake — and a
 * CSV written by anything other than Excel has no BOM. `File.text()` is defined to decode UTF-8 and
 * drop the mark if there is one. The workbook formats record their own encoding, so those go in as
 * bytes and are left to it.
 *
 * The i18n keys it throws keep their `qi_` prefix: they are already translated, already generic in
 * meaning ("file too big", "not UTF-8"), and renaming them would churn the question importer's copy
 * for no gain.
 */
export async function readSheetRows(file: File): Promise<string[][]> {
  const ext = extensionOf(file.name);
  if (file.size > MAX_SHEET_BYTES) throw new ExtractInputError('qi_err_too_big');
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
    // not the fix (that mojibakes the UTF-8 files a skill produces); saying so is.
    if (text.includes('�')) throw new ExtractInputError('qi_err_not_utf8');
    book = XLSX.read(text, { type: 'string' });
  } else {
    book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  }

  // The first sheet only. A template has one, and walking the rest would silently append whatever a
  // teacher keeps on sheet 2 — a marking scheme, last year's paper — to this year's import.
  const sheet = book.Sheets[book.SheetNames[0] ?? ''];
  // `header: 1` asks for a row per array and `raw: false` for the cell as DISPLAYED, so a number
  // typed into a column arrives as the string the teacher sees rather than as a float. The mapping is
  // only here to make the types honest and to survive a ragged row.
  const rows = (
    sheet ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' }) : []
  ).map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : []));

  if (sheet) fillMergedCells(rows, sheet['!merges']);

  // Emptiness is judged on the cells, not the row count: SheetJS reads a zero-byte file as one row
  // holding one empty string, so `rows.length` alone would let a blank file through to a parser and
  // come back as "no such column", which sends the teacher looking for a header that isn't missing.
  if (!rows.some((row) => row.some((cell) => cell.trim() !== ''))) {
    throw new ExtractInputError('qi_err_empty');
  }
  return rows;
}
