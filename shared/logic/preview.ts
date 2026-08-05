/**
 * "Preview buổi sau" — the shape a session preview takes once composed, and the pure functions
 * that decide what belongs in one.
 *
 * Four surfaces consume a ComposedPreview: the staff editor, the student's upcoming-sessions
 * screen, the two push jobs, and the Zalo share image. They must agree on which tests count as
 * "checked at this session" and on how a preview reads in one line, so both decisions live here
 * rather than in whichever caller needed them first.
 *
 * No React, no DOM, no server types — same rules as recurrence.ts, and the reason this half of
 * the feature is testable under plain Node.
 */

/**
 * Indochina Time. UTC+7, no daylight saving.
 *
 * Knowingly duplicated from server/services/notify.ts: that constant is about deciding when a
 * cron sweep runs, this one about reading a stored UTC instant as a school day, and shared/ must
 * not import from server/. One school, one city — if that changes, both move together.
 */
export const ICT_OFFSET_MIN = 7 * 60;

/** A UTC ISO instant -> the `YYYY-MM-DD` it falls on in Vietnam. */
export function ictDateOfUtc(utcIso: string): string {
  const t = new Date(utcIso).getTime();
  if (Number.isNaN(t)) return '';
  return new Date(t + ICT_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

export type PreviewTestLite = {
  id: string;
  title: string;
  /** online | paper */
  mode: string;
  /** ICT YYYY-MM-DD */
  date: string | null;
  /** UTC ISO */
  openAt: string | null;
  /** UTC ISO */
  closeAt: string | null;
};

/**
 * Does this test count as "checked at this session"?
 *
 * Two ways it can: the test is dated that day, or its online window covers that day. The window
 * is compared in ICT days, not UTC — an 8pm-Vietnam open time is stored as 13:00 UTC the same
 * day, but a 7am one is 00:00 UTC, and a UTC comparison would put them on different days.
 *
 * Callers filter to `status = 'published'` and the occurrence's own class before calling.
 */
export function testTouchesOccurrence(
  t: { date: string | null; openAt: string | null; closeAt: string | null },
  occDate: string,
): boolean {
  if (t.date === occDate) return true;
  if (!t.openAt) return false;
  const openDay = ictDateOfUtc(t.openAt);
  if (!openDay) return false;
  const closeDay = t.closeAt ? ictDateOfUtc(t.closeAt) || openDay : openDay;
  return openDay <= occDate && occDate <= closeDay;
}

export type PreviewVocabTopic = {
  id: string;
  name: string;
  slug: string | null;
  wordCount: number;
};

export type ComposedPreview = {
  /** The teacher's own words. Empty when nobody wrote anything for this occurrence. */
  focusText: string;
  vocabTopic: PreviewVocabTopic | null;
  tests: PreviewTestLite[];
};

/** Nothing to say about this session at all — the push jobs substitute their own fallback. */
export function isPreviewEmpty(c: ComposedPreview): boolean {
  return !c.focusText.trim() && !c.tests.length && !c.vocabTopic;
}

/**
 * One line for a push body, in Vietnamese.
 *
 * Hardcoded Vietnamese rather than run through i18n on purpose: push copy is composed in the
 * Worker, which has no user locale to read (notification prefs are school-wide), and the school
 * is Vietnamese. The in-app screens and the share image DO go through i18n.
 *
 * Returns '' when there is nothing to say, so callers can choose their own fallback.
 */
export function previewLine(c: ComposedPreview, max = 140): string {
  const parts: string[] = [];
  const focus = c.focusText.trim();
  if (focus) parts.push(`Học: ${focus}`);
  if (c.tests.length) parts.push(`Kiểm tra: ${c.tests.map((t) => t.title).join(', ')}`);
  if (c.vocabTopic) parts.push(`Ôn từ vựng: ${c.vocabTopic.name}`);
  const line = parts.join(' · ');
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
