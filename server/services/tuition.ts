import { eq, and, gte, lte, isNotNull, asc, sql } from 'drizzle-orm';
import {
  attendanceRecords,
  classes,
  classPrices,
  events,
  settings,
  tuitionLines,
  tuitionMonths,
  tuitionStudentMonths,
} from '../db/schema';
import { chunk, rowsPerStatement, type Db } from '../db/index';
import type {
  AttendanceStatus,
  ClassPriceInput,
  TuitionAdjustmentInput,
  TuitionPaymentInfoInput,
  TuitionPaymentInput,
} from '../../shared/schemas';
/**
 * Tuition (học phí): turn attendance into a monthly fee.
 *
 * No student self-view: a child is never told what their family owes. Everything that computes or
 * edits a month is staff-only, and a family learns the amount from the printed slip (phiếu thu) or
 * the office. The one read outside that is a PARENT's own slip, assembled by
 * server/services/fee-slip.ts behind the portal toggle — the audience the slip was always for.
 *
 * A month is computed live from `attendance_records` until an admin closes it. Closing freezes the
 * numbers into `tuition_lines`, so later attendance fixes, price changes, or a different billable
 * -status setting cannot silently restate an amount a parent has already been told. Reopening
 * deletes the snapshot and returns the month to live compute.
 *
 * Payments and adjustments live in `tuition_student_months`, deliberately outside the snapshot:
 * money is collected after the month closes.
 *
 * Everything is integer VND.
 */

export type TuitionSettings = { billableStatuses: AttendanceStatus[] };

/**
 * Default: an unexcused absence is billed (the seat was held), an excused one is not. Both the
 * shape and this default are what a centre is most likely to want on day one; /config changes it.
 */
export const DEFAULT_TUITION_SETTINGS: TuitionSettings = {
  billableStatuses: ['present', 'late', 'absent'],
};

const SETTINGS_KEY = 'tuition-settings';

export async function getTuitionSettings(db: Db): Promise<TuitionSettings> {
  const rows = await db.select().from(settings).where(eq(settings.key, SETTINGS_KEY));
  const row = rows[0];
  if (!row) return { ...DEFAULT_TUITION_SETTINGS };
  try {
    const parsed = JSON.parse(row.value) as Partial<TuitionSettings>;
    const list = parsed.billableStatuses;
    if (!Array.isArray(list) || list.length === 0) return { ...DEFAULT_TUITION_SETTINGS };
    return { billableStatuses: list };
  } catch {
    return { ...DEFAULT_TUITION_SETTINGS };
  }
}

export async function setTuitionSettings(
  db: Db,
  patch: Partial<TuitionSettings>,
): Promise<TuitionSettings> {
  const current = await getTuitionSettings(db);
  const next = { ...current, ...patch };
  await db
    .insert(settings)
    .values({ key: SETTINGS_KEY, value: JSON.stringify(next) })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(next) } });
  return next;
}

/* ── Payment details (bank transfer + VietQR) ───────────────────────────────────────────── */

export type TuitionPaymentInfo = {
  bankName: string | null;
  bankCode: string | null;
  accountNumber: string | null;
  accountHolder: string | null;
  memoTemplate: string | null;
};

const EMPTY_PAYMENT_INFO: TuitionPaymentInfo = {
  bankName: null,
  bankCode: null,
  accountNumber: null,
  accountHolder: null,
  memoTemplate: null,
};

const PAYMENT_INFO_KEY = 'tuition-payment-info';

/** The centre's bank account. Unset until an admin fills the /config form — every field nullable. */
export async function getPaymentInfo(db: Db): Promise<TuitionPaymentInfo> {
  const rows = await db.select().from(settings).where(eq(settings.key, PAYMENT_INFO_KEY));
  const row = rows[0];
  if (!row) return { ...EMPTY_PAYMENT_INFO };
  try {
    const parsed = JSON.parse(row.value) as Partial<TuitionPaymentInfo>;
    return { ...EMPTY_PAYMENT_INFO, ...parsed };
  } catch {
    return { ...EMPTY_PAYMENT_INFO };
  }
}

export async function setPaymentInfo(
  db: Db,
  patch: TuitionPaymentInfoInput,
): Promise<TuitionPaymentInfo> {
  const current = await getPaymentInfo(db);
  const next: TuitionPaymentInfo = {
    bankName: patch.bankName ?? current.bankName,
    bankCode: patch.bankCode ?? current.bankCode,
    accountNumber: patch.accountNumber ?? current.accountNumber,
    accountHolder: patch.accountHolder ?? current.accountHolder,
    memoTemplate: patch.memoTemplate ?? current.memoTemplate,
  };
  await db
    .insert(settings)
    .values({ key: PAYMENT_INFO_KEY, value: JSON.stringify(next) })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(next) } });
  return next;
}

