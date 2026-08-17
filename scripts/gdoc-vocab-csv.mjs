#!/usr/bin/env node
/**
 * Turn a Google Docs HTML export of a vocabulary workbook into the CSV the importer reads.
 *
 *   curl -sL "https://docs.google.com/document/d/<ID>/export?format=html" -o /tmp/book.html
 *   node scripts/gdoc-vocab-csv.mjs /tmp/book.html > data/curricula/en9-global-success.csv
 *
 * WHY A SCRIPT AND NOT A TRANSCRIPTION. The source book is ~450 rows of bilingual content, and a
 * wrong Vietnamese gloss is a wrong flashcard. Reading the tables mechanically means no row can be
 * mistyped, the conversion is re-runnable when the doc is corrected, and the diff a reviewer sees is
 * the book rather than somebody's retyping of it.
 *
 * WHY THE HTML EXPORT. `?format=txt` flattens tables to one cell per line, and the cells cannot be
 * safely regrouped because the column ORDER VARIES BETWEEN UNITS — *Tiếng Anh 9 Global Success* uses
 * three different orders across its six vocabulary tables, and unit 6 writes `Từ loại` where the
 * others write `Loại từ`. The HTML export keeps real <tr>/<td> boundaries, so each table's own header
 * row says which column is which. Never trust position.
 *
 * WHAT IS IN SCOPE. The `A. Vocabulary` tables, plus the phrasal-verb tables that appear in the
 * grammar sections of units 1 and 2 (three columns: phrase, meaning, example — no IPA, no part of
 * speech, so those rows are emitted with pos `phr.v`). Grammar explanations and the ~475 practice
 * MCQs are deliberately NOT touched; they are a different feature.
 *
 * WHAT IT DOES NOT DO. It does not invent. No topic tags are assigned (the column is emitted empty,
 * to be filled in by hand or left blank), no meaning is translated, no example is rewritten. The one
 * derived field is `example_answer`, and only when the headword appears in the sentence verbatim —
 * the importer applies the same whole-word rule and drops the sentence if it does not hold, so a
 * guess here would be discarded there anyway.
 */

import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/gdoc-vocab-csv.mjs <export.html>');
  process.exit(1);
}

const html = readFileSync(file, 'utf8');

/** Unit titles, in order. Read off the `Unit N: Title` headings rather than hardcoded. */
const unitTitles = new Map();
for (const m of html.matchAll(/Unit\s*(\d+)\s*:\s*([^<]{1,80})</g)) {
  const no = Number(m[1]);
  const title = decode(m[2]).trim();
  if (title && !unitTitles.has(no)) unitTitles.set(no, title);
}

/**
 * The Latin-1 named entities, U+00C0 to U+00FF in order.
 *
 * Google's HTML export encodes anything in the Latin-1 supplement by NAME (`&ocirc;`) and everything
 * above it — which is most Vietnamese — as a numeric reference (`&#7897;`). Decoding only the numeric
 * form is the trap: it leaves `Phi&ecirc;n &acirc;m` looking nothing like `phien am`, so the header
 * match fails and the IPA and example columns silently come out empty for the whole book. The rows
 * were never missing; the header was unreadable.
 */
const LATIN1 =
  'Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'.split(
    ' ',
  );

const ENTITIES = new Map([
  ['nbsp', ' '],
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['hellip', '…'],
  ['ndash', '–'],
  ['mdash', '—'],
  ['lsquo', '‘'],
  ['rsquo', '’'],
  ['ldquo', '“'],
  ['rdquo', '”'],
  ['middot', '·'],
  ['rarr', '→'],
  ['pound', '£'],
  // IPA symbols outside Latin-1, which Google names rather than numbers: θ as `&theta;`, ʃ as
  // `&int;` (the integral sign — visually close enough that the doc's author used it), ŋ as `&eta;`.
  ['theta', 'θ'],
  ['int', 'ʃ'],
  ['eta', 'ŋ'],
  // A zero-width joiner in the middle of a word is invisible and breaks equality checks.
  ['zwj', ''],
  ...LATIN1.map((name, i) => [name, String.fromCodePoint(0x00c0 + i)]),
]);

