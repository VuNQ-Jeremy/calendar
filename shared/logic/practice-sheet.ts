/**
 * Pure grouping for the Practice sheet (src/practice/practice-sheet.tsx): one student's month,
 * split into date groups with the per-day extras a teacher acts on (a miss, a pending excuse, the
 * blank row). No React, no server imports — testable like shared/logic/practice.ts, and the one
 * place the "blank row from today on, practice days only, unfiltered only" rule is written down.
 */

export type SheetFilter = 'all' | 'review' | 'misses';

export type SheetCopy = { id: string; taskId: string | null; date: string; status: string };
export type SheetMiss = { id: string; date: string; excused: boolean };
export type SheetExcuse = { id: string; date: string; status: string };

/** `scope` is what the row's edit/delete post to: a class task, or this student's own copy. */
export type SheetRow<C extends SheetCopy> = { copy: C; scope: 'class' | 'student' };

export type SheetDay<C extends SheetCopy, M extends SheetMiss, E extends SheetExcuse> = {
  date: string;
  isPractice: boolean;
  isToday: boolean;
  rows: SheetRow<C>[];
  miss: M | null;
  excuse: E | null;
  showBlank: boolean;
};

export type SheetInput<C extends SheetCopy, M extends SheetMiss, E extends SheetExcuse> = {
  month: string;
  today: string;
  filter: SheetFilter;
  practiceDays: readonly string[];
  /** Already narrowed to ONE student, in the service's (date, sortOrder) order. */
  copies: readonly C[];
  misses: readonly M[];
  /** Pending requests only — the loader filters status; this module does not. */
  excuses: readonly E[];
};

/** '2026-09' → '2026-09-30'. UTC arithmetic on a fixed noon so no DST can shift the day. */
export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}

export function monthDates(month: string): string[] {
  const last = Number(lastDayOfMonth(month).slice(8, 10));
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

export function needsReviewCount(copies: readonly SheetCopy[]): number {
  return copies.filter((c) => c.status === 'submitted').length;
}

export function buildSheet<C extends SheetCopy, M extends SheetMiss, E extends SheetExcuse>(
  input: SheetInput<C, M, E>,
): SheetDay<C, M, E>[] {
  const practice = new Set(input.practiceDays);
  const out: SheetDay<C, M, E>[] = [];
  for (const date of monthDates(input.month)) {
    let rows: SheetRow<C>[] = input.copies
      .filter((c) => c.date === date)
      .map((c) => ({ copy: c, scope: c.taskId ? 'class' : 'student' }));
    const miss = input.misses.find((m) => m.date === date) ?? null;
    const excuse = input.excuses.find((e) => e.date === date) ?? null;
    if (input.filter === 'review') {
      rows = rows.filter((r) => r.copy.status === 'submitted');
      if (rows.length === 0) continue;
    }
    if (input.filter === 'misses' && !miss) continue;
    const isPractice = practice.has(date);
    out.push({
      date,
      isPractice,
      isToday: date === input.today,
      rows,
      miss,
      excuse,
      showBlank: input.filter === 'all' && isPractice && date >= input.today,
    });
  }
  return out;
}
