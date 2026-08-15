/**
 * Pure flashcard logic, shared by the web app and the mobile app.
 *
 * Extracted from `src/flashcards/game-utils.ts` and the bulk-import parser in
 * `src/flashcards/topic.tsx` during phase 3, so the two clients cannot disagree about what a
 * card's "meaning" is, how a paste is parsed, or how many words a game needs. No React, no DOM,
 * no React Native.
 */

import { normalizeText } from './tests';

export type GameMode =
  | 'flip'
  | 'quiz'
  | 'match'
  | 'scramble'
  | 'fill'
  | 'type'
  | 'picture'
  | 'ipa'
  | 'stress'
  | 'cloze'
  | 'listen'
  | 'pronounce'
  | 'mix';

/**
 * Every mode, in canonical display order. Drives the launcher rows, the assign-modal checkboxes
 * and `normalizeModesCsv` — one ordering, everywhere. Mix sits last: it is the "all of the above"
 * round, and the assign modal features it separately from the plain modes.
 */
export const ALL_MODES: readonly GameMode[] = [
  'flip',
  'quiz',
  'match',
  'scramble',
  'fill',
  'type',
  'picture',
  'ipa',
  'stress',
  'cloze',
  'listen',
  'pronounce',
  'mix',
];

/**
 * Minimum words a mode needs to be playable. Quiz, picture, ipa and cloze need 4 for one answer +
 * three distractors (picture distractors are word strings, so they don't need images of their own;
 * cloze distractors are other topic words). The floors that data availability sets on top of deck
 * size — a word with IPA, a word with an example sentence — are checked by the launcher per mode.
 */
export const MIN_WORDS: Record<GameMode, number> = {
  flip: 1,
  quiz: 4,
  match: 3,
  scramble: 1,
  fill: 1,
  type: 1,
  picture: 4,
  ipa: 4,
  stress: 1,
  cloze: 4,
  listen: 1,
  pronounce: 1,
  mix: 4,
};

/**
 * Azure accuracy score (0-100) at or above which a spoken word counts as correct in the
 * pronounce mode. 70 is Azure's own suggested "fair pronunciation" line. Pronounce stays out
 * of MIX_POOL_MODES / wordSupportsMode on purpose: it needs the network and a microphone,
 * and a mixed round must stay playable offline.
 */
export const PRONOUNCE_PASS = 70;

/** Whether an Azure accuracy score passes the pronounce mode's bar. */
export function pronouncePassed(accuracy: number): boolean {
  return accuracy >= PRONOUNCE_PASS;
}

/**
 * How one phoneme of the IPA breakdown is coloured: green / amber / red. The red line sits
 * below PRONOUNCE_PASS on purpose — per-phoneme scores on a one-word clip are noisier than the
 * word score, and marking a sound wrong is harsher feedback than failing the word.
 */
export function phonemeTier(accuracy: number): 'good' | 'close' | 'wrong' {
  if (accuracy >= 80) return 'good';
  return accuracy >= 60 ? 'close' : 'wrong';
}

/**
 * The forgiveness presets the admin can apply to pronounce scores (/config → Pronounce
 * scoring). Kids record on cheap mics in noisy rooms, so raw Azure numbers read harsher than
 * the pronunciation deserves; a curve lifts what is SHOWN and the pass mark follows it. The
 * raw numbers stay in the DTO untouched — the details drawer and stored results keep the truth.
 */
export const PRONOUNCE_CURVES = ['off', 'round5', 'boost5', 'round10', 'squeeze'] as const;
export type PronounceCurve = (typeof PRONOUNCE_CURVES)[number];

/**
 * Apply a forgiveness curve to one raw 0-100 score. 0 stays 0 on every curve — kindness is
 * for attempts, and a silent clip must not earn points from a flat boost. Applied server-side
 * to decide `correct`, and client-side to every kid-facing number and colour tier.
 */
