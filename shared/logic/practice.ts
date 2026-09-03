/**
 * Practice (Nhiệm vụ) rules shared by the Worker, the web and the phone.
 *
 * Everything here is a pure function over plain data so the nightly cron, the ledger page and the
 * student's badge cannot disagree about what a miss costs. No Date arithmetic leaks in except
 * through `dates.ts` helpers; dates are ICT 'YYYY-MM-DD' strings throughout.
 */
import { addDays, iso, parseISO } from './dates';
import { expandEvents, type RecurringEvent } from './recurrence';

export const EXCUSED_BASE_QUOTA = 3;
export const EXCUSED_CARRY_CAP = 1;
export const VIDEO_MAX_SECONDS = 60;
export const MEDIA_MAX_BYTES = 50 * 1024 * 1024;

export type PracticeSettingsLike = { enabled: boolean; weekdays: string };
export type DayOverrideLike = { date: string; isPractice: boolean };

/** "1,3,5" → Set{1,3,5}. Tolerates blanks. */
export function parseWeekdays(mask: string): Set<number> {
  return new Set(
    mask
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
  );
}

export function formatWeekdays(days: Iterable<number>): string {
  return [...new Set(days)].sort((a, b) => a - b).join(',');
}

/** ICT weekday of a 'YYYY-MM-DD' string; the date is a calendar day so no timezone math applies. */
export function weekdayOf(date: string): number {
  return parseISO(date).getDay();
}

/** Override wins; otherwise the weekday mask. A disabled class never has practice days. */
export function isPracticeDay(
  settings: PracticeSettingsLike | null | undefined,
  overrides: readonly DayOverrideLike[],
  date: string,
): boolean {
  if (!settings || !settings.enabled) return false;
  const ov = overrides.find((o) => o.date === date);
  if (ov) return ov.isPractice;
  return parseWeekdays(settings.weekdays).has(weekdayOf(date));
}

/** Every practice day in [from, to] inclusive. */
export function practiceDaysInRange(
  settings: PracticeSettingsLike | null | undefined,
  overrides: readonly DayOverrideLike[],
  from: string,
  to: string,
): string[] {
  const out: string[] = [];
  let d = parseISO(from);
  const end = parseISO(to);
  while (d <= end) {
    const day = iso(d);
    if (isPracticeDay(settings, overrides, day)) out.push(day);
    d = addDays(d, 1);
  }
  return out;
}

/** First practice day strictly after `date`, searching up to 60 days ahead; null if none. */
export function nextPracticeDay(
  settings: PracticeSettingsLike | null | undefined,
  overrides: readonly DayOverrideLike[],
  date: string,
): string | null {
  let d = addDays(parseISO(date), 1);
  for (let i = 0; i < 60; i++) {
    const day = iso(d);
    if (isPracticeDay(settings, overrides, day)) return day;
    d = addDays(d, 1);
  }
  return null;
}

/**
 * Default mask when a class opts in: Mon–Sat minus the weekdays the class meets (derived from its
 * recurring events over the next 14 days). Sunday is never a default practice day (the sheet's
 * DAY OFF). A class with no events keeps all six.
 */
export function defaultWeekdaysFromEvents(
  events: readonly RecurringEvent[],
  fromDate: string,
): string {
  const start = parseISO(fromDate);
  const classDays = new Set(
    expandEvents([...events], start, addDays(start, 13)).map((e) => weekdayOf(e.date)),
  );
  const days: number[] = [];
  for (let wd = 1; wd <= 6; wd++) if (!classDays.has(wd)) days.push(wd);
  return formatWeekdays(days);
}

export type MissLike = { date: string; excused: boolean };

/** 'YYYY-MM' of a date string. */
export const monthOf = (date: string): string => date.slice(0, 7);

/** Previous month of a 'YYYY-MM'. */
export function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * Excused quota for `month`: 3, plus 1 carried when the previous month had zero misses of ANY kind
 * (excused misses spoil it too — the sheet's literal rule) and the class actually had ≥1 practice
 * day that month (an unenrolled or disabled month earns nothing).
 */
export function excusedQuota(
  month: string,
  misses: readonly MissLike[],
  prevMonthHadPracticeDays: boolean,
): number {
  const prev = prevMonth(month);
  const prevMisses = misses.filter((m) => monthOf(m.date) === prev).length;
  const carry = prevMonthHadPracticeDays && prevMisses === 0 ? EXCUSED_CARRY_CAP : 0;
  return EXCUSED_BASE_QUOTA + carry;
}

export type WarningLike = {
  level: number;
  pendingMultiplier: number;
  pendingForDate: string | null;
  pendingFromMiss: string | null;
};

export const EMPTY_WARNING: WarningLike = {
  level: 0,
  pendingMultiplier: 0,
  pendingForDate: null,
  pendingFromMiss: null,
};

/** An unexcused miss: level +1, and the next practice day owes ×(1 + level). */
export function applyUnexcusedMiss(
  w: WarningLike,
  missId: string,
  nextDay: string | null,
): WarningLike {
  const level = w.level + 1;
  return { level, pendingMultiplier: 1 + level, pendingForDate: nextDay, pendingFromMiss: missId };
}

/** The ×N day was fully submitted: the debt clears, the level (and the warning) stay. */
export function clearPending(w: WarningLike): WarningLike {
  return { ...w, pendingMultiplier: 0, pendingForDate: null, pendingFromMiss: null };
}

/** Teacher excused a miss after the fact: undo its level step; drop its pending ×N if it is the one owed. */
export function undoMiss(w: WarningLike, missId: string): WarningLike {
  const level = Math.max(0, w.level - 1);
  const base = { ...w, level };
  return w.pendingFromMiss === missId ? clearPending(base) : base;
}

/** Teacher cleared the warning: everything resets. */
export function clearWarning(): WarningLike {
  return { ...EMPTY_WARNING };
}

export type StudentTaskLike = { date: string; status: string };

export const DONE_STATUSES: ReadonlySet<string> = new Set([
  'submitted',
  'accepted',
  'teacher_done',
]);

/** Did the student finish the day? Every copy on that date must be in a done status. */
export function dayIsComplete(tasks: readonly StudentTaskLike[], date: string): boolean {
  const onDay = tasks.filter((t) => t.date === date);
  return onDay.length > 0 && onDay.every((t) => DONE_STATUSES.has(t.status));
}

export type MonthSummary = {
  month: string;
  doneTasks: number;
  totalTasks: number;
  excusedUsed: number;
  excusedQuota: number;
  unexcused: number;
  level: number;
  pendingMultiplier: number;
  pendingForDate: string | null;
};

export function monthSummary(
  month: string,
  tasks: readonly StudentTaskLike[],
  misses: readonly MissLike[],
  warning: WarningLike,
  prevMonthHadPracticeDays: boolean,
): MonthSummary {
  const inMonth = tasks.filter((t) => monthOf(t.date) === month);
  const monthMisses = misses.filter((m) => monthOf(m.date) === month);
  return {
    month,
    doneTasks: inMonth.filter((t) => DONE_STATUSES.has(t.status)).length,
    totalTasks: inMonth.length,
    excusedUsed: monthMisses.filter((m) => m.excused).length,
    excusedQuota: excusedQuota(month, misses, prevMonthHadPracticeDays),
    unexcused: monthMisses.filter((m) => !m.excused).length,
    level: warning.level,
    pendingMultiplier: warning.pendingMultiplier,
    pendingForDate: warning.pendingForDate,
  };
}

/** Quick-add parsing: one task per non-empty line, trimmed, capped at 40 lines. */
export function parseQuickAddLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((l) => l.length > 0)
    .slice(0, 40);
}
