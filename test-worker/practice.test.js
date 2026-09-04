import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { createRawDb } from '../server/db/internal';
import { TenantDb, PRIMARY_TENANT_ID } from '../server/db/index';
import * as practiceSvc from '../server/services/practice';
import * as classesSvc from '../server/services/classes';
import * as peopleSvc from '../server/services/people';
import * as assessSvc from '../server/services/assessments';
import { runPracticeFinalize } from '../server/services/practice-notify';

/**
 * Practice: the nightly finalize is the only writer of misses and the one place the ×N rule is
 * applied. These tests drive it against real D1 through the service layer — no hand SQL — and
 * pin: copies fan out to the roster, a complete day is not a miss, an incomplete day is, an
 * approved excuse makes it excused with no behavior row, and the ×N badge escalates/clears.
 */
function db() {
  return new TenantDb(createRawDb(env), PRIMARY_TENANT_ID);
}

async function fixture(d) {
  const a = await peopleSvc.createStudent(d, { name: 'PR Student A', color: 'blue', classIds: [] });
  const b = await peopleSvc.createStudent(d, { name: 'PR Student B', color: 'blue', classIds: [] });
  const cls = await classesSvc.create(d, {
    name: `PR Class ${crypto.randomUUID().slice(0, 6)}`,
    color: 'green',
    studentIds: [a.id, b.id],
  });
  await practiceSvc.saveSettings(
    d,
    { classId: cls.id, enabled: true, weekdays: '1,2,3,4,5,6' },
    '2031-03-03',
    true,
  );
  return { a, b, cls };
}

/** A staff row to hang reviewedBy/decidedBy on — those columns are real FKs. */
async function someStaffId(d) {
  const rows = await peopleSvc.listStaff(d);
  return rows[0].id;
}

const taskInput = (classId, date, title, proofType = 'none') => ({
  classId,
  date,
  title,
  materialId: null,
  url: null,
  proofType,
  studentId: null,
});

describe('practice — tasks fan out to the roster', () => {
  it('creates one copy per enrolled student and edits propagate to open copies only', async () => {
    const d = db();
    const { a, cls } = await fixture(d);
    const task = await practiceSvc.createTask(
      d,
      taskInput(cls.id, '2031-03-03', 'Workbook p.4', 'photo'),
      null,
    );
    const copies = await practiceSvc.listStudentTasks(d, cls.id, '2031-03-03', '2031-03-03');
    expect(copies).toHaveLength(2);
    const mine = copies.find((c) => c.studentId === a.id);
    await practiceSvc.submit(
      d,
      a.id,
      { studentTaskId: mine.id, timeFrom: '20:00', timeTo: '20:30', note: null },
      { key: 'k', type: 'image/jpeg' },
      '2031-03-03',
    );
    await practiceSvc.updateTask(d, task.id, { title: 'Workbook p.4-7' });
    const after = await practiceSvc.listStudentTasks(d, cls.id, '2031-03-03', '2031-03-03');
    expect(after.find((c) => c.studentId === a.id).title).toBe('Workbook p.4'); // submitted: frozen
    expect(after.find((c) => c.studentId !== a.id).title).toBe('Workbook p.4-7'); // open: followed
  });

  it('deleting a class task keeps a submitted copy and drops the open one', async () => {
    const d = db();
    const { a, cls } = await fixture(d);
    const task = await practiceSvc.createTask(d, taskInput(cls.id, '2031-03-04', 'T'), null);
    const copies = await practiceSvc.listStudentTasks(d, cls.id, '2031-03-04', '2031-03-04');
    const mine = copies.find((c) => c.studentId === a.id);
    await practiceSvc.submit(
      d,
      a.id,
      { studentTaskId: mine.id, timeFrom: null, timeTo: null, note: null },
      null,
      '2031-03-04',
    );
    await practiceSvc.deleteTask(d, task.id);
    const after = await practiceSvc.listStudentTasks(d, cls.id, '2031-03-04', '2031-03-04');
    expect(after).toHaveLength(1);
    expect(after[0].studentId).toBe(a.id);
    expect(after[0].taskId).toBe(null); // FK SET NULL kept the submission
  });
});

