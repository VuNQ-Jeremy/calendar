#!/usr/bin/env -S npx tsx
/**
 * Import a curriculum CSV into a running Mochi instance, through its real route.
 *
 *   MOCHI_URL=https://calendar.ngqv0712.workers.dev \
 *   MOCHI_EMAIL=dev@mochi.edu MOCHI_PASSWORD=… \
 *   npx tsx scripts/import-curriculum.mts data/curricula/en9-global-success.csv "Tiếng Anh 9 Global Success" --library
 *
 * Re-run into the same book by passing its id instead of creating another:
 *
 *   npx tsx scripts/import-curriculum.mts <csv> <name> --curriculum-id 5fde15f6-…
 *
 * WHY THIS EXISTS. The importer's parse step runs in the BROWSER (src/flashcards/curriculum.tsx reads
 * the file with SheetJS and hands the server a units/words tree), so there is no server endpoint that
 * takes a CSV. Seeding a book on a deployed instance therefore needs something that does the client's
 * half. This is that — and it imports `parseVocabRows` from shared/logic rather than reimplementing
 * it, so what lands is exactly what the UI would have sent. A second parser would be a second set of
 * bugs and would silently drift.
 *
 * It writes only through `/vocabulary`'s own intents, so every ownership and tier check applies
 * normally: `--library` needs the account to be a platform admin or the route returns 403.
 *
 * Re-runnable. `importUnits` skips words already present in a unit by headword, so a second run with
 * `--curriculum-id` reports 0 words rather than duplicating the book. That is also why a source book
 * listing the same phrasal verb in both its vocabulary table and its grammar section lands one copy:
 * the word is in the topic, which is all that matters.
 */

import { readFileSync } from 'node:fs';
import { parseVocabRows } from '../shared/logic/vocab-csv.ts';
import { VOCAB_TOPICS } from '../shared/logic/vocab-topics.ts';

const [csvPath, curriculumName] = process.argv.slice(2);
const intoLibrary = process.argv.includes('--library');
const base = process.env.MOCHI_URL ?? 'http://localhost:5173';
const email = process.env.MOCHI_EMAIL;
const password = process.env.MOCHI_PASSWORD;

if (!csvPath || !curriculumName || !email || !password) {
  console.error(
    'usage: MOCHI_URL=… MOCHI_EMAIL=… MOCHI_PASSWORD=… npx tsx scripts/import-curriculum.mts <csv> <curriculum name> [--library]',
  );
  process.exit(1);
}

/** Minimal RFC-4180 split. The generator quotes any cell containing a comma. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

let cookie = '';

/**
 * Read a value out of a React Router single-fetch (turbo-stream) response body.
 *
 * The body is a flat array where objects are `{"_<keyIndex>": <valueIndex>}` — so
 * `[{"_1":2},"data",{"_3":4,"_5":6,"_7":6},"ok",true,"units",0,"words"]` means
 * `{ data: { ok: true, units: 0, words: 0 } }`. A literal `"words":381` therefore never appears in
 * the text, which is exactly the trap the first version of this script fell into: it regex-matched
 * `"words":(\d+)`, always missed, and reported a successful 381-word import as zero.
 */
function readNumber(body: string, label: string): number | null {
  let arr: unknown[];
  try {
    arr = JSON.parse(body) as unknown[];
  } catch {
    return null;
  }
  for (const node of arr) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (!k.startsWith('_') || typeof v !== 'number') continue;
      if (arr[Number(k.slice(1))] === label && typeof arr[v] === 'number') return arr[v] as number;
    }
  }
  return null;
}

