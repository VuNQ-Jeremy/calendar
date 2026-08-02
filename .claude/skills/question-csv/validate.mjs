#!/usr/bin/env node
/**
 * Check a question-import CSV before a teacher uploads it to Mochi.
 *
 * This exists because the CSV is now written by a model reading a test paper, and a model cannot
 * see its own miscounts: an option shifted one column to the left, an answer letter pointing at a
 * cell it left blank, forty-one rows for a forty-question paper. All of those import "successfully"
 * and produce quietly wrong questions. Running this in the same turn the file was written is the
 * cheapest chance to catch them, and a teacher can run it again on a file they edited in Excel.
 *
 * Zero dependencies, and deliberately NOT the app's spreadsheet reader. The app parses uploads with
 * SheetJS, which is a pinned tarball dependency; this has to run with a bare `node validate.mjs` in
 * a terminal, or in a chat sandbox with no node_modules at all. So it carries its own small CSV
 * reader — enough of RFC 4180 to read anything Excel or a model writes, and nothing more.
 *
 * Every message names the spreadsheet row number (1-based, counting the header) rather than an
 * array index, because the next thing the reader does is open the file in Excel and look at it.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The canonical header, quoted back at the reader when theirs cannot be used. */
const HEADER_LINE =
  'number,type,context,prompt,optionA,optionB,optionC,optionD,answer,explanation,difficulty,tags';

/** Mirrors MAX_IMPORT_QUESTIONS in shared/schemas.ts. */
const MAX_QUESTIONS = 50;
const MAX_PROMPT = 4000;
const MAX_CONTEXT = 8000;
const MAX_OPTION_TEXT = 500;
const MAX_EXPLANATION = 2000;
const MAX_TAGS = 20;
const MAX_TAG_TEXT = 50;

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const TYPES = new Set(['mcq', 'multi', 'text', 'essay']);
const DIFFICULTIES = new Set(['easy', 'medium', 'hard']);

/**
 * Drop a leading byte-order mark. Excel writes one at the start of every UTF-8 CSV it exports, and
 * left in place it becomes part of the first header cell, so `number` stops matching `number` and
 * the whole first column disappears.
 */
const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

/**
 * Map one header cell to a canonical column key, or null when the column is one we ignore.
 *
 * The aliases are not decoration: a teacher who already keeps questions in a spreadsheet should be
 * able to import it without rebuilding it, and `q`/`no`/`#` are what those files actually say.
 */
function columnKey(raw) {
  const h = stripBom(String(raw ?? ''))
    .trim()
    .toLowerCase();
  if (h === 'number' || h === 'no' || h === '#' || h === 'q') return 'number';
  if (h === 'type') return 'type';
  if (h === 'context' || h === 'passage') return 'context';
  if (h === 'prompt' || h === 'question') return 'prompt';
  const option = /^option\s*([a-j])$/.exec(h);
  if (option) return `option${option[1].toUpperCase()}`;
  if (h === 'answer' || h === 'key' || h === 'correct') return 'answer';
  if (h === 'explanation' || h === 'explain') return 'explanation';
  if (h === 'difficulty' || h === 'level') return 'difficulty';
  if (h === 'tags' || h === 'tag') return 'tags';
  return null;
}

/**
 * Guess the delimiter from the header line alone.
 *
 * Only the header, and only outside quotes: prompts are full of commas and semicolons, so counting
 * over the whole file would call a semicolon-delimited export comma-delimited about half the time.
 * The header has one delimiter per column and no prose, which makes it the one reliable sample. A
 * tie goes to the comma, because that is what the template is.
 */
function sniffDelimiter(text) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (ch === '\n' || ch === '\r') break;
    if (ch === ',' || ch === ';' || ch === '\t') counts[ch]++;
  }
  if (counts[';'] > counts[','] && counts[';'] >= counts['\t']) return ';';
  if (counts['\t'] > counts[','] && counts['\t'] > counts[';']) return '\t';
  return ',';
}