export function forgiveScore(raw: number, curve: PronounceCurve): number {
  if (raw <= 0) return 0;
  switch (curve) {
    case 'round5':
      return Math.min(100, Math.ceil(raw / 5) * 5);
    case 'boost5':
      return Math.min(100, raw + 5);
    case 'round10':
      return Math.min(100, Math.ceil(raw / 10) * 10);
    case 'squeeze':
      return Math.round(100 - (100 - raw) * 0.75);
    default:
      return raw;
  }
}

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
 * One picture question for `w`: the answer's word string plus up to three distractor word strings
 * from the rest of the topic (deduped; distractors don't need images).
 */
export function buildPictureQuestion<W extends { id: string; word: string }>(
  w: W,
  words: readonly W[],
): PictureQuestion<W> {
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
}

/** Picture rounds are quiz-shaped — see `buildPictureQuestion` for one question's shape. */
export function buildPictureQuestions<W extends { id: string; word: string }>(
  words: readonly W[],
  roundSize: number = SPELL_ROUND_SIZE,
): PictureQuestion<W>[] {
  return pickRound(wordsWithImages(words), roundSize).map((w) => buildPictureQuestion(w, words));
}

/** Round sizes a student may pick in free study; an assignment's questionCount overrides. */
export const ROUND_SIZES = [10, 15, 20] as const;
export const DEFAULT_ROUND_SIZE = 10;

// ---- IPA stress parsing ----

/** GA vowel letters the enrichment prompt produces (broad transcription). */
const IPA_VOWELS = new Set('iɪyʏeøɛœæaɶɑɒʌɔoʊuɯʉɘɵəɜɞɐɚɝ');
/** Two-character GA diphthongs counted as ONE nucleus. */
const IPA_DIPHTHONGS = new Set(['aɪ', 'aʊ', 'eɪ', 'oʊ', 'ɔɪ']);
/** Combining syllabic-consonant mark ("buttn" -> /ˈbʌtn̩/): the marked consonant is a nucleus. */
const IPA_SYLLABIC = '̩';

export type IpaStress = { syllables: number; stressIndex: number };

/**
 * Syllable count and primary-stress position derived from a broad IPA transcription
 * (/ˈwɪskər/ -> 2 syllables, stress on 0). Nuclei are maximal vowel groups (greedy two-char
 * diphthong, ː extends) plus syllabic consonants. A multi-syllable word with no ˈ mark returns
 * null — guessing a stress would grade students against a coin flip.
 */
export function ipaStress(ipa: string | null | undefined): IpaStress | null {
  if (!ipa) return null;
  const s = ipa.trim().replace(/^[/[]+|[/\]]+$/g, '');
  let syllables = 0;
  let stressIndex = -1;
  let pendingStress = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === 'ˈ') {
      pendingStress = true;
      continue;
    }
    const syllabicConsonant = !IPA_VOWELS.has(ch) && s[i + 1] === IPA_SYLLABIC;
    if (!IPA_VOWELS.has(ch) && !syllabicConsonant) continue;
    if (IPA_VOWELS.has(ch)) {
      if (s[i + 1] && IPA_DIPHTHONGS.has(ch + s[i + 1])) i++;
      while (s[i + 1] === 'ː') i++;
    } else {
      i++; // consume the syllabic mark
    }
    if (pendingStress) {
      stressIndex = syllables;
      pendingStress = false;
    }
    syllables++;
  }
  if (syllables === 0) return null;
  if (stressIndex < 0) {
    if (syllables > 1) return null;
    stressIndex = 0;
  }
  return { syllables, stressIndex };
}

/** Words the stress mode can ask about: multi-syllable with a parseable stress mark. */
export function stressEligible(w: { ipa?: string | null }): boolean {
  const st = ipaStress(w.ipa);
  return st !== null && st.syllables >= 2;
}

// ---- Example sentences (cloze / listen) ----

export const CLOZE_BLANK = '_____';

export interface ExampleSource {
  exampleEn?: string | null;
  exampleAnswer?: string | null;
}

/** Letters and digits — what may NOT sit against a match for it to count as a whole word. */
const isWordChar = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/**
 * Case-insensitive index of the stored surface form inside the sentence, or -1.
 *
 * WHOLE-WORD, not substring. The enrich/generate prompt asks the model for `exampleAnswer` as the
 * exact form as it appears in the sentence, "including any inflection (\"ran\" for \"run\")" — so a
 * match that is only a substring is precisely the signal that the model failed to do that.
 * Accepting it produced broken cloze questions: answer "read" against "He reads books." blanked to
 * "He _____s books.". Scans every occurrence, because the first one may be the inflected near-miss
 * while a later one is the real word.
 */
export function exampleAnswerIndex(sentence: string, answer: string): number {
  if (!sentence || !answer) return -1;
  const hay = sentence.toLowerCase();
  const needle = answer.toLowerCase();
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    if (!isWordChar(hay[i - 1]) && !isWordChar(hay[i + needle.length])) return i;
  }
  return -1;
}

/**
 * Does the sentence really contain its own answer, as a word?
 *
 * The ingestion sanitizers (server/services/enrich.ts, generate.ts) null BOTH example fields when
 * this is false. Exported so those two and the games agree by construction — three independent
 * `.includes()` checks are what let the mismatch through in the first place.
 */
export function exampleContainsAnswer(sentence: string, answer: string): boolean {
  return exampleAnswerIndex(sentence, answer) >= 0;
}

