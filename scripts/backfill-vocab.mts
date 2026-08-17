#!/usr/bin/env -S npx tsx
/**
 * Fill in the fields an imported book leaves empty: English definition, example sentence, and
 * picture. Only ever writes a field that is currently NULL — it never overwrites a teacher's text.
 *
 *   MOCHI_URL=https://calendar.ngqv0712.workers.dev \
 *   MOCHI_EMAIL=dev@mochi.edu MOCHI_PASSWORD=… \
 *   npx tsx scripts/backfill-vocab.mts --curriculum 5fde15f6-… --text
 *
 * Flags: `--text` fills definitionEn / exampleEn / exampleAnswer via the app's enrich path;
 * `--images` attaches an Openverse picture per word; `--dry-run` reports without writing;
 * `--limit N` caps the words touched (use it for a first pass).
 *
 * WHY IT GOES THROUGH THE APP, not straight to D1. Enrichment must run inside the TranslateProxy
 * Durable Object: Cloudflare serves this Worker from Hong Kong for Vietnam traffic and Anthropic
 * geo-blocks that egress, so a script calling Anthropic directly from a Vietnamese machine gets
 * `403 Request not allowed`. Routing through `/enrich-vocab` also means the usage counters, the
 * sanitizers, and the ownership checks all apply exactly as they do for a teacher clicking the
 * button.
 *
 * MODEL TIER. It requests `quality: 'best'` (Claude Opus 5) rather than the interactive default
 * (Haiku 4.5). A backfill writes text that ships as-is into a shared library — nobody reviews 380
 * rows — and a wrong Vietnamese gloss becomes a wrong flashcard. Roughly 15x the cost per word, for
 * a few hundred words, once.
 *
 * PLATFORM ADMIN REQUIRED for a shared-library book. Library decks are `tenant_id NULL`, and
 * `updateWord` only reaches them for a platform admin (`editableTopicIds`). With an ordinary staff
 * account the writes match zero rows and the script reports every word as unfilled.
 */

import { execSync } from 'node:child_process';

const base = process.env.MOCHI_URL ?? 'http://localhost:5173';
const email = process.env.MOCHI_EMAIL;
const password = process.env.MOCHI_PASSWORD;
const flag = (name: string) => process.argv.includes(`--${name}`);
const value = (name: string) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
};

const doText = flag('text');
const doImages = flag('images');
const dryRun = flag('dry-run');
const limit = Number(value('limit') ?? '0') || Infinity;
const curriculumId = value('curriculum');

if (!email || !password || (!doText && !doImages)) {
  console.error(
    'usage: MOCHI_URL=… MOCHI_EMAIL=… MOCHI_PASSWORD=… npx tsx scripts/backfill-vocab.mts ' +
      '--curriculum <id> [--text] [--images] [--dry-run] [--limit N]',
  );
  process.exit(1);
}

/** Words per enrich request. The route caps a batch at 200; 50 is what the web client sends. */
const CHUNK = 50;

let cookie = '';

async function login() {
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ intent: 'login', email: email!, password: password! }),
    redirect: 'manual',
  });
  const match = res.headers.get('set-cookie')?.match(/__mochi_session=[^;]+/);
  if (!match) throw new Error(`login failed (${res.status})`);
  cookie = match[0];
  console.log(`signed in as ${email}`);
}

/**
 * The words to fill, read straight from D1 via wrangler.
 *
 * A direct read rather than the loader, because the loader returns one deck at a time and the
 * turbo-stream payload has to be decoded to get at it. Writes still go through the app.
 */
function candidates(): {
  id: string;
  slug: string;
  word: string;
  meaningVi: string;
  hasDefinition: boolean;
  hasExample: boolean;
  hasImage: boolean;
}[] {
  const where = curriculumId
    ? `t.curriculum_id = '${curriculumId}'`
    : 't.curriculum_id IS NOT NULL';
  const sql =
    `SELECT w.id, t.slug, w.word, w.meaning_vi AS meaningVi, ` +
    `(w.definition_en IS NOT NULL) AS hasDefinition, ` +
    `(w.example_en IS NOT NULL) AS hasExample, ` +
    `(w.image_key IS NOT NULL) AS hasImage ` +
    `FROM flashcard_words w JOIN flashcard_topics t ON t.id = w.topic_id ` +
    `WHERE ${where} ORDER BY t.unit_no, w.sort_order;`;
  const remote = base.startsWith('http') && !base.includes('localhost') ? '--remote' : '--local';
  const out = execSync(
    `npx wrangler d1 execute mochi-class ${remote} --json --command "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const parsed = JSON.parse(out) as { results: Record<string, unknown>[] }[];
  return (parsed[0]?.results ?? []).map((r) => ({
    id: String(r.id),
    slug: String(r.slug),
    word: String(r.word),
    meaningVi: String(r.meaningVi ?? ''),
    hasDefinition: Boolean(Number(r.hasDefinition)),
    hasExample: Boolean(Number(r.hasExample)),
    hasImage: Boolean(Number(r.hasImage)),
  }));
}

/** POST a form to a route action, returning the raw turbo-stream body. */
async function post(path: string, fields: Record<string, string>) {
  const res = await fetch(`${base}${path}.data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: new URLSearchParams(fields),
    redirect: 'manual',
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return text;
}

interface Enriched {
  word: string;
  meaningVi: string;
  definitionEn: string;
  ipa: string;
  exampleEn: string;
  exampleAnswer: string;
}

/**
 * Enrich one chunk. `/enrich-vocab` is a resource route outside `_app`, so it answers plain JSON
 * rather than turbo-stream — the one endpoint here whose body can be parsed directly.
 */
async function enrich(words: { word: string; definitionEn: string | null }[]): Promise<Enriched[]> {
  const res = await fetch(`${base}/enrich-vocab`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ items: words, quality: 'best' }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`enrich -> ${res.status}: ${body.slice(0, 300)}`);
  return ((JSON.parse(body) as { data?: { words?: Enriched[] } }).data?.words ?? []) as Enriched[];
}

