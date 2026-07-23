export type DictEntry = {
  ipa: string | null;
  audioUrl: string | null;
  definition: string | null;
};

/**
 * Look up a single English word in the free dictionaryapi.dev API. Runs in the
 * browser (the API sends `Access-Control-Allow-Origin: *`). Returns null when
 * the word is not found or the network is unavailable — callers treat that as
 * "no auto data, fill manually".
 */
export async function fetchDictEntry(word: string): Promise<DictEntry | null> {
  const w = word.trim().toLowerCase();
  if (!w) return null;
  try {
    const res = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`,
    );
    if (!res.ok) return null; // 404 = word not found
    const json = (await res.json()) as Array<{
      phonetic?: string;
      phonetics?: Array<{ text?: string; audio?: string }>;
      meanings?: Array<{ definitions?: Array<{ definition?: string }> }>;
    }>;
    const entry = json[0];
    if (!entry) return null;
    const withAudio = entry.phonetics?.find((p) => p.audio);
    const withText = entry.phonetics?.find((p) => p.text);
    return {
      ipa: withText?.text ?? entry.phonetic ?? null,
      audioUrl: withAudio?.audio ?? null,
      definition: entry.meanings?.[0]?.definitions?.[0]?.definition ?? null,
    };
  } catch {
    return null; // network error → treat as not found
  }
}

/**
 * Look up many words with bounded concurrency (4 at a time) so a bulk paste of
 * dozens of words does not fire dozens of simultaneous requests. Reports
 * progress as each lookup settles.
 */
export async function fetchDictEntries(
  words: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, DictEntry | null>> {
  const out = new Map<string, DictEntry | null>();
  const queue = [...words];
  let done = 0;
  async function worker() {
    for (let w = queue.shift(); w !== undefined; w = queue.shift()) {
      out.set(w, await fetchDictEntry(w));
      onProgress?.(++done, words.length);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  return out;
}