/** Words the sentence games can ask: sentence present and it really contains the answer. */
export function exampleEligible(w: ExampleSource): boolean {
  return Boolean(
    w.exampleEn && w.exampleAnswer && exampleAnswerIndex(w.exampleEn, w.exampleAnswer) >= 0,
  );
}

/** The subset of a deck the sentence games (cloze / listen) can actually show. */
export function wordsWithExamples<W extends ExampleSource>(words: readonly W[]): W[] {
  return words.filter(exampleEligible);
}

/** The sentence with its target blanked, plus the answer in its original casing, or null. */
export function blankExample(w: ExampleSource): { blanked: string; answer: string } | null {
  if (!w.exampleEn || !w.exampleAnswer) return null;
  const idx = exampleAnswerIndex(w.exampleEn, w.exampleAnswer);
  if (idx < 0) return null;
  const answer = w.exampleEn.slice(idx, idx + w.exampleAnswer.length);
  return {
    blanked:
      w.exampleEn.slice(0, idx) + CLOZE_BLANK + w.exampleEn.slice(idx + w.exampleAnswer.length),
    answer,
  };
}

// ---- Quiz questions (moved from src/flashcards/game-quiz.tsx so mix and mobile share it) ----

/**
 * `text` and `audio` ask which meaning fits the word. `image` runs the other way round — the
 * picture is the prompt and the options are English words — which is the whole point of putting a
 * picture on a card: recognising the thing without translating first.
 */
export type QuizQuestion<W> = {
  word: W;
  prompt: 'text' | 'audio' | 'image';
  options: string[];
  answer: string;
};

/** Roughly how often a word that has a picture is asked as a picture question. */
export const QUIZ_IMAGE_SHARE = 0.35;
/** Roughly how often a text-meaning question is asked as audio instead. */
export const QUIZ_AUDIO_SHARE = 0.35;

type QuizSource = MeaningSource & { id: string; imageKey?: string | null };

/**
 * One quiz question for `w`, with distractors drawn from `words`. A picture question needs three
 * other spellings to choose between; a deck of near-duplicates can fall through to a meaning
 * question even when `w` has a picture.
 */
export function buildQuizQuestion<W extends QuizSource>(
  w: W,
  words: readonly W[],
): QuizQuestion<W> {
  if (imageOf(w) && Math.random() < QUIZ_IMAGE_SHARE) {
    const wordDistractors = shuffle(
      Array.from(new Set(words.filter((o) => o.id !== w.id).map((o) => o.word))).filter(
        (o) => o !== w.word,
      ),
    ).slice(0, 3);
    if (wordDistractors.length === 3) {
      return {
        word: w,
        prompt: 'image',
        options: shuffle([w.word, ...wordDistractors]),
        answer: w.word,
      };
    }
    // Not enough distinct spellings — fall through to the meaning question below.
  }
  const answer = meaningOf(w);
  const distractors = shuffle(
    Array.from(
      new Set(
        words
          .filter((o) => o.id !== w.id)
          .map(meaningOf)
          .filter((m) => m !== answer),
      ),
    ),
  ).slice(0, 3);
  return {
    word: w,
    prompt: Math.random() < QUIZ_AUDIO_SHARE ? 'audio' : 'text',
    options: shuffle([answer, ...distractors]),
    answer,
  };
}

export function buildQuizQuestions<W extends QuizSource>(
  words: readonly W[],
  roundSize?: number,
): QuizQuestion<W>[] {
  return shuffle(words)
    .slice(0, roundSize ?? words.length)
    .map((w) => buildQuizQuestion(w, words));
}

// ---- IPA questions ----

export type IpaQuestion<W> = {
  word: W;
  direction: 'ipa-to-word' | 'word-to-ipa';
  options: string[];
  answer: string;
};

/** How often an IPA question runs word -> IPA instead of IPA -> word, when enough distractors exist. */
export const IPA_REVERSE_SHARE = 0.35;

type IpaSource = { id: string; word: string; ipa?: string | null };

/** The subset of a deck the IPA mode can actually show. */
export function wordsWithIpa<W extends IpaSource>(words: readonly W[]): W[] {
  return words.filter((w) => Boolean(w.ipa));
}

/**
 * One IPA question for `w`. Runs word -> IPA only when three other distinct transcriptions exist
 * in the deck to distract with; otherwise (and most of the time) it runs IPA -> word.
 */