await login();

const all = candidates();
console.log(`${all.length} words in scope`);
if (!all.length) process.exit(0);

if (doText) {
  // Only rows missing something. A word that already has both an English definition and a usable
  // example is left completely alone — re-enriching it would replace the book's own sentence.
  const todo = all.filter((w) => !w.hasDefinition || !w.hasExample).slice(0, limit);
  console.log(`\ntext: ${todo.length} words missing a definition and/or an example`);

  let filled = 0;
  let skipped = 0;
  for (let i = 0; i < todo.length; i += CHUNK) {
    const chunk = todo.slice(i, i + CHUNK);
    const got = await enrich(chunk.map((w) => ({ word: w.word, definitionEn: null })));
    // Match by word, not by position: the sanitizer may drop a row, and a positional join would
    // then write every subsequent word's fields onto the wrong word.
    const byWord = new Map(got.map((g) => [g.word.trim().toLowerCase(), g]));

    for (const w of chunk) {
      const hit = byWord.get(w.word.trim().toLowerCase());
      if (!hit) {
        skipped++;
        continue;
      }
      const fields: Record<string, string> = { intent: 'word-update', id: w.id };
      if (!w.hasDefinition && hit.definitionEn) fields.definitionEn = hit.definitionEn;
      // Both example fields move together or not at all — a sentence without its answer form is
      // unusable by the cloze and listen games, which is the whole point of the pair.
      if (!w.hasExample && hit.exampleEn && hit.exampleAnswer) {
        fields.exampleEn = hit.exampleEn;
        fields.exampleAnswer = hit.exampleAnswer;
      }
      // The book supplies every Vietnamese gloss, so `meaningVi` is deliberately never written —
      // a model's gloss must not silently replace the textbook's.
      if (Object.keys(fields).length <= 2) {
        skipped++;
        continue;
      }
      if (dryRun) {
        console.log(`  would fill ${w.word}: ${Object.keys(fields).slice(2).join(', ')}`);
      } else {
        await post(`/vocabulary/${w.slug}`, fields);
      }
      filled++;
    }
    console.log(`  ${Math.min(i + CHUNK, todo.length)}/${todo.length} … ${filled} filled`);
  }
  console.log(`text: ${filled} filled, ${skipped} skipped`);
}

if (doImages) {
  const todo = all.filter((w) => !w.hasImage).slice(0, limit);
  console.log(`\nimages: ${todo.length} words with no picture`);

  let attached = 0;
  let none = 0;
  for (const w of todo) {
    // `/vocab-image-search` returns candidates (Openverse needs no API key, so this path costs
    // nothing); `/vocab-image-commit` is what copies one into R2 and mints the key — the client
    // never gets to choose a URL, only a provider + that provider's own id.
    const search = await fetch(`${base}/vocab-image-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      // No `provider` on the way in — the search route picks one (Pixabay when its key is set,
      // Openverse otherwise) and each returned candidate names its own provider, which is what the
      // commit call must echo back.
      body: JSON.stringify({ query: w.word, page: 1 }),
    });
    if (!search.ok) {
      none++;
      continue;
    }
    const found = (await search.json()) as {
      data?: { candidates?: { provider: string; id: string }[] };
    };
    const first = found.data?.candidates?.[0];
    if (!first) {
      none++;
      continue;
    }
    if (dryRun) {
      console.log(`  would attach a picture to ${w.word}`);
      attached++;
      continue;
    }
    const commit = await fetch(`${base}/vocab-image-commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ provider: first.provider, id: first.id }),
    });
    if (!commit.ok) {
      none++;
      continue;
    }
    const { data } = (await commit.json()) as { data?: { imageKey?: string } };
    if (!data?.imageKey) {
      none++;
      continue;
    }
    await post(`/vocabulary/${w.slug}`, {
      intent: 'word-update',
      id: w.id,
      imageKey: data.imageKey,
    });
    attached++;
    if (attached % 25 === 0) console.log(`  ${attached}/${todo.length} attached`);
  }
  console.log(`images: ${attached} attached, ${none} with no usable result`);
}