/** POST a form to a route action. React Router's `.data` suffix is what the app's own fetchers use. */
async function post(path: string, fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  const res = await fetch(`${base}${path}.data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookie,
    },
    body,
    redirect: 'manual',
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  return text;
}

async function login() {
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ intent: 'login', email: email!, password: password! }),
    redirect: 'manual',
  });
  const setCookie = res.headers.get('set-cookie');
  const match = setCookie?.match(/__mochi_session=[^;]+/);
  if (!match) throw new Error(`login failed (${res.status}) — no session cookie`);
  cookie = match[0];
  console.log(`signed in as ${email}`);
}

/**
 * The curriculum to import into: the `--curriculum-id` given, else a freshly created one.
 *
 * There is deliberately no "find it by name" path. The loader payload is turbo-stream encoded, so a
 * name lookup means regex-scraping a flat array — and the first version of this script did exactly
 * that, matched an unrelated uuid sitting near the name, and 404'd every unit with
 * `curriculum_not_found`. An explicit id is unambiguous, and a re-run is a normal thing to want:
 * `importUnits` skips words already in a unit, so re-running with the same id is a no-op.
 */
async function resolveCurriculum(): Promise<string> {
  const flag = process.argv.indexOf('--curriculum-id');
  if (flag >= 0 && process.argv[flag + 1]) {
    const id = process.argv[flag + 1];
    console.log(`importing into existing curriculum ${id}`);
    return id;
  }
  const out = await post('/vocabulary', {
    intent: 'curriculum-create',
    name: curriculumName,
    active: 'true',
    ...(intoLibrary ? { intoLibrary: 'true' } : {}),
  });
  const created = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(out);
  if (!created) throw new Error(`could not read the new curriculum id from: ${out.slice(0, 400)}`);
  console.log(`created curriculum ${created[1]}${intoLibrary ? ' (shared library)' : ''}`);
  return created[1];
}

await login();

const rows = readFileSync(csvPath, 'utf8').trim().split('\n').map(splitCsv);
const parsed = parseVocabRows(
  rows,
  VOCAB_TOPICS.map((t) => t.id),
);
const total = parsed.units.reduce((n, u) => n + u.words.length, 0);
console.log(`parsed ${parsed.units.length} units / ${total} words`);
if (parsed.skipped.length) console.log(`skipped rows: ${parsed.skipped.join(', ')}`);
if (parsed.truncated) console.log('WARNING: truncated by a cap');

// Rows the review screen would leave unchecked. Reported rather than silently dropped, and skipped
// for the same reason the UI unchecks them: a word the app cannot fully honour should not arrive by
// accident. `vi_issue_duplicate` and `vi_issue_example_dropped` are the expected ones for this book.
const flagged = parsed.units.flatMap((u) =>
  u.words
    .filter((w) => w.issues.length)
    .map((w) => `u${u.unitNo} ${w.word}: ${w.issues.join(',')}`),
);
if (flagged.length) {
  console.log(`\n${flagged.length} flagged rows (imported anyway unless --skip-flagged):`);
  for (const f of flagged.slice(0, 12)) console.log(`  ${f}`);
  if (flagged.length > 12) console.log(`  … and ${flagged.length - 12} more`);
}
const skipFlagged = process.argv.includes('--skip-flagged');

const curriculumId = await resolveCurriculum();

// One POST per unit rather than one for the book: `VocabImportInput` caps a unit at 200 words and the
// request at 20 units, and a per-unit post means a failure names the unit it failed on.
let units = 0;
let words = 0;
for (const unit of parsed.units) {
  const chosen = skipFlagged ? unit.words.filter((w) => !w.issues.length) : unit.words;
  if (!chosen.length) continue;
  const payload = {
    curriculumId,
    units: [
      {
        unitNo: unit.unitNo,
        name: unit.name,
        words: chosen.map((w) => ({
          word: w.word,
          meaningVi: w.meaningVi,
          definitionEn: w.definitionEn,
          ipa: w.ipa,
          partOfSpeech: w.partOfSpeech,
          exampleEn: w.exampleEn,
          exampleAnswer: w.exampleAnswer,
          topicIds: w.topicIds,
        })),
      },
    ],
  };
  const out = await post('/vocabulary', {
    intent: 'curriculum-import',
    ...(intoLibrary ? { intoLibrary: 'true' } : {}),
    payload: JSON.stringify(payload),
  });
  const u = readNumber(out, 'units');
  const w = readNumber(out, 'words');
  if (u === null || w === null) {
    throw new Error(`could not read the import counts from: ${out.slice(0, 300)}`);
  }
  units += u;
  words += w;
  const skippedHere = chosen.length - w;
  console.log(
    `unit ${unit.unitNo} (${unit.name}): +${w} words` +
      // Already-present words are skipped by headword, which is what makes a re-run a no-op.
      (skippedHere ? ` (${skippedHere} already present)` : ''),
  );
}

console.log(`\nimported ${units} units / ${words} words into ${curriculumId}`);
