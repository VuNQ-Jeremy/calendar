// @vitest-environment node
//
// Node rather than the suite's default jsdom: every fixture below is addressed as a URL relative to
// `import.meta.url`, and under jsdom that resolves against the document's origin instead of the file
// path, so `readFileSync` looks for F:\test\fixtures\... and every test in the file fails on ENOENT.
// Nothing here touches the DOM.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { MAX_IMPORT_QUESTIONS } from '../shared/schemas';
import {
  TEMPLATE_CSV,
  HEADER_ALIASES,
  parseQuestionRows,
  ExtractInputError,
} from '../shared/logic/question-csv';
import { validateCsv } from '../.claude/skills/question-csv/validate.mjs';

// The teacher-facing CSV now has THREE independent implementations of the same contract: the
// template the app hands out, the parser that reads an upload, and the validator that ships with
// the Claude skill so a model can check its own work before anyone downloads it. Nothing forces
// them to agree — the skill is a folder of text files, not code the compiler sees — so this file is
// the only thing standing between a spec change and a skill that quietly teaches the wrong format.
//
// It therefore checks three things, in order of how badly they hurt:
//   1. the skill's template.csv is byte-identical to the app's TEMPLATE_CSV;
//   2. the validator's verdict on every fixture is the one the fixture was built to provoke;
//   3. the app's own parser, fed the same file through SheetJS exactly as the upload path does,
//      reaches the same conclusion — same question count, nothing skipped.
//
// (3) is the important one. A validator that passes a file the app then mangles is worse than no
// validator, because it converts "the import looks wrong" into "the import was checked".

const skillFile = (name: string): URL =>
  new URL(`../.claude/skills/question-csv/${name}`, import.meta.url);
const fixture = (name: string): URL => new URL(`./fixtures/question-csv/${name}`, import.meta.url);

const readText = (url: URL): string => readFileSync(url, 'utf8');

/** Collapse a run of trailing newlines to exactly one — the only difference we tolerate. */
const oneTrailingNewline = (s: string): string => s.replace(/\n*$/, '\n');

/**
 * Read a file the way the app's upload path does — INCLUDING which of SheetJS's two doors it goes
 * through, because that choice is load-bearing. `readQuestionRows` decodes a .csv to text and passes
 * a string, and only workbooks go in as bytes: handed bytes with no byte-order mark, SheetJS guesses
 * a single-byte codepage and turns `Hà Nội` into `HÃ  Ná»™i`, and a BOM-less UTF-8 CSV is exactly what
 * the skill produces. A test that read every fixture as bytes would agree with the validator on the
 * counts while disagreeing with it about every diacritic, and would keep passing if the app's reader
 * regressed to the byte path — which is the whole failure this file exists to prevent.
 */
function sheetRows(url: URL): string[][] {
  const csv = url.pathname.endsWith('.csv');
  const book = csv
    ? XLSX.read(readFileSync(url, 'utf8'), { type: 'string' })
    : XLSX.read(readFileSync(url), { type: 'buffer' });
  const sheet = book.Sheets[book.SheetNames[0]];
  return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '' });
}

describe('the question-csv skill template', () => {
  it('is byte-identical to the template the app exports', () => {
    const onDisk = readText(skillFile('template.csv'));
    expect(oneTrailingNewline(onDisk)).toBe(oneTrailingNewline(TEMPLATE_CSV));
  });

  it('is plain LF UTF-8 with no byte-order mark, because a teacher opens it in Excel', () => {
    const bytes = readFileSync(skillFile('template.csv'));
    expect(bytes.includes(0x0d)).toBe(false);
    expect(bytes.subarray(0, 3).toString('hex')).not.toBe('efbbbf');
  });

  it('has the canonical header and 12 fields on every line', () => {
    const lines = readText(skillFile('template.csv')).trimEnd().split('\n');
    expect(lines[0]).toBe(
      'number,type,context,prompt,optionA,optionB,optionC,optionD,answer,explanation,difficulty,tags',
    );
    // Commas OUTSIDE quotes: "A,C" is one field, not two.
    const topLevelCommas = (line: string): number => {
      let quoted = false;
      let commas = 0;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') {
          if (quoted && line[i + 1] === '"') i++;
          else quoted = !quoted;
        } else if (!quoted && line[i] === ',') commas++;
      }
      return commas;
    };
    expect(lines).toHaveLength(5);
    for (const line of lines) expect(topLevelCommas(line)).toBe(11);
  });

  it('validates with no errors', () => {
    const result = validateCsv(readText(skillFile('template.csv')));
    expect(result.errors).toEqual([]);
    expect(result.count).toBe(4);
    expect(result.answered).toBe(4);
    expect(result.numbers).toEqual([1, 2, 3, 4]);
  });
});