/**
 * Read the whole file into rows of raw cell strings.
 *
 * Handles what real files contain: quoted fields with doubled quotes inside them, newlines inside a
 * quoted passage, CRLF from Windows Excel, and a last line with no newline at all. A quote in the
 * MIDDLE of an unquoted field (`a 5" pipe`) is kept as a literal character rather than opening a
 * quoted section, because that is the reading that does not swallow the rest of the file.
 */
function parseRows(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let fieldStart = true;

  const endField = () => {
    row.push(field);
    field = '';
    fieldStart = true;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && fieldStart) {
      quoted = true;
      fieldStart = false;
      continue;
    }
    if (ch === delimiter) {
      endField();
      continue;
    }
    if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
      continue;
    }
    if (ch === '\n') {
      endRow();
      continue;
    }
    field += ch;
    fieldStart = false;
  }
  // A file ending in a newline has already flushed its last row; anything still buffered here is a
  // final line without one.
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/** The printed question number: the first run of one to three digits, or null. */
function printedNumber(cell) {
  const m = /\d{1,3}/.exec(cell);
  const n = m ? Number(m[0]) : Number.NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** A list for a message body, truncated so a forty-row problem stays one readable line. */
function joinNumbers(numbers, limit = 12) {
  const shown = numbers.slice(0, limit).join(', ');
  return numbers.length > limit ? `${shown} and ${numbers.length - limit} more` : shown;
}

/**
 * Validate the text of one CSV file.
 *
 * Errors mean the file will not import the way its author intended — a wrong answer, a lost row, a
 * truncated field. Warnings mean look at it: each has a legitimate explanation, the commonest by
 * far being a paper that simply does not print its answers.
 */
export function validateCsv(text) {
  const errors = [];
  const warnings = [];
  const clean = stripBom(String(text ?? ''));
  const rows = parseRows(clean, sniffDelimiter(clean));

  if (!rows.some((r) => r.some((c) => String(c ?? '').trim() !== ''))) {
    errors.push(`The file has no rows at all. Row 1 must be the header: ${HEADER_LINE}`);
    return { errors, warnings, count: 0, answered: 0, numbers: [] };
  }

  // Look for the header the way the importer does: the first of the top ten rows that names a prompt
  // column. Anchoring on row 1 instead would reject a file the importer reads perfectly — a school's
  // own template usually carries a title row, and Excel writes a `sep=;` line on some semicolon
  // locales — and the fix it would advise (replace row 1 with the header) deletes the title.
  const HEADER_SCAN_ROWS = 10;
  let headerIndex = -1;
  const scanLimit = Math.min(rows.length, HEADER_SCAN_ROWS);
  for (let i = 0; i < scanLimit; i++) {
    if (rows[i].map(columnKey).includes('prompt')) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex === -1) {
    errors.push(
      `There is no prompt column in the first ${HEADER_SCAN_ROWS} rows, so not one question can ` +
        `be read. One row must contain "prompt" (or "question"): ${HEADER_LINE}`,
    );
    return { errors, warnings, count: 0, answered: 0, numbers: [] };
  }
  if (headerIndex > 0) {
    warnings.push(
      `The header is row ${headerIndex + 1}, so row${headerIndex > 1 ? 's' : ''} 1${
        headerIndex > 1 ? `-${headerIndex}` : ''
      } will be ignored as a title. That is fine — just check no question is hiding up there.`,
    );
  }

  const keys = rows[headerIndex].map(columnKey);
  const indexOf = (key) => keys.indexOf(key);

  /** Letters whose column exists in THIS file — an answer may only name one of these. */
  const optionColumns = new Map();
  for (const letter of LETTERS) {
    const at = indexOf(`option${letter}`);
    if (at !== -1) optionColumns.set(letter, at);
  }

  let count = 0;
  let answered = 0;
  const numbers = [];
  /** Printed number -> the first spreadsheet row that used it, for the duplicate warning. */
  const firstRowOfNumber = new Map();
  const numbered = [];
  const blankAnswerRows = [];

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const cells = rows[i];
    const rowNo = i + 1;
    // Normalised to NFC before anything is measured, because the importer normalises too. Text
    // pasted out of a PDF is often decomposed (`e` + a combining acute rather than `é`), which
    // inflates a Vietnamese passage by about a quarter — so measuring the raw string would report a
    // cap error on a file the importer stores whole, and the advertised fix (split the passage
    // across two questions) changes what a student reads to satisfy a limit that was never hit.
    const cell = (key) => {
      const at = indexOf(key);
      return at === -1
        ? ''
        : String(cells[at] ?? '')
            .normalize('NFC')
            .trim();
    };

    // A fully blank row is skipped in silence: Excel adds them, and a teacher who separates two
    // sections with an empty line has not made a mistake.
    if (cells.every((c) => String(c ?? '').trim() === '')) continue;

    const prompt = cell('prompt');
    if (!prompt) {
      errors.push(
        `Row ${rowNo}: this row has content but its prompt cell is empty, so the import would ` +
          `skip it. Put the question text in the prompt column, or delete the row.`,
      );
      continue;
    }
    count++;
    if (count === MAX_QUESTIONS + 1) {
      errors.push(
        `Row ${rowNo}: this is question ${count}, and one file may hold at most ${MAX_QUESTIONS}. ` +
          `Split the paper into part1.csv, part2.csv … and keep the printed numbering running ` +
          `across the parts so one answer key still matches every part.`,
      );
    }
    if (prompt.length > MAX_PROMPT) {
      errors.push(
        `Row ${rowNo}: the prompt is ${prompt.length} characters; the cap is ${MAX_PROMPT}.`,
      );
    }

    const context = cell('context');
    if (context.length > MAX_CONTEXT) {
      errors.push(
        `Row ${rowNo}: the context is ${context.length} characters; the cap is ${MAX_CONTEXT}. ` +
          `Split the passage across two questions rather than trimming what a student reads.`,
      );
    }

    const options = new Map();
    /** Option text -> the first letter that printed it, for the duplicate check below. */
    const optionFirstLetter = new Map();
    for (const [letter] of optionColumns) {
      const value = cell(`option${letter}`);
      if (value) options.set(letter, value);
      if (value.length > MAX_OPTION_TEXT) {
        errors.push(
          `Row ${rowNo}: option ${letter} is ${value.length} characters; the cap is ` +
            `${MAX_OPTION_TEXT}.`,
        );
      }
      // The importer keeps only the first of two options whose text is IDENTICAL, and an answer
      // letter pointing at the one it dropped then resolves to nothing. Two options differing only
      // in capitalisation are NOT duplicates and are both kept — that distinction is the whole
      // question in "choose the correct capitalisation" — so this compares exactly, as it does.
      if (value && optionFirstLetter.has(value)) {
        errors.push(
          `Row ${rowNo}: option ${letter} repeats option ${optionFirstLetter.get(value)} word for ` +
            `word, so the importer keeps only one of them and an answer naming ${letter} would ` +
            `find nothing. Give each option its own text, or leave the column empty.`,
        );
      } else if (value) {
        optionFirstLetter.set(value, letter);
      }
    }

    const answer = cell('answer');
    const declaredRaw = cell('type');
    const declared = declaredRaw.toLowerCase();
    if (declaredRaw && !TYPES.has(declared)) {
      errors.push(
        `Row ${rowNo}: type "${declaredRaw}" is not one of mcq, multi, text, essay. Leave it ` +
          `blank to let the importer work the type out from the row itself.`,
      );
    }
    // The same inference the importer makes, so every check below judges the row the app will
    // build rather than the one its author had in mind.
    const type = TYPES.has(declared)
      ? declared
      : options.size >= 2
        ? 'mcq'
        : answer
          ? 'text'
          : 'essay';
    const choice = type === 'mcq' || type === 'multi';

    if (choice && options.size < 2) {
      errors.push(
        `Row ${rowNo}: type "${type}" needs at least two non-blank option cells and this row has ` +
          `${options.size}, so the importer would turn it into ` +
          `${answer ? 'a short-answer' : 'an essay'} question.`,
      );
    }
    if (!choice && options.size > 0) {
      warnings.push(
        `Row ${rowNo}: type "${type}" ignores option cells, so the ${options.size} option(s) in ` +
          `this row will not be imported. Change the type to mcq or multi if they matter.`,
      );
    }

    if (choice) {
      const letters = [];
      for (const token of answer.split(/[,;/&+\s]+/).filter(Boolean)) {
        const bare = token
          .replace(/^[^A-Za-z]+/, '')
          .replace(/[^A-Za-z]+$/, '')
          .toUpperCase();
        if (!/^[A-J]$/.test(bare)) {
          errors.push(
            `Row ${rowNo}: the answer "${token}" is not an option letter. Type ${type} answers ` +
              `name printed letters, like "B" or "B,D" — the option TEXT does not belong here.`,
          );
          continue;
        }
        if (!optionColumns.has(bare)) {
          errors.push(
            `Row ${rowNo}: the answer names option ${bare}, but this file has no option${bare} ` +
              `column, so the question would import with no answer at all.`,
          );
          continue;
        }
        if (!options.has(bare)) {
          errors.push(
            `Row ${rowNo}: the answer names option ${bare}, but option${bare} is empty in this ` +
              `row, so the question would import with no answer at all. Either fill that option ` +
              `in, or point the answer at the letter the paper really prints — the column letter ` +
              `IS the printed letter, so options never shift left to close a gap.`,
          );
          continue;
        }
        letters.push(bare);
      }
      if (type === 'multi' && letters.length === 1) {
        warnings.push(
          `Row ${rowNo}: type "multi" with the single answer letter ${letters[0]} behaves exactly ` +
            `like an mcq. Add the other correct letter, or change the type to mcq.`,
        );
      }
    } else if (type === 'text' && /^[a-j][.)]?$/i.test(answer)) {
      warnings.push(
        `Row ${rowNo}: the short-answer answer is the bare letter "${answer}". If that is an ` +
          `option letter then this row is an mcq and needs its options filled in; if the answer ` +
          `really is that letter, ignore this.`,
      );
    } else if (type === 'essay' && answer) {
      warnings.push(
        `Row ${rowNo}: an essay row carries no answer key, so "${answer}" will be dropped. Use ` +
          `type text if it should be graded automatically.`,
      );
    }

    if (answer) answered++;
    else if (type !== 'essay') blankAnswerRows.push(rowNo);

    const explanation = cell('explanation');
    if (explanation.length > MAX_EXPLANATION) {
      errors.push(
        `Row ${rowNo}: the explanation is ${explanation.length} characters; the cap is ` +
          `${MAX_EXPLANATION}.`,
      );
    }

    const difficultyRaw = cell('difficulty');
    if (difficultyRaw && !DIFFICULTIES.has(difficultyRaw.toLowerCase())) {
      errors.push(
        `Row ${rowNo}: difficulty "${difficultyRaw}" is not one of easy, medium, hard. Leave it ` +
          `blank when the paper does not say.`,
      );
    }

    const tags = cell('tags')
      .split(/[,;]/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length > MAX_TAGS) {
      errors.push(`Row ${rowNo}: ${tags.length} tags; the cap is ${MAX_TAGS}.`);
    }
    for (const tag of tags) {
      if (tag.length > MAX_TAG_TEXT) {
        errors.push(
          `Row ${rowNo}: the tag "${tag.slice(0, 20)}…" is ${tag.length} characters; the cap is ` +
            `${MAX_TAG_TEXT}. Tags are labels, not sentences.`,
        );
      }
    }

    const numberCell = cell('number');
    const number = printedNumber(numberCell);
    if (number == null) {
      if (numberCell) {
        warnings.push(
          `Row ${rowNo}: the number cell "${numberCell}" holds no digits, so this question cannot ` +
            `be matched against a separate answer key.`,
        );
      }
    } else {
      numbers.push(number);
      numbered.push({ rowNo, number });
      const first = firstRowOfNumber.get(number);
      if (first === undefined) firstRowOfNumber.set(number, rowNo);
      else {
        warnings.push(
          `Row ${rowNo}: printed number ${number} is already used on row ${first}. An answer key ` +
            `can only fill in one of the two.`,
        );
      }
    }
  }

  // Gaps are reported where they appear, so the reader can look at the rows either side and decide
  // whether a question was dropped or the paper itself skips that number.
  for (let i = 1; i < numbered.length; i++) {
    const prev = numbered[i - 1];
    const here = numbered[i];
    if (here.number > prev.number + 1) {
      const missing = [];
      for (let n = prev.number + 1; n < here.number; n++) missing.push(n);
      warnings.push(
        `Row ${here.rowNo}: the numbering jumps from ${prev.number} to ${here.number} — ` +
          `${joinNumbers(missing)} ${missing.length === 1 ? 'is' : 'are'} missing. Check ` +
          `${missing.length === 1 ? 'that question' : 'those questions'} in the original.`,
      );
    }
  }

  if (blankAnswerRows.length > 0) {
    warnings.push(
      `${blankAnswerRows.length} of ${count} question rows have a blank answer ` +
        `(${blankAnswerRows.length === 1 ? 'row' : 'rows'} ${joinNumbers(blankAnswerRows)}). ` +
        `That is CORRECT when the paper prints no answer key — ` +
        `the app flags them and the teacher pastes the key in afterwards. It is only a problem if ` +
        `the paper did give its answers.`,
    );
  }

  return { errors, warnings, count, answered, numbers };
}

