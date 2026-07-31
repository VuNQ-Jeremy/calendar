import type { GeneratedWord, VocabGenerateInput } from '../../shared/schemas';

export type GenerateResult =
  { ok: true; words: GeneratedWord[] } | { ok: false; error: 'disabled' | 'failed' };

/**
 * Ask the `/generate-vocab` resource route for a set of words on a topic. Plain same-origin
 * fetch: the session cookie rides along automatically, and hitting a resource route (not the
 * flashcards route action) avoids any client-cache invalidation side effects.
 *
 * Unlike fetchTranslations, failures are reported rather than swallowed — the user pressed a
 * button and waited up to 20 seconds, so an empty list would read as a bug.
 */
export async function fetchGeneratedWords(input: VocabGenerateInput): Promise<GenerateResult> {
  try {
    const fd = new FormData();
    fd.set('payload', JSON.stringify(input));
    const res = await fetch('/generate-vocab', { method: 'POST', body: fd });
    if (res.status === 503) return { ok: false, error: 'disabled' };
    if (!res.ok) return { ok: false, error: 'failed' };
    const json = (await res.json()) as { data?: { words?: GeneratedWord[] } };
    return { ok: true, words: json.data?.words ?? [] };
  } catch {
    return { ok: false, error: 'failed' };
  }
}