describe('validateCsv over the fixtures', () => {
  it('passes a clean file, and the semicolon re-save of the same file', () => {
    for (const name of ['clean.csv', 'clean-semicolon.csv']) {
      const result = validateCsv(readText(fixture(name)));
      expect(result.errors, name).toEqual([]);
      expect(result.count, name).toBe(5);
      // Four questions carry an answer; the fifth is an essay, which has none by definition.
      expect(result.answered, name).toBe(4);
      expect(result.numbers, name).toEqual([1, 2, 3, 4, 5]);
    }
  });

  it('accepts a file with no answers at all, and says how many are unanswered', () => {
    const result = validateCsv(readText(fixture('keyless.csv')));
    // The whole point: a paper that prints no key is not an error, it is a warning the teacher
    // reads and then pastes the key in.
    expect(result.errors).toEqual([]);
    expect(result.count).toBe(5);
    expect(result.answered).toBe(0);
    expect(
      result.warnings.some((w) => w.includes('5 of 5 question rows have a blank answer')),
    ).toBe(true);
  });

  it('rejects a header with no prompt column', () => {
    const result = validateCsv(readText(fixture('no-prompt-column.csv')));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('prompt');
    expect(result.count).toBe(0);
  });

  it('accepts a school template whose header sits below a title row, and says so', () => {
    // The app scans ten rows for the header, so a validator that demanded row 1 would reject a file
    // the importer reads perfectly — and the fix it advised would delete the teacher's title.
    const result = validateCsv(readText(fixture('title-row.csv')));
    expect(result.errors).toEqual([]);
    expect(result.count).toBe(2);
    expect(result.warnings.some((w) => w.includes('header is row 3'))).toBe(true);
  });

  it('rejects two options with word-for-word identical text', () => {
    const result = validateCsv(readText(fixture('duplicate-option.csv')));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Row 2');
    expect(result.errors[0]).toContain('option C repeats option A');
  });

  it('passes a Vietnamese file, including one whose options differ only in capitalisation', () => {
    const result = validateCsv(readText(fixture('vietnamese.csv')));
    expect(result.errors).toEqual([]);
    expect(result.count).toBe(3);
    expect(result.answered).toBe(3);
  });

  it('rejects an answer letter pointing at a blank option, and names the Excel row', () => {
    const result = validateCsv(readText(fixture('letter-at-blank-option.csv')));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Row 3');
    expect(result.errors[0]).toContain('optionB');
  });

  it('rejects a file over the question cap, naming the row that broke it', () => {
    const result = validateCsv(readText(fixture('over-cap.csv')));
    expect(result.count).toBe(MAX_IMPORT_QUESTIONS + 1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain(`Row ${MAX_IMPORT_QUESTIONS + 2}`);
    expect(result.errors[0]).toContain(String(MAX_IMPORT_QUESTIONS));
  });
});

describe('the app parser agrees with the skill validator', () => {
  it.each(['clean.csv', 'clean-semicolon.csv'])('reads %s to the same question count', (name) => {
    const expected = validateCsv(readText(fixture(name)));
    const parsed = parseQuestionRows(sheetRows(fixture(name)));
    expect(parsed.drafts).toHaveLength(expected.count);
    expect(parsed.skipped).toEqual([]);
    expect(parsed.truncated).toBe(false);
  });

  it('reads the template itself', () => {
    const expected = validateCsv(readText(skillFile('template.csv')));
    const parsed = parseQuestionRows(sheetRows(skillFile('template.csv')));
    expect(parsed.drafts).toHaveLength(expected.count);
    expect(parsed.skipped).toEqual([]);
  });

  it('throws on the header the validator rejected', () => {
    const rows = sheetRows(fixture('no-prompt-column.csv'));
    expect(() => parseQuestionRows(rows)).toThrow(ExtractInputError);
    expect(() => parseQuestionRows(rows)).toThrow('qi_err_bad_header');
  });

  it('leaves the blank-option row unanswered rather than answering it wrongly', () => {
    const parsed = parseQuestionRows(sheetRows(fixture('letter-at-blank-option.csv')));
    expect(parsed.drafts).toHaveLength(2);
    const draft = parsed.drafts[1];
    expect(draft.issues).toContain('qi_issue_no_answer');
    // "B" named a blank cell, so it must resolve to nothing at all — never to the option that
    // happens to sit where B would have been once the blank was dropped.
    expect(draft.options.map((option) => option.id)).not.toContain(draft.answerKey);
  });

  it('truncates the over-cap file at the import limit', () => {
    const parsed = parseQuestionRows(sheetRows(fixture('over-cap.csv')));
    expect(parsed.drafts).toHaveLength(MAX_IMPORT_QUESTIONS);
    expect(parsed.truncated).toBe(true);
  });

  it('finds the header below a title row, exactly as the validator did', () => {
    const parsed = parseQuestionRows(sheetRows(fixture('title-row.csv')));
    expect(parsed.drafts).toHaveLength(2);
    expect(parsed.skipped).toEqual([]);
    expect(parsed.drafts[0].prompt).toContain('She has lived here');
  });

  /**
   * Counts agreeing is not enough. This is the one assertion that reads the CELLS, because the
   * failure it guards against — a BOM-less UTF-8 file read as bytes — changes every accented
   * character while leaving every count identical.
   */
  it('carries Vietnamese through intact, diacritics and all', () => {
    const parsed = parseQuestionRows(sheetRows(fixture('vietnamese.csv')));
    expect(parsed.drafts).toHaveLength(3);

    const [capital, capitalisation, reading] = parsed.drafts;
    expect(capital.prompt).toBe('Thủ đô của Việt Nam là thành phố nào?');
    expect(capital.answerKey).toEqual(['Hà Nội']);

    // Four options that differ only in capitalisation are four options. Folding them together — as a
    // case-insensitive duplicate check would — deletes the distractors and leaves the question
    // meaningless, while looking deliberate.
    expect(capitalisation.options.map((o) => o.text)).toEqual([
      'hà nội',
      'Hà Nội',
      'HÀ NỘI',
      'Hà nội',
    ]);
    expect(capitalisation.answerKey).toBe(capitalisation.options[1].id);

    expect(reading.context).toContain('Đồng bằng sông Cửu Long');
    expect(reading.answerKey).toEqual([reading.options[0].id, reading.options[1].id]);
    expect(reading.issues).toEqual([]);
  });
});

describe('the spec written in the skill matches the spec in the code', () => {
  // template.csv is byte-checked above, but the header line and the alias table are ALSO written out
  // in SKILL.md and README.md — as prose, which no compiler and no other test reads. SKILL.md's copy
  // is the one a model actually types when it writes line 1, so it is the copy that matters most.
  const headerLine = TEMPLATE_CSV.split('\n')[0];
  const skillMd = readText(skillFile('SKILL.md'));
  const readme = readText(skillFile('README.md'));
  const validator = readText(skillFile('validate.mjs'));

  it.each([
    ['SKILL.md', () => skillMd],
    ['README.md', () => readme],
    ['validate.mjs', () => validator],
  ])('quotes the canonical header verbatim in %s', (_name, read) => {
    expect(read()).toContain(headerLine);
  });

  it('documents every alias the parser accepts, and no alias it does not', () => {
    const documented = new Set(
      // The alias table runs from the header block to the sentence that closes it.
      (skillMd.split('These aliases are')[1] ?? '')
        .split('Prefer the canonical names')[0]
        .match(/`[^`]+`/g)
        ?.map((token) => token.replace(/`/g, '').toLowerCase()) ?? [],
    );
    expect(documented.size).toBeGreaterThan(10);

    const accepted = Object.values(HEADER_ALIASES).flat();
    for (const alias of accepted) {
      expect(documented, `SKILL.md must document the alias "${alias}"`).toContain(alias);
    }
    for (const token of documented) {
      // An option column is documented as a range (`optionA`..`optionJ`, `option a` .. `option j`);
      // everything else in that table must be a name the parser really answers to.
      const isOption = /^option\s*[a-j]$/.test(token);
      expect(
        isOption || accepted.includes(token),
        `SKILL.md documents "${token}", which the parser does not accept`,
      ).toBe(true);
    }
  });
});
