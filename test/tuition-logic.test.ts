import { describe, it, expect } from 'vitest';
import { formatVnd, paymentStatus, shiftMonth, studentFees } from '../shared/logic/tuition';
import type { TuitionLine } from '../server/services/tuition';
import {
  TuitionMonth,
  ClassPriceInput,
  TuitionAdjustmentInput,
  TuitionPaymentInput,
} from '../shared/schemas';

function line(over: Partial<TuitionLine> = {}): TuitionLine {
  return {
    studentId: 's1',
    classId: 'c1',
    className: 'Toán 9',
    sessions: 4,
    statusCounts: { present: 4 },
    unitPriceVnd: 100_000,
    amountVnd: 400_000,
    ...over,
  };
}

describe('formatVnd', () => {
  it('groups thousands with dots, the Vietnamese way', () => {
    expect(formatVnd(0)).toBe('0 ₫');
    expect(formatVnd(1_000)).toBe('1.000 ₫');
    expect(formatVnd(150_000)).toBe('150.000 ₫');
    expect(formatVnd(1_500_000)).toBe('1.500.000 ₫');
    expect(formatVnd(12_345_678)).toBe('12.345.678 ₫');
  });

  it('keeps a discount readable as a negative amount', () => {
    expect(formatVnd(-20_000)).toBe('-20.000 ₫');
  });
});

describe('paymentStatus', () => {
  it('reads paid, part paid and unpaid off the two amounts', () => {
    expect(paymentStatus(400_000, 0)).toBe('unpaid');
    expect(paymentStatus(400_000, 100_000)).toBe('partial');
    expect(paymentStatus(400_000, 400_000)).toBe('paid');
    // Overpayment is still paid, not a fourth state.
    expect(paymentStatus(400_000, 500_000)).toBe('paid');
  });

  it('counts a month with nothing owed as paid rather than unpaid', () => {
    expect(paymentStatus(0, 0)).toBe('paid');
  });
});

describe('studentFees', () => {
  it('sums a student’s lines and applies their adjustment', () => {
    const fees = studentFees(
      [line(), line({ classId: 'c2', className: 'Lý 9', sessions: 2, amountVnd: 300_000 })],
      [
        {
          month: '2031-03',
          studentId: 's1',
          adjustmentVnd: -100_000,
          adjustmentNote: 'Giảm giá em thứ hai',
          paidVnd: 500_000,
          paidAt: '2031-03-05',
          paymentNote: null,
        },
      ],
    );
    expect(fees).toHaveLength(1);
    const fee = fees[0];
    expect(fee.billedVnd).toBe(700_000);
    expect(fee.dueVnd).toBe(600_000);
    expect(fee.paidVnd).toBe(500_000);
    expect(fee.outstandingVnd).toBe(100_000);
    expect(fee.status).toBe('partial');
  });

  it('never lets a large discount produce a negative amount due', () => {
    const [fee] = studentFees(
      [line({ amountVnd: 100_000 })],
      [
        {
          month: '2031-03',
          studentId: 's1',
          adjustmentVnd: -500_000,
          adjustmentNote: 'Học bổng',
          paidVnd: 0,
          paidAt: null,
          paymentNote: null,
        },
      ],
    );
    expect(fee.dueVnd).toBe(0);
    expect(fee.outstandingVnd).toBe(0);
    expect(fee.status).toBe('paid');
  });

  it('keeps a student who paid but has no fee lines', () => {
    // Happens when a month is reopened after the attendance it was billed from was corrected away;
    // dropping the row would hide money that was actually collected.
    const fees = studentFees(
      [],
      [
        {
          month: '2031-03',
          studentId: 'ghost',
          adjustmentVnd: 0,
          adjustmentNote: null,
          paidVnd: 200_000,
          paidAt: '2031-03-02',
          paymentNote: 'Đã thu',
        },
      ],
    );
    expect(fees).toHaveLength(1);
    expect(fees[0].studentId).toBe('ghost');
    expect(fees[0].billedVnd).toBe(0);
    expect(fees[0].paidVnd).toBe(200_000);
  });

  it('drops an all-zero payment row, so zeroing a payment undoes it', () => {
    // There is no way to delete a tuition_student_months row, so zeroing the amounts is the only
    // undo an admin has; an empty row must not leave the student listed as "Paid in full".
    const fees = studentFees(
      [],
      [
        {
          month: '2031-03',
          studentId: 'mistake',
          adjustmentVnd: 0,
          adjustmentNote: null,
          paidVnd: 0,
          paidAt: null,
          paymentNote: null,
        },
      ],
    );
    expect(fees).toEqual([]);
  });

  it('gives a student with lines but no payment row a zero-paid entry', () => {
    const [fee] = studentFees([line()], []);
    expect(fee.paidVnd).toBe(0);
    expect(fee.adjustmentVnd).toBe(0);
    expect(fee.status).toBe('unpaid');
  });
});

