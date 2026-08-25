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
 * `--images` attaches a picture per word; `--dry-run` reports without writing;
 * `--limit N` caps the words touched (use it for a first pass).
 *
 * `--replace` is the one flag that breaks the never-overwrite rule, and only for pictures. It
 * widens the selection to EVERY word — all topics, curriculum or not, with or without an existing
 * image — and overwrites the picture a teacher chose. Added for the one-off re-run after
 * PIXABAY_API_KEY was finally set in prod, when the whole library had been picked from Openverse's
 * CC0 slice and was uniformly poor. The old R2 objects become unreferenced and `pruneImages`
 * collects them 24h later, so there is a one-day window to change your mind and no longer.
 *
 * Because of that, `--replace` NEVER WRITES AN OPENVERSE PICTURE. `/vocab-image-search` names the
 * provider it used, and Pixabay's bot check is swallowed silently upstream (see
 * server/services/vocab-images.ts) — so a rate-limited run would otherwise quietly replace hundreds
 * of pictures with the very source it was meant to escape.
 *
 * A fallback to Openverse is AMBIGUOUS, which is the subtlety here: `searchImages` returns
 * `provider: 'openverse'` both when Pixabay threw and when Pixabay simply had no photo of the word.
 * Phrasal verbs ("get on (well) with") hit the second case constantly under `--all-pos`. So a
 * fallback triggers a probe for a word Pixabay certainly has: probe fine → that word has no stock
 * photo, skip it and keep whatever picture it already had; probe also falls back → Pixabay has
 * stopped answering, abort the run.
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
const doReplace = flag('replace');
const dryRun = flag('dry-run');

/**
 * Pixabay allows about 100 requests a minute per key, and one word costs two of them: the search,
 * then the commit's `resolveImageUrl` lookup. 1.5s between words keeps a 400-word run at roughly
 * 80/min, leaving headroom for the health probes an undepictable word triggers — 1.3s put the
 * baseline at 92/min, close enough to the ceiling that a run of phrasal verbs could push it over.
 * About ten minutes end to end for the full library.
 */
const PIXABAY_PACE_MS = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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

/**
 * Is this a word a photograph can actually depict?
 *
 * Image search returns *something* for any query, so "a candidate was found" says nothing about
 * whether the picture is right — and a wrong picture is worse than none, because the `picture` game
 * uses the image as the PROMPT and would teach the wrong association. Concrete nouns are the subset
 * a stock photo can carry; `break down`, `pass down` and `take (rubbish) away` have no depictable
 * referent and are better left blank.
 *
 * The source book spells the part of speech four ways for nouns — `n`, `N`, `(n)`, `noun` — so this
 * strips punctuation and case rather than comparing literals.
 */
function depictable(partOfSpeech: string): boolean {
  const pos = partOfSpeech.replace(/[^a-z]/gi, '').toLowerCase();
  return pos === 'n' || pos === 'noun';
}

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
  partOfSpeech: string;
  hasDefinition: boolean;
  hasExample: boolean;
  hasImage: boolean;
}[] {
  // An explicit --curriculum always wins. Otherwise the default scope is curriculum-linked topics
  // (the imported books this script was written for), except under --replace, which is a
  // whole-library sweep and must reach the standalone topics too.
  const where = curriculumId
    ? `t.curriculum_id = '${curriculumId}'`
    : doReplace
      ? '1 = 1'
      : 't.curriculum_id IS NOT NULL';
  const sql =
    `SELECT w.id, t.slug, w.word, w.meaning_vi AS meaningVi, ` +
    `COALESCE(w.part_of_speech, '') AS partOfSpeech, ` +
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
    partOfSpeech: String(r.partOfSpeech ?? ''),
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

/**
 * Is Pixabay still answering, or has it stopped?
 *
 * Asked only when a search has already fallen back, to disambiguate the two causes `searchImages`
 * reports identically. "dog" is the control: a word Pixabay has thousands of photos of, so a
 * fallback on THIS query cannot mean "no results" and must mean the key or the rate limit.
 */
async function pixabayHealthy(): Promise<boolean> {
  const res = await fetch(`${base}/vocab-image-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ query: 'dog', page: 1 }),
  });
  if (!res.ok) return false;
  const json = (await res.json()) as { data?: { provider?: string } };
  return json.data?.provider === 'pixabay';
}

if (doImages) {
  // --replace sweeps every word; the default only fills the blanks.
  const inScope = doReplace ? all : all.filter((w) => !w.hasImage);
  // `--all-pos` turns the noun filter off, for a caller who would rather review a wrong picture than
  // have none. Default is nouns only — see `depictable` for why.
  const eligible = flag('all-pos') ? inScope : inScope.filter((w) => depictable(w.partOfSpeech));
  const todo = eligible.slice(0, limit);
  const overwrites = todo.filter((w) => w.hasImage).length;
  console.log(
    `\nimages: ${inScope.length} in scope, ${eligible.length} depictable` +
      `${flag('all-pos') ? ' (--all-pos: filter off)' : ''}, doing ${todo.length}`,
  );
  if (doReplace && !dryRun) {
    console.log(
      `  --replace: ${overwrites} existing picture(s) will be OVERWRITTEN. The old R2 objects stay ` +
        `recoverable until pruneImages sweeps them ~24h from now.`,
    );
  }

  let attached = 0;
  let none = 0;
  /** Words Pixabay simply has no photo of — kept separate from `none` so the tail is legible. */
  let skippedNoStock = 0;
  for (const [i, w] of todo.entries()) {
    // Pace at the TOP of the loop, not on the success path: every `continue` below has already
    // spent a search request, and those are exactly the words a rate limit produces.
    if (i > 0) await sleep(PIXABAY_PACE_MS);
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
      data?: { candidates?: { provider: string; id: string }[]; provider?: string };
    };
    // The guard the whole --replace mode rests on. Falling back to Openverse is normal and fine
    // when filling a blank, but under --replace it means we are about to trade a teacher's pick for
    // a CC0 museum scan — and the cause (Pixabay's bot check or its rate limit) is silent upstream,
    // so nothing else would ever report it. Stop the run instead.
    if (doReplace && found.data?.provider !== 'pixabay') {
      // Ambiguous on its own — probe with a word Pixabay certainly has to find out which it is.
      if (await pixabayHealthy()) {
        // Pixabay is fine; it just has no photo of this word (phrasal verbs, abstract phrases).
        // Skip it: under --replace, leaving the existing picture beats writing a CC0 scan over it.
        skippedNoStock++;
        continue;
      }
      console.error(
        `\nABORTED at "${w.word}" (${attached} replaced so far): Pixabay has stopped answering — a ` +
          `probe for a word it certainly has fell back to Openverse too. Bot check or rate limit. ` +
          `Wait a few minutes and re-run; words already written are fine and the rest are untouched.`,
      );
      process.exit(1);
    }
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
  console.log(
    `images: ${attached} attached, ${none} with no usable result` +
      `, ${skippedNoStock} left as-is (no Pixabay photo exists)`,
  );
}
