import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { createDb } from '../server/db/index';
import * as classesSvc from '../server/services/classes';
import * as eventsSvc from '../server/services/events';
import * as peopleSvc from '../server/services/people';
import * as attendanceSvc from '../server/services/attendance';
import * as tuitionSvc from '../server/services/tuition';
import { notifyTuitionMonth } from '../server/services/notify';
import { accounts, pushTokens } from '../server/db/schema';

/**
 * The student self-view and the manual fee notification.
 *
 * Everything here goes through the REAL close path — seed a class, a price and attendance, then
 * `closeMonth` — rather than writing `tuition_lines` by hand. The rules being checked (an open
 * month is invisible, one student never sees another's money, a re-close only re-notifies when the
 * amount moved) are only worth anything if they hold against the snapshot the app actually writes.
 */

function db() {
  return createDb(env);
}

/** A class, a priced month, a student in it, and one event to mark attendance against. */
async function fixture(d, { month, name, price = 100_000 }) {
  const cls = await classesSvc.create(d, { name, color: 'blue', studentIds: [] });
  const student = await peopleSvc.createStudent(d, {
    name: `${name} Student`,
    color: 'blue',
    classIds: [cls.id],
  });
  const ev = await eventsSvc.create(d, {
    title: `${name} Session`,
    date: `${month}-02`,
    classId: cls.id,
    recurrence: 'none',
  });
  await tuitionSvc.setPrice(d, { classId: cls.id, priceVnd: price, effectiveFrom: `${month}-01` });
  return { cls, student, ev };
}

/** Give an existing student an account with a registered device. */
async function giveDevice(d, student, token) {
  const accountId = crypto.randomUUID();
  await d.insert(accounts).values({
    id: accountId,
    email: `${token}@example.test`,
    passwordHash: 'x',
    studentId: student.id,
    createdAt: new Date().toISOString(),
  });
  await d.insert(pushTokens).values({
    id: crypto.randomUUID(),
    accountId,
    expoToken: token,
    platform: 'android',
    createdAt: new Date().toISOString(),
  });
}

describe('tuition — student self-view', () => {
  it('hides an open month and reveals it once closed', async () => {
    const d = db();
    const month = '2032-01';
    const { student, ev } = await fixture(d, { month, name: 'SelfOpen' });
    await attendanceSvc.saveOccurrence(d, ev.id, `${month}-02`, [
      { studentId: student.id, status: 'present' },
    ]);

    // Attendance exists and the admin screen would already show an estimate — the student sees
    // nothing, because an open month's number still moves.
    expect(await tuitionSvc.listClosedMonthsForStudent(d, student.id)).toEqual([]);
    expect(await tuitionSvc.getStudentMonthDetail(d, student.id, month)).toBe(null);

    await tuitionSvc.closeMonth(d, month, 'Tester');

    const months = await tuitionSvc.listClosedMonthsForStudent(d, student.id);
    expect(months).toHaveLength(1);
    expect(months[0]).toMatchObject({ month, dueVnd: 100_000, status: 'unpaid' });

    const detail = await tuitionSvc.getStudentMonthDetail(d, student.id, month);
    expect(detail.fee.lines).toHaveLength(1);
    expect(detail.fee.lines[0].dates).toEqual([`${month}-02`]);
  });

  it('never returns another student’s fees', async () => {
    const d = db();
    const month = '2032-02';
    const { cls, student, ev } = await fixture(d, { month, name: 'SelfScope' });
    const other = await peopleSvc.createStudent(d, {
      name: 'SelfScope Other',
      color: 'green',
      classIds: [cls.id],
    });
    await attendanceSvc.saveOccurrence(d, ev.id, `${month}-02`, [
      { studentId: student.id, status: 'present' },
      { studentId: other.id, status: 'present' },
    ]);
    await tuitionSvc.closeMonth(d, month, 'Tester');

    const mine = await tuitionSvc.getStudentMonthDetail(d, student.id, month);
    expect(mine.fee.studentId).toBe(student.id);
    expect(mine.fee.lines.every((l) => l.studentId === student.id)).toBe(true);
    // Both were billed the same amount, so the totals alone would not prove separation.
    expect(mine.fee.lines).toHaveLength(1);
  });

  it('reflects a payment recorded after the close, and reports it as partial', async () => {
    const d = db();
    const month = '2032-03';
    const { student, ev } = await fixture(d, { month, name: 'SelfPaid', price: 200_000 });
    await attendanceSvc.saveOccurrence(d, ev.id, `${month}-02`, [
      { studentId: student.id, status: 'present' },
    ]);
    await tuitionSvc.closeMonth(d, month, 'Tester');

    // Payments live outside the snapshot: a closed month is still allowed to change here.
    await tuitionSvc.saveStudentMonth(d, month, student.id, { paidVnd: 50_000 });

    const [summary] = await tuitionSvc.listClosedMonthsForStudent(d, student.id);
    expect(summary).toMatchObject({
      dueVnd: 200_000,
      paidVnd: 50_000,
      outstandingVnd: 150_000,
      status: 'partial',
    });
  });

  it('keeps a reopened month out of the list', async () => {
    const d = db();
    const month = '2032-04';
    const { student, ev } = await fixture(d, { month, name: 'SelfReopen' });
    await attendanceSvc.saveOccurrence(d, ev.id, `${month}-02`, [
      { studentId: student.id, status: 'present' },
    ]);
    await tuitionSvc.closeMonth(d, month, 'Tester');
    expect(await tuitionSvc.listClosedMonthsForStudent(d, student.id)).toHaveLength(1);

    await tuitionSvc.reopenMonth(d, month);
    expect(await tuitionSvc.listClosedMonthsForStudent(d, student.id)).toEqual([]);
    expect(await tuitionSvc.getStudentMonthDetail(d, student.id, month)).toBe(null);
  });
});

