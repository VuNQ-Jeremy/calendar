/**
 * Turn a picked file into something the extraction endpoint can hand to Claude.
 *
 * Everything with a text layer is parsed HERE, in the browser: a Word file is only a zip of XML
 * and a spreadsheet only a grid of strings, so shipping megabytes of it to the model — and paying
 * per page — buys nothing. PDF is the exception. A test paper exported to PDF may be a scan with
 * no text layer at all, and column/table structure is routinely unrecoverable from its text
 * stream, so the whole file goes to Claude as a native document block and its vision does the
 * reading.
 *
 * Both parsers are dynamically imported, for the same reason `docx-preview` is in
 * src/calendar/material-preview.tsx: they are large, browser-only, and must never end up in the
 * SSR bundle or the main client chunk.
 */

/** What the file picker accepts. `.doc` is deliberately absent — see `extractFileContent`. */
export const ACCEPT = '.docx,.pdf,.xlsx,.xls,.md,.txt';

/**
 * A PDF rides to the Worker as base64 inside a JSON body, so its size is bounded by more than
 * disk: base64 inflates it by 4/3, and Anthropic caps a request at 32MB. 10MB of PDF is a very
 * long test paper and leaves plenty of headroom.
 *
 * The same ceiling is applied to the formats parsed in-browser, for a different reason: mammoth
 * and SheetJS both run on the main thread, so a huge workbook would lock the tab up rather than
 * fail cleanly.
 */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Matches QuestionExtractInput's cap. ~50k words of test paper — far more than one exam. */
export const MAX_TEXT_CHARS = 200_000;

export type ExtractPayload = { kind: 'text'; text: string } | { kind: 'pdf'; dataBase64: string };

/** Thrown with an i18n key as its message so the modal can render it directly. */
export class ExtractInputError extends Error {
  constructor(key: string) {
    super(key);
    this.name = 'ExtractInputError';
  }
}

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
};

/**
 * `btoa` needs a string, and `String.fromCharCode(...bytes)` on a multi-megabyte array blows the
 * call stack (each byte is an argument). Chunk it.
 */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000; // 32KB — comfortably under the argument-count limit
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Word → HTML rather than raw text. Teachers very often mark the correct option by bolding or
 * underlining it, and `extractRawText` would throw exactly that away; the extraction prompt tells
 * the model to read `<strong>`/`<u>` as the answer marker.
 */
async function fromDocx(file: File): Promise<string> {
  const mammoth = await import('mammoth');
  const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  return value;
}

/**
 * Every sheet as tab-separated rows under its own heading. Tabs (rather than commas) keep the
 * column layout legible to the model, which is what lets it recognise the common
 * "question | A | B | C | D | answer" arrangement; the sheet headings keep a multi-sheet workbook
 * from reading as one run-on table.
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

/**
 * Parse a picked file into an extraction payload.
 *
 * Throws `ExtractInputError` carrying an i18n key for anything the teacher can fix themselves
 * (wrong file type, too big, no text found).
 */
export async function extractFileContent(file: File): Promise<ExtractPayload> {
  const ext = extensionOf(file.name);
  if (file.size > MAX_FILE_BYTES) throw new ExtractInputError('qi_err_too_big');

  if (ext === 'pdf') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { kind: 'pdf', dataBase64: toBase64(bytes) };
  }

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
  // Truncate rather than reject: the questions are at the top of a test paper far more often than
  // the bottom, so half an import beats none. The prompt caps output at 50 questions anyway.
  return { kind: 'text', text: trimmed.slice(0, MAX_TEXT_CHARS) };
}