export function buildIpaQuestion<W extends IpaSource>(w: W, words: readonly W[]): IpaQuestion<W> {
  const pool = wordsWithIpa(words);
  const ipaDistractors = shuffle(
    Array.from(new Set(pool.filter((o) => o.id !== w.id).map((o) => o.ipa as string))).filter(
      (x) => x !== w.ipa,
    ),
  ).slice(0, 3);
  if (ipaDistractors.length === 3 && Math.random() < IPA_REVERSE_SHARE) {
    return {
      word: w,
      direction: 'word-to-ipa',
      options: shuffle([w.ipa as string, ...ipaDistractors]),
      answer: w.ipa as string,
    };
  }
  const wordDistractors = shuffle(
    Array.from(new Set(words.filter((o) => o.id !== w.id).map((o) => o.word))).filter(
      (x) => x !== w.word,
    ),
  ).slice(0, 3);
  return {
    word: w,
    direction: 'ipa-to-word',
    options: shuffle([w.word, ...wordDistractors]),
    answer: w.word,
  };
}

export function buildIpaQuestions<W extends IpaSource>(
  words: readonly W[],
  roundSize: number = SPELL_ROUND_SIZE,
): IpaQuestion<W>[] {
  return pickRound(wordsWithIpa(words), roundSize).map((w) => buildIpaQuestion(w, words));
}

// ---- Word stress questions ----

/**
 * Either an odd-one-out board (three words share a stress position, one differs — pick the odd
 * one) or a "which syllable is stressed?" question for one word. The IPA itself is never part of
 * the rendered question — it IS the answer, so a caller must not print it before grading.
 */
export type StressQuestion<W> =
  | { kind: 'odd'; words: W[]; answerId: string }
  | { kind: 'syllable'; word: W; syllables: number; answer: number };

type StressSource = { id: string; word: string; ipa?: string | null };

/**
 * One stress question about `w`. Prefers odd-one-out when at least three other multi-syllable
 * words in the deck share a stress position different from `w`'s; otherwise (and always for a
 * word with no such peers) asks which syllable of `w` itself is stressed.
 */
export function buildStressQuestion<W extends StressSource>(
  w: W,
  words: readonly W[],
): StressQuestion<W> {
  const st = ipaStress(w.ipa) as IpaStress; // caller filters the pool with stressEligible first
  const others = words
    .map((o) => ({ o, st: ipaStress(o.ipa) }))
    .filter(
      (x): x is { o: W; st: IpaStress } => x.o.id !== w.id && x.st !== null && x.st.syllables >= 2,
    );
  if (Math.random() < 0.5) {
    const groups = new Map<number, W[]>();
    for (const x of others) {
      if (x.st.stressIndex === st.stressIndex) continue;
      const g = groups.get(x.st.stressIndex) ?? [];
      g.push(x.o);
      groups.set(x.st.stressIndex, g);
    }
    const usable = [...groups.values()].filter((g) => g.length >= 3);
    if (usable.length) {
      const g = usable[Math.floor(Math.random() * usable.length)];
      return { kind: 'odd', words: shuffle([w, ...shuffle(g).slice(0, 3)]), answerId: w.id };
    }
  }
  return { kind: 'syllable', word: w, syllables: st.syllables, answer: st.stressIndex };
}

export function buildStressQuestions<W extends StressSource>(
  words: readonly W[],
  roundSize: number = SPELL_ROUND_SIZE,
): StressQuestion<W>[] {
  return pickRound(words.filter(stressEligible), roundSize).map((w) =>
    buildStressQuestion(w, words),
  );
}

// ---- Sentence questions (cloze / listen) ----

export type ClozeQuestion<W> = { word: W; blanked: string; options: string[]; answer: string };

type ClozeSource = ExampleSource & { id: string; word: string };

/** One cloze question for `w`: its sentence blanked, distractors are three other topic words. */
export function buildClozeQuestion<W extends ClozeSource>(
  w: W,
  words: readonly W[],
): ClozeQuestion<W> {
  const { blanked, answer } = blankExample(w) as { blanked: string; answer: string };
  const distractors = shuffle(
    Array.from(new Set(words.filter((o) => o.id !== w.id).map((o) => o.word))).filter(
      (x) => normalizeText(x) !== normalizeText(answer),
    ),
  ).slice(0, 3);
  return { word: w, blanked, options: shuffle([answer, ...distractors]), answer };
}

export function buildClozeQuestions<W extends ClozeSource>(
  words: readonly W[],
  roundSize: number = SPELL_ROUND_SIZE,
): ClozeQuestion<W>[] {
  return pickRound(wordsWithExamples(words), roundSize).map((w) => buildClozeQuestion(w, words));
}

export type ListenQuestion<W> = { word: W; sentence: string; blanked: string; answer: string };

