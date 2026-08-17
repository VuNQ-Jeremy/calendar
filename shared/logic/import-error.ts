/**
 * The error type every file importer throws when the teacher can fix the problem themselves.
 *
 * The message IS an i18n key, so a caller renders it with `t(e.message)` and nothing has to map
 * error shapes to copy. Anything that is *not* an `ExtractInputError` is a real fault and gets a
 * generic "could not read that file" instead.
 *
 * It lives in its own module because two unrelated importers need it — the question sheet
 * (`question-csv.ts`) and the vocabulary workbook (`vocab-csv.ts`) — and having the second import it
 * from the first would imply a relationship that does not exist. `question-csv.ts` re-exports it so
 * that every existing caller keeps importing it from the module it picked its file with.
 */
export class ExtractInputError extends Error {
  constructor(key: string) {
    super(key);
    this.name = 'ExtractInputError';
  }
}
