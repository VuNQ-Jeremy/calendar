/**
 * Post a batch of words to the `/translate` resource route and return a
 * lowercase-word → Vietnamese-meaning map. Plain same-origin fetch: the session
 * cookie rides along automatically, and hitting a resource route (not the
 * flashcards route action) avoids any client-cache invalidation side effects.
 *
 * Every failure path (translation disabled, network error, bad response) yields
 * an empty map so callers degrade gracefully — the meaning field just stays
 * empty and editable.
 */
export async function fetchTranslations(
  items: { word: string; definitionEn?: string | null }[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (items.length === 0) return out;
  try {
    const fd = new FormData();
    fd.set('items', JSON.stringify(items));
    const res = await fetch('/translate', { method: 'POST', body: fd });
    if (!res.ok) return out; // disabled (503) / failed (502) → empty map
    const json = (await res.json()) as {
      translations?: { word: string; meaningVi: string }[];
    };
    for (const t of json.translations ?? []) out.set(t.word.toLowerCase(), t.meaningVi);
  } catch {
    /* network error → empty map, UI degrades gracefully */
  }
  return out;
}
