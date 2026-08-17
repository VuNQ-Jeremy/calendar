/**
 * Read a teacher's vocabulary workbook into units and words for the review screen.
 *
 * Same stance as the question importer (see the header of question-csv.ts): the app only ever
 * PARSES. Nothing is guessed, no import costs anything, and the file is a thing a teacher can open
 * and correct before uploading. Turning a textbook into this CSV is a one-off conversation job, not
 * a runtime model call.
 *
 * COLUMNS ARE FOUND BY HEADER, NEVER BY POSITION. That is not defensive programming, it is the
 * actual shape of the source material: the six vocabulary tables of *Tiếng Anh 9 Global Success* use
 * three different column orders between them, and unit 6 labels the part of speech `Từ loại` where
 * the other five write `Loại từ`. A positional reader would silently swap IPA and meaning for a third
 * of the book. Header matching is case- and diacritic-insensitive so a Vietnamese heading typed
 * without tone marks still lands.
 */

import { ExtractInputError } from './import-error';
import { exampleContainsAnswer } from './flashcards';

/** Rows scanned for a header before giving up — a teacher's file often opens with a title row. */
const HEADER_SCAN_ROWS = 10;

/** Units per import, and words in total. The English 9 book is 6 units / ~451 words. */
export const MAX_IMPORT_UNITS = 20;
export const MAX_IMPORT_WORDS = 600;

/** Tags per word, mirroring `FlashcardWordInput.topicIds`. */
const MAX_TAGS = 5;

/** Field limits, mirroring `FlashcardWordInput` so the review screen cannot show a row the server 400s. */
const MAX = {
  word: 100,
  meaningVi: 500,
  definitionEn: 1000,
  ipa: 200,
  partOfSpeech: 20,
  exampleEn: 300,
  exampleAnswer: 100,
  unitName: 200,
} as const;

export type VocabField =
  | 'unit'
  | 'unitName'
  | 'word'
  | 'partOfSpeech'
  | 'ipa'
  | 'meaningVi'
  | 'definitionEn'
  | 'exampleEn'
  | 'exampleAnswer'
  | 'topics';

/**
 * Accepted spellings per column, exported as data so `test/vocab-csv.test.ts` can hold the parser and
 * the documented template to each other. Compared after `norm()`, so tone marks and case are
 * irrelevant and only the letters matter.
 */
export const VOCAB_HEADER_ALIASES: Record<VocabField, string[]> = {
  unit: ['unit', 'unit no', 'unit number', 'bai', 'so bai', 'unit_no'],
  unitName: ['unit name', 'unit_name', 'ten bai', 'chu de bai', 'unit title'],
  word: ['word', 'tu vung', 'tu', 'headword', 'english'],
  partOfSpeech: ['pos', 'part of speech', 'part_of_speech', 'loai tu', 'tu loai', 'word class'],
  ipa: ['ipa', 'phien am', 'pronunciation', 'phonetic'],
  meaningVi: ['meaning', 'meaning vi', 'meaning_vi', 'nghia', 'nghia tieng viet', 'vietnamese'],
  definitionEn: [
    'definition',
    'definition en',
    'definition_en',
    'dinh nghia',
    'english definition',
  ],
  exampleEn: ['example', 'example en', 'example_en', 'vi du', 'cau vi du', 'example sentence'],
  exampleAnswer: ['example answer', 'example_answer', 'answer', 'dang trong cau', 'target form'],
  topics: ['topics', 'topic', 'chu de', 'tags', 'tag'],
};

/** Per-row defects the review screen shows as chips. Each is an i18n key. */
export type VocabImportIssue =
  | 'vi_issue_no_meaning'
  | 'vi_issue_example_dropped'
  | 'vi_issue_unknown_topic'
  | 'vi_issue_duplicate';

export interface ParsedVocabWord {
  word: string;
  partOfSpeech: string | null;
  ipa: string | null;
  meaningVi: string;
  definitionEn: string | null;
  exampleEn: string | null;
  exampleAnswer: string | null;
  topicIds: string[];
  issues: VocabImportIssue[];
  /** 1-based spreadsheet row this came from, so the review screen can point at it. */
  row: number;
}

