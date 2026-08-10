/**
 * Pictures for vocabulary flashcards: find one, draw one, store one, sweep the leftovers.
 *
 * Every image a word points at lives in our own R2 bucket under `flashcards/`, addressed by an
 * object key rather than a URL. That is the lesson of `audio_url` (see
 * 0016_wipe_flashcard_audio.sql): a column full of third-party links rots, and the feature dies
 * with it. Third-party URLs appear here only for the seconds it takes to copy the bytes across.
 *
 * Two sources, deliberately in this order:
 *
 *   - **Openverse** (api.openverse.org) needs no API key, and its CC0/public-domain slice needs no
 *     attribution, so it always works and there is no credit line to render on a card. It is the
 *     baseline: search is available even with nothing configured.
 *   - **Pixabay** is tried first when PIXABAY_API_KEY is set, because its photos are better
 *     curated for this. It sits behind a bot check that can reject server-to-server traffic
 *     outright (429 + an interstitial), so a failure here is expected, not exceptional — it falls
 *     back to Openverse silently rather than failing the request.
 *
 * `commit` takes a provider and that provider's id, never a URL. The server asks the provider
 * where the image lives, so the address being fetched is always one the provider chose. There is
 * no caller-supplied fetch target, which is what keeps this from being an open proxy.
 */
import { isNotNull } from 'drizzle-orm';
import { flashcardWords } from '../db/schema';
import type { Db } from '../db/index';
import type { VocabImageCandidate, VocabImageProvider } from '../../shared/schemas';

const PREFIX = 'flashcards/';

/** Refuse anything larger than this. A flashcard picture has no business being bigger. */
const MAX_BYTES = 6 * 1024 * 1024;

/** Content types we will store, and the extension each gets. Anything else is rejected. */
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** How many candidates the picker shows. Three rows of three. */
const CANDIDATES = 9;

/**
 * Pixabay's bot check appears to key partly off client hints, so send a stable, honest identity
 * rather than pretending to be a browser. Openverse asks for a contactable UA as a courtesy.
 */
const UA = 'MochiFlashcards/1.0 (+https://calendar.ngqv0712.workers.dev)';

// ---- Search ----

/**
 * Candidates for one search phrase, best source first.
 *
 * Never throws for want of results: an empty array means "nothing found", which the picker shows
 * as an empty state. It throws only when every configured source failed outright, so the caller
 * can tell "no matches" apart from "search is broken".
 */
export async function searchImages(
  env: Env,
  query: string,
): Promise<{ candidates: VocabImageCandidate[]; provider: VocabImageProvider }> {
  if (env.PIXABAY_API_KEY) {
    try {
      const candidates = await searchPixabay(env.PIXABAY_API_KEY, query);
      if (candidates.length) return { candidates, provider: 'pixabay' };
    } catch {
      // Bot check, rate limit, or an outage — Openverse below is the whole point of the fallback.
    }
  }
  return { candidates: await searchOpenverse(query), provider: 'openverse' };
}

async function searchPixabay(apiKey: string, query: string): Promise<VocabImageCandidate[]> {
  const url = new URL('https://pixabay.com/api/');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('q', query.slice(0, 100));
  url.searchParams.set('image_type', 'photo');
  url.searchParams.set('orientation', 'horizontal');
  // The audience is children; this is not optional.
  url.searchParams.set('safesearch', 'true');
  url.searchParams.set('per_page', String(CANDIDATES));
  url.searchParams.set('lang', 'en');

  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': UA } });
  if (!res.ok) throw new Error(`pixabay ${res.status}`);
  // A bot-check interstitial is HTML with a 200, so trust the content type, not the status.
  if (!(res.headers.get('content-type') ?? '').includes('json')) throw new Error('pixabay html');

  const json = (await res.json()) as {
    hits?: { id: number; previewURL?: string; webformatURL?: string; user?: string }[];
  };
  return (json.hits ?? [])
    .filter((h) => h.previewURL && h.webformatURL)
    .map((h) => ({
      provider: 'pixabay' as const,
      id: String(h.id),
      thumbUrl: h.previewURL as string,
      credit: h.user ?? '',
    }));
}

/**
 * Openverse, restricted to CC0 and public-domain marks.
 *
 * That filter is what makes the pictures usable with no credit line on the card. If it finds
 * nothing we return nothing rather than quietly widening to licences that would require
 * attribution the UI has nowhere to show.
 */
