/**
 * Read a teacher's separate answer key and match it onto imported question drafts.
 *
 * Vietnamese school tests almost never mark the answers on the paper itself — the key lives in a
 * second file, or in a message, as a bare list: "1. B  2. C  3. A". Without this the teacher has
 * to click forty radio buttons by hand after every import.
 *
 * Pure and client-side on purpose. Parsing a list of letters needs no model call, so the key costs
 * nothing and the teacher sees the result before anything is saved.
 *
 * The subtle part is `letterIds`. "17. C" means the THIRD option as printed, but the sanitizer may
 * have dropped a blank or duplicate option along the way, so counting into the surviving options
 * array would silently shift the answer. `letterIds` maps the original printed position to the id
 * that position was given (or null if it was dropped), which is the only mapping the letter can be
 * resolved against.
 */

import type { QuestionType } from '../schemas';

/** One line of a key: the question number, the letters it names, and the raw text after it. */
export type AnswerKeyEntry = {
  number: number;
  /** Uppercase A–J, in the order written. Empty for a free-text answer. */
  letters: string[];
  /** Everything after the number, trimmed — the answer for a short-answer question. */
  raw: string;
};

const LETTERS = 'ABCDEFGHIJ';
const MAX_RAW = 500;

/**
 * A question number and its separator: "1.", "1)", "Câu 1:", "Question 1 -", or a bare "1B".
 *
 * The leading `[^\p{L}\p{N}]` keeps it from firing inside a word or a longer number, and the
 * closing group demands either punctuation or an immediately following letter — so a year in a
 * sentence ("in 1975 the war ended") never reads as question 197.
 *
 * The unpunctuated form ("1B", "1 B") may only reach across spaces and tabs, never a line break.
 * A key headed "ĐÁP ÁN PRACTICE TEST 10" whose next line starts "Câu 1: D" would otherwise read
 * that heading as question 10 — and, first-entry-wins, shadow the real answer for 10.
 */
const MARKER =
  /(?:^|[^\p{L}\p{N}])(?:c[âa]u|question|ques|b[àa]i|q)?[ \t.]*(\d{1,3})(?:[ \t]*[.)\]:\-–—][ \t]*|[ \t]*(?=[A-Za-z]))/giu;

/** The words a teacher joins two answers with, removed before the letters are read out. */
const JOINERS = /(?<!\p{L})(?:and|v[àa]|hay|ho[ăa]c|or)(?!\p{L})/giu;

/** What is left of a pure letter answer once the joiners are gone: "A", "A, C", "AC", "A C". */
const LETTER_ONLY = /^[A-J](?:\s*[,;&+/]?\s*[A-J])*$/i;

/** A single letter standing alone as a word — the fallback for "Câu 1: Đáp án B". */
const STANDALONE_LETTER = /(?:^|[^\p{L}\p{N}])([A-J])(?![\p{L}\p{N}])/giu;

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

/**
 * A .docx key arrives as mammoth HTML, so tags have to go before anything can be read. Block-level
 * boundaries become newlines (and table cells tabs) so "1. B" and "2. C" in adjacent cells do not
 * run together into "1. B2. C".
 */
export function stripHtml(input: string): string {
  if (!/<[a-z!/]/i.test(input)) return input;
  return input
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(td|th)>/gi, '\t')
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? ' ');
}

/** The letters a key body names, or [] when it is free text rather than a list of choices. */
function lettersOf(body: string): string[] {
  const trimmed = body.trim().replace(/[.;,]+$/, '');
  if (!trimmed) return [];
  // "B and D" and "B và D" are the same answer as "B, D" — but the joiner's own letters must not
  // be read as options, so it goes before the letters are picked out.
  const cleaned = trimmed.replace(JOINERS, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned && LETTER_ONLY.test(cleaned)) {
    return [...new Set(cleaned.toUpperCase().match(/[A-J]/g) ?? [])];
  }
  // "Đáp án: B", "B (because it is the only plural)" — one letter standing on its own in a longer
  // line still names an option. Two or more would be ambiguous prose, so those stay free text.
  const standalone = [...trimmed.matchAll(STANDALONE_LETTER)].map((m) => m[1].toUpperCase());
  return standalone.length === 1 ? standalone : [];
}