describe('tuition — payment info', () => {
  it('resolves the memo and only offers a QR while something is owed', async () => {
    const info = {
      bankName: 'Vietcombank',
      bankCode: 'VCB',
      accountNumber: '0011234567',
      accountHolder: 'NGUYEN VAN A',
      memoTemplate: 'HP {month} {name}',
    };
    const owed = tuitionSvc.resolvePaymentInfo(info, {
      month: '2026-07',
      studentName: 'Trần Thị Bích',
      outstandingVnd: 800_000,
    });
    expect(owed.memo).toBe('HP 7/2026 Trần Thị Bích');
    expect(owed.vietQrUrl).toContain('amount=800000');

    const settled = tuitionSvc.resolvePaymentInfo(info, {
      month: '2026-07',
      studentName: 'Trần Thị Bích',
      outstandingVnd: 0,
    });
    expect(settled.vietQrUrl).toBe(null);
    // The memo still stands: the bank details stay readable on a paid month.
    expect(settled.memo).toBe('HP 7/2026 Trần Thị Bích');
  });

  it('offers no QR until the account is configured', async () => {
    const partial = tuitionSvc.resolvePaymentInfo(
      {
        bankName: 'Vietcombank',
        bankCode: null,
        accountNumber: null,
        accountHolder: null,
        memoTemplate: null,
      },
      { month: '2026-07', studentName: 'An', outstandingVnd: 100_000 },
    );
    expect(partial.vietQrUrl).toBe(null);
    expect(partial.memo).toBe(null);
  });

  it('round-trips through the settings row', async () => {
    const d = db();
    expect((await tuitionSvc.getPaymentInfo(d)).bankCode).toBe(null);
    await tuitionSvc.setPaymentInfo(d, { bankCode: 'VCB', accountNumber: '123' });
    // A partial save must not blank the fields it did not mention.
    await tuitionSvc.setPaymentInfo(d, { accountHolder: 'NGUYEN VAN A' });
    expect(await tuitionSvc.getPaymentInfo(d)).toMatchObject({
      bankCode: 'VCB',
      accountNumber: '123',
      accountHolder: 'NGUYEN VAN A',
    });
  });
});