/** One listen question for `w`: the full sentence to speak, and its blanked form to display. */
export function buildListenQuestion<W extends ClozeSource>(w: W): ListenQuestion<W> {
  const { blanked, answer } = blankExample(w) as { blanked: string; answer: string };
  return { word: w, sentence: w.exampleEn as string, blanked, answer };
}

export function buildListenQuestions<W extends ClozeSource>(
  words: readonly W[],
  roundSize: number = SPELL_ROUND_SIZE,
): ListenQuestion<W>[] {
  return pickRound(wordsWithExamples(words), roundSize).map((w) => buildListenQuestion(w));
}

// ---- Mixed rounds ----

/**
 * The auto-graded, single-question modes a mixed round can draw from. Scramble and fill are not
 * included — their letter-tile UI does not compress into a single shared question renderer the
 * way the others do; the mixed round leans on `type` for spelling recall instead.
 */
export const MIX_POOL_MODES: readonly GameMode[] = [
  'quiz',
  'type',
  'picture',
  'ipa',
  'stress',
  'cloze',
  'listen',
];

type MixSource = QuizSource & IpaSource & ClozeSource & { imageKey?: string | null };

export type MixItem<W> =
  | { mode: 'quiz'; question: QuizQuestion<W> }
  | { mode: 'type'; word: W }
  | { mode: 'picture'; question: PictureQuestion<W> }
  | { mode: 'ipa'; question: IpaQuestion<W> }
  | { mode: 'stress'; question: StressQuestion<W> }
  | { mode: 'cloze'; question: ClozeQuestion<W> }
  | { mode: 'listen'; question: ListenQuestion<W> };

/** Can this word be asked in this mode, given the whole deck for distractors? */
function wordSupportsMode<W extends MixSource>(mode: GameMode, w: W, words: readonly W[]): boolean {
  switch (mode) {
    case 'quiz':
      return words.length >= MIN_WORDS.quiz;
    case 'type':
      return typeEligible(w);
    case 'picture':
      return imageOf(w) !== null && words.length >= MIN_WORDS.picture;
    case 'ipa':
      return Boolean(w.ipa) && words.length >= MIN_WORDS.ipa;
    case 'stress':
      return stressEligible(w);
    case 'cloze':
      return exampleEligible(w) && words.length >= MIN_WORDS.cloze;
    case 'listen':
      return exampleEligible(w);
    default:
      return false;
  }
}

/**
 * The modes a mixed round over this deck may use. `allowed` is the assignment's checked modes
 * (null = unrestricted); an intersection that leaves nothing usable falls back to every
 * auto-graded mode the deck supports — "only mix checked" must not produce an empty round.
 */
export function mixEligibleModes<W extends MixSource>(
  words: readonly W[],
  allowed: readonly GameMode[] | null,
): GameMode[] {
  const supported = (pool: readonly GameMode[]) =>
    pool.filter((m) => words.some((w) => wordSupportsMode(m, w, words)));
  const restricted = allowed ? MIX_POOL_MODES.filter((m) => allowed.includes(m)) : MIX_POOL_MODES;
  const usable = supported(restricted);
  return usable.length ? usable : supported(MIX_POOL_MODES);
}

function buildMixItem<W extends MixSource>(mode: GameMode, w: W, words: readonly W[]): MixItem<W> {
  switch (mode) {
    case 'quiz':
      return { mode, question: buildQuizQuestion(w, words) };
    case 'picture':
      return { mode, question: buildPictureQuestion(w, words) };
    case 'ipa':
      return { mode, question: buildIpaQuestion(w, words) };
    case 'stress':
      return { mode, question: buildStressQuestion(w, words) };
    case 'cloze':
      return { mode, question: buildClozeQuestion(w, words) };
    case 'listen':
      return { mode, question: buildListenQuestion(w) };
    default:
      return { mode: 'type', word: w };
  }
}

/**
 * A mixed round: `count` questions over a shuffled deck, each word asked in a random mode it
 * supports. The word cycle keeps coverage even; the safety valve stops a deck that supports
 * nothing from looping forever.
 */
export function buildMixItems<W extends MixSource>(
  words: readonly W[],
  modes: readonly GameMode[],
  count: number,
): MixItem<W>[] {
  const deck = shuffle(words);
  const items: MixItem<W>[] = [];
  let i = 0;
  let safety = count * 6;
  while (items.length < count && safety-- > 0 && deck.length > 0) {
    const w = deck[i % deck.length];
    i++;
    const usable = modes.filter((m) => wordSupportsMode(m, w, words));
    if (!usable.length) continue;
    items.push(buildMixItem(usable[Math.floor(Math.random() * usable.length)], w, words));
  }
  return items;
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
