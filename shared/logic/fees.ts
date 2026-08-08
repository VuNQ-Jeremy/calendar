/**
 * Pure fee arithmetic and formatting, shared by the web tuition screen, the printable slip, the
 * server slip renderer and the mobile app's "Học phí" screens.
 *
 * These lived in `shared/logic/tuition.ts` until the mobile app needed them: tuition.ts
 * type-imports `server/services/tuition`, which drags the Workers types into anything that touches
 * it, and React Native cannot follow that graph. Same reason `shared/logic/month.ts` and
 * `shared/logic/assess.ts` exist. No React, no DOM, no `server/` imports.
 *
 * tuition.ts re-exports every name, so existing web imports keep working.
 */

/**
 * One student's fee line for one class in one month. Structurally identical to the server's
 * `TuitionLine` (`server/services/tuition.ts`) — defined here as its own type so this module never
 * has to import from `server/`.
 */
export type FeeLine = {
  studentId: string;
  classId: string;
  className: string;
  /** Billable sessions, per the settings in force. */
  sessions: number;
  /**
   * The billable session dates, ascending, one entry per billed session. Empty for months closed
   * before the column existed (migration 0021) — render a count-only fallback then.
   */
  dates: string[];
  /** Every status seen, billable or not — the slip shows the breakdown. */
  statusCounts: Record<string, number>;
  unitPriceVnd: number;
  amountVnd: number;
};

/** The payment/adjustment row, mirror of the server's `StudentMonthRow`. */
export type FeePaymentRow = {
  month: string;
  studentId: string;
  adjustmentVnd: number;
  adjustmentNote: string | null;
  paidVnd: number;
  paidAt: string | null;
  paymentNote: string | null;
};

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
  lines: FeeLine[];
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
export function studentFees(lines: FeeLine[], studentMonths: FeePaymentRow[]): StudentFee[] {
  const byStudent = new Map<string, FeeLine[]>();
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

/* ── Payment info (bank transfer + VietQR) ──────────────────────────────────────────────── */

/**
 * Fill the admin's transfer-memo template for one student-month.
 * '{month}' -> '7/2026' (numeric, the way a banking app shows it), '{name}' -> the student's name,
 * diacritics kept — Vietnamese banks accept them in the transfer note, and the URL encoder handles
 * them for the QR.
 */
export function resolveMemo(template: string, vars: { month: string; name: string }): string {
  return template
    .replaceAll('{month}', monthNumeric(vars.month))
    .replaceAll('{name}', vars.name)
    .trim();
}

/**
 * A VietQR image URL (img.vietqr.io) with the amount and memo prefilled, so the student scans it
 * straight into their banking app. `bankCode` is the VietQR bank id — 'VCB', 'TCB', … or the
 * six-digit BIN. Built as a plain URL on purpose: one <Image> on mobile, no QR library anywhere.
 */
export function vietQrUrl(input: {
  bankCode: string;
  accountNumber: string;
  accountHolder: string;
  amountVnd: number;
  memo: string;
}): string {
  const base = `https://img.vietqr.io/image/${encodeURIComponent(input.bankCode)}-${encodeURIComponent(input.accountNumber)}-compact2.png`;
  const params = new URLSearchParams();
  params.set('amount', String(Math.max(0, Math.round(input.amountVnd))));
  params.set('addInfo', input.memo);
  params.set('accountName', input.accountHolder);
  return `${base}?${params.toString()}`;
}
