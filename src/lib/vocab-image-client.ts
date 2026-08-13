import type { VocabImageCandidate, VocabImageProvider } from '../../shared/schemas';

/**
 * Browser side of the vocabulary-picture routes. Plain same-origin fetches, like
 * generate-client.ts: the session cookie rides along, and posting to a resource route rather than
 * a route action keeps the client cache out of it.
 *
 * Every call reports failure rather than throwing. A missing picture is never worth taking a save
 * down for — the word is the point, the picture is a bonus.
 */

export type SearchResult =
  { ok: true; candidates: VocabImageCandidate[]; provider: VocabImageProvider } | { ok: false };

/**
 * Candidates for one phrase. `ok: true` with an empty list means "nothing matched" — which is also
 * what a `page` past the end of the results returns, so a caller walking pages knows to wrap.
 */
export async function searchVocabImages(query: string, page = 1): Promise<SearchResult> {
  try {
    const fd = new FormData();
    fd.set('payload', JSON.stringify({ query, page }));
    const res = await fetch('/vocab-image-search', { method: 'POST', body: fd });
    if (!res.ok) return { ok: false };
    const json = (await res.json()) as {
      data?: { candidates?: VocabImageCandidate[]; provider?: VocabImageProvider };
    };
    return {
      ok: true,
      candidates: json.data?.candidates ?? [],
      provider: json.data?.provider ?? 'openverse',
    };
  } catch {
    return { ok: false };
  }
}

export type KeyResult = { ok: true; imageKey: string } | { ok: false };

/** Draw an illustration for `subject` and store it. Takes a few seconds — show a spinner. */
export async function generateVocabImage(subject: string): Promise<KeyResult> {
  try {
    const fd = new FormData();
    fd.set('payload', JSON.stringify({ prompt: subject }));
    const res = await fetch('/vocab-image-generate', { method: 'POST', body: fd });
    if (!res.ok) return { ok: false };
    const json = (await res.json()) as { data?: { imageKey?: string } };
    return json.data?.imageKey ? { ok: true, imageKey: json.data.imageKey } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/**
 * Copy a chosen stock picture into our bucket. Sends the provider's id, not a URL — the server
 * resolves where the image lives, so there is no fetch target to tamper with.
 */
export async function commitVocabImage(
  provider: VocabImageProvider,
  id: string,
): Promise<KeyResult> {
  try {
    const fd = new FormData();
    fd.set('payload', JSON.stringify({ provider, id }));
    const res = await fetch('/vocab-image-commit', { method: 'POST', body: fd });
    if (!res.ok) return { ok: false };
    const json = (await res.json()) as { data?: { imageKey?: string } };
    return json.data?.imageKey ? { ok: true, imageKey: json.data.imageKey } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/**
 * Run `fn` over `items` with at most `limit` in flight, preserving result order.
 *
 * Auto-attaching pictures to a freshly generated topic means up to 50 searches at once. Firing
 * them all would hammer both our Worker and the upstream provider's rate limit; a small pool keeps
 * the whole batch to a couple of seconds without being rude.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = Array.from({ length: items.length }) as R[];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