/** The one-screen summary the CLI prints above its findings. */
function report(label, result) {
  const { errors, warnings, count, answered, numbers } = result;
  const range = numbers.length
    ? `${Math.min(...numbers)}-${Math.max(...numbers)} (${numbers.length} numbered)`
    : 'none';
  const lines = [
    `question-csv: ${label}`,
    `  question rows   ${count}`,
    `  with answers    ${answered} / ${count}`,
    `  printed numbers ${range}`,
    '',
  ];
  if (errors.length) {
    lines.push(`ERRORS (${errors.length}) - this file will not import as intended:`);
    for (const e of errors) lines.push(`  - ${e}`);
    lines.push('');
  }
  if (warnings.length) {
    lines.push(`WARNINGS (${warnings.length}) - read these, they are often fine:`);
    for (const w of warnings) lines.push(`  - ${w}`);
    lines.push('');
  }
  lines.push(errors.length ? 'RESULT: fix the errors above, then run this again.' : 'RESULT: OK.');
  return lines.join('\n');
}

/**
 * Run only when invoked as a script. Importing this module — which the repo's own test does — must
 * never read a file or set an exit code.
 */
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('usage: node validate.mjs questions.csv [more.csv ...]');
    process.exitCode = 1;
  } else {
    let failed = false;
    for (const [index, file] of files.entries()) {
      let text;
      try {
        text = readFileSync(file, 'utf8');
      } catch (err) {
        console.error(`question-csv: cannot read ${file} (${err.code ?? err.message})`);
        failed = true;
        continue;
      }
      const result = validateCsv(text);
      if (result.errors.length > 0) failed = true;
      console.log(`${index > 0 ? '\n' : ''}${report(basename(file), result)}`);
    }
    process.exitCode = failed ? 1 : 0;
  }
}