/* ── Class prices ───────────────────────────────────────────────────────────────────────── */

export type ClassPriceRow = {
  id: string;
  classId: string;
  priceVnd: number;
  effectiveFrom: string;
};

function mapPrice(r: typeof classPrices.$inferSelect): ClassPriceRow {
  return {
    id: r.id,
    classId: r.classId,
    priceVnd: r.priceVnd,
    effectiveFrom: r.effectiveFrom,
  };
}

export async function listPrices(db: Db): Promise<ClassPriceRow[]> {
  const rows = await db
    .select()
    .from(classPrices)
    .orderBy(asc(classPrices.classId), asc(classPrices.effectiveFrom));
  return rows.map(mapPrice);
}

/**
 * Set a class's price from a date. An upsert, not an insert: "the price for this class from March"
 * is one fact, so saving it twice must correct the amount rather than fail on the unique index.
 */
export async function setPrice(db: Db, input: ClassPriceInput): Promise<ClassPriceRow> {
  await db
    .insert(classPrices)
    .values({
      id: crypto.randomUUID(),
      classId: input.classId,
      priceVnd: input.priceVnd,
      effectiveFrom: input.effectiveFrom,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [classPrices.classId, classPrices.effectiveFrom],
      set: { priceVnd: input.priceVnd },
    });
  const rows = await db
    .select()
    .from(classPrices)
    .where(
      and(
        eq(classPrices.classId, input.classId),
        eq(classPrices.effectiveFrom, input.effectiveFrom),
      ),
    );
  return mapPrice(rows[0]);
}

/** Changing an existing row's date is a delete plus a `setPrice`, so there is no updatePrice. */
export async function removePrice(db: Db, id: string): Promise<void> {
  await db.delete(classPrices).where(eq(classPrices.id, id));
}

/**
 * The price in force for a whole month: the latest row effective on or before the 1st.
 *
 * One price per month, not per session date. That keeps a fee line readable ("12 buổi × 150.000 đ")
 * instead of splitting a student's month in two when a price changes mid-month — and it matches how
 * a centre announces a change ("giá mới áp dụng từ tháng 9"). The cost is that an `effectiveFrom`
 * of the 10th only takes effect the following month; the prices UI says so.
 *
 * Returns null when the class has no price yet — `closeMonth` refuses rather than billing zero.
 */
export function priceForMonth(
  prices: ClassPriceRow[],
  classId: string,
  month: string,
): number | null {
  const firstOfMonth = `${month}-01`;
  let best: ClassPriceRow | null = null;
  for (const p of prices) {
    if (p.classId !== classId) continue;
    if (p.effectiveFrom > firstOfMonth) continue;
    if (!best || p.effectiveFrom > best.effectiveFrom) best = p;
  }
  return best ? best.priceVnd : null;
}

/* ── Monthly computation ────────────────────────────────────────────────────────────────── */

export type TuitionLine = {
  studentId: string;
  classId: string;
  className: string;
  /** Billable sessions, per the settings in force. */
  sessions: number;
  /**
   * The billable session dates, ascending, one entry per billed session — so two events of the same
   * class on one day appear twice, matching `sessions`. The Minimal slip lists them ("Buổi học /
   * Ngày học"). Empty for months closed before the column existed (migration 0021).
   */
  dates: string[];
  /** Every status seen, billable or not — the slip shows the breakdown. */
  statusCounts: Record<string, number>;
  unitPriceVnd: number;
  amountVnd: number;
};

export type StudentMonthRow = {
  month: string;
  studentId: string;
  adjustmentVnd: number;
  adjustmentNote: string | null;
  paidVnd: number;
  paidAt: string | null;
  paymentNote: string | null;
};

export type MonthReport = {
  month: string;
  status: 'open' | 'closed';
  closedAt: string | null;
  closedBy: string | null;
  lines: TuitionLine[];
  studentMonths: StudentMonthRow[];
  /** Classes with billable sessions but no price yet. Always empty for a closed month. */
  missingPriceClasses: { id: string; name: string }[];
};

/** '2026-03' -> ['2026-03-01', '2026-03-31'] — dates are zero-padded, so lexical compare works. */
function monthRange(month: string): [string, string] {
  return [`${month}-01`, `${month}-31`];
}

/**
 * Live fee lines for a month, straight from attendance.
 *
 * A student with no attendance row is not billed at all: unmarked and absent are different states
 * in this app, and only the second one is a decision someone made.
 */