export interface ParsedVocabUnit {
  unitNo: number;
  name: string;
  words: ParsedVocabWord[];
}

export interface ParsedVocabFile {
  units: ParsedVocabUnit[];
  /** 1-based spreadsheet rows that had content but no usable word. */
  skipped: number[];
  /** True when a cap cut the file short, so the teacher knows rows were left behind. */
  truncated: boolean;
}

/**
 * Lowercase, strip Vietnamese tone marks, collapse punctuation and runs of space.
 *
 * `đ`/`Đ` is special-cased because it does not decompose under NFD — it is a distinct letter, not a
 * `d` with a diacritic — so `Đọc` would otherwise keep its `đ` and fail to match `doc`.
 */
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const clamp = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s);
const orNull = (s: string): string | null => (s === '' ? null : s);

/** Column index per field, from the first row that names a `word` column. */
type HeaderMap = { row: number; cols: Partial<Record<VocabField, number>> };

function findHeader(rows: string[][]): HeaderMap {
  const fields = Object.entries(VOCAB_HEADER_ALIASES) as [VocabField, string[]][];
  for (let r = 0; r < Math.min(rows.length, HEADER_SCAN_ROWS); r++) {
    const cells = (rows[r] ?? []).map((c) => norm(c));
    const cols: Partial<Record<VocabField, number>> = {};
    for (const [field, aliases] of fields) {
      const at = cells.findIndex((c) => c !== '' && aliases.includes(c));
      if (at >= 0 && cols[field] === undefined) cols[field] = at;
    }
    if (cols.word !== undefined) return { row: r, cols };
  }
  // The one thing a teacher must fix in the file itself. Everything else degrades.
  throw new ExtractInputError('vi_err_bad_header');
}

/**
 * A downloadable starter file. Assembled line by line rather than as one template literal so
 * `core.autocrlf` cannot rewrite the newlines into something SheetJS reads as one row — the same
 * reason `TEMPLATE_CSV` in question-csv.ts is built this way.
 */
export const VOCAB_TEMPLATE_CSV = [
  'unit,unit_name,word,pos,ipa,meaning_vi,definition_en,example_en,example_answer,topics',
  '1,Local community,local,adj,/ˈləʊkəl/,(thuộc) địa phương,,Local markets offer fresh produce.,Local,',
  '1,Local community,community,n,/kəˈmjuːnɪti/,cộng đồng,,The community cleaned up the park.,community,home',
  '1,Local community,look after,phr.v,,chăm sóc,,She looks after her younger brother.,looks after,family',
  '2,City life,packed,adj,/pækt/,chật chội,,The stadium was packed with fans.,packed,',
].join('\n');

/**
 * Parse a sheet into units and words.
 *
 * `knownTopicIds` is the global tag catalog; a tag outside it is dropped with an issue rather than
 * rejected, because one typo must not cost the word.
 *
 * Throws `ExtractInputError('vi_err_bad_header')` when there is no word column. Every other defect
 * degrades: a row with no word is reported in `skipped`, a row the app cannot fully honour is flagged
 * for review, and a file over a cap is truncated rather than refused.
 */
