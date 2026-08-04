/**
 * Pure fee arithmetic, shared by the tuition screen, the printable slip and the tests.
 *
 * Nothing here touches the database: the server hands over fee lines (live or frozen) plus the
 * payment rows, and these functions turn them into what a person reads.
 */

import type { StudentMonthRow, TuitionLine } from '../../server/services/tuition';

/**
 * VND, grouped with dots: 1500000 -> '1.500.000 ₫'.
 *
 * Grouped by hand rather than with `toLocaleString('vi-VN')` on purpose — the amount is rendered
 * during SSR and again on hydration, and the two runtimes' ICU data do not have to agree. A
 * mismatch there would be a hydration error over money.
 */
export function formatVnd(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const grouped = Math.abs(Math.round(amount))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${grouped} ₫`;
}

export type PaymentStatus = 'unpaid' | 'partial' | 'paid';

/** Nothing owed counts as paid — a fully discounted month should not read as "unpaid". */
export function paymentStatus(dueVnd: number, paidVnd: number): PaymentStatus {
  if (paidVnd >= dueVnd) return 'paid';
  if (paidVnd > 0) return 'partial';
  return 'unpaid';
}

export type StudentFee = {
  studentId: string;
  lines: TuitionLine[];
  /** Sum of the fee lines, before the adjustment. */
  billedVnd: number;
  adjustmentVnd: number;
  adjustmentNote: string | null;
  /** What the family owes: billed + adjustment, never below zero. */
  dueVnd: number;
  paidVnd: number;
  paidAt: string | null;
  paymentNote: string | null;
  outstandingVnd: number;
  status: PaymentStatus;
};

/**
 * One row per student for a month.
 *
 * A student with a payment row but no fee lines is still listed, as long as the row says something:
 * a month can be reopened after the attendance it was billed from was corrected away, and dropping
 * the row would hide money that was actually collected. An all-zero row says nothing, so it is
 * skipped — that is also what makes zeroing a payment work as an undo, since there is no way to
 * delete the row itself.
 */
export function studentFees(lines: TuitionLine[], studentMonths: StudentMonthRow[]): StudentFee[] {
  const byStudent = new Map<string, TuitionLine[]>();
  for (const line of lines) {
    const list = byStudent.get(line.studentId);
    if (list) list.push(line);
    else byStudent.set(line.studentId, [line]);
  }
  const paymentByStudent = new Map(studentMonths.map((s) => [s.studentId, s]));
  for (const [studentId, row] of paymentByStudent) {
    if (byStudent.has(studentId)) continue;
    if (row.paidVnd === 0 && row.adjustmentVnd === 0) continue;
    byStudent.set(studentId, []);
  }

  const out: StudentFee[] = [];
  for (const [studentId, studentLines] of byStudent) {
    const payment = paymentByStudent.get(studentId);
    const billedVnd = studentLines.reduce((n, l) => n + l.amountVnd, 0);
    const adjustmentVnd = payment?.adjustmentVnd ?? 0;
    const dueVnd = Math.max(0, billedVnd + adjustmentVnd);
    const paidVnd = payment?.paidVnd ?? 0;
    out.push({
      studentId,
      lines: studentLines,
      billedVnd,
      adjustmentVnd,
      adjustmentNote: payment?.adjustmentNote ?? null,
      dueVnd,
      paidVnd,
      paidAt: payment?.paidAt ?? null,
      paymentNote: payment?.paymentNote ?? null,
      outstandingVnd: Math.max(0, dueVnd - paidVnd),
      status: paymentStatus(dueVnd, paidVnd),
    });
  }
  return out;
}

/** '2026-03' + 1 -> '2026-04'. Plain string math; no Date, so no timezone can get involved. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const zeroBased = y * 12 + (m - 1) + delta;
  const year = Math.floor(zeroBased / 12);
  const monthNo = (zeroBased % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(monthNo).padStart(2, '0')}`;
}