describe('shiftMonth', () => {
  it('steps within a year', () => {
    expect(shiftMonth('2031-03', 1)).toBe('2031-04');
    expect(shiftMonth('2031-03', -1)).toBe('2031-02');
  });

  it('crosses year boundaries in both directions', () => {
    expect(shiftMonth('2031-12', 1)).toBe('2032-01');
    expect(shiftMonth('2031-01', -1)).toBe('2030-12');
    expect(shiftMonth('2031-01', -13)).toBe('2029-12');
  });
});

describe('tuition schemas', () => {
  it('accepts real months and rejects impossible ones', () => {
    expect(TuitionMonth.safeParse('2031-01').success).toBe(true);
    expect(TuitionMonth.safeParse('2031-12').success).toBe(true);
    expect(TuitionMonth.safeParse('2031-13').success).toBe(false);
    expect(TuitionMonth.safeParse('2031-00').success).toBe(false);
    expect(TuitionMonth.safeParse('2031-1').success).toBe(false);
    expect(TuitionMonth.safeParse('2031-01-01').success).toBe(false);
  });

  it('coerces a price out of the form body and refuses a negative or fractional one', () => {
    const ok = ClassPriceInput.safeParse({
      classId: 'c1',
      priceVnd: '150000',
      effectiveFrom: '2031-03-01',
    });
    expect(ok.success && ok.data.priceVnd).toBe(150_000);
    expect(
      ClassPriceInput.safeParse({ classId: 'c1', priceVnd: '-1', effectiveFrom: '2031-03-01' })
        .success,
    ).toBe(false);
    expect(
      ClassPriceInput.safeParse({ classId: 'c1', priceVnd: '1.5', effectiveFrom: '2031-03-01' })
        .success,
    ).toBe(false);
    expect(
      ClassPriceInput.safeParse({ classId: 'c1', priceVnd: '1000', effectiveFrom: '2031-3' })
        .success,
    ).toBe(false);
  });

  it('allows a negative adjustment — that is what a discount is', () => {
    const parsed = TuitionAdjustmentInput.safeParse({ adjustmentVnd: '-50000' });
    expect(parsed.success && parsed.data.adjustmentVnd).toBe(-50_000);
  });

  it('reads a cleared payment date as no date, and still rejects a malformed one', () => {
    // The picker is clearable and an empty form field arrives as '', not as a missing key. Before
    // the literal branch this failed the regex and 400'd the entire payment save.
    const cleared = TuitionPaymentInput.safeParse({ paidVnd: '250000', paidAt: '' });
    expect(cleared.success).toBe(true);
    expect(cleared.success && cleared.data.paidAt).toBe(null);

    const real = TuitionPaymentInput.safeParse({ paidVnd: '250000', paidAt: '2031-03-05' });
    expect(real.success && real.data.paidAt).toBe('2031-03-05');

    expect(TuitionPaymentInput.safeParse({ paidVnd: '1', paidAt: '5 March' }).success).toBe(false);
  });
});