/**
 * Named entities seen but not decoded. Collected rather than ignored: an undecoded entity is exactly
 * the bug that once emptied the IPA and example columns for the whole book, because the unreadable
 * text was a HEADER and the columns simply went unmatched. Silence is the dangerous outcome here, so
 * the run fails at the end if this is non-empty.
 */
const unknownEntities = new Set();

/** Strip tags, decode entities, collapse whitespace. */
function decode(s) {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) => {
      const hit = ENTITIES.get(name);
      if (hit === undefined) {
        unknownEntities.add(name);
        return m;
      }
      return hit;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lowercase, strip Vietnamese tone marks — the same normalisation the app's parser uses. */
function norm(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const HEADERS = {
  word: ['tu vung', 'tu', 'word'],
  pos: ['loai tu', 'tu loai', 'pos'],
  ipa: ['phien am', 'ipa'],
  meaning: ['nghia', 'meaning'],
  example: ['vi du', 'example'],
  phrase: ['cum dong tu'],
};

/** Every table in the document, as arrays of cell strings. */
function tables() {
  const out = [];
  for (const t of html.matchAll(/<table[\s\S]*?<\/table>/g)) {
    const rows = [];
    for (const r of t[0].matchAll(/<tr[\s\S]*?<\/tr>/g)) {
      rows.push([...r[0].matchAll(/<td[\s\S]*?<\/td>/g)].map((c) => decode(c[0])));
    }
    // `index` lets us decide which unit a table belongs to, by document position.
    out.push({ rows, at: t.index });
  }
  return out;
}

/** Byte offset of each `Unit N` heading, so a table can be attributed to the unit above it. */
const unitStarts = [...html.matchAll(/Unit\s*(\d+)\s*:/g)].map((m) => ({
  no: Number(m[1]),
  at: m.index,
}));
const unitAt = (offset) => {
  let no = 0;
  for (const u of unitStarts) if (u.at <= offset) no = u.no;
  return no;
};

/** Map a header row to column indexes, or null when this table is not a vocabulary table. */
function mapHeader(cells) {
  const normed = cells.map(norm);
  const find = (keys) => normed.findIndex((c) => keys.includes(c));
  const cols = {
    word: find(HEADERS.word),
    pos: find(HEADERS.pos),
    ipa: find(HEADERS.ipa),
    meaning: find(HEADERS.meaning),
    example: find(HEADERS.example),
  };
  if (cols.word < 0) {
    // The phrasal-verb tables head their first column `Cụm động từ` instead of `Từ vựng`.
    const phrase = find(HEADERS.phrase);
    if (phrase < 0) return null;
    cols.word = phrase;
    cols.phrasal = true;
  }
  // A vocabulary table always has a meaning column; a practice table never does.
  if (cols.meaning < 0) return null;
  return cols;
}

/** Whole-word, case-insensitive containment — the rule `exampleContainsAnswer` applies. */
function containsWholeWord(sentence, answer) {
  if (!sentence || !answer) return false;
  const esc = answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}([^\\p{L}\\p{N}]|$)`, 'iu').test(sentence);
}

/**
 * The phrasal verbs unit 2 writes as a numbered prose list instead of a table:
 *
 *     <p>1. Get around: Dạo quanh</p>
 *     <ul><li>When I was in town, I chose to get around by bus.</li></ul>
 *     <p>· (Khi ở thị trấn, tôi chọn di chuyển bằng xe buýt.)</p>
 *
 * Two shapes for the same material in one book, so both have to be read or unit 2 quietly loses five
 * words. Bounded to the stretch between a `Phrasal Verb` heading and the next `A./B./C.` section
 * heading, so the numbered items of a practice exercise can never be mistaken for vocabulary.
 */
function proseListRows() {
  const out = [];
  const blocks = [...html.matchAll(/<(p|li|h\d)\b[\s\S]*?<\/\1>/g)].map((m) => ({
    tag: m[1],
    text: decode(m[0]),
    at: m.index,
  }));
  let active = false;
  let pending = null;
  const flush = () => {
    if (pending) out.push(pending);
    pending = null;
  };
  for (const b of blocks) {
    if (/phrasal verb/i.test(b.text)) {
      flush();
      active = true;
      continue;
    }
    // Any lettered section heading ends the stretch — `B. Practice`, `C. Practice`, `A. Vocabulary`.
    if (/^[A-C]\.\s+\S/.test(b.text)) {
      flush();
      active = false;
      continue;
    }
    if (!active) continue;

    const item = /^(\d+)\.\s*([A-Za-z][^:]{0,40}?)\s*:\s*(.+)$/.exec(b.text);
    if (item && b.tag === 'p') {
      flush();
      pending = {
        unit: unitAt(b.at),
        word: item[2].trim().toLowerCase(),
        meaning: item[3].trim(),
        example: '',
      };
      continue;
    }
    // The first list item after a numbered entry is its English example; the Vietnamese gloss that
    // follows is a <p> starting with the bullet character, which this never matches.
    if (pending && b.tag === 'li' && !pending.example && /[A-Za-z]/.test(b.text)) {
      pending.example = b.text;
    }
  }
  flush();
  return out.filter((r) => r.unit && r.word && r.meaning);
}

const csvCell = (s) => {
  const v = String(s ?? '').replace(/"/g, '""');
  return /[",\n]/.test(v) ? `"${v}"` : v;
};

const out = [
  'unit,unit_name,word,pos,ipa,meaning_vi,definition_en,example_en,example_answer,topics',
];
let rowCount = 0;
const perUnit = new Map();

for (const table of tables()) {
  if (!table.rows.length) continue;
  const cols = mapHeader(table.rows[0]);
  if (!cols) continue;
  const unit = unitAt(table.at);
  if (!unit) continue;
  const unitName = unitTitles.get(unit) ?? `Unit ${unit}`;

  for (const cells of table.rows.slice(1)) {
    const at = (i) => (i >= 0 ? (cells[i] ?? '').trim() : '');
    const word = at(cols.word);
    const meaning = at(cols.meaning);
    if (!word || !meaning) continue;
    // A repeated header row inside a long table (Google splits them across pages) is not a word.
    if (norm(word) === norm(table.rows[0][cols.word] ?? '')) continue;

    const example = at(cols.example);
    // Only when the headword really is in the sentence; otherwise leave it for the importer to flag
    // rather than guessing an inflection.
    const answer = containsWholeWord(example, word) ? word : '';
    out.push(
      [
        unit,
        unitName,
        word,
        cols.phrasal ? 'phr.v' : at(cols.pos),
        at(cols.ipa),
        meaning,
        '',
        example,
        answer,
        '',
      ]
        .map(csvCell)
        .join(','),
    );
    rowCount++;
    perUnit.set(unit, (perUnit.get(unit) ?? 0) + 1);
  }
}

// The prose-list phrasal verbs, appended after their unit's table rows. Order inside a unit becomes
// `sort_order`, so keeping them last means the tables' numbering is unaffected by this pass.
const prose = proseListRows();
const byUnit = new Map();
for (const r of prose) {
  if (!byUnit.has(r.unit)) byUnit.set(r.unit, []);
  byUnit.get(r.unit).push(r);
}
for (const [unit, rows] of [...byUnit].sort((a, b) => a[0] - b[0])) {
  const unitName = unitTitles.get(unit) ?? `Unit ${unit}`;
  for (const r of rows) {
    const answer = containsWholeWord(r.example, r.word) ? r.word : '';
    out.push(
      [unit, unitName, r.word, 'phr.v', '', r.meaning, '', r.example, answer, '']
        .map(csvCell)
        .join(','),
    );
    rowCount++;
    perUnit.set(unit, (perUnit.get(unit) ?? 0) + 1);
  }
}

process.stdout.write(out.join('\n') + '\n');
console.error(`${rowCount} words across ${perUnit.size} units`);
for (const [no, n] of [...perUnit].sort((a, b) => a[0] - b[0])) {
  console.error(`  unit ${no}: ${n} words — ${unitTitles.get(no) ?? '?'}`);
}
const missing = out.length - 1 - rowCount;
if (missing) console.error(`WARNING: ${missing} rows unaccounted for`);

// Fail rather than emit half-decoded text. Add the entity to ENTITIES above and re-run.
if (unknownEntities.size) {
  console.error(`\nERROR: undecoded named entities: ${[...unknownEntities].sort().join(', ')}`);
  console.error(
    'Add them to ENTITIES in this script — an undecoded header breaks column matching.',
  );
  process.exit(2);
}