export async function computeMonthLines(
  db: Db,
  month: string,
  settings: TuitionSettings,
): Promise<{ lines: TuitionLine[]; missingPriceClasses: { id: string; name: string }[] }> {
  const [start, end] = monthRange(month);
  // One row per attendance record rather than a grouped count: the Minimal slip lists the individual
  // session dates, so the dates have to come back with the rows. One centre-month is a few hundred.
  const [marks, prices, classRows] = await Promise.all([
    db
      .select({
        studentId: attendanceRecords.studentId,
        classId: events.classId,
        status: attendanceRecords.status,
        date: attendanceRecords.date,
      })
      .from(attendanceRecords)
      .innerJoin(events, eq(attendanceRecords.eventId, events.id))
      .where(
        and(
          gte(attendanceRecords.date, start),
          lte(attendanceRecords.date, end),
          isNotNull(events.classId),
        ),
      )
      .orderBy(asc(attendanceRecords.date)),
    listPrices(db),
    db.select({ id: classes.id, name: classes.name }).from(classes),
  ]);

  const classNames = new Map(classRows.map((c) => [c.id, c.name]));
  const billable = new Set<string>(settings.billableStatuses);

  const byPair = new Map<string, TuitionLine>();
  for (const row of marks) {
    const classId = row.classId;
    if (!classId) continue; // isNotNull already excludes these; narrowing for TypeScript
    const key = `${row.studentId} ${classId}`;
    let line = byPair.get(key);
    if (!line) {
      line = {
        studentId: row.studentId,
        classId,
        className: classNames.get(classId) ?? classId,
        sessions: 0,
        dates: [],
        statusCounts: {},
        unitPriceVnd: 0,
        amountVnd: 0,
      };
      byPair.set(key, line);
    }
    line.statusCounts[row.status] = (line.statusCounts[row.status] ?? 0) + 1;
    if (billable.has(row.status)) {
      line.sessions += 1;
      line.dates.push(row.date);
    }
  }

  const missing = new Map<string, string>();
  const lines: TuitionLine[] = [];
  for (const line of byPair.values()) {
    // Nothing billable this month (all sessions excused, say): no fee line, nothing to price.
    if (line.sessions === 0) continue;
    const price = priceForMonth(prices, line.classId, month);
    if (price == null) {
      missing.set(line.classId, line.className);
      continue;
    }
    line.unitPriceVnd = price;
    line.amountVnd = price * line.sessions;
    lines.push(line);
  }

  lines.sort(
    (a, b) => a.studentId.localeCompare(b.studentId) || a.className.localeCompare(b.className),
  );

  return {
    lines,
    missingPriceClasses: [...missing].map(([id, name]) => ({ id, name })),
  };
}

function mapStudentMonth(r: typeof tuitionStudentMonths.$inferSelect): StudentMonthRow {
  return {
    month: r.month,
    studentId: r.studentId,
    adjustmentVnd: r.adjustmentVnd,
    adjustmentNote: r.adjustmentNote ?? null,
    paidVnd: r.paidVnd,
    paidAt: r.paidAt ?? null,
    paymentNote: r.paymentNote ?? null,
  };
}

async function listStudentMonths(db: Db, month: string): Promise<StudentMonthRow[]> {
  const rows = await db
    .select()
    .from(tuitionStudentMonths)
    .where(eq(tuitionStudentMonths.month, month));
  return rows.map(mapStudentMonth);
}

/** A snapshot column that holds JSON. Corrupt or pre-migration values read as the fallback. */
function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function listSnapshotLines(db: Db, month: string): Promise<TuitionLine[]> {
  const rows = await db
    .select()
    .from(tuitionLines)
    .where(eq(tuitionLines.month, month))
    .orderBy(asc(tuitionLines.studentId), asc(tuitionLines.className));
  return rows.map((r) => {
    return {
      studentId: r.studentId,
      classId: r.classId,
      className: r.className,
      sessions: r.sessions,
      dates: parseJson<string[]>(r.dates, []),
      statusCounts: parseJson<Record<string, number>>(r.statusCounts, {}),
      unitPriceVnd: r.unitPriceVnd,
      amountVnd: r.amountVnd,
    };
  });
}

export async function getMonthStatus(
  db: Db,
  month: string,
): Promise<{ status: 'open' | 'closed'; closedAt: string | null; closedBy: string | null }> {
  const rows = await db.select().from(tuitionMonths).where(eq(tuitionMonths.month, month));
  const row = rows[0];
  if (!row || row.status !== 'closed') return { status: 'open', closedAt: null, closedBy: null };
  return { status: 'closed', closedAt: row.closedAt ?? null, closedBy: row.closedBy ?? null };
}

