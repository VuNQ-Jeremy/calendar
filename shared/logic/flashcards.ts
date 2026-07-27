/**
 * Pure flashcard logic, shared by the web app and the mobile app.
 *
 * Extracted from `src/flashcards/game-utils.ts` and the bulk-import parser in
 * `src/flashcards/topic.tsx` during phase 3, so the two clients cannot disagree about what a
 * card's "meaning" is, how a paste is parsed, or how many words a game needs. No React, no DOM,
 * no React Native.
 */

export type GameMode = 'flip' | 'quiz' | 'match';

/** Minimum words a mode needs to be playable. Quiz needs 4 for one answer + three distractors. */
export const MIN_WORDS: Record<GameMode, number> = { flip: 1, quiz: 4, match: 3 };

/** The number of pairs in one round of match. */
export const MATCH_ROUND_SIZE = 6;

/** Structural minimum for `meaningOf` — any row with these three fields works. */
export interface MeaningSource {
  word: string;
  meaningVi: string;
  definitionEn?: string | null;
}

/**
 * The text shown as a card's "meaning". Prefers the manual Vietnamese meaning and falls back to
 * the English definition (then the word itself), so cards with no Vietnamese translation still
 * work in every game mode.
 */
export function meaningOf(w: MeaningSource): string {
  return w.meaningVi || w.definitionEn || w.word;
}

/** Fisher-Yates shuffle returning a new array (does not mutate the input). */
export function shuffle<T>(arr: readonly T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Milliseconds to `m:ss`. */
export function fmtDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Parse pasted bulk-import text into rows.
 *
 * One word per line. A tab or ` - ` separates the word from an optional Vietnamese meaning.
 * The spaces around the dash are load-bearing: they let hyphenated words like `well-known`
 * through unsplit.
 */
export function parseImportLines(text: string): { word: string; meaningVi: string }[] {
  const rows: { word: string; meaningVi: string }[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let word = line;
    let meaningVi = '';
    const tab = line.indexOf('\t');
    if (tab >= 0) {
      word = line.slice(0, tab).trim();
      meaningVi = line.slice(tab + 1).trim();
    } else {
      const dash = line.indexOf(' - ');
      if (dash >= 0) {
        word = line.slice(0, dash).trim();
        meaningVi = line.slice(dash + 3).trim();
      }
    }
    if (word) rows.push({ word, meaningVi });
  }
  return rows;
}

/**
 * Adaptive study order: the words a student gets wrong most often first, then the ones they have
 * not seen for longest. A student with no history — and any staff member, who has no mastery
 * rows at all by design — gets a plain shuffle.
 *
 * Moved verbatim from the `orderedWords` memo in src/flashcards/topic.tsx. Do not change the
 * comparison without changing it there.
 */
export function orderWordsByMastery<W extends { id: string }>(
  words: readonly W[],
  mastery: readonly { wordId: string; correct: number; wrong: number; lastSeen: string | null }[],
): W[] {
  if (mastery.length === 0) return shuffle(words);
  const by = new Map(mastery.map((m) => [m.wordId, m]));
  const ratio = (m?: { correct: number; wrong: number }) =>
    m ? m.wrong / Math.max(1, m.correct + m.wrong) : 0;
  return words.slice().sort((a, b) => {
    const ra = ratio(by.get(a.id));
    const rb = ratio(by.get(b.id));
    if (rb !== ra) return rb - ra;
    const la = by.get(a.id)?.lastSeen ?? '';
    const lb = by.get(b.id)?.lastSeen ?? '';
    return la.localeCompare(lb); // '' (never seen) sorts first
  });
}
