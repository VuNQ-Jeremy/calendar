/**
 * Pure flashcard logic, shared by the web app and the mobile app.
 *
 * Extracted from `src/flashcards/game-utils.ts` and the bulk-import parser in
 * `src/flashcards/topic.tsx` during phase 3, so the two clients cannot disagree about what a
 * card's "meaning" is, how a paste is parsed, or how many words a game needs. No React, no DOM,
 * no React Native.
 */

import { normalizeText } from './tests';

export type GameMode = 'flip' | 'quiz' | 'match' | 'scramble' | 'fill' | 'type' | 'picture';

/**
 * Every mode, in canonical display order. Drives the launcher rows, the assign-modal checkboxes
 * and `normalizeModesCsv` — one ordering, everywhere.
 */
export const ALL_MODES: readonly GameMode[] = [
  'flip',
  'quiz',
  'match',
  'scramble',
  'fill',
  'type',
  'picture',
];

/**
 * Minimum words a mode needs to be playable. Quiz and picture need 4 for one answer + three
 * distractors (picture distractors are word strings, so they don't need images of their own).
 */
export const MIN_WORDS: Record<GameMode, number> = {
  flip: 1,
  quiz: 4,
  match: 3,
  scramble: 1,
  fill: 1,
  type: 1,
  picture: 4,
};

/** The number of pairs in one round of match. */
export const MATCH_ROUND_SIZE = 6;

/**
 * Words per round of the "spelling" modes (scramble / fill / type / picture). Flip and quiz walk
 * the whole deck; these are slower per word, so a round is capped to keep one round short enough
 * that an assignment's `requiredCount` stays reasonable homework.
 */
export const SPELL_ROUND_SIZE = 10;

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

/**
 * Path that serves a word's stored picture, or null when it has none.
 *
 * Words hold an R2 object key (`flashcards/<uuid>.<ext>`), not a URL — see
 * 0033_flashcard_word_images.sql. Only the filename travels in the path; the route re-adds the
 * prefix, so no key can address another part of the bucket. Origin-relative, so the web app can
 * use it directly and the mobile app prefixes its API base.
 */
export function flashcardImagePath(imageKey: string | null | undefined): string | null {
  if (!imageKey) return null;
  const file = imageKey.slice(imageKey.indexOf('/') + 1);
  return file && !file.includes('/') ? `/flashcard-images/${file}` : null;
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

/** A random subset for one round of the spelling modes. The whole deck when it is small enough. */
export function pickRound<T>(items: readonly T[], size: number = SPELL_ROUND_SIZE): T[] {
  return shuffle(items).slice(0, size);
}

/**
 * True for characters a student has to place: letters and digits. Spaces, hyphens and
 * apostrophes ("ice cream", "well-known", "don't") stay fixed in the slot row instead of becoming
 * tiles — scrambling the separator teaches nothing and grading it punishes the wrong skill.
 */
export function isLetterChar(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch);
}

/** One character slot of a word, in order. Non-letter slots render as-is; letter slots play. */
export type LetterSlot = { ch: string; letter: boolean };

export function letterSlots(word: string): LetterSlot[] {
  return [...word].map((ch) => ({ ch, letter: isLetterChar(ch) }));
}

/**
 * The scramble bank: the word's letters, shuffled, avoiding the identity order when any other
 * order exists. When the shuffle lands on the original sequence, the first two positions holding
 * different letters are swapped — deterministic, no retry loop. A word whose letters are all the
 * same ("oo") has only one order, and keeps it.
 */
export function scrambleLetters(word: string): string[] {
  const letters = [...word].filter(isLetterChar);
  if (letters.length < 2) return letters;
  const out = shuffle(letters);
  if (out.join('') === letters.join('')) {
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        if (out[i] !== out[j]) {
          [out[i], out[j]] = [out[j], out[i]];
          return out;
        }
      }
    }
  }
  return out;
}

/** One slot of a masked word: hidden slots are the gaps the student fills. */
export type MaskSlot = { ch: string; hidden: boolean };

/**
 * Hide 40% of a word's letters (rounded up, at least one), never a separator, and — for words of
 * two or more letters — always leaving at least one letter visible as an anchor. A one-letter
 * word is fully hidden, which is degenerate but still playable: the meaning is the hint.
 */
