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

import { ExtractInputError } from '../../shared/logic/import-error';
import { MAX_SHEET_BYTES, readSheetRows, SHEET_ACCEPT } from '../lib/sheet-rows';

/**
 * The error type callers catch to tell "the teacher can fix this themselves" from a real fault.
 *
 * It is defined in shared/logic/import-error.ts — the parsers throw it too and shared/ cannot import
 * from src/, so the dependency has to run that way round — and re-exported here so that every caller
 * still imports it from the module it picked the file with.
 */
export { ExtractInputError };

/**
 * The sheet reader now lives in src/lib/sheet-rows.ts, because the vocabulary workbook importer needs
 * exactly the same step. Re-exported under the names this module has always used so that no caller
 * changed; `readQuestionRows` and `readSheetRows` are the same function.
 */
export {
  MAX_SHEET_BYTES as MAX_FILE_BYTES,
  readSheetRows as readQuestionRows,
  SHEET_ACCEPT as ACCEPT,
};

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
};

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
  if (file.size > MAX_SHEET_BYTES) throw new ExtractInputError('qi_err_too_big');

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
