/**
 * Test grading and test-window maths — shared by the web app, the mobile app and the server.
 *
 * Pure data plus pure functions: no React, no DOM, and no `server/` imports. A question is
 * described structurally (type, answer key, points) rather than by its Drizzle row type, so React
 * Native can follow the graph and so the grader can be unit-tested without a database.
 *
 * **Vietnamese text.** Short-answer grading forgives the three things students get wrong for
 * reasons that are not knowledge: letter case, stray whitespace, and missing diacritics — a phone
 * keyboard without a Vietnamese layout types "Ha Noi", and that is the right answer.
 *
 * **Timezone.** The whole user base is in Vietnam: ICT, UTC+7, no DST, ever. Windows are stored in
 * UTC and rendered in ICT. `server/services/notify.ts` has its own private `ICT_OFFSET_MIN` with
 * the same value; the two exist independently because this module must not import server code, and
 * the constant is small enough that duplicating it beats coupling the two.
 */

export type QuestionTypeId = 'mcq' | 'multi' | 'text' | 'essay';
/** A string for mcq, an array of option ids for multi, an array of accepted answers for text. */
export type AnswerKey = string | string[] | null;
export type AnswerValue = string | string[] | null;

/**
 * Case-, whitespace- and diacritic-insensitive comparison form:
 * lowercase → NFD → strip combining marks → đ → d → trim and collapse inner whitespace.
 *
 * NFD decomposes every Vietnamese tone and vowel mark, but `đ` is a distinct letter that it does
 * not touch, so that one is replaced explicitly — after lowercasing, so only `đ` needs handling.
 */
export function normalizeText(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      // The combining diacritical marks block, U+0300-U+036F (raw, not escaped).
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .trim()
      .replace(/\s+/g, ' ')
  );
}

/**
 * `null` means "not auto-gradable": an essay, or a question whose answer key is missing or blank.
 * A blank/absent student answer is simply wrong, not ungradable. `multi` is all-or-nothing — the
 * selected set must equal the key set exactly.
 */
export function gradeAnswer(
  q: { type: QuestionTypeId; answerKey: AnswerKey },
  answer: AnswerValue,
): boolean | null {
  if (q.type === 'essay') return null;
  const key = q.answerKey;

  if (q.type === 'mcq') {
    if (typeof key !== 'string' || key === '') return null;
    return typeof answer === 'string' && answer === key;
  }

  if (q.type === 'multi') {
    if (!Array.isArray(key) || key.length === 0) return null;
    if (!Array.isArray(answer)) return false;
    const want = new Set(key);
    const got = new Set(answer);
    if (want.size !== got.size) return false;
    for (const id of want) if (!got.has(id)) return false;
    return true;
  }

  // text
  const accepted = Array.isArray(key) ? key : typeof key === 'string' && key !== '' ? [key] : [];
  const wanted = accepted.map(normalizeText).filter((a) => a !== '');
  if (!wanted.length) return null;
  if (typeof answer !== 'string') return false;
  return wanted.includes(normalizeText(answer));
}

export type AutoGradeItem = {
  questionId: string;
  type: QuestionTypeId;
  answerKey: AnswerKey;
  points: number;
};

export type AutoGradeResult = {
  perQuestion: Map<string, { correct: boolean | null; autoPoints: number | null }>;
  /** Sum of autoPoints over the auto-gradable questions. */
  autoScore: number;
  /** Sum of points over the auto-gradable questions — the denominator the auto score is out of. */
  maxAutoPoints: number;
  /** Sum of points over ALL questions, essays included — the denominator of the final score. */
  maxTotalPoints: number;
  /** True when at least one question still needs a human. */
  hasEssay: boolean;
};

/** Grades everything a machine can grade and reports what is left for the teacher. */
export function autoGradeAttempt(
  items: AutoGradeItem[],
  answers: Map<string, AnswerValue>,
): AutoGradeResult {
  const perQuestion = new Map<string, { correct: boolean | null; autoPoints: number | null }>();
  let autoScore = 0;
  let maxAutoPoints = 0;
  let maxTotalPoints = 0;
  let hasEssay = false;

  for (const item of items) {
    maxTotalPoints += item.points;
    const correct = gradeAnswer(item, answers.get(item.questionId) ?? null);
    if (correct === null) {
      hasEssay = true;
      perQuestion.set(item.questionId, { correct: null, autoPoints: null });
      continue;
    }
    const autoPoints = correct ? item.points : 0;
    maxAutoPoints += item.points;
    autoScore += autoPoints;
    perQuestion.set(item.questionId, { correct, autoPoints });
  }

  return { perQuestion, autoScore, maxAutoPoints, maxTotalPoints, hasEssay };
}

/**
 * Raw points → the Vietnamese 0–10 scale, rounded to two decimals and clamped.
 * A test worth no points scores 0 rather than dividing by zero.
 */
export function normalizeScore(totalPoints: number, maxPoints: number): number {
  if (maxPoints <= 0) return 0;
  const raw = (totalPoints / maxPoints) * 10;
  const clamped = Math.min(10, Math.max(0, raw));
  return Math.round(clamped * 100) / 100;
}

/** Indochina Time. UTC+7, no daylight saving. */
export const ICT_OFFSET_MIN = 7 * 60;

/** The ICT calendar day a UTC instant falls on, as 'YYYY-MM-DD'. */
export function ictDateOf(isoUtc: string): string {
  return splitIctFromUtc(isoUtc).date;
}

/**
 * Where `now` sits relative to the test window. A null `openAt` means the test is already open; a
 * null `closeAt` means it never closes.
 */
export function isWindowOpen(
  openAt: string | null,
  closeAt: string | null,
  now: Date,
): 'upcoming' | 'open' | 'closed' {
  const t = now.getTime();
  if (openAt && t < new Date(openAt).getTime()) return 'upcoming';
  if (closeAt && t >= new Date(closeAt).getTime()) return 'closed';
  return 'open';
}

/** ICT 'YYYY-MM-DD' + 'HH:mm' → the UTC ISO instant to store. */
export function composeUtcFromIct(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const asIct = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
  return new Date(asIct - ICT_OFFSET_MIN * 60_000).toISOString();
}

/** A stored UTC ISO instant → the ICT date and time to show. */
export function splitIctFromUtc(isoUtc: string): { date: string; time: string } {
  const shifted = new Date(new Date(isoUtc).getTime() + ICT_OFFSET_MIN * 60_000);
  return {
    date: shifted.toISOString().slice(0, 10),
    time: shifted.toISOString().slice(11, 16),
  };
}