async function searchOpenverse(query: string): Promise<VocabImageCandidate[]> {
  const url = new URL('https://api.openverse.org/v1/images/');
  url.searchParams.set('q', query.slice(0, 100));
  url.searchParams.set('license', 'cc0,pdm');
  url.searchParams.set('page_size', String(CANDIDATES));
  // Wildly tall or wide pictures look broken in a 3:2 card.
  url.searchParams.set('aspect_ratio', 'wide,square');

  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': UA } });
  if (!res.ok) throw new Error(`openverse ${res.status}`);

  const json = (await res.json()) as {
    results?: { id?: string; thumbnail?: string; creator?: string }[];
  };
  return (json.results ?? [])
    .filter((r) => r.id && r.thumbnail)
    .map((r) => ({
      provider: 'openverse' as const,
      id: r.id as string,
      thumbUrl: r.thumbnail as string,
      credit: r.creator ?? '',
    }));
}

// ---- Commit (copy a chosen picture into our bucket) ----

/** Ask the provider where one of its images actually lives. */
async function resolveImageUrl(
  env: Env,
  provider: VocabImageProvider,
  id: string,
): Promise<string> {
  if (provider === 'openverse') {
    const res = await fetch(`https://api.openverse.org/v1/images/${encodeURIComponent(id)}/`, {
      headers: { accept: 'application/json', 'user-agent': UA },
    });
    if (!res.ok) throw new Error(`openverse detail ${res.status}`);
    const json = (await res.json()) as { url?: string; thumbnail?: string };
    // `url` is the original upload; the thumbnail is a fine consolation if it is missing.
    const url = json.url ?? json.thumbnail;
    if (!url) throw new Error('openverse no url');
    return url;
  }

  if (!env.PIXABAY_API_KEY) throw new Error('pixabay disabled');
  const url = new URL('https://pixabay.com/api/');
  url.searchParams.set('key', env.PIXABAY_API_KEY);
  url.searchParams.set('id', id);
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': UA } });
  if (!res.ok) throw new Error(`pixabay detail ${res.status}`);
  if (!(res.headers.get('content-type') ?? '').includes('json')) throw new Error('pixabay html');
  const json = (await res.json()) as { hits?: { largeImageURL?: string; webformatURL?: string }[] };
  const hit = json.hits?.[0];
  const picked = hit?.webformatURL ?? hit?.largeImageURL;
  if (!picked) throw new Error('pixabay no url');
  return picked;
}

/**
 * Copy a chosen stock image into R2 and return its key.
 *
 * The URL comes from `resolveImageUrl`, i.e. from the provider — the caller only ever names an id.
 * Size and content type are checked before the object is written, so a redirect to something that
 * is not an image cannot land in the bucket.
 */
export async function commitImage(
  env: Env,
  provider: VocabImageProvider,
  id: string,
): Promise<string> {
  const src = await resolveImageUrl(env, provider, id);
  const res = await fetch(src, { headers: { accept: 'image/*', 'user-agent': UA } });
  if (!res.ok) throw new Error(`fetch image ${res.status}`);

  const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const ext = EXT_BY_TYPE[contentType];
  if (!ext) throw new Error(`unsupported type ${contentType}`);

  const bytes = await res.arrayBuffer();
  if (bytes.byteLength === 0) throw new Error('empty image');
  if (bytes.byteLength > MAX_BYTES) throw new Error('image too large');

  const key = `${PREFIX}${crypto.randomUUID()}.${ext}`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType } });
  return key;
}

// ---- Generate ----

/**
 * Keeping generated pictures free of lettering, which took three attempts to get right.
 *
 * These models render confident nonsense when they try to write — a card captioned "taiey tor
 * feried" is worse than no card at all, on a deck whose whole purpose is spelling. Two things were
 * learned the hard way:
 *
 *   1. **Never name a medium that carries text.** Asking for "an illustration for a children's
 *      vocabulary flashcard" produced a bordered card with a caption top and bottom, because that
 *      is what a flashcard looks like. "Children's storybook illustration" did the same. Naming a
 *      medium that never carries words — clip art — stopped it dead.
 *   2. **Never mention text in the prompt, even to forbid it.** Diffusion prompts have no negation:
 *      "no text, no letters, no captions" reliably summoned a caption. Exclusions belong in
 *      `negative_prompt`, which is why this uses Leonardo Phoenix — flux-1-schnell accepts only
 *      `prompt` and `steps`, so there is nowhere to put them.
 *
 * The pair verified clean on a concrete noun and on a two-person scene (the harder case), both at
 * the requested 3:2. Change either half only against regenerated samples, not by reading it.
 */