describe('practice — finalize', () => {
  it('records a miss for the incomplete student, ×2 on the next practice day, and a behavior row', async () => {
    const d = db();
    const { a, b, cls } = await fixture(d);
    await practiceSvc.createTask(d, taskInput(cls.id, '2031-03-03', 'T1'), null);
    const copies = await practiceSvc.listStudentTasks(d, cls.id, '2031-03-03', '2031-03-03');
    await practiceSvc.submit(
      d,
      a.id,
      {
        studentTaskId: copies.find((c) => c.studentId === a.id).id,
        timeFrom: null,
        timeTo: null,
        note: null,
      },
      null,
      '2031-03-03',
    );
    const outcomes = await practiceSvc.finalizeDay(d, cls.id, '2031-03-03');
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      studentId: b.id,
      excused: false,
      multiplier: 2,
      nextDay: '2031-03-04',
    });
    const w = await practiceSvc.getWarning(d, cls.id, b.id);
    expect(w).toMatchObject({ level: 1, pendingMultiplier: 2, pendingForDate: '2031-03-04' });
    const beh = (await assessSvc.listBehavior(d)).filter(
      (r) => r.studentId === b.id && r.type === 'missing_practice',
    );
    expect(beh).toHaveLength(1);
    // Idempotent
    expect(await practiceSvc.finalizeDay(d, cls.id, '2031-03-03')).toEqual([]);
  });

  it('an approved excuse makes the miss excused with no behavior row; excusing after the fact undoes ×N', async () => {
    const d = db();
    const { a, b, cls } = await fixture(d);
    const staffId = await someStaffId(d);
    await practiceSvc.createTask(d, taskInput(cls.id, '2031-03-05', 'T'), null);
    const ex = await practiceSvc.requestExcuse(
      d,
      a.id,
      { classId: cls.id, date: '2031-03-05', reason: 'Sick' },
      '2031-03-05',
    );
    await practiceSvc.decideExcuse(d, { excuseId: ex.id, decision: 'approve' }, staffId);
    const out = await practiceSvc.finalizeDay(d, cls.id, '2031-03-05');
    const forA = out.find((o) => o.studentId === a.id);
    const forB = out.find((o) => o.studentId === b.id);
    expect(forA).toMatchObject({ excused: true, multiplier: 0 });
    expect(forB).toMatchObject({ excused: false, multiplier: 2 });
    await practiceSvc.excuseMiss(d, { missId: forB.missId, reason: 'Family' }, staffId);
    expect(await practiceSvc.getWarning(d, cls.id, b.id)).toMatchObject({
      level: 0,
      pendingMultiplier: 0,
    });
    expect(
      (await assessSvc.listBehavior(d)).filter(
        (r) => r.studentId === b.id && r.type === 'missing_practice',
      ),
    ).toHaveLength(0);
  });

  it('a ×N debt due on a day off or an empty day moves to the next practice day instead of sticking', async () => {
    const d = db();
    const { b, cls } = await fixture(d);
    // Miss on Mon 03 → ×2 due Tue 04.
    await practiceSvc.createTask(d, taskInput(cls.id, '2031-03-03', 'T'), null);
    await practiceSvc.finalizeDay(d, cls.id, '2031-03-03');
    expect(await practiceSvc.getWarning(d, cls.id, b.id)).toMatchObject({
      pendingMultiplier: 2,
      pendingForDate: '2031-03-04',
    });
    // Tue 04 becomes a day off: finalizing it must carry the debt to Wed 05, not leave it on the 4th.
    await practiceSvc.setOverride(d, { classId: cls.id, date: '2031-03-04', isPractice: false });
    expect(await practiceSvc.finalizeDay(d, cls.id, '2031-03-04')).toEqual([]);
    expect(await practiceSvc.getWarning(d, cls.id, b.id)).toMatchObject({
      pendingMultiplier: 2,
      pendingForDate: '2031-03-05',
    });
    // Wed 05 is a practice day with no tasks at all: same shift, to Thu 06.
    expect(await practiceSvc.finalizeDay(d, cls.id, '2031-03-05')).toEqual([]);
    expect(await practiceSvc.getWarning(d, cls.id, b.id)).toMatchObject({
      pendingForDate: '2031-03-06',
    });
  });

  it('a second excuse request for the same day is refused while one is pending or approved', async () => {
    const d = db();
    const { a, cls } = await fixture(d);
    const staffId = await someStaffId(d);
    await practiceSvc.requestExcuse(
      d,
      a.id,
      { classId: cls.id, date: '2031-03-08', reason: 'Sick' },
      '2031-03-08',
    );
    await expect(
      practiceSvc.requestExcuse(
        d,
        a.id,
        { classId: cls.id, date: '2031-03-08', reason: 'Again' },
        '2031-03-08',
      ),
    ).rejects.toThrow('already_requested');
    // A rejected one may be replaced.
    const [pending] = await practiceSvc.listExcuses(d, {
      classId: cls.id,
      studentId: a.id,
      status: 'pending',
    });
    await practiceSvc.decideExcuse(d, { excuseId: pending.id, decision: 'reject' }, staffId);
    const again = await practiceSvc.requestExcuse(
      d,
      a.id,
      { classId: cls.id, date: '2031-03-08', reason: 'Really sick' },
      '2031-03-08',
    );
    expect(again.status).toBe('pending');
  });

  it('the cron runner finalizes yesterday ICT for every enabled class', async () => {
    const d = db();
    const { cls } = await fixture(d);
    await practiceSvc.createTask(d, taskInput(cls.id, '2031-03-10', 'T'), null);
    // 2031-03-11 00:30 ICT = 2031-03-10T17:30:00Z → yesterday ICT is 2031-03-10
    await runPracticeFinalize(d, new Date('2031-03-10T17:30:00Z'));
    const misses = await practiceSvc.listMisses(d, { classId: cls.id });
    expect(misses.map((m) => m.date)).toEqual(['2031-03-10', '2031-03-10']);
  });
});
