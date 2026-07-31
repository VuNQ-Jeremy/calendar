import type { EnrichedWord, VocabEnrichItem } from '@mochi/shared/schemas';
import * as api from './endpoints';

/** Map from lowercased word → the model's answer for it. */
export type EnrichMap = Map<string, EnrichedWord>;

/**
 * Words per request. The route accepts 200, but a single 200-word call takes over a minute — past
 * the endpoint's own 60s timeout — and gives the user no feedback. 50-word chunks keep each round
 * trip under ~20s and let the caller show real progress.
 *
 * Mirrors CHUNK in `src/lib/enrich-client.ts`; keep the two in step.
 */
const CHUNK = 50;

/**
 * Ask `/enrich-vocab` to fill in meaning, definition and IPA for a list of words, in chunks.
 *
 * Sequential, not parallel: chunks share one Anthropic account, and a burst of concurrent requests
 * is how you find its rate limit. Errors are allowed to throw so the caller's `useMutation` can
 * show them — a screen that silently returns nothing after a 20-second wait reads as a bug.
 */
export async function enrichInChunks(
  items: VocabEnrichItem[],
  onProgress?: (done: number, total: number) => void,
): Promise<EnrichMap> {
  const map: EnrichMap = new Map();
  if (items.length === 0) return map;
  onProgress?.(0, items.length);
  let done = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const res = await api.enrichVocab(chunk);
    for (const w of res.words) map.set(w.word.trim().toLowerCase(), w);
    done += chunk.length;
    onProgress?.(done, items.length);
  }
  return map;
}