export function parseVocabRows(
  rows: string[][],
  knownTopicIds: readonly string[],
): ParsedVocabFile {
  const { row: headerRow, cols } = findHeader(rows);
  const known = new Set(knownTopicIds);
  const units = new Map<number, ParsedVocabUnit>();
  /** Words already seen per unit, for the duplicate flag. */
  const seen = new Map<number, Set<string>>();
  const skipped: number[] = [];
  let truncated = false;
  let wordCount = 0;

  for (let r = headerRow + 1; r < rows.length; r++) {
    const raw = rows[r] ?? [];
    const rowNo = r + 1;
    const cell = (f: VocabField): string => {
      const at = cols[f];
      return at === undefined ? '' : (raw[at] ?? '').trim();
    };

    const word = clamp(cell('word'), MAX.word);
    // A wholly blank row is padding, not a mistake — SheetJS reports plenty of them at the end of a
    // hand-edited file. Only a row with SOMETHING in it but no word is worth reporting.
    if (!word) {
      if (raw.some((c) => c.trim() !== '')) skipped.push(rowNo);
      continue;
    }

    if (wordCount >= MAX_IMPORT_WORDS) {
      truncated = true;
      break;
    }

    const unitNo = Number.parseInt(cell('unit'), 10);
    // No unit column, or an unreadable one: everything lands in unit 1. Refusing the row would be
    // worse — a single-unit word list with no unit column is a perfectly reasonable file.
    const unit = Number.isFinite(unitNo) && unitNo >= 1 ? unitNo : 1;

    const issues: VocabImportIssue[] = [];
    const meaningVi = clamp(cell('meaningVi'), MAX.meaningVi);
    const definitionEn = clamp(cell('definitionEn'), MAX.definitionEn);
    if (!meaningVi && !definitionEn) issues.push('vi_issue_no_meaning');

    // Example handling, the most error-prone part of the whole import. `exampleAnswer` must appear
    // WHOLE-WORD in the sentence or the cloze and listen games can never blank it, so we check with
    // the games' own helper rather than a near-copy: a bare `includes()` accepts "run" inside "runs".
    // If the answer cell is blank, the headword is the obvious candidate — that works for "community"
    // in "The community gathered" but not for "look after" in "She looks after", which is exactly why
    // the column exists. When neither form is present, drop BOTH fields: a sentence the games cannot
    // use is worse than no sentence, because it looks like coverage.
    let exampleEn: string | null = orNull(clamp(cell('exampleEn'), MAX.exampleEn));
    let exampleAnswer: string | null = orNull(clamp(cell('exampleAnswer'), MAX.exampleAnswer));
    if (exampleEn) {
      if (!exampleAnswer && exampleContainsAnswer(exampleEn, word)) exampleAnswer = word;
      if (!exampleAnswer || !exampleContainsAnswer(exampleEn, exampleAnswer)) {
        exampleEn = null;
        exampleAnswer = null;
        issues.push('vi_issue_example_dropped');
      }
    } else {
      // An answer with no sentence is meaningless on its own.
      exampleAnswer = null;
    }

    const tagCells = cell('topics')
      .split(/[,;]/)
      .map((t) => t.trim())
      .filter(Boolean);
    const topicIds: string[] = [];
    let unknownTag = false;
    for (const t of tagCells) {
      const id = norm(t).replace(/ /g, '-');
      if (known.has(t)) topicIds.push(t);
      else if (known.has(id)) topicIds.push(id);
      else unknownTag = true;
    }
    if (unknownTag) issues.push('vi_issue_unknown_topic');

    const dupSet = seen.get(unit) ?? new Set<string>();
    seen.set(unit, dupSet);
    const key = norm(word);
    if (dupSet.has(key)) issues.push('vi_issue_duplicate');
    dupSet.add(key);

    let bucket = units.get(unit);
    if (!bucket) {
      if (units.size >= MAX_IMPORT_UNITS) {
        truncated = true;
        break;
      }
      bucket = { unitNo: unit, name: '', words: [] };
      units.set(unit, bucket);
    }
    // First non-blank name wins, so a merged/repeated unit-name column does not fight itself.
    if (!bucket.name) bucket.name = clamp(cell('unitName'), MAX.unitName);

    bucket.words.push({
      word,
      partOfSpeech: orNull(clamp(cell('partOfSpeech'), MAX.partOfSpeech)),
      ipa: orNull(clamp(cell('ipa'), MAX.ipa)),
      meaningVi,
      definitionEn: orNull(definitionEn),
      exampleEn,
      exampleAnswer,
      topicIds: topicIds.slice(0, MAX_TAGS),
      issues,
      row: rowNo,
    });
    wordCount++;
  }

  const out = [...units.values()].sort((a, b) => a.unitNo - b.unitNo);
  // A unit with no name still needs one — it becomes a deck, and a nameless deck is unusable. The
  // number is the only thing we can honestly call it.
  for (const u of out) if (!u.name) u.name = `Unit ${u.unitNo}`;
  return { units: out, skipped, truncated };
}