describe('tuition — the manual notify button', () => {
  let sent = [];

  beforeEach(() => {
    sent = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const batch = JSON.parse(init.body);
        sent.push(...batch);
        return new Response(JSON.stringify({ data: batch.map(() => ({ status: 'ok' })) }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
  });

  it('sends once, and a second press reaches nobody', async () => {
    const d = db();
    const month = '2033-01';
    const { student, ev } = await fixture(d, { month, name: 'NotifyOnce', price: 150_000 });
    await giveDevice(d, student, 'ExponentPushToken[notify-once]');
    await attendanceSvc.saveOccurrence(d, ev.id, `${month}-02`, [
      { studentId: student.id, status: 'present' },
    ]);
    await tuitionSvc.closeMonth(d, month, 'Tester');

    const first = await notifyTuitionMonth(d, month);
    expect(first).toMatchObject({ sent: 1, skipped: 0, noDevice: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe('Học phí tháng 1/2033');
    expect(sent[0].body).toContain('150.000 ₫');
    // The url fallback is what keeps a pre-tuition bundle off +not-found; the kind is what an
    // updated bundle routes on.
    expect(sent[0].data).toEqual({ url: '/profile', kind: 'tuition' });

    sent = [];
    const second = await notifyTuitionMonth(d, month);
    expect(second).toMatchObject({ sent: 0, skipped: 1 });
    expect(sent).toHaveLength(0);
  });

  it('re-notifies only when a reopen actually changed the amount', async () => {
    const d = db();
    const month = '2033-02';
    const { student, ev } = await fixture(d, { month, name: 'NotifyAmount', price: 100_000 });
    await giveDevice(d, student, 'ExponentPushToken[notify-amount]');
    await attendanceSvc.saveOccurrence(d, ev.id, `${month}-02`, [
      { studentId: student.id, status: 'present' },
    ]);
    await tuitionSvc.closeMonth(d, month, 'Tester');
    await notifyTuitionMonth(d, month);

    // Re-close with nothing changed: the amount is the same, so the key is the same.
    sent = [];
    await tuitionSvc.closeMonth(d, month, 'Tester');
    expect(await notifyTuitionMonth(d, month)).toMatchObject({ sent: 0, skipped: 1 });

    // Now a correction that moves the money — a second billed session.
    await attendanceSvc.saveOccurrence(d, ev.id, `${month}-09`, [
      { studentId: student.id, status: 'present' },
    ]);
    await tuitionSvc.closeMonth(d, month, 'Tester');
    sent = [];
    expect(await notifyTuitionMonth(d, month)).toMatchObject({ sent: 1 });
    expect(sent[0].body).toContain('200.000 ₫');
  });

  it('refuses an open month and skips students who owe nothing', async () => {
    const d = db();
    const month = '2033-03';
    const { student, ev } = await fixture(d, { month, name: 'NotifyZero' });
    await giveDevice(d, student, 'ExponentPushToken[notify-zero]');
    await attendanceSvc.saveOccurrence(d, ev.id, `${month}-02`, [
      { studentId: student.id, status: 'present' },
    ]);

    // Open: closedMonthFees returns nothing rather than computing an estimate to announce.
    expect(await notifyTuitionMonth(d, month)).toMatchObject({ sent: 0 });

    await tuitionSvc.closeMonth(d, month, 'Tester');
    // A full discount leaves nothing owed, which is not news.
    await tuitionSvc.saveStudentMonth(d, month, student.id, { adjustmentVnd: -100_000 });
    sent = [];
    expect(await notifyTuitionMonth(d, month)).toMatchObject({ sent: 0 });
    expect(sent).toHaveLength(0);
  });

  it('counts a student with no device instead of failing', async () => {
    const d = db();
    const month = '2033-04';
    const { student, ev } = await fixture(d, { month, name: 'NotifyNoDevice' });
    await attendanceSvc.saveOccurrence(d, ev.id, `${month}-02`, [
      { studentId: student.id, status: 'present' },
    ]);
    await tuitionSvc.closeMonth(d, month, 'Tester');

    expect(await notifyTuitionMonth(d, month)).toMatchObject({ sent: 0, noDevice: 1 });
  });
});