export function maskWord(word: string): MaskSlot[] {
  const chars = [...word];
  const letterIdx = chars.map((ch, i) => (isLetterChar(ch) ? i : -1)).filter((i) => i >= 0);
  if (letterIdx.length === 0) return chars.map((ch) => ({ ch, hidden: false }));
  let hide = Math.max(1, Math.ceil(letterIdx.length * 0.4));
  if (letterIdx.length >= 2) hide = Math.min(hide, letterIdx.length - 1);
  const chosen = new Set(shuffle(letterIdx).slice(0, hide));
  return chars.map((ch, i) => ({ ch, hidden: chosen.has(i) }));
}

/** Random a–z letters padding the fill bank, so the gaps are not a free giveaway. */
export function decoyLetters(n = 2): string[] {
  const abc = 'abcdefghijklmnopqrstuvwxyz';
  return Array.from({ length: n }, () => abc[Math.floor(Math.random() * abc.length)]);
}

/**
 * Grade a typed answer with the school's established forgiveness rules — case, stray whitespace
 * and missing diacritics are not knowledge errors (shared/logic/tests.ts).
 */
export function checkTyped(input: string, word: string): boolean {
  return normalizeText(input) === normalizeText(word);
}

/**
 * Words the type mode may ask. `meaningOf` falls back to the word itself when both meaning fields
 * are blank, which would print the answer as the hint — those words are skipped, not asked.
 */
export function typeEligible(w: MeaningSource): boolean {
  return normalizeText(meaningOf(w)) !== normalizeText(w.word);
}

/**
 * The displayable URL for a word row's picture, or null. A structural wrapper over
 * `flashcardImagePath` (the one place that knows the serving route's shape): the key is read at
 * runtime rather than demanded by the type, so word rows loaded by clients built before the
 * `image_key` column shipped simply read as imageless instead of failing the build. `base` is
 * for clients that need an absolute URL (the mobile app); the web passes nothing and gets the
 * origin-relative path.
 */
export function imageOf(w: object, base = ''): string | null {
  const key = (w as { imageKey?: unknown }).imageKey;
  const path = typeof key === 'string' ? flashcardImagePath(key) : null;
  return path ? `${base}${path}` : null;
}

/** The subset of a deck the picture mode can actually show. */
export function wordsWithImages<W extends object>(words: readonly W[]): W[] {
  return words.filter((w) => imageOf(w) !== null);
}

/** One picture question: the image is the prompt, the options are English words. */
export type PictureQuestion<W> = { word: W; options: string[]; answer: string };

/**
 * Picture rounds are quiz-shaped: the answer's word string plus up to three distractor word
 * strings from the rest of the topic (deduped; distractors don't need images). Mirrors
 * `buildQuestions` in the quiz game.
 */
export function buildPictureQuestions<W extends { id: string; word: string }>(
  words: readonly W[],
  roundSize: number = SPELL_ROUND_SIZE,
): PictureQuestion<W>[] {
  return pickRound(wordsWithImages(words), roundSize).map((w) => {
    const answer = w.word;
    const distractors = shuffle(
      Array.from(
        new Set(
          words
            .filter((o) => o.id !== w.id)
            .map((o) => o.word)
            .filter((x) => x !== answer),
        ),
      ),
    ).slice(0, 3);
    return { word: w, options: shuffle([answer, ...distractors]), answer };
  });
}

/**
 * Parse an assignment's `modes` CSV (vocab_assignments.modes) into mode ids, or null for "any
 * mode counts" — the meaning of NULL, '' and a CSV with no recognisable ids alike. Unknown ids
 * are dropped rather than fatal so an old client reading a newer row degrades to a wider filter,
 * never a crash. Output order is canonical (`ALL_MODES`), whatever order the input had.
 */
export function parseModes(csv: string | null | undefined): GameMode[] | null {
  if (!csv) return null;
  const seen = new Set<string>();
  for (const tok of csv.split(',')) {
    const id = tok.trim();
    if ((ALL_MODES as readonly string[]).includes(id)) seen.add(id);
  }
  return seen.size ? ALL_MODES.filter((m) => seen.has(m)) : null;
}

/** The write-side twin: mode ids -> canonical CSV, or null when nothing valid remains. */
export function normalizeModesCsv(modes: readonly string[]): string | null {
  return parseModes(modes.join(','))?.join(',') ?? null;
}

/** Input validation for the modes CSV: every non-empty token must be a real mode id. */
export function isValidModesCsv(csv: string): boolean {
  return csv
    .split(',')
    .every((tok) => tok.trim() === '' || (ALL_MODES as readonly string[]).includes(tok.trim()));
}

/** Does a round in `mode` count toward an assignment restricted to `modesCsv`? Null = any. */
export function modeAllowed(modesCsv: string | null | undefined, mode: string): boolean {
  const modes = parseModes(modesCsv);
  return modes === null || modes.includes(mode as GameMode);
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
