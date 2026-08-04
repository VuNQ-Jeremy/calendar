/**
 * Pure fee arithmetic, shared by the tuition screen, the printable slip and the tests.
 *
 * Nothing here touches the database: the server hands over fee lines (live or frozen) plus the
 * payment rows, and these functions turn them into what a person reads.
 */

import type { StudentMonthRow, TuitionLine } from '../../server/services/tuition';
import { getCal } from '../i18n/strings';

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

/**
 * '2026-07' -> '7/2026'. For Vietnamese sentences that already say "tháng", where `monthLabel`'s
 * "Tháng 7 2026" would read as "học phí tháng Tháng 7 2026".
 */
export function monthNumeric(month: string): string {
  const [year, monthNo] = month.split('-');
  return `${Number(monthNo)}/${year}`;
}

/** 'YYYY-MM-DD' -> '04/05/2026'. What the paper receipts write, and unambiguous in Vietnam. */
export function formatDmy(date: string): string {
  const [y, m, d] = date.split('-');
  return d && m && y ? `${d}/${m}/${y}` : date;
}

const VI_DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'] as const;
/** Group scale words, ascending: units, thousands, millions, billions. */
const VI_SCALES = ['', 'nghìn', 'triệu', 'tỷ'] as const;

/** One group of three digits. `lead` is true for the highest non-zero group, which needs no padding. */
function readViGroup(n: number, lead: boolean): string {
  const hundreds = Math.floor(n / 100);
  const tens = Math.floor(n / 10) % 10;
  const units = n % 10;
  const words: string[] = [];

  if (hundreds > 0) words.push(VI_DIGITS[hundreds], 'trăm');
  else if (!lead) words.push('không', 'trăm');

  if (tens === 0) {
    // "lẻ" is the spoken filler for a missing tens place: 105 -> "một trăm lẻ năm".
    if (units > 0 && (hundreds > 0 || !lead)) words.push('lẻ');
    if (units > 0) words.push(VI_DIGITS[units]);
  } else if (tens === 1) {
    words.push('mười');
    // 11 -> "mười một", but 15 -> "mười lăm": five changes shape after a tens word.
    if (units === 5) words.push('lăm');
    else if (units > 0) words.push(VI_DIGITS[units]);
  } else {
    words.push(VI_DIGITS[tens], 'mươi');
    // 21 -> "hai mươi mốt", 25 -> "hai mươi lăm".
    if (units === 1) words.push('mốt');
    else if (units === 5) words.push('lăm');
    else if (units > 0) words.push(VI_DIGITS[units]);
  }

  return words.join(' ');
}

/**
 * An amount of đồng written out in Vietnamese: 2400000 -> 'Hai triệu bốn trăm nghìn đồng'.
 *
 * Vietnamese receipts carry the total in words next to the figure, so an altered digit is obvious.
 * All-zero groups are dropped the way they are spoken — 2.400.000 is "hai triệu bốn trăm nghìn", not
 * "hai triệu bốn trăm nghìn không trăm". A negative amount is not a thing on a receipt, so it is
 * read as its absolute value.
 */
export function dongToWords(amount: number): string {
  const n = Math.abs(Math.round(amount));
  if (n === 0) return 'Không đồng';

  // Split into groups of three, least significant first.
  const groups: number[] = [];
  for (let rest = n; rest > 0; rest = Math.floor(rest / 1000)) groups.push(rest % 1000);

  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i];
    if (group === 0) continue; // an empty group is simply not spoken
    const isLead = parts.length === 0;
    // Past a thousand billion the scale word repeats ("tỷ tỷ"); the schema caps amounts long
    // before that, so the last scale is reused rather than invented.
    const scale = VI_SCALES[Math.min(i, VI_SCALES.length - 1)];
    parts.push([readViGroup(group, isLead), scale].filter(Boolean).join(' '));
  }

  const sentence = `${parts.join(' ')} đồng`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
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

/**
 * '2026-03' -> 'March 2026' / 'Tháng 3 2026', reusing the calendar's own month names so the two
 * screens never disagree about what to call a month.
 */
export function monthLabel(month: string, lang: string): string {
  const { months } = getCal(lang);
  const [year, monthNo] = month.split('-');
  return `${months[Number(monthNo) - 1] ?? monthNo} ${year}`;
}

/** '2026-03' + 1 -> '2026-04'. Plain string math; no Date, so no timezone can get involved. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const zeroBased = y * 12 + (m - 1) + delta;
  const year = Math.floor(zeroBased / 12);
  const monthNo = (zeroBased % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(monthNo).padStart(2, '0')}`;
}