/**
 * Parse a pasted (or uploaded) answer key into one entry per question number.
 *
 * Tolerates every layout a key turns up in: one per line, several per line, a table, a numbered
 * paragraph, with or without "Câu"/"Question" in front. The first entry for a number wins — a key
 * that lists 1–40 and then repeats a few in a "corrections" note should not have the note
 * overwrite the list silently.
 */
export function parseAnswerKey(input: string): AnswerKeyEntry[] {
  const text = stripHtml(String(input ?? '')).normalize('NFC');
  const out: AnswerKeyEntry[] = [];
  const seen = new Set<number>();

  // Two passes over the same scan: collect the marker positions first, so each body can run to the
  // start of the NEXT marker (that is what makes "1. B  2. C  3. D" on one line work).
  const marks: { number: number; bodyStart: number; markStart: number }[] = [];
  MARKER.lastIndex = 0;
  for (let m = MARKER.exec(text); m; m = MARKER.exec(text)) {
    const number = Number(m[1]);
    if (number > 0) {
      marks.push({ number, bodyStart: m.index + m[0].length, markStart: m.index });
    }
  }

  marks.forEach((mark, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].markStart : text.length;
    const body = text.slice(mark.bodyStart, Math.max(mark.bodyStart, end));
    if (seen.has(mark.number)) return;
    const letters = lettersOf(body);
    const raw = body.trim().replace(/\s+/g, ' ').slice(0, MAX_RAW);
    if (!letters.length && !raw) return;
    seen.add(mark.number);
    out.push({ number: mark.number, letters, raw });
  });

  return out;
}

/** The bit of a draft the key needs to see. */
export type KeyTarget = {
  type: QuestionType;
  /** Original printed option position -> assigned id, null where that option was dropped. */
  letterIds: (string | null)[];
  /** The number this question carries in the document. Null questions can never be matched. */
  sourceNumber: number | null;
};

/** What to write onto one draft. `type` may differ from the target's — a two-letter key is multi. */
export type KeyApplication = {
  /** Index into the array handed to `applyAnswerKey`. */
  index: number;
  type: QuestionType;
  answerKey: string | string[];
};

export type KeyResult = {
  applied: KeyApplication[];
  /** Numbers the key names that no question carries — a mis-numbered or wrong-paper key. */
  unmatchedNumbers: number[];
  /** Numbers whose letters point at options this question does not have. */
  unresolvedNumbers: number[];
};

const letterIndex = (letter: string): number => LETTERS.indexOf(letter.toUpperCase());

/**
 * Match parsed key entries onto drafts by their printed question number.
 *
 * The key is AUTHORITATIVE: a teacher who pastes one is correcting the paper, so it overwrites an
 * answer the model thought it read. An essay question is skipped (there is nothing to overwrite),
 * and a question whose letters resolve to nothing is left exactly as it was rather than half-set.
 */
export function applyAnswerKey(targets: KeyTarget[], entries: AnswerKeyEntry[]): KeyResult {
  const byNumber = new Map<number, AnswerKeyEntry>();
  for (const e of entries) if (!byNumber.has(e.number)) byNumber.set(e.number, e);

  const applied: KeyApplication[] = [];
  const used = new Set<number>();
  const unresolvedNumbers: number[] = [];

  targets.forEach((target, index) => {
    if (target.sourceNumber == null) return;
    const entry = byNumber.get(target.sourceNumber);
    if (!entry) return;

    if (target.type === 'essay') return;

    if (target.type === 'mcq' || target.type === 'multi') {
      const ids = [
        ...new Set(
          entry.letters
            .map((letter) => target.letterIds[letterIndex(letter)] ?? null)
            .filter((id): id is string => id != null),
        ),
      ];
      if (!ids.length) {
        used.add(entry.number);
        unresolvedNumbers.push(entry.number);
        return;
      }
      used.add(entry.number);
      applied.push(
        ids.length > 1
          ? { index, type: 'multi', answerKey: ids }
          : { index, type: target.type, answerKey: target.type === 'multi' ? ids : ids[0] },
      );
      return;
    }

    // text: the key line itself is the accepted answer ("3. Hanoi"). A bare letter is one too —
    // a fill-in-the-blank key can legitimately read "3. A".
    const answer = entry.raw || entry.letters.join(', ');
    used.add(entry.number);
    if (!answer) return;
    applied.push({ index, type: 'text', answerKey: [answer] });
  });

  const unmatchedNumbers = [...byNumber.keys()].filter((n) => !used.has(n)).sort((a, b) => a - b);
  return { applied, unmatchedNumbers, unresolvedNumbers };
}