const ILLUSTRATION_STYLE =
  'colourful cartoon clip art, bold outlines, flat solid colours, ' +
  'single subject filling the frame, plain white background, simple and clear';

/** Everything that must stay out of the picture. Only Phoenix can actually honour this. */
const ILLUSTRATION_NEGATIVE =
  'text, letters, words, caption, subtitle, title, label, alphabet, handwriting, numbers, ' +
  'watermark, signature, logo, poster, book page, flashcard, worksheet, ' +
  'frame, border, speech bubble, collage, multiple panels, blurry, distorted, scary';

/**
 * Draw an illustration and store it, returning the key.
 *
 * This is the answer for words stock photography handles badly — abstract nouns, verbs, feelings.
 * Unlike a stock pick, the bytes exist nowhere else, so they go straight to R2 (which is why an
 * abandoned review can leave an unreferenced object behind; see `pruneImages`).
 *
 * Phoenix is asked for a 3:2 picture to match the shape of a flip card, and is given a negative
 * prompt to keep lettering out. If it fails, flux-1-schnell still produces something usable — it
 * just tends to add a garbled caption, and the teacher sees the result in the picker before saving
 * either way.
 */
export async function generateImage(env: Env, subject: string): Promise<string> {
  const prompt = `${subject}. ${ILLUSTRATION_STYLE}`;
  let bytes: Uint8Array;
  try {
    const out = await env.AI.run('@cf/leonardo/phoenix-1.0', {
      prompt,
      negative_prompt: ILLUSTRATION_NEGATIVE,
      // 3:2, the aspect ratio of the card face the picture sits on.
      width: 1024,
      height: 680,
    });
    bytes = await imageBytes(out);
  } catch (err) {
    // Log it: falling back silently is how a captioned flux image gets mistaken for a Phoenix one.
    console.error('phoenix-1.0 failed, falling back to flux-1-schnell:', err);
    const out = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt, steps: 6 });
    bytes = await imageBytes(out);
  }
  if (bytes.byteLength === 0) throw new Error('empty image');

  const key = `${PREFIX}${crypto.randomUUID()}.jpg`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
  return key;
}

/**
 * Normalise what an image model hands back. The two used here disagree: flux returns
 * `{ image: <base64> }`, while Phoenix returns the JPEG itself — as a stream at runtime, though
 * its generated type says `string`. Accept all three shapes rather than betting on one.
 */
async function imageBytes(out: unknown): Promise<Uint8Array> {
  if (out instanceof ReadableStream) {
    return new Uint8Array(await new Response(out).arrayBuffer());
  }
  if (out instanceof ArrayBuffer) return new Uint8Array(out);
  const base64 =
    typeof out === 'string' ? out : ((out as { image?: string } | null)?.image ?? undefined);
  if (!base64) throw new Error('no image from model');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}


// ---- Housekeeping ----

/**
 * Delete stored pictures no word points at, once they are more than a day old.
 *
 * Images are written to R2 before the word that will reference them exists — a teacher reviewing a
 * generated topic can swap a picture, or abandon the whole topic, after the bytes have landed.
 * Rather than trying to undo that at every exit, unreferenced objects are simply collected later.
 *
 * The age guard is the load-bearing part: a review in progress holds keys that nothing references
 * yet, and deleting those would break the save the teacher is about to make. Anything under 24h
 * old is left alone, which is far longer than any review.
 *
 * Rides the daily job rather than taking a cron of its own, like `zalo.pruneMedia`.
 */
export async function pruneImages(db: Db, files: R2Bucket, minAgeHours = 24): Promise<number> {
  const rows = await db
    .select({ imageKey: flashcardWords.imageKey })
    .from(flashcardWords)
    .where(isNotNull(flashcardWords.imageKey));
  const referenced = new Set(rows.map((r) => r.imageKey as string));

  const cutoff = Date.now() - minAgeHours * 3_600_000;
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const page = await files.list({ prefix: PREFIX, cursor });
    const stale = page.objects
      .filter((o) => o.uploaded.getTime() < cutoff && !referenced.has(o.key))
      .map((o) => o.key);
    if (stale.length) {
      await files.delete(stale);
      deleted += stale.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return deleted;
}
