import type { EnrichedWord, VocabEnrichItem } from '../../shared/schemas';

/** Map from lowercased word → the model's answer for it. */
export type EnrichMap = Map<string, EnrichedWord>;

export type EnrichResult =
  { ok: true; map: EnrichMap } | { ok: false; error: 'disabled' | 'failed' };

/**
 * Words per request. The route accepts 200, but a single 200-word call takes over a minute and
 * gives the user no feedback; 50-word chunks keep each round trip under ~20s and let the caller
 * show real progress.
 */
const CHUNK = 50;

/**
 * Ask the `/enrich-vocab` resource route to fill in meaning, definition and IPA for a list of
 * words. Plain same-origin fetch: the session cookie rides along automatically, and hitting a
 * resource route (not the flashcards route action) avoids any client-cache invalidation.
 *
 * This is the app's only enrichment path — it replaced a browser-side lookup against the free
 * dictionaryapi.dev, which had no Vietnamese and did not exist on mobile.
 *
 * Failures are reported rather than swallowed: the user pressed a button and waited, so silently
 * blank fields would read as a bug. Callers can still fall through to hand-editing.
 */
export async function fetchEnrichedWords(
  items: VocabEnrichItem[],
  onProgress?: (done: number, total: number) => void,
): Promise<EnrichResult> {
  const map: EnrichMap = new Map();
  if (items.length === 0) return { ok: true, map };
  onProgress?.(0, items.length);
  let done = 0;
  // Sequential, not parallel: chunks share one Anthropic account, and a burst of concurrent
  // requests is how you find its rate limit.
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    try {
      const fd = new FormData();
      fd.set('items', JSON.stringify(chunk));
      const res = await fetch('/enrich-vocab', { method: 'POST', body: fd });
      if (res.status === 503) return { ok: false, error: 'disabled' };
      if (!res.ok) return { ok: false, error: 'failed' };
      const json = (await res.json()) as { data?: { words?: EnrichedWord[] } };
      for (const w of json.data?.words ?? []) map.set(w.word.trim().toLowerCase(), w);
    } catch {
      return { ok: false, error: 'failed' };
    }
    done += chunk.length;
    onProgress?.(done, items.length);
  }
  return { ok: true, map };
}