export async function getMonthReport(db: Db, month: string): Promise<MonthReport> {
  const [{ status, closedAt, closedBy }, studentMonths] = await Promise.all([
    getMonthStatus(db, month),
    listStudentMonths(db, month),
  ]);

  if (status === 'closed') {
    return {
      month,
      status,
      closedAt,
      closedBy,
      lines: await listSnapshotLines(db, month),
      studentMonths,
      missingPriceClasses: [],
    };
  }

  const settings = await getTuitionSettings(db);
  const { lines, missingPriceClasses } = await computeMonthLines(db, month, settings);
  return { month, status, closedAt, closedBy, lines, studentMonths, missingPriceClasses };
}

/** Raised when a month cannot be closed because some class that has sessions has no price. */
export class MissingPriceError extends Error {
  constructor(readonly classes: { id: string; name: string }[]) {
    super(`No price set for: ${classes.map((c) => c.name).join(', ')}`);
    this.name = 'MissingPriceError';
  }
}

/** The columns each tuition_lines row binds — see `rowsPerStatement`. */
const TUITION_LINE_COLUMNS = 10;

/**
 * Freeze the month. Idempotent: closing an already-closed month recomputes and replaces the
 * snapshot, which is how an admin applies a correction they made while it was open.
 */
export async function closeMonth(db: Db, month: string, closedBy: string): Promise<void> {
  const settings = await getTuitionSettings(db);
  const { lines, missingPriceClasses } = await computeMonthLines(db, month, settings);
  // Billing a class at zero because nobody set its price would be a silent, wrong invoice.
  if (missingPriceClasses.length) throw new MissingPriceError(missingPriceClasses);

  const values = lines.map((l) => ({
    id: crypto.randomUUID(),
    month,
    studentId: l.studentId,
    classId: l.classId,
    className: l.className,
    sessions: l.sessions,
    dates: JSON.stringify(l.dates),
    statusCounts: JSON.stringify(l.statusCounts),
    unitPriceVnd: l.unitPriceVnd,
    amountVnd: l.amountVnd,
  }));

  const closedAt = new Date().toISOString();
  const billableJson = JSON.stringify(settings.billableStatuses);

  const markClosed = db
    .insert(tuitionMonths)
    .values({ month, status: 'closed', closedAt, closedBy, billableStatuses: billableJson })
    .onConflictDoUpdate({
      target: tuitionMonths.month,
      set: { status: 'closed', closedAt, closedBy, billableStatuses: billableJson },
    });
  const del = db.delete(tuitionLines).where(eq(tuitionLines.month, month));
  // A line binds 10 parameters, so one INSERT of every line would blow D1's 100-parameter ceiling
  // past 10 lines. Chunked, but in the same batch as the delete — that is what keeps a month from
  // being left marked closed with a half-written snapshot.
  const inserts = chunk(values, rowsPerStatement(TUITION_LINE_COLUMNS)).map((part) =>
    db.insert(tuitionLines).values(part),
  );

  await db.batch([markClosed, del, ...inserts]);
}

/** Back to live compute. Payments and adjustments survive — they are not part of the snapshot. */
export async function reopenMonth(db: Db, month: string): Promise<void> {
  await db.batch([
    db.delete(tuitionLines).where(eq(tuitionLines.month, month)),
    db.update(tuitionMonths).set({ status: 'open' }).where(eq(tuitionMonths.month, month)),
  ]);
}

/* ── Payments and adjustments ───────────────────────────────────────────────────────────── */

export async function saveStudentMonth(
  db: Db,
  month: string,
  studentId: string,
  patch: Partial<TuitionPaymentInput & TuitionAdjustmentInput>,
): Promise<StudentMonthRow> {
  const set: Partial<typeof tuitionStudentMonths.$inferInsert> = {};
  if (patch.paidVnd !== undefined) set.paidVnd = patch.paidVnd;
  if (patch.paidAt !== undefined) set.paidAt = patch.paidAt ?? null;
  if (patch.paymentNote !== undefined) set.paymentNote = patch.paymentNote ?? null;
  if (patch.adjustmentVnd !== undefined) set.adjustmentVnd = patch.adjustmentVnd;
  if (patch.adjustmentNote !== undefined) set.adjustmentNote = patch.adjustmentNote ?? null;

  await db
    .insert(tuitionStudentMonths)
    .values({ month, studentId, ...set })
    .onConflictDoUpdate({
      target: [tuitionStudentMonths.month, tuitionStudentMonths.studentId],
      set,
    });

  const rows = await db
    .select()
    .from(tuitionStudentMonths)
    .where(
      and(eq(tuitionStudentMonths.month, month), eq(tuitionStudentMonths.studentId, studentId)),
    );
  return mapStudentMonth(rows[0]);
}
