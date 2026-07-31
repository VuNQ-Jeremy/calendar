import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { createDb } from '../server/db/index';
import * as classesSvc from '../server/services/classes';
import * as homeworkSvc from '../server/services/homework';
import * as eventsSvc from '../server/services/events';
import * as materialsSvc from '../server/services/materials';
import * as themeSvc from '../server/services/theme';
import * as feedbackSvc from '../server/services/feedback';
import * as authSvc from '../server/services/auth';
import * as peopleSvc from '../server/services/people';
import * as invitesSvc from '../server/services/invites';
import * as assessSvc from '../server/services/assessments';
import * as typesSvc from '../server/services/assessment-types';
import * as attendanceSvc from '../server/services/attendance';
import * as gradeLevelsSvc from '../server/services/grade-levels';
import * as questionsSvc from '../server/services/questions';
import * as testsSvc from '../server/services/tests';
import * as attemptsSvc from '../server/services/attempts';
import { ictDateOf, normalizeScore } from '../shared/logic/tests';
import { hashPassword } from '../server/services/crypto';
import { sessionCookie } from '../server/session';
import {
  accounts,
  classes,
  classSchedule,
  classStudents,
  parentStudents,
  events,
  homework,
  homeworkGrades,
  materials,
  sessions,
  scoreRecords,
  behaviorRecords,
  attendanceRecords,
  questions as questionsTable,
  tests as testsTable,
  testQuestions,
  testAttempts,
} from '../server/db/schema';

function db() {
  return createDb(env);
}

describe('classes service', () => {
  it('creates and lists a class', async () => {
    const cls = await classesSvc.create(db(), {
      name: 'Math 101',
      color: 'blue',
      schedule: [],
      studentIds: [],
    });
    expect(cls.id).toBeTruthy();
    expect(cls.name).toBe('Math 101');

    const list = await classesSvc.list(db());
    expect(list.some((c) => c.id === cls.id)).toBe(true);
  });

  it('updates a class', async () => {
    const cls = await classesSvc.create(db(), {
      name: 'Science',
      color: 'green',
      schedule: [],
      studentIds: [],
    });
    await classesSvc.update(db(), cls.id, { name: 'Science II' });
    const list = await classesSvc.list(db());
    const updated = list.find((c) => c.id === cls.id);
    expect(updated?.name).toBe('Science II');
  });

  it('removes a class', async () => {
    const cls = await classesSvc.create(db(), {
      name: 'Temp',
      color: 'orange',
      schedule: [],
      studentIds: [],
    });
    await classesSvc.remove(db(), cls.id);
    const list = await classesSvc.list(db());
    expect(list.some((c) => c.id === cls.id)).toBe(false);
  });
});

describe('homework service', () => {
  it('creates and lists homework', async () => {
    const hw = await homeworkSvc.create(db(), { title: 'Chapter 1', done: false });
    expect(hw.id).toBeTruthy();
    expect(hw.title).toBe('Chapter 1');

    const list = await homeworkSvc.list(db());
    expect(list.some((h) => h.id === hw.id)).toBe(true);
  });

  it('marks homework done', async () => {
    const hw = await homeworkSvc.create(db(), { title: 'Essay', done: false });
    await homeworkSvc.update(db(), hw.id, { done: true });
    const list = await homeworkSvc.list(db());
    const updated = list.find((h) => h.id === hw.id);
    expect(updated?.done).toBe(true);
  });
});

describe('theme service', () => {
  it('returns default theme when no settings', async () => {
    const theme = await themeSvc.getTheme(db());
    expect(theme.bg).toBe('#FFFCF8');
    expect(theme.bgOpacity).toBe(0.12);
  });

  it('persists theme patch', async () => {
    await themeSvc.setTheme(db(), { bg: '#123456' });
    const theme = await themeSvc.getTheme(db());
    expect(theme.bg).toBe('#123456');
  });
});

describe('feedback service', () => {
  it('creates and counts new feedback', async () => {
    await feedbackSvc.create(db(), { message: 'Great app!', category: 'praise', status: 'new' });
    const count = await feedbackSvc.countUnresolved(db());
    expect(count).toBeGreaterThanOrEqual(1);
  });

  // The sidebar badge counts this, so resolving a *reviewed* item has to move it too.
  it('counts reviewed as unresolved and drops resolved', async () => {
    const before = await feedbackSvc.countUnresolved(db());
    await feedbackSvc.create(db(), { message: 'a', category: 'idea', status: 'new' });
    await feedbackSvc.create(db(), { message: 'b', category: 'bug', status: 'reviewed' });
    const third = await feedbackSvc.create(db(), {
      message: 'c',
      category: 'other',
      status: 'new',
    });
    expect(await feedbackSvc.countUnresolved(db())).toBe(before + 3);

    await feedbackSvc.update(db(), third.id, { status: 'done' });
    expect(await feedbackSvc.countUnresolved(db())).toBe(before + 2);
  });
});

// ---- Auth integration tests ----

async function seedStaffAccount(db, { email, password, name = 'Test User' } = {}) {
  const staffRow = await peopleSvc.createStaff(db, {
    name,
    email,
    role: 'Teacher',
    color: 'orange',
  });
  const passwordHash = await hashPassword(password);
  const accountId = crypto.randomUUID();
  await db.insert(accounts).values({
    id: accountId,
    email: email.toLowerCase(),
    passwordHash,
    staffId: staffRow.id,
    createdAt: new Date().toISOString(),
  });
  return { accountId, staffId: staffRow.id };
}

describe('auth service — login', () => {
  it('returns null for bad credentials', async () => {
    const d = db();
    await seedStaffAccount(d, { email: 'bad@test.com', password: 'correct-pw' });
    const result = await authSvc.login(d, 'bad@test.com', 'wrong-pw');
    expect(result).toBeNull();
  });

  it('returns accountId for correct credentials', async () => {
    const d = db();
    const { accountId } = await seedStaffAccount(d, {
      email: 'good@test.com',
      password: 'good-pw',
    });
    const result = await authSvc.login(d, 'good@test.com', 'good-pw');
    expect(result).not.toBeNull();
    expect(result.accountId).toBe(accountId);
  });

  it('is case-insensitive for email', async () => {
    const d = db();
    await seedStaffAccount(d, { email: 'mixed@test.com', password: 'pw' });
    const result = await authSvc.login(d, 'MIXED@TEST.COM', 'pw');
    expect(result).not.toBeNull();
  });

  it('returns null for unknown email (no enumeration)', async () => {
    const result = await authSvc.login(db(), 'nobody@test.com', 'anything');
    expect(result).toBeNull();
  });
});

describe('auth service — session lifecycle', () => {
  it('createSession returns a raw token; getUser resolves it', async () => {
    const d = db();
    const { accountId } = await seedStaffAccount(d, {
      email: 'session@test.com',
      password: 'pw',
    });
    const token = await authSvc.createSession(d, accountId, true);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(20);

    const cookieHeader = await sessionCookie.serialize(token, { maxAge: 86400 });
    const req = new Request('http://localhost/dashboard', {
      headers: { Cookie: cookieHeader },
    });
    const user = await authSvc.getUser(req, env);
    expect(user).not.toBeNull();
    expect(user.account.id).toBe(accountId);
    expect(user.user.name).toBe('Test User');
  });

  it('getUser returns null for missing cookie', async () => {
    const req = new Request('http://localhost/dashboard');
    const user = await authSvc.getUser(req, env);
    expect(user).toBeNull();
  });

  it('logout deletes the session; old cookie stops working', async () => {
    const d = db();
    const { accountId } = await seedStaffAccount(d, {
      email: 'logout@test.com',
      password: 'pw',
    });
    const token = await authSvc.createSession(d, accountId, true);
    const cookieHeader = await sessionCookie.serialize(token, { maxAge: 86400 });

    const logoutReq = new Request('http://localhost/logout', {
      headers: { Cookie: cookieHeader },
    });
    await authSvc.logout(d, logoutReq);

    const checkReq = new Request('http://localhost/dashboard', {
      headers: { Cookie: cookieHeader },
    });
    const user = await authSvc.getUser(checkReq, env);
    expect(user).toBeNull();
  });
});

describe('auth service — invite redemption', () => {
  it('creates account and marks invite used; second redemption fails', async () => {
    const d = db();
    const invite = await invitesSvc.create(d, {
      code: 'TST001',
      role: 'Staff',
      used: false,
    });

    const result = await authSvc.redeemInvite(d, 'TST001', {
      name: 'New Teacher',
      email: 'newteacher@test.com',
      password: 'pw123',
    });
    expect(result).not.toBeNull();

    // Second redemption with same code should fail
    const result2 = await authSvc.redeemInvite(d, 'TST001', {
      name: 'Another',
      email: 'another@test.com',
      password: 'pw456',
    });
    expect(result2).toBeNull();
  });

  it('fails for unknown invite code', async () => {
    const result = await authSvc.redeemInvite(db(), 'XXXXXX', {
      name: 'Ghost',
      email: 'ghost@test.com',
      password: 'pw',
    });
    expect(result).toBeNull();
  });
});

describe('auth service — password reset', () => {
  it('resetPassword updates hash and invalidates old sessions', async () => {
    const d = db();
    const { accountId } = await seedStaffAccount(d, {
      email: 'reset@test.com',
      password: 'old-pw',
    });

    // Create a session so we can verify it gets wiped
    const token = await authSvc.createSession(d, accountId, true);

    // Request reset
    const { devUrl } = await authSvc.requestReset(d, 'reset@test.com');
    expect(typeof devUrl).toBe('string');
    const resetToken = new URL('http://localhost' + devUrl).searchParams.get('token');
    expect(resetToken).toBeTruthy();

    // Perform reset
    const ok = await authSvc.resetPassword(d, resetToken, 'new-pw');
    expect(ok).toBe(true);

    // Old session no longer works
    const cookieHeader = await sessionCookie.serialize(token, { maxAge: 86400 });
    const req = new Request('http://localhost/dashboard', { headers: { Cookie: cookieHeader } });
    expect(await authSvc.getUser(req, env)).toBeNull();

    // New password works
    const loginResult = await authSvc.login(d, 'reset@test.com', 'new-pw');
    expect(loginResult).not.toBeNull();

    // Old password rejected
    expect(await authSvc.login(d, 'reset@test.com', 'old-pw')).toBeNull();
  });

  it('resetPassword returns false for invalid token', async () => {
    const ok = await authSvc.resetPassword(db(), 'bogus-token', 'new-pw');
    expect(ok).toBe(false);
  });
});

// ---- Task 1: batch atomicity ----

describe('db.batch atomicity', () => {
  it('batch rolls back entirely when a statement fails', async () => {
    const d = db();
    const classId = crypto.randomUUID();

    let threw = false;
    try {
      await d.batch([
        d.insert(classes).values({ id: classId, name: 'Rollback Test', color: 'blue' }),
        // FK violation: student_id references a nonexistent student
        d.insert(classStudents).values({ classId, studentId: 'nonexistent-student-id' }),
      ]);
    } catch {
      threw = true;
    }

    expect(threw).toBe(true);
    // The class row must not exist — the whole batch was rolled back
    const list = await classesSvc.list(d);
    expect(list.some((c) => c.id === classId)).toBe(false);
  });
});

// ---- Task 2: FK cascade verification ----

describe('FK cascade — delete class', () => {
  it('cascades class_schedule rows', async () => {
    const d = db();
    const cls = await classesSvc.create(d, {
      name: 'Cascade Test',
      color: 'blue',
      schedule: [{ day: 1, start: '09:00', end: '10:00' }],
      studentIds: [],
    });

    const schedBefore = await d
      .select()
      .from(classSchedule)
      .where(eq(classSchedule.classId, cls.id));
    expect(schedBefore.length).toBe(1);

    await classesSvc.remove(d, cls.id);

    const schedAfter = await d
      .select()
      .from(classSchedule)
      .where(eq(classSchedule.classId, cls.id));
    expect(schedAfter.length).toBe(0);
  });

  it('cascades class_students rows', async () => {
    const d = db();
    const student = await peopleSvc.createStudent(d, {
      name: 'Cascade Student',
      color: 'blue',
      classIds: [],
    });
    const cls = await classesSvc.create(d, {
      name: 'Cascade Test 2',
      color: 'green',
      schedule: [],
      studentIds: [student.id],
    });

    const linkBefore = await d
      .select()
      .from(classStudents)
      .where(eq(classStudents.classId, cls.id));
    expect(linkBefore.length).toBe(1);

    await classesSvc.remove(d, cls.id);

    const linkAfter = await d.select().from(classStudents).where(eq(classStudents.classId, cls.id));
    expect(linkAfter.length).toBe(0);
  });

  it('sets events.class_id to NULL (SET NULL)', async () => {
    const d = db();
    const cls = await classesSvc.create(d, {
      name: 'Event Class',
      color: 'violet',
      schedule: [],
      studentIds: [],
    });
    const ev = await eventsSvc.create(d, {
      title: 'Test Event',
      date: '2024-01-15',
      classId: cls.id,
      recurrence: 'none',
    });

    await classesSvc.remove(d, cls.id);

    const evRows = await d.select().from(events).where(eq(events.id, ev.id));
    expect(evRows[0]?.classId).toBeNull();
  });

  it('sets homework.class_id to NULL (SET NULL)', async () => {
    const d = db();
    const cls = await classesSvc.create(d, {
      name: 'HW Class',
      color: 'orange',
      schedule: [],
      studentIds: [],
    });
    const hw = await homeworkSvc.create(d, { title: 'HW Item', classId: cls.id, done: false });

    await classesSvc.remove(d, cls.id);

    const hwRows = await d.select().from(homework).where(eq(homework.id, hw.id));
    expect(hwRows[0]?.classId).toBeNull();
  });

  it('sets materials.class_id to NULL (SET NULL)', async () => {
    const d = db();
    const cls = await classesSvc.create(d, {
      name: 'Mat Class',
      color: 'rose',
      schedule: [],
      studentIds: [],
    });
    const mat = await materialsSvc.create(d, {
      title: 'Mat Item',
      type: 'notes',
      classId: cls.id,
      favorite: false,
    });

    await classesSvc.remove(d, cls.id);

    const matRows = await d.select().from(materials).where(eq(materials.id, mat.id));
    expect(matRows[0]?.classId).toBeNull();
  });
});

describe('FK cascade — delete student', () => {
  it('cascades class_students and parent_students rows', async () => {
    const d = db();
    const cls = await classesSvc.create(d, {
      name: 'FK Class',
      color: 'blue',
      schedule: [],
      studentIds: [],
    });
    const student = await peopleSvc.createStudent(d, {
      name: 'FK Student',
      color: 'blue',
      classIds: [cls.id],
    });
    const parent = await peopleSvc.createParent(d, {
      name: 'FK Parent',
      color: 'green',
      studentIds: [student.id],
    });

    const csBefore = await d
      .select()
      .from(classStudents)
      .where(eq(classStudents.studentId, student.id));
    const psBefore = await d
      .select()
      .from(parentStudents)
      .where(eq(parentStudents.studentId, student.id));
    expect(csBefore.length).toBe(1);
    expect(psBefore.length).toBe(1);

    await peopleSvc.removeStudent(d, student.id);

    const csAfter = await d
      .select()
      .from(classStudents)
      .where(eq(classStudents.studentId, student.id));
    const psAfter = await d
      .select()
      .from(parentStudents)
      .where(eq(parentStudents.studentId, student.id));
    expect(csAfter.length).toBe(0);
    expect(psAfter.length).toBe(0);

    // Parent should still exist
    const parentList = await peopleSvc.listParents(d);
    expect(parentList.some((p) => p.id === parent.id)).toBe(true);
  });
});

describe('FK cascade — delete account', () => {
  it('cascades sessions on account delete', async () => {
    const d = db();
    const staffRow = await peopleSvc.createStaff(d, {
      name: 'Sess Test',
      email: 'sess@test.com',
      role: 'Teacher',
      color: 'orange',
    });
    const passwordHash = await hashPassword('pw');
    const accountId = crypto.randomUUID();
    await d.insert(accounts).values({
      id: accountId,
      email: 'sess@test.com',
      passwordHash,
      staffId: staffRow.id,
      createdAt: new Date().toISOString(),
    });

    await authSvc.createSession(d, accountId, true);
    const sessBefore = await d.select().from(sessions).where(eq(sessions.accountId, accountId));
    expect(sessBefore.length).toBe(1);

    await d.delete(accounts).where(eq(accounts.id, accountId));

    const sessAfter = await d.select().from(sessions).where(eq(sessions.accountId, accountId));
    expect(sessAfter.length).toBe(0);
  });
});

describe('assessments service', () => {
  it('creates, lists, updates, and removes a score record', async () => {
    const d = db();
    const student = await peopleSvc.createStudent(d, {
      name: 'Score Student',
      color: 'blue',
      classIds: [],
    });
    const rec = await assessSvc.createScore(d, {
      studentId: student.id,
      date: '2026-05-01',
      score: 7.5,
      assessmentTypeId: 'at2',
    });
    expect(rec.id).toBeTruthy();
    expect(rec.score).toBe(7.5);
    expect(rec.assessmentTypeId).toBe('at2');

    const list = await assessSvc.listScores(d);
    expect(list.some((r) => r.id === rec.id)).toBe(true);

    const updated = await assessSvc.updateScore(d, rec.id, { score: 9 });
    expect(updated.score).toBe(9);

    await assessSvc.removeScore(d, rec.id);
    const after = await assessSvc.listScores(d);
    expect(after.some((r) => r.id === rec.id)).toBe(false);
  });

  it('creates, lists, updates, and removes a behavior record', async () => {
    const d = db();
    const student = await peopleSvc.createStudent(d, {
      name: 'Behavior Student',
      color: 'green',
      classIds: [],
    });
    const rec = await assessSvc.createBehavior(d, {
      studentId: student.id,
      date: '2026-05-02',
      type: 'late',
    });
    expect(rec.id).toBeTruthy();
    expect(rec.type).toBe('late');

    const list = await assessSvc.listBehavior(d);
    expect(list.some((r) => r.id === rec.id)).toBe(true);

    const updated = await assessSvc.updateBehavior(d, rec.id, { type: 'absent' });
    expect(updated.type).toBe('absent');

    await assessSvc.removeBehavior(d, rec.id);
    const after = await assessSvc.listBehavior(d);
    expect(after.some((r) => r.id === rec.id)).toBe(false);
  });

  it('cascades score and behavior records on student delete', async () => {
    const d = db();
    const student = await peopleSvc.createStudent(d, {
      name: 'Cascade Assess Student',
      color: 'orange',
      classIds: [],
    });
    const score = await assessSvc.createScore(d, {
      studentId: student.id,
      date: '2026-05-03',
      score: 8,
    });
    const beh = await assessSvc.createBehavior(d, {
      studentId: student.id,
      date: '2026-05-03',
      type: 'missing_homework',
    });

    await peopleSvc.removeStudent(d, student.id);

    const scoreAfter = await d.select().from(scoreRecords).where(eq(scoreRecords.id, score.id));
    const behAfter = await d.select().from(behaviorRecords).where(eq(behaviorRecords.id, beh.id));
    expect(scoreAfter.length).toBe(0);
    expect(behAfter.length).toBe(0);
  });

  it('sets class_id to NULL on class delete for both record types', async () => {
    const d = db();
    const student = await peopleSvc.createStudent(d, {
      name: 'Assess Class Student',
      color: 'violet',
      classIds: [],
    });
    const cls = await classesSvc.create(d, {
      name: 'Assess Class',
      color: 'blue',
      schedule: [],
      studentIds: [],
    });
    const score = await assessSvc.createScore(d, {
      studentId: student.id,
      classId: cls.id,
      date: '2026-05-04',
      score: 6,
    });
    const beh = await assessSvc.createBehavior(d, {
      studentId: student.id,
      classId: cls.id,
      date: '2026-05-04',
      type: 'late',
    });

    await classesSvc.remove(d, cls.id);

    const scoreAfter = await d.select().from(scoreRecords).where(eq(scoreRecords.id, score.id));
    const behAfter = await d.select().from(behaviorRecords).where(eq(behaviorRecords.id, beh.id));
    expect(scoreAfter[0]?.classId).toBeNull();
    expect(behAfter[0]?.classId).toBeNull();
  });
});

describe('assessment types service', () => {
  it('creates, lists, renames, and deactivates a type', async () => {
    const d = db();
    const created = await typesSvc.create(d, { name: 'Pop quiz', active: true });
    expect(created.id).toBeTruthy();
    expect(created.sortOrder).toBeGreaterThan(0);

    const list = await typesSvc.list(d);
    expect(list.some((t) => t.id === created.id)).toBe(true);

    const renamed = await typesSvc.update(d, created.id, { name: 'Pop quiz v2' });
    expect(renamed.name).toBe('Pop quiz v2');

    const deactivated = await typesSvc.update(d, created.id, { active: false });
    expect(deactivated.active).toBe(false);
  });

  it('rejects a duplicate name', async () => {
    const d = db();
    await typesSvc.create(d, { name: 'Unique Type A', active: true });
    await expect(typesSvc.create(d, { name: 'Unique Type A', active: true })).rejects.toBeTruthy();
  });
});

describe('attendance service', () => {
  it('saves and lists attendance for an occurrence, and dates stay independent', async () => {
    const d = db();
    const student1 = await peopleSvc.createStudent(d, {
      name: 'Attendance Student 1',
      color: 'blue',
      classIds: [],
    });
    const student2 = await peopleSvc.createStudent(d, {
      name: 'Attendance Student 2',
      color: 'green',
      classIds: [],
    });
    const ev = await eventsSvc.create(d, {
      title: 'Attendance Event',
      date: '2026-06-22',
      recurrence: 'weekly',
    });

    await attendanceSvc.saveOccurrence(d, ev.id, '2026-06-22', [
      { studentId: student1.id, status: 'present' },
      { studentId: student2.id, status: 'late' },
    ]);
    const day1 = await attendanceSvc.listForOccurrence(d, ev.id, '2026-06-22');
    expect(day1.length).toBe(2);

    // Re-saving with one record overwrites (unmarked student disappears).
    await attendanceSvc.saveOccurrence(d, ev.id, '2026-06-22', [
      { studentId: student1.id, status: 'absent' },
    ]);
    const day1After = await attendanceSvc.listForOccurrence(d, ev.id, '2026-06-22');
    expect(day1After.length).toBe(1);
    expect(day1After[0].status).toBe('absent');

    // A different occurrence date for the same event is independent.
    const day2 = await attendanceSvc.listForOccurrence(d, ev.id, '2026-06-29');
    expect(day2.length).toBe(0);

    await eventsSvc.remove(d, ev.id);
    const afterEventDelete = await d
      .select()
      .from(attendanceRecords)
      .where(eq(attendanceRecords.eventId, ev.id));
    expect(afterEventDelete.length).toBe(0);
  });

  it('cascades attendance rows on student delete', async () => {
    const d = db();
    const student = await peopleSvc.createStudent(d, {
      name: 'Attendance Cascade Student',
      color: 'orange',
      classIds: [],
    });
    const ev = await eventsSvc.create(d, {
      title: 'Attendance Cascade Event',
      date: '2026-06-22',
      recurrence: 'none',
    });
    await attendanceSvc.saveOccurrence(d, ev.id, '2026-06-22', [
      { studentId: student.id, status: 'present' },
    ]);
    await peopleSvc.removeStudent(d, student.id);
    const rows = await d
      .select()
      .from(attendanceRecords)
      .where(eq(attendanceRecords.studentId, student.id));
    expect(rows.length).toBe(0);
  });
});

describe('homework grading sync', () => {
  async function setup(d) {
    const cls = await classesSvc.create(d, {
      name: 'Grading Class',
      color: 'blue',
      schedule: [],
      studentIds: [],
    });
    const student = await peopleSvc.createStudent(d, {
      name: 'Grading Student',
      color: 'blue',
      classIds: [],
    });
    const hw = await homeworkSvc.create(d, {
      title: 'Graded Homework',
      classId: cls.id,
      due: '2026-06-23',
      done: false,
      assessmentTypeId: 'at2',
    });
    return { cls, student, hw };
  }

  it('grading creates a linked score record, and re-grading updates it without duplicating', async () => {
    const d = db();
    const { student, hw, cls } = await setup(d);

    const grades = await homeworkSvc.saveGrades(d, hw.id, [
      { studentId: student.id, score: 8, comment: 'Nice work' },
    ]);
    const grade = grades.find((g) => g.studentId === student.id);
    expect(grade.scoreRecordId).toBeTruthy();

    const scoreRows = await d
      .select()
      .from(scoreRecords)
      .where(eq(scoreRecords.id, grade.scoreRecordId));
    expect(scoreRows[0].score).toBe(8);
    expect(scoreRows[0].date).toBe('2026-06-23');
    expect(scoreRows[0].classId).toBe(cls.id);
    expect(scoreRows[0].assessmentTypeId).toBe('at2');
    expect(scoreRows[0].notes).toBe('Nice work');

    const regraded = await homeworkSvc.saveGrades(d, hw.id, [
      { studentId: student.id, score: 9, comment: 'Even better' },
    ]);
    const regrade = regraded.find((g) => g.studentId === student.id);
    expect(regrade.scoreRecordId).toBe(grade.scoreRecordId);

    const allScores = await assessSvc.listScores(d);
    const linkedScores = allScores.filter((s) => s.id === grade.scoreRecordId);
    expect(linkedScores.length).toBe(1);
    expect(linkedScores[0].score).toBe(9);
  });

  it('clearing score and comment removes the grade and its score record', async () => {
    const d = db();
    const { student, hw } = await setup(d);
    const grades = await homeworkSvc.saveGrades(d, hw.id, [
      { studentId: student.id, score: 7, comment: 'ok' },
    ]);
    const scoreRecordId = grades[0].scoreRecordId;

    const cleared = await homeworkSvc.saveGrades(d, hw.id, [
      { studentId: student.id, score: null, comment: null },
    ]);
    expect(cleared.find((g) => g.studentId === student.id)).toBeUndefined();

    const scoreAfter = await d
      .select()
      .from(scoreRecords)
      .where(eq(scoreRecords.id, scoreRecordId));
    expect(scoreAfter.length).toBe(0);
  });

  it('comment-only grade has no linked score record', async () => {
    const d = db();
    const { student, hw } = await setup(d);
    const grades = await homeworkSvc.saveGrades(d, hw.id, [
      { studentId: student.id, score: null, comment: 'Missing submission' },
    ]);
    const grade = grades.find((g) => g.studentId === student.id);
    expect(grade.scoreRecordId).toBeNull();
    expect(grade.comment).toBe('Missing submission');
  });

  it('updating homework due date propagates to linked score records', async () => {
    const d = db();
    const { student, hw } = await setup(d);
    const grades = await homeworkSvc.saveGrades(d, hw.id, [
      { studentId: student.id, score: 6, comment: null },
    ]);
    const scoreRecordId = grades[0].scoreRecordId;

    await homeworkSvc.update(d, hw.id, { due: '2026-07-01' });

    const scoreAfter = await d
      .select()
      .from(scoreRecords)
      .where(eq(scoreRecords.id, scoreRecordId));
    expect(scoreAfter[0].date).toBe('2026-07-01');
  });

  it('deleting homework deletes linked score records', async () => {
    const d = db();
    const { student, hw } = await setup(d);
    const grades = await homeworkSvc.saveGrades(d, hw.id, [
      { studentId: student.id, score: 5, comment: null },
    ]);
    const scoreRecordId = grades[0].scoreRecordId;

    await homeworkSvc.remove(d, hw.id);

    const scoreAfter = await d
      .select()
      .from(scoreRecords)
      .where(eq(scoreRecords.id, scoreRecordId));
    expect(scoreAfter.length).toBe(0);
    const gradesAfter = await d
      .select()
      .from(homeworkGrades)
      .where(eq(homeworkGrades.homeworkId, hw.id));
    expect(gradesAfter.length).toBe(0);
  });

  it('removing the linked score record from the Assessments side unlinks the grade', async () => {
    const d = db();
    const { student, hw } = await setup(d);
    const grades = await homeworkSvc.saveGrades(d, hw.id, [
      { studentId: student.id, score: 6.5, comment: null },
    ]);
    const scoreRecordId = grades[0].scoreRecordId;

    await assessSvc.removeScore(d, scoreRecordId);

    const gradesAfter = await d
      .select()
      .from(homeworkGrades)
      .where(eq(homeworkGrades.homeworkId, hw.id));
    expect(gradesAfter[0].scoreRecordId).toBeNull();
  });
});

// ---- Task 3: R2 materials ----

describe('materials service — R2 file storage', () => {
  it('create with file stores object in R2 and sets file_key on row', async () => {
    const d = db();
    const content = new Uint8Array([1, 2, 3, 4, 5]);
    const file = new File([content], 'test.pdf', { type: 'application/pdf' });

    const mat = await materialsSvc.create(
      d,
      { title: 'R2 Test', type: 'notes', favorite: false },
      file,
      env.FILES,
    );

    expect(mat.fileKey).toBeTruthy();
    expect(mat.fileName).toBe('test.pdf');

    const obj = await env.FILES.get(mat.fileKey);
    expect(obj).not.toBeNull();
    const bytes = new Uint8Array(await obj.arrayBuffer());
    expect(bytes).toEqual(content);
  });

  it('download route returns correct bytes and headers', async () => {
    const d = db();
    const content = new Uint8Array([10, 20, 30]);
    const file = new File([content], 'report.pdf', { type: 'application/pdf' });

    const mat = await materialsSvc.create(
      d,
      { title: 'Download Test', type: 'notes', favorite: false },
      file,
      env.FILES,
    );

    const obj = await env.FILES.get(mat.fileKey);
    expect(obj).not.toBeNull();
    expect(obj.httpMetadata?.contentType).toBe('application/pdf');

    const bytes = new Uint8Array(await obj.arrayBuffer());
    expect(bytes).toEqual(content);
    expect(mat.fileName).toBe('report.pdf');
  });

  it('delete removes the R2 object', async () => {
    const d = db();
    const file = new File(['hello'], 'del.txt', { type: 'text/plain' });
    const mat = await materialsSvc.create(
      d,
      { title: 'To Delete', type: 'notes', favorite: false },
      file,
      env.FILES,
    );

    expect(await env.FILES.get(mat.fileKey)).not.toBeNull();

    await materialsSvc.remove(d, mat.id, env.FILES);

    expect(await env.FILES.get(mat.fileKey)).toBeNull();
  });

  it('create without file sets fileKey to null', async () => {
    const d = db();
    const mat = await materialsSvc.create(d, {
      title: 'No File',
      type: 'link',
      url: 'https://example.com',
      favorite: false,
    });
    expect(mat.fileKey).toBeNull();
  });
});

// ---- WP1.5: Tests module Phase 1 services ----

describe('grade levels', () => {
  it('create then list — new level appears after the seeded Khối 6..9', async () => {
    const d = db();
    const created = await gradeLevelsSvc.create(d, { name: 'Khối 10', active: true });
    expect(created.id).toBeTruthy();

    const list = await gradeLevelsSvc.list(d);
    // Migration 0017 seeds gl6..gl9 with sortOrder 1..4, so they lead the list.
    expect(list.slice(0, 4).map((g) => g.id)).toEqual(['gl6', 'gl7', 'gl8', 'gl9']);
    expect(list.slice(0, 4).map((g) => g.name)).toEqual(['Khối 6', 'Khối 7', 'Khối 8', 'Khối 9']);
    expect(list.some((g) => g.id === created.id)).toBe(true);

    // Ordering is sortOrder asc, then name asc.
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const cur = list[i];
      expect(
        prev.sortOrder < cur.sortOrder ||
          (prev.sortOrder === cur.sortOrder && prev.name <= cur.name),
      ).toBe(true);
    }
  });

  it('create without sortOrder computes max + 1', async () => {
    const d = db();
    // Storage is shared across tests in this file, so compute the baseline instead of hardcoding
    // the seeded max of 4.
    const baseMax = (await gradeLevelsSvc.list(d)).reduce((m, g) => Math.max(m, g.sortOrder), 0);
    const first = await gradeLevelsSvc.create(d, { name: 'Auto Order A', active: true });
    expect(first.sortOrder).toBe(baseMax + 1);

    const second = await gradeLevelsSvc.create(d, { name: 'Auto Order B', active: true });
    expect(second.sortOrder).toBe(baseMax + 2);

    const explicit = await gradeLevelsSvc.create(d, {
      name: 'Explicit Order',
      active: true,
      sortOrder: 99,
    });
    expect(explicit.sortOrder).toBe(99);
  });

  it('update renames and toggles active as a real boolean', async () => {
    const d = db();
    const created = await gradeLevelsSvc.create(d, { name: 'Khối 11', active: true });
    expect(created.active).toBe(true);

    const renamed = await gradeLevelsSvc.update(d, created.id, { name: 'Khối 11 (evening)' });
    expect(renamed.name).toBe('Khối 11 (evening)');
    expect(renamed.active).toBe(true);

    const deactivated = await gradeLevelsSvc.update(d, created.id, { active: false });
    expect(deactivated.active).toBe(false);
    expect(typeof deactivated.active).toBe('boolean');

    const list = await gradeLevelsSvc.list(d);
    const fromList = list.find((g) => g.id === created.id);
    expect(fromList.name).toBe('Khối 11 (evening)');
    expect(fromList.active).toBe(false);
  });

  it('reorder rewrites sortOrder to 1..n in the given order', async () => {
    const d = db();
    const ids = ['gl9', 'gl6', 'gl8', 'gl7'];
    await gradeLevelsSvc.reorder(d, ids);

    const list = await gradeLevelsSvc.list(d);
    const seeded = list.filter((g) => ids.includes(g.id));
    expect(seeded.map((g) => g.id)).toEqual(ids);
    expect(seeded.map((g) => g.sortOrder)).toEqual([1, 2, 3, 4]);
  });

  it('remove deletes the row', async () => {
    const d = db();
    const created = await gradeLevelsSvc.create(d, { name: 'Temp Level', active: true });
    expect((await gradeLevelsSvc.list(d)).some((g) => g.id === created.id)).toBe(true);

    await gradeLevelsSvc.remove(d, created.id);
    expect((await gradeLevelsSvc.list(d)).some((g) => g.id === created.id)).toBe(false);
  });
});

describe('questions', () => {
  const OPTS = [
    { id: 'a', text: 'Alpha' },
    { id: 'b', text: 'Bravo' },
    { id: 'c', text: 'Charlie' },
    { id: 'd', text: 'Delta' },
  ];

  function mcqInput(overrides = {}) {
    return {
      type: 'mcq',
      prompt: 'Pick one',
      gradeLevelId: 'gl6',
      difficulty: 'easy',
      tags: ['algebra'],
      options: OPTS,
      answerKey: 'b',
      explanation: null,
      ...overrides,
    };
  }

  /** A tests row needs only id + title; every other column has a non-null default or is nullable. */
  async function seedTest(d, title = 'WP1.5 Test') {
    const id = crypto.randomUUID();
    await d.insert(testsTable).values({ id, title });
    return id;
  }

  async function linkQuestion(d, testId, questionId, sortOrder = 0) {
    await d.insert(testQuestions).values({ testId, questionId, sortOrder, points: 1 });
  }

  async function seedAttempt(d, testId, studentName = 'Attempt Student') {
    const student = await peopleSvc.createStudent(d, {
      name: studentName,
      color: 'blue',
      classIds: [],
    });
    const id = crypto.randomUUID();
    await d.insert(testAttempts).values({
      id,
      testId,
      studentId: student.id,
      startedAt: new Date().toISOString(),
    });
    return { attemptId: id, studentId: student.id };
  }

  it('creates one question of each type and round-trips the JSON columns', async () => {
    const d = db();

    const mcq = await questionsSvc.create(d, mcqInput());
    const multi = await questionsSvc.create(d, {
      type: 'multi',
      prompt: 'Pick two',
      gradeLevelId: 'gl7',
      difficulty: 'medium',
      tags: ['geometry', 'shapes'],
      options: OPTS,
      answerKey: ['a', 'c'],
      explanation: 'Because.',
    });
    const text = await questionsSvc.create(d, {
      type: 'text',
      prompt: 'Capital of Vietnam?',
      difficulty: 'easy',
      tags: [],
      options: [],
      answerKey: ['Hanoi', 'Hà Nội'],
    });
    const essay = await questionsSvc.create(d, {
      type: 'essay',
      prompt: 'Discuss the water cycle.',
      difficulty: 'hard',
      tags: ['writing'],
      options: [],
      answerKey: null,
    });

    const list = await questionsSvc.list(d);
    const byId = Object.fromEntries(list.map((q) => [q.id, q]));
    expect([mcq.id, multi.id, text.id, essay.id].every((id) => byId[id])).toBe(true);

    const m = byId[mcq.id];
    expect(m.type).toBe('mcq');
    expect(m.options).toEqual(OPTS);
    expect(m.options.length).toBe(4);
    expect(m.answerKey).toBe('b');
    expect(Array.isArray(m.tags)).toBe(true);
    expect(m.tags).toEqual(['algebra']);
    expect(m.gradeLevelId).toBe('gl6');
    expect(typeof m.createdAt).toBe('string');
    expect(typeof m.updatedAt).toBe('string');

    const mu = byId[multi.id];
    expect(mu.options.length).toBe(4);
    expect(mu.options.every((o) => typeof o.id === 'string' && typeof o.text === 'string')).toBe(
      true,
    );
    expect(mu.answerKey).toEqual(['a', 'c']);
    expect(mu.tags).toEqual(['geometry', 'shapes']);
    expect(mu.explanation).toBe('Because.');

    const t = byId[text.id];
    expect(t.options).toEqual([]);
    expect(t.answerKey).toEqual(['Hanoi', 'Hà Nội']);
    expect(t.tags).toEqual([]);

    const e = byId[essay.id];
    expect(e.options).toEqual([]);
    expect(e.answerKey).toBeNull();
    expect(e.difficulty).toBe('hard');
  });

  it('list is ordered newest-updatedAt first', async () => {
    const d = db();
    const q1 = await questionsSvc.create(d, mcqInput({ prompt: 'Q1' }));
    const q2 = await questionsSvc.create(d, mcqInput({ prompt: 'Q2' }));
    const q3 = await questionsSvc.create(d, mcqInput({ prompt: 'Q3' }));

    const list = await questionsSvc.list(d);
    expect(list.length).toBeGreaterThanOrEqual(3);
    for (const id of [q1.id, q2.id, q3.id]) {
      expect(list.some((q) => q.id === id)).toBe(true);
    }
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1].updatedAt >= list[i].updatedAt).toBe(true);
    }
  });

  it('update of prompt/tags/difficulty succeeds and bumps updatedAt', async () => {
    const d = db();
    const q = await questionsSvc.create(d, mcqInput({ prompt: 'Before' }));

    const updated = await questionsSvc.update(d, q.id, {
      prompt: 'After',
      tags: ['fractions'],
      difficulty: 'hard',
    });
    expect(updated.prompt).toBe('After');
    expect(updated.tags).toEqual(['fractions']);
    expect(updated.difficulty).toBe('hard');
    expect(updated.updatedAt >= q.updatedAt).toBe(true);
    // Answer shape untouched.
    expect(updated.options).toEqual(OPTS);
    expect(updated.answerKey).toBe('b');
  });

  it('usageCounts counts the tests that include each question', async () => {
    const d = db();
    const q1 = await questionsSvc.create(d, mcqInput({ prompt: 'Used twice' }));
    const q2 = await questionsSvc.create(d, mcqInput({ prompt: 'Used once' }));
    const q3 = await questionsSvc.create(d, mcqInput({ prompt: 'Unused' }));

    const testA = await seedTest(d, 'Test A');
    const testB = await seedTest(d, 'Test B');
    await linkQuestion(d, testA, q1.id, 0);
    await linkQuestion(d, testA, q2.id, 1);
    await linkQuestion(d, testB, q1.id, 0);

    const counts = await questionsSvc.usageCounts(d);
    expect(counts[q1.id]).toBe(2);
    expect(counts[q2.id]).toBe(1);
    expect(counts[q3.id]).toBeUndefined();
  });

  it('remove throws 409 question_in_use while a test still links it', async () => {
    const d = db();
    const q = await questionsSvc.create(d, mcqInput({ prompt: 'Linked' }));
    const testId = await seedTest(d, 'Linking Test');
    await linkQuestion(d, testId, q.id);

    let err = null;
    try {
      await questionsSvc.remove(d, q.id);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Response);
    expect(err.status).toBe(409);
    expect(await err.json()).toEqual({ error: 'question_in_use' });

    const rows = await d.select().from(questionsTable).where(eq(questionsTable.id, q.id));
    expect(rows.length).toBe(1);
  });

  it('remove succeeds once no test links the question', async () => {
    const d = db();
    const q = await questionsSvc.create(d, mcqInput({ prompt: 'Free' }));
    await questionsSvc.remove(d, q.id);
    const rows = await d.select().from(questionsTable).where(eq(questionsTable.id, q.id));
    expect(rows.length).toBe(0);
  });

  it('update throws 409 question_locked when an attempt exists and the patch touches options', async () => {
    const d = db();
    const q = await questionsSvc.create(d, mcqInput({ prompt: 'Locked' }));
    const testId = await seedTest(d, 'Attempted Test');
    await linkQuestion(d, testId, q.id);
    await seedAttempt(d, testId, 'Locked Student');

    let err = null;
    try {
      await questionsSvc.update(d, q.id, {
        options: [
          { id: 'a', text: 'Alpha' },
          { id: 'z', text: 'Zulu' },
        ],
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Response);
    expect(err.status).toBe(409);
    expect(await err.json()).toEqual({ error: 'question_locked' });

    const after = await questionsSvc.list(d);
    expect(after.find((x) => x.id === q.id).options).toEqual(OPTS);
  });

  it('prompt-only update is still allowed while locked', async () => {
    const d = db();
    const q = await questionsSvc.create(d, mcqInput({ prompt: 'Locked but renameable' }));
    const testId = await seedTest(d, 'Attempted Test 2');
    await linkQuestion(d, testId, q.id);
    await seedAttempt(d, testId, 'Locked Student 2');

    const updated = await questionsSvc.update(d, q.id, { prompt: 'Renamed while locked' });
    expect(updated.prompt).toBe('Renamed while locked');
    expect(updated.options).toEqual(OPTS);
    expect(updated.answerKey).toBe('b');
  });

  it('hasAttempts flips from false to true when an attempt is inserted', async () => {
    const d = db();
    const q = await questionsSvc.create(d, mcqInput({ prompt: 'Attempt probe' }));
    const testId = await seedTest(d, 'Probe Test');
    await linkQuestion(d, testId, q.id);

    expect(await questionsSvc.hasAttempts(d, q.id)).toBe(false);
    await seedAttempt(d, testId, 'Probe Student');
    expect(await questionsSvc.hasAttempts(d, q.id)).toBe(true);
  });

  it('rejects a merged patch that would leave an essay question with options', async () => {
    const d = db();
    const q = await questionsSvc.create(d, mcqInput({ prompt: 'Type switch' }));

    let err = null;
    try {
      await questionsSvc.update(d, q.id, { type: 'essay' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Response);
    expect(err.status).toBe(400);
    const body = await err.json();
    expect(body.errors).toBeTruthy();

    // The row is untouched.
    const after = await questionsSvc.list(d);
    const row = after.find((x) => x.id === q.id);
    expect(row.type).toBe('mcq');
    expect(row.options).toEqual(OPTS);
  });
});

// ---- WP2a.2: tests service + paper score sync ----

describe('tests service', () => {
  const OPTS = [
    { id: 'a', text: 'Alpha' },
    { id: 'b', text: 'Bravo' },
  ];

  async function makeQuestion(d, prompt) {
    return questionsSvc.create(d, {
      type: 'mcq',
      prompt,
      gradeLevelId: 'gl6',
      difficulty: 'easy',
      tags: [],
      options: OPTS,
      answerKey: 'b',
      explanation: null,
    });
  }

  /** Inserts a raw attempt row so the "already sat" guards can be exercised. */
  async function seedAttempt(d, testId, opts = {}) {
    const student = await peopleSvc.createStudent(d, {
      name: `Attempt ${crypto.randomUUID().slice(0, 8)}`,
      color: 'blue',
      classIds: [],
    });
    const id = crypto.randomUUID();
    await d.insert(testAttempts).values({
      id,
      testId,
      studentId: student.id,
      startedAt: new Date().toISOString(),
      ...opts,
    });
    return { attemptId: id, studentId: student.id };
  }

  async function expectThrown(fn) {
    let err = null;
    try {
      await fn();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Response);
    return err;
  }

  it('create sets draft status and createdAt; list is createdAt DESC; get returns the row', async () => {
    const d = db();
    const a = await testsSvc.create(d, { title: 'WP2a Test A', mode: 'online' });
    const b = await testsSvc.create(d, { title: 'WP2a Test B', mode: 'paper' });

    expect(a.id).toBeTruthy();
    expect(a.status).toBe('draft');
    expect(typeof a.createdAt).toBe('string');
    expect(a.mode).toBe('online');
    expect(b.mode).toBe('paper');

    const list = await testsSvc.list(d);
    expect(list.some((t) => t.id === a.id)).toBe(true);
    expect(list.some((t) => t.id === b.id)).toBe(true);
    // Storage is shared across tests in this file, so assert monotonicity rather than positions.
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1].createdAt;
      const cur = list[i].createdAt;
      if (prev != null && cur != null) expect(prev >= cur).toBe(true);
    }

    const fetched = await testsSvc.get(d, a.id);
    expect(fetched.title).toBe('WP2a Test A');
  });

  it('get on an unknown id throws 404 test_not_found', async () => {
    const err = await expectThrown(() => testsSvc.get(db(), 'no-such-test'));
    expect(err.status).toBe(404);
    expect(await err.json()).toEqual({ error: 'test_not_found' });
  });

  it('setQuestions stores sortOrder by array index with the given points, and totalPoints sums', async () => {
    const d = db();
    const t = await testsSvc.create(d, { title: 'WP2a Links', mode: 'paper' });
    const q1 = await makeQuestion(d, 'Link Q1');
    const q2 = await makeQuestion(d, 'Link Q2');
    const q3 = await makeQuestion(d, 'Link Q3');

    const links = await testsSvc.setQuestions(d, t.id, [
      { questionId: q2.id, points: 2 },
      { questionId: q1.id, points: 3.5 },
      { questionId: q3.id, points: 1 },
    ]);
    expect(links.map((l) => l.questionId)).toEqual([q2.id, q1.id, q3.id]);
    expect(links.map((l) => l.sortOrder)).toEqual([0, 1, 2]);
    expect(links.map((l) => l.points)).toEqual([2, 3.5, 1]);
    expect(links.every((l) => l.testId === t.id)).toBe(true);
    expect(await testsSvc.totalPoints(d, t.id)).toBe(6.5);
  });

  it('setQuestions replaces the whole set rather than merging, and an empty array clears it', async () => {
    const d = db();
    const t = await testsSvc.create(d, { title: 'WP2a Replace', mode: 'paper' });
    const q1 = await makeQuestion(d, 'Replace Q1');
    const q2 = await makeQuestion(d, 'Replace Q2');
    const q3 = await makeQuestion(d, 'Replace Q3');

    await testsSvc.setQuestions(d, t.id, [
      { questionId: q1.id, points: 1 },
      { questionId: q2.id, points: 1 },
    ]);

    const replaced = await testsSvc.setQuestions(d, t.id, [{ questionId: q3.id, points: 4 }]);
    expect(replaced.length).toBe(1);
    expect(replaced[0].questionId).toBe(q3.id);
    expect(replaced[0].sortOrder).toBe(0);
    expect(await testsSvc.totalPoints(d, t.id)).toBe(4);

    const rows = await d.select().from(testQuestions).where(eq(testQuestions.testId, t.id));
    expect(rows.length).toBe(1);

    const cleared = await testsSvc.setQuestions(d, t.id, []);
    expect(cleared).toEqual([]);
    expect(await testsSvc.totalPoints(d, t.id)).toBe(0);
    const afterClear = await d.select().from(testQuestions).where(eq(testQuestions.testId, t.id));
    expect(afterClear.length).toBe(0);
  });

  it('setQuestions with an unknown questionId throws 400 unknown_question and changes nothing', async () => {
    const d = db();
    const t = await testsSvc.create(d, { title: 'WP2a Unknown Q', mode: 'paper' });
    const q1 = await makeQuestion(d, 'Known Q');
    await testsSvc.setQuestions(d, t.id, [{ questionId: q1.id, points: 1 }]);

    const err = await expectThrown(() =>
      testsSvc.setQuestions(d, t.id, [
        { questionId: q1.id, points: 1 },
        { questionId: 'nope-not-a-question', points: 1 },
      ]),
    );
    expect(err.status).toBe(400);
    expect(await err.json()).toEqual({ error: 'unknown_question' });

    const links = await testsSvc.listQuestionLinks(d, t.id);
    expect(links.map((l) => l.questionId)).toEqual([q1.id]);
  });

  it('publish refuses an empty test with 400 test_empty', async () => {
    const d = db();
    const t = await testsSvc.create(d, { title: 'WP2a Empty', mode: 'paper' });
    const err = await expectThrown(() => testsSvc.publish(d, t.id));
    expect(err.status).toBe(400);
    expect(await err.json()).toEqual({ error: 'test_empty' });
    expect((await testsSvc.get(d, t.id)).status).toBe('draft');
  });

  it('publish refuses an online test with no closeAt, and succeeds once closeAt is set', async () => {
    const d = db();
    const t = await testsSvc.create(d, { title: 'WP2a Online', mode: 'online' });
    const q = await makeQuestion(d, 'Online Q');
    await testsSvc.setQuestions(d, t.id, [{ questionId: q.id, points: 1 }]);

    const err = await expectThrown(() => testsSvc.publish(d, t.id));
    expect(err.status).toBe(400);
    expect(await err.json()).toEqual({ error: 'test_no_close' });
    expect((await testsSvc.get(d, t.id)).status).toBe('draft');

    await testsSvc.update(d, t.id, { closeAt: '2026-08-01T10:00:00.000Z' });
    const published = await testsSvc.publish(d, t.id);
    expect(published.status).toBe('published');
  });

  it('publish succeeds for a paper test with questions and no closeAt', async () => {
    const d = db();
    const t = await testsSvc.create(d, { title: 'WP2a Paper Publish', mode: 'paper' });
    const q = await makeQuestion(d, 'Paper Q');
    await testsSvc.setQuestions(d, t.id, [{ questionId: q.id, points: 1 }]);

    const published = await testsSvc.publish(d, t.id);
    expect(published.status).toBe('published');
    expect(published.closeAt).toBeNull();
  });

  it('unpublish returns to draft with no attempts, then throws 409 test_has_attempts', async () => {
    const d = db();
    const t = await testsSvc.create(d, { title: 'WP2a Unpublish', mode: 'paper' });
    const q = await makeQuestion(d, 'Unpublish Q');
    await testsSvc.setQuestions(d, t.id, [{ questionId: q.id, points: 1 }]);
    await testsSvc.publish(d, t.id);

    const drafted = await testsSvc.unpublish(d, t.id);
    expect(drafted.status).toBe('draft');

    await testsSvc.publish(d, t.id);
    await seedAttempt(d, t.id);
    const err = await expectThrown(() => testsSvc.unpublish(d, t.id));
    expect(err.status).toBe(409);
    expect(await err.json()).toEqual({ error: 'test_has_attempts' });
    expect((await testsSvc.get(d, t.id)).status).toBe('published');
  });

  it('setQuestions throws 409 test_has_attempts once an attempt exists and leaves links intact', async () => {
    const d = db();
    const t = await testsSvc.create(d, { title: 'WP2a Locked Links', mode: 'paper' });
    const q1 = await makeQuestion(d, 'Locked Q1');
    const q2 = await makeQuestion(d, 'Locked Q2');
    const before = await testsSvc.setQuestions(d, t.id, [
      { questionId: q1.id, points: 2 },
      { questionId: q2.id, points: 3 },
    ]);
    await seedAttempt(d, t.id);

    const err = await expectThrown(() => testsSvc.setQuestions(d, t.id, []));
    expect(err.status).toBe(409);
    expect(await err.json()).toEqual({ error: 'test_has_attempts' });

    const after = await testsSvc.listQuestionLinks(d, t.id);
    expect(after).toEqual(before);
  });

  it('hasAttempts flips false to true, and attemptsSummary buckets by status', async () => {
    const d = db();
    const t = await testsSvc.create(d, { title: 'WP2a Summary', mode: 'paper' });
    expect(await testsSvc.hasAttempts(d, t.id)).toBe(false);

    await seedAttempt(d, t.id, { status: 'in_progress' });
    expect(await testsSvc.hasAttempts(d, t.id)).toBe(true);
    await seedAttempt(d, t.id, { status: 'needs_grading' });
    await seedAttempt(d, t.id, { status: 'graded' });
    await seedAttempt(d, t.id, { status: 'graded' });

    const summary = await testsSvc.attemptsSummary(d);
    expect(summary[t.id]).toEqual({ total: 4, needsGrading: 1, graded: 2 });
    expect((await testsSvc.listAttempts(d, t.id)).length).toBe(4);
  });
});

describe('paper score sync', () => {
  /** A fresh class, two fresh students, a fresh assessment type and a paper test wired to them. */
  async function setup(d, overrides = {}) {
    const tag = crypto.randomUUID().slice(0, 8);
    const cls = await classesSvc.create(d, {
      name: `Paper Class ${tag}`,
      color: 'blue',
      schedule: [],
      studentIds: [],
    });
    const type = await typesSvc.create(d, { name: `Paper Type ${tag}`, active: true });
    const s1 = await peopleSvc.createStudent(d, {
      name: `Paper Student A ${tag}`,
      color: 'blue',
      classIds: [cls.id],
    });
    const s2 = await peopleSvc.createStudent(d, {
      name: `Paper Student B ${tag}`,
      color: 'green',
      classIds: [cls.id],
    });
    const test = await testsSvc.create(d, {
      title: `Paper Test ${tag}`,
      mode: 'paper',
      classId: cls.id,
      assessmentTypeId: type.id,
      date: '2026-06-23',
      ...overrides,
    });
    return { cls, type, s1, s2, test };
  }

  function scoresFor(d, studentId) {
    return d.select().from(scoreRecords).where(eq(scoreRecords.studentId, studentId));
  }

  it('a paper score creates a graded attempt and a fully populated linked score record', async () => {
    const d = db();
    const { cls, type, s1, test } = await setup(d);

    const attempts = await testsSvc.savePaperScores(d, test.id, [
      { studentId: s1.id, score: 8.5, comment: 'Nice work' },
    ]);
    const attempt = attempts.find((a) => a.studentId === s1.id);
    expect(attempt).toBeTruthy();
    expect(attempt.source).toBe('paper');
    expect(attempt.status).toBe('graded');
    expect(attempt.normalizedScore).toBe(8.5);
    expect(attempt.comment).toBe('Nice work');
    expect(attempt.scoreRecordId).toBeTruthy();

    const rows = await scoresFor(d, s1.id);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(attempt.scoreRecordId);
    expect(rows[0].studentId).toBe(s1.id);
    expect(rows[0].classId).toBe(cls.id);
    expect(rows[0].assessmentTypeId).toBe(type.id);
    expect(rows[0].date).toBe('2026-06-23');
    expect(rows[0].score).toBe(8.5);
    expect(rows[0].notes).toBe('Nice work');
  });

  it('invariant: updating a score reuses the same score record with no orphans', async () => {
    const d = db();
    const { s1, test } = await setup(d);

    const first = await testsSvc.savePaperScores(d, test.id, [
      { studentId: s1.id, score: 6, comment: 'ok' },
    ]);
    const scoreRecordId = first.find((a) => a.studentId === s1.id).scoreRecordId;

    const second = await testsSvc.savePaperScores(d, test.id, [
      { studentId: s1.id, score: 9, comment: 'better' },
    ]);
    const attempt = second.find((a) => a.studentId === s1.id);
    expect(attempt.scoreRecordId).toBe(scoreRecordId);
    expect(attempt.normalizedScore).toBe(9);

    const rows = await scoresFor(d, s1.id);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(scoreRecordId);
    expect(rows[0].score).toBe(9);
    expect(rows[0].notes).toBe('better');
    expect((await testsSvc.listAttempts(d, test.id)).length).toBe(1);
  });

  it('invariant: clearing both score and comment deletes the attempt and its score record', async () => {
    const d = db();
    const { s1, test } = await setup(d);
    await testsSvc.savePaperScores(d, test.id, [{ studentId: s1.id, score: 7, comment: 'ok' }]);

    const after = await testsSvc.savePaperScores(d, test.id, [
      { studentId: s1.id, score: null, comment: null },
    ]);
    expect(after.find((a) => a.studentId === s1.id)).toBeUndefined();
    expect(after.length).toBe(0);
    expect(await scoresFor(d, s1.id)).toEqual([]);
  });

  it('invariant: a comment-only entry keeps the attempt but drops the score record', async () => {
    const d = db();
    const { s1, test } = await setup(d);
    const first = await testsSvc.savePaperScores(d, test.id, [
      { studentId: s1.id, score: 7, comment: 'scored' },
    ]);
    const scoreRecordId = first.find((a) => a.studentId === s1.id).scoreRecordId;
    expect(scoreRecordId).toBeTruthy();

    const after = await testsSvc.savePaperScores(d, test.id, [
      { studentId: s1.id, score: null, comment: 'Missing submission' },
    ]);
    const attempt = after.find((a) => a.studentId === s1.id);
    expect(attempt).toBeTruthy();
    expect(attempt.normalizedScore).toBeNull();
    expect(attempt.comment).toBe('Missing submission');
    expect(attempt.scoreRecordId).toBeNull();

    const gone = await d.select().from(scoreRecords).where(eq(scoreRecords.id, scoreRecordId));
    expect(gone.length).toBe(0);
    expect(await scoresFor(d, s1.id)).toEqual([]);
  });

  it('a test with no date scores against today in ICT', async () => {
    const d = db();
    const { s1, test } = await setup(d, { date: null });
    expect(test.date).toBeNull();

    const expected = ictDateOf(new Date().toISOString());
    const attempts = await testsSvc.savePaperScores(d, test.id, [
      { studentId: s1.id, score: 5, comment: null },
    ]);
    const rows = await scoresFor(d, s1.id);
    expect(rows.length).toBe(1);
    expect(rows[0].date).toBe(expected);
    expect(rows[0].id).toBe(attempts.find((a) => a.studentId === s1.id).scoreRecordId);
  });

  it('update propagates date, classId and assessmentTypeId to every linked score record', async () => {
    const d = db();
    const { s1, s2, test } = await setup(d);
    await testsSvc.savePaperScores(d, test.id, [
      { studentId: s1.id, score: 6, comment: null },
      { studentId: s2.id, score: 7, comment: null },
    ]);

    const otherClass = await classesSvc.create(d, {
      name: `Paper Class Moved ${crypto.randomUUID().slice(0, 8)}`,
      color: 'red',
      schedule: [],
      studentIds: [],
    });
    const otherType = await typesSvc.create(d, {
      name: `Paper Type Moved ${crypto.randomUUID().slice(0, 8)}`,
      active: true,
    });

    await testsSvc.update(d, test.id, {
      date: '2026-07-01',
      classId: otherClass.id,
      assessmentTypeId: otherType.id,
    });

    for (const s of [s1, s2]) {
      const rows = await scoresFor(d, s.id);
      expect(rows.length).toBe(1);
      expect(rows[0].date).toBe('2026-07-01');
      expect(rows[0].classId).toBe(otherClass.id);
      expect(rows[0].assessmentTypeId).toBe(otherType.id);
    }
  });

  it('remove deletes linked score records and cascades attempts and question links', async () => {
    const d = db();
    const { s1, s2, test } = await setup(d);
    const q = await questionsSvc.create(d, {
      type: 'essay',
      prompt: 'Paper essay',
      difficulty: 'easy',
      tags: [],
      options: [],
      answerKey: null,
    });
    await testsSvc.setQuestions(d, test.id, [{ questionId: q.id, points: 10 }]);
    await testsSvc.savePaperScores(d, test.id, [
      { studentId: s1.id, score: 6, comment: null },
      { studentId: s2.id, score: 7, comment: 'good' },
    ]);
    expect((await scoresFor(d, s1.id)).length).toBe(1);
    expect((await scoresFor(d, s2.id)).length).toBe(1);

    await testsSvc.remove(d, test.id);

    expect(await scoresFor(d, s1.id)).toEqual([]);
    expect(await scoresFor(d, s2.id)).toEqual([]);
    const attemptRows = await d.select().from(testAttempts).where(eq(testAttempts.testId, test.id));
    expect(attemptRows.length).toBe(0);
    const linkRows = await d.select().from(testQuestions).where(eq(testQuestions.testId, test.id));
    expect(linkRows.length).toBe(0);
    const testRows = await d.select().from(testsTable).where(eq(testsTable.id, test.id));
    expect(testRows.length).toBe(0);
  });

  it('paper entry never clobbers an existing online attempt', async () => {
    const d = db();
    const { s1, s2, test } = await setup(d);
    const onlineId = crypto.randomUUID();
    await d.insert(testAttempts).values({
      id: onlineId,
      testId: test.id,
      studentId: s1.id,
      source: 'online',
      status: 'submitted',
      startedAt: new Date().toISOString(),
      normalizedScore: 4.5,
    });

    await testsSvc.savePaperScores(d, test.id, [
      { studentId: s1.id, score: 10, comment: 'paper override attempt' },
      { studentId: s2.id, score: 8, comment: null },
    ]);

    const online = (await d.select().from(testAttempts).where(eq(testAttempts.id, onlineId)))[0];
    expect(online.source).toBe('online');
    expect(online.status).toBe('submitted');
    expect(online.normalizedScore).toBe(4.5);
    expect(online.comment).toBeNull();
    expect(online.scoreRecordId).toBeNull();
    // No gradebook row was invented for the online student.
    expect(await scoresFor(d, s1.id)).toEqual([]);

    const paper = (await testsSvc.listAttempts(d, test.id)).find((a) => a.studentId === s2.id);
    expect(paper.source).toBe('paper');
    expect(paper.normalizedScore).toBe(8);
    expect((await scoresFor(d, s2.id)).length).toBe(1);
  });

  it('savePaperScores on an unknown testId throws 404 test_not_found', async () => {
    let err = null;
    try {
      await testsSvc.savePaperScores(db(), 'no-such-test', []);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Response);
    expect(err.status).toBe(404);
    expect(await err.json()).toEqual({ error: 'test_not_found' });
  });

  it('is idempotent: saving the identical payload twice leaves one attempt and one score record each', async () => {
    const d = db();
    const { s1, s2, test } = await setup(d);
    const payload = [
      { studentId: s1.id, score: 6.5, comment: 'first' },
      { studentId: s2.id, score: 9, comment: null },
    ];

    const first = await testsSvc.savePaperScores(d, test.id, payload);
    const second = await testsSvc.savePaperScores(d, test.id, payload);

    expect(second.length).toBe(2);
    expect(new Set(second.map((a) => a.id))).toEqual(new Set(first.map((a) => a.id)));
    for (const s of [s1, s2]) {
      const rows = await scoresFor(d, s.id);
      expect(rows.length).toBe(1);
      expect(rows[0].id).toBe(second.find((a) => a.studentId === s.id).scoreRecordId);
    }
  });
});

// ---- WP3.1: attempts service (online test taking) ----

describe('attempts service', () => {
  const OPTS = [
    { id: 'a', text: 'Alpha' },
    { id: 'b', text: 'Bravo' },
    { id: 'c', text: 'Charlie' },
  ];

  async function expectThrown(fn) {
    let err = null;
    try {
      await fn();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Response);
    return err;
  }

  function iso(offsetMs) {
    return new Date(Date.now() + offsetMs).toISOString();
  }

  /**
   * A fresh class, student, assessment type and published online test per test.
   * The workers pool shares one D1 across this file, so nothing here may assert absolute counts —
   * every assertion filters by the ids this fixture created.
   */
  async function setup(d, opts = {}) {
    const tag = crypto.randomUUID().slice(0, 8);
    const cls = await classesSvc.create(d, {
      name: `Attempt Class ${tag}`,
      color: 'blue',
      schedule: [],
      studentIds: [],
    });
    const type = await typesSvc.create(d, { name: `Attempt Type ${tag}`, active: true });
    const student = await peopleSvc.createStudent(d, {
      name: `Attempt Student ${tag}`,
      color: 'blue',
      classIds: [cls.id],
    });
    const outsider = await peopleSvc.createStudent(d, {
      name: `Attempt Outsider ${tag}`,
      color: 'red',
      classIds: [],
    });

    const specs = opts.questions ?? [
      { type: 'mcq', prompt: `Q mcq ${tag}`, options: OPTS, answerKey: 'b', points: 2 },
    ];
    const qs = [];
    for (const s of specs) {
      const q = await questionsSvc.create(d, {
        type: s.type,
        prompt: s.prompt,
        difficulty: 'easy',
        tags: [],
        options: s.options ?? [],
        answerKey: s.answerKey ?? null,
        explanation: s.explanation ?? 'Because reasons',
      });
      qs.push({ ...q, points: s.points });
    }

    const test = await testsSvc.create(d, {
      title: `Attempt Test ${tag}`,
      mode: opts.mode ?? 'online',
      classId: cls.id,
      assessmentTypeId: type.id,
      date: opts.date ?? '2026-06-24',
      openAt: opts.openAt ?? null,
      closeAt: opts.closeAt ?? iso(60 * 60 * 1000),
      timeLimitMinutes: opts.timeLimitMinutes ?? null,
    });
    await testsSvc.setQuestions(
      d,
      test.id,
      qs.map((q) => ({ questionId: q.id, points: q.points })),
    );
    if (opts.publish !== false) await testsSvc.publish(d, test.id);

    return { tag, cls, type, student, outsider, qs, test: await testsSvc.get(d, test.id) };
  }

  function scoresFor(d, studentId) {
    return d.select().from(scoreRecords).where(eq(scoreRecords.studentId, studentId));
  }

  const THREE_Q = [
    { type: 'mcq', prompt: 'Pick b', options: OPTS, answerKey: 'b', points: 2 },
    { type: 'multi', prompt: 'Pick a and c', options: OPTS, answerKey: ['a', 'c'], points: 2 },
    { type: 'text', prompt: 'Capital of Vietnam', answerKey: ['Hà Nội'], points: 1 },
  ];

  it('start creates an online in_progress attempt and returns questions with no answer key', async () => {
    const d = db();
    const { student, test, qs } = await setup(d, {
      questions: [
        { type: 'mcq', prompt: 'Second', options: OPTS, answerKey: 'b', points: 2 },
        { type: 'essay', prompt: 'First', answerKey: null, points: 5 },
      ],
    });
    // setQuestions ordered them [mcq, essay]; sortOrder must drive the returned order.
    const now = new Date();
    const res = await attemptsSvc.start(d, test.id, student.id, now);

    expect(res.attempt.source).toBe('online');
    expect(res.attempt.status).toBe('in_progress');
    expect(res.attempt.testId).toBe(test.id);
    expect(res.attempt.studentId).toBe(student.id);
    expect(res.serverNow).toBe(now.toISOString());

    expect(res.questions.map((q) => q.id)).toEqual([qs[0].id, qs[1].id]);
    expect(res.questions.map((q) => q.sortOrder)).toEqual([0, 1]);
    expect(res.questions.map((q) => q.points)).toEqual([2, 5]);
    expect(res.questions[0].options).toEqual(OPTS);

    // The leak guard: the properties must be ABSENT, not merely null.
    for (const q of res.questions) {
      expect('answerKey' in q).toBe(false);
      expect('explanation' in q).toBe(false);
      expect(Object.keys(q).sort()).toEqual(
        ['id', 'options', 'points', 'prompt', 'sortOrder', 'type'].sort(),
      );
    }
  });

  it('deadlineAt is min(closeAt, startedAt + timeLimitMinutes), or null when neither is set', async () => {
    const d = db();

    // closeAt sooner than the time limit.
    const closeSoon = iso(5 * 60 * 1000);
    const a = await setup(d, { closeAt: closeSoon, timeLimitMinutes: 120 });
    const ra = await attemptsSvc.start(d, a.test.id, a.student.id, new Date());
    expect(ra.attempt.deadlineAt).toBe(closeSoon);

    // time limit sooner than closeAt.
    const b = await setup(d, { closeAt: iso(10 * 60 * 60 * 1000), timeLimitMinutes: 30 });
    const bNow = new Date();
    const rb = await attemptsSvc.start(d, b.test.id, b.student.id, bNow);
    expect(rb.attempt.deadlineAt).toBe(new Date(bNow.getTime() + 30 * 60_000).toISOString());

    // Neither: a published online test needs a closeAt, so clear it after publishing.
    const c = await setup(d, { timeLimitMinutes: null });
    await d.update(testsTable).set({ closeAt: null }).where(eq(testsTable.id, c.test.id));
    const rc = await attemptsSvc.start(d, c.test.id, c.student.id, new Date());
    expect(rc.attempt.deadlineAt).toBeNull();
  });

  it('start is idempotent: the same attempt comes back with startedAt and deadlineAt untouched', async () => {
    const d = db();
    const { student, test } = await setup(d, { timeLimitMinutes: 60 });
    const first = await attemptsSvc.start(d, test.id, student.id, new Date());
    const later = new Date(Date.now() + 5 * 60 * 1000);
    const second = await attemptsSvc.start(d, test.id, student.id, later);

    expect(second.attempt.id).toBe(first.attempt.id);
    expect(second.attempt.startedAt).toBe(first.attempt.startedAt);
    expect(second.attempt.deadlineAt).toBe(first.attempt.deadlineAt);
    expect(second.attempt.status).toBe('in_progress');
    expect(second.questions.length).toBe(first.questions.length);
    expect(second.serverNow).toBe(later.toISOString());

    const rows = await d.select().from(testAttempts).where(eq(testAttempts.testId, test.id));
    expect(rows.length).toBe(1);
  });

  it('start refuses a draft test with 409 test_not_published', async () => {
    const d = db();
    const { student, test } = await setup(d, { publish: false });
    expect(test.status).toBe('draft');
    const err = await expectThrown(() => attemptsSvc.start(d, test.id, student.id, new Date()));
    expect(err.status).toBe(409);
    expect(await err.json()).toEqual({ error: 'test_not_published' });
  });

  it('start refuses a paper test with 409 test_not_online', async () => {
    const d = db();
    const { student, test } = await setup(d, { mode: 'paper' });
    const err = await expectThrown(() => attemptsSvc.start(d, test.id, student.id, new Date()));
    expect(err.status).toBe(409);
    expect(await err.json()).toEqual({ error: 'test_not_online' });
  });

  it('start refuses a student who is not on the roster with 403 not_enrolled', async () => {
    const d = db();
    const { outsider, test } = await setup(d);
    const err = await expectThrown(() => attemptsSvc.start(d, test.id, outsider.id, new Date()));
    expect(err.status).toBe(403);
    expect(await err.json()).toEqual({ error: 'not_enrolled' });
    expect(await attemptsSvc.listForTest(d, test.id)).toEqual([]);
  });

  it('start refuses a window that has not opened yet with 409 window_upcoming', async () => {
    const d = db();
    const { student, test } = await setup(d, {
      openAt: iso(60 * 60 * 1000),
      closeAt: iso(2 * 60 * 60 * 1000),
    });
    const err = await expectThrown(() => attemptsSvc.start(d, test.id, student.id, new Date()));
    expect(err.status).toBe(409);
    expect(await err.json()).toEqual({ error: 'window_upcoming' });
  });

  it('start refuses a closed window with 409 window_closed', async () => {
    const d = db();
    const { student, test } = await setup(d, { closeAt: iso(-60 * 60 * 1000) });
    const err = await expectThrown(() => attemptsSvc.start(d, test.id, student.id, new Date()));
    expect(err.status).toBe(409);
    expect(await err.json()).toEqual({ error: 'window_closed' });
  });

  it('getOwn hides another student attempt behind the same 404 as a missing one', async () => {
    const d = db();
    const { cls, student, test } = await setup(d);
    const other = await peopleSvc.createStudent(d, {
      name: `Attempt Peer ${crypto.randomUUID().slice(0, 8)}`,
      color: 'green',
      classIds: [cls.id],
    });
    const { attempt } = await attemptsSvc.start(d, test.id, student.id, new Date());

    const mine = await attemptsSvc.getOwn(d, attempt.id, student.id);
    expect(mine.id).toBe(attempt.id);

    const stolen = await expectThrown(() => attemptsSvc.getOwn(d, attempt.id, other.id));
    expect(stolen.status).toBe(404);
    expect(await stolen.json()).toEqual({ error: 'attempt_not_found' });

    const missing = await expectThrown(() => attemptsSvc.getOwn(d, 'no-such-attempt', student.id));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'attempt_not_found' });
  });

  it('saveAnswers round-trips strings and arrays, and a second save overwrites', async () => {
    const d = db();
    const { student, test, qs } = await setup(d, { questions: THREE_Q });
    const { attempt } = await attemptsSvc.start(d, test.id, student.id, new Date());

    await attemptsSvc.saveAnswers(
      d,
      attempt.id,
      student.id,
      [
        { questionId: qs[0].id, answer: 'a' },
        { questionId: qs[1].id, answer: ['a', 'c'] },
        { questionId: qs[2].id, answer: 'Hue' },
      ],
      new Date(),
    );

    let rows = await attemptsSvc.listAnswers(d, attempt.id);
    expect(rows.length).toBe(3);
    let byQ = Object.fromEntries(rows.map((r) => [r.questionId, r.answer]));
    expect(byQ[qs[0].id]).toBe('a');
    expect(byQ[qs[1].id]).toEqual(['a', 'c']);
    expect(byQ[qs[2].id]).toBe('Hue');
    expect(rows.every((r) => r.attemptId === attempt.id)).toBe(true);
    expect(rows.every((r) => r.autoCorrect === null && r.autoPoints === null)).toBe(true);

    // Overwrite one, leave the others alone: the composite PK means no duplicate rows.
    await attemptsSvc.saveAnswers(
      d,
      attempt.id,
      student.id,
      [{ questionId: qs[0].id, answer: 'b' }],
      new Date(),
    );
    rows = await attemptsSvc.listAnswers(d, attempt.id);
    expect(rows.length).toBe(3);
    byQ = Object.fromEntries(rows.map((r) => [r.questionId, r.answer]));
    expect(byQ[qs[0].id]).toBe('b');
    expect(byQ[qs[1].id]).toEqual(['a', 'c']);
  });

  it('saveAnswers rejects a questionId that is not on the test with 400 unknown_question', async () => {
    const d = db();
    const { student, test, qs } = await setup(d);
    const stray = await questionsSvc.create(d, {
      type: 'mcq',
      prompt: `Not on the test ${crypto.randomUUID().slice(0, 8)}`,
      difficulty: 'easy',
      tags: [],
      options: OPTS,
      answerKey: 'a',
    });
    const { attempt } = await attemptsSvc.start(d, test.id, student.id, new Date());

    const err = await expectThrown(() =>
      attemptsSvc.saveAnswers(
        d,
        attempt.id,
        student.id,
        [
          { questionId: qs[0].id, answer: 'b' },
          { questionId: stray.id, answer: 'a' },
        ],
        new Date(),
      ),
    );
    expect(err.status).toBe(400);
    expect(await err.json()).toEqual({ error: 'unknown_question' });
    expect(await attemptsSvc.listAnswers(d, attempt.id)).toEqual([]);
  });

  it('saveAnswers past the deadline throws 409 attempt_closed', async () => {
    const d = db();
    const { student, test, qs } = await setup(d, { timeLimitMinutes: 10 });
    const { attempt } = await attemptsSvc.start(d, test.id, student.id, new Date());
    expect(attempt.deadlineAt).toBeTruthy();

    // Inside the 30s grace still works.
    await attemptsSvc.saveAnswers(
      d,
      attempt.id,
      student.id,
      [{ questionId: qs[0].id, answer: 'b' }],
      new Date(new Date(attempt.deadlineAt).getTime() + 10_000),
    );

    const err = await expectThrown(() =>
      attemptsSvc.saveAnswers(
        d,
        attempt.id,
        student.id,
        [{ questionId: qs[0].id, answer: 'a' }],
        new Date(new Date(attempt.deadlineAt).getTime() + 10 * 60_000),
      ),
    );
    expect(err.status).toBe(409);
    expect(await err.json()).toEqual({ error: 'attempt_closed' });
    // The pre-deadline answer survived.
    const rows = await attemptsSvc.listAnswers(d, attempt.id);
    expect(rows[0].answer).toBe('b');
  });

  it('saveAnswers on an already-submitted attempt throws 409 attempt_closed', async () => {
    const d = db();
    const { student, test, qs } = await setup(d);
    const { attempt } = await attemptsSvc.start(d, test.id, student.id, new Date());
    await attemptsSvc.submit(d, attempt.id, student.id, new Date());

    const err = await expectThrown(() =>
      attemptsSvc.saveAnswers(
        d,
        attempt.id,
        student.id,
        [{ questionId: qs[0].id, answer: 'b' }],
        new Date(),
      ),
    );
    expect(err.status).toBe(409);
    expect(await err.json()).toEqual({ error: 'attempt_closed' });
  });

  it('submit auto-grades an essay-free test, stores per-answer marks and syncs the gradebook', async () => {
    const d = db();
    const { cls, type, student, test, qs } = await setup(d, { questions: THREE_Q });
    const { attempt } = await attemptsSvc.start(d, test.id, student.id, new Date());
    await attemptsSvc.saveAnswers(
      d,
      attempt.id,
      student.id,
      [
        { questionId: qs[0].id, answer: 'b' }, // right, 2
        { questionId: qs[1].id, answer: ['a'] }, // wrong (all-or-nothing), 0
        { questionId: qs[2].id, answer: 'Hà Nội' }, // right, 1
      ],
      new Date(),
    );

    const submitted = await attemptsSvc.submit(d, attempt.id, student.id, new Date());
    expect(submitted.status).toBe('graded');
    expect(submitted.autoScore).toBe(3);
    expect(submitted.totalScore).toBe(3);
    expect(submitted.normalizedScore).toBe(normalizeScore(3, 5));
    expect(submitted.submittedAt).toBeTruthy();
    expect(submitted.scoreRecordId).toBeTruthy();

    const rows = await attemptsSvc.listAnswers(d, attempt.id);
    const byQ = Object.fromEntries(rows.map((r) => [r.questionId, r]));
    expect(byQ[qs[0].id].autoCorrect).toBe(true);
    expect(byQ[qs[0].id].autoPoints).toBe(2);
    expect(byQ[qs[1].id].autoCorrect).toBe(false);
    expect(byQ[qs[1].id].autoPoints).toBe(0);
    expect(byQ[qs[2].id].autoCorrect).toBe(true);
    expect(byQ[qs[2].id].autoPoints).toBe(1);

    const scores = await scoresFor(d, student.id);
    expect(scores.length).toBe(1);
    expect(scores[0].id).toBe(submitted.scoreRecordId);
    expect(scores[0].score).toBe(normalizeScore(3, 5));
    expect(scores[0].classId).toBe(cls.id);
    expect(scores[0].assessmentTypeId).toBe(type.id);
    expect(scores[0].date).toBe('2026-06-24');
  });

  it('text auto-grading forgives case and missing diacritics', async () => {
    const d = db();
    const { student, test, qs } = await setup(d, {
      questions: [{ type: 'text', prompt: 'Capital?', answerKey: ['Hà Nội'], points: 4 }],
    });
    const { attempt } = await attemptsSvc.start(d, test.id, student.id, new Date());
    await attemptsSvc.saveAnswers(
      d,
      attempt.id,
      student.id,
      [{ questionId: qs[0].id, answer: 'ha noi' }],
      new Date(),
    );
    const submitted = await attemptsSvc.submit(d, attempt.id, student.id, new Date());
    expect(submitted.autoScore).toBe(4);
    expect(submitted.normalizedScore).toBe(10);
    expect((await attemptsSvc.listAnswers(d, attempt.id))[0].autoCorrect).toBe(true);
  });

  it('submit with an essay parks the attempt in needs_grading with no gradebook row', async () => {
    const d = db();
    const { student, test, qs } = await setup(d, {
      questions: [
        { type: 'mcq', prompt: 'Pick b', options: OPTS, answerKey: 'b', points: 2 },
        { type: 'essay', prompt: 'Discuss', answerKey: null, points: 8 },
      ],
    });
    const { attempt } = await attemptsSvc.start(d, test.id, student.id, new Date());
    await attemptsSvc.saveAnswers(
      d,
      attempt.id,
      student.id,
      [
        { questionId: qs[0].id, answer: 'b' },
        { questionId: qs[1].id, answer: 'Some prose.' },
      ],
      new Date(),
    );

    const submitted = await attemptsSvc.submit(d, attempt.id, student.id, new Date());
    expect(submitted.status).toBe('needs_grading');
    expect(submitted.autoScore).toBe(2);
    expect(submitted.totalScore).toBeNull();
    expect(submitted.normalizedScore).toBeNull();
    expect(submitted.scoreRecordId).toBeNull();

    const rows = await attemptsSvc.listAnswers(d, attempt.id);
    const byQ = Object.fromEntries(rows.map((r) => [r.questionId, r]));
    expect(byQ[qs[1].id].autoCorrect).toBeNull();
    expect(byQ[qs[1].id].autoPoints).toBeNull();
    expect(byQ[qs[1].id].answer).toBe('Some prose.');

    // Nothing reaches the gradebook until a human grades it.
    expect(await scoresFor(d, student.id)).toEqual([]);
  });

  it('submit is idempotent: a second call returns the row unchanged', async () => {
    const d = db();
    const { student, test, qs } = await setup(d, { questions: THREE_Q });
    const { attempt } = await attemptsSvc.start(d, test.id, student.id, new Date());
    await attemptsSvc.saveAnswers(
      d,
      attempt.id,
      student.id,
      [{ questionId: qs[0].id, answer: 'b' }],
      new Date(),
    );
    const first = await attemptsSvc.submit(d, attempt.id, student.id, new Date());
    const second = await attemptsSvc.submit(
      d,
      attempt.id,
      student.id,
      new Date(Date.now() + 60_000),
    );
    expect(second).toEqual(first);
    expect(second.autoScore).toBe(2);
    expect((await scoresFor(d, student.id)).length).toBe(1);
  });

  it('grade awards manual points, totals them with the auto marks and syncs the gradebook', async () => {
    const d = db();
    const { student, test, qs } = await setup(d, {
      questions: [
        { type: 'mcq', prompt: 'Pick b', options: OPTS, answerKey: 'b', points: 2 },
        { type: 'essay', prompt: 'Discuss', answerKey: null, points: 8 },
      ],
    });
    const { attempt } = await attemptsSvc.start(d, test.id, student.id, new Date());
    await attemptsSvc.saveAnswers(
      d,
      attempt.id,
      student.id,
      [
        { questionId: qs[0].id, answer: 'b' },
        { questionId: qs[1].id, answer: 'Some prose.' },
      ],
      new Date(),
    );
    await attemptsSvc.submit(d, attempt.id, student.id, new Date());

    const graded = await attemptsSvc.grade(d, attempt.id, {
      attemptId: attempt.id,
      grades: [{ questionId: qs[1].id, manualPoints: 6, feedback: 'Good argument' }],
      comment: 'Well done',
    });
    expect(graded.status).toBe('graded');
    expect(graded.totalScore).toBe(8); // 2 auto + 6 manual
    expect(graded.normalizedScore).toBe(normalizeScore(8, 10));
    expect(graded.comment).toBe('Well done');
    expect(graded.scoreRecordId).toBeTruthy();

    const rows = await attemptsSvc.listAnswers(d, attempt.id);
    const essay = rows.find((r) => r.questionId === qs[1].id);
    expect(essay.manualPoints).toBe(6);
    expect(essay.feedback).toBe('Good argument');

    const scores = await scoresFor(d, student.id);
    expect(scores.length).toBe(1);
    expect(scores[0].id).toBe(graded.scoreRecordId);
    expect(scores[0].score).toBe(normalizeScore(8, 10));
    expect(scores[0].notes).toBe('Well done');

    // normalizedOverride wins over the computed value, reusing the same score record.
    const overridden = await attemptsSvc.grade(d, attempt.id, {
      attemptId: attempt.id,
      grades: [],
      normalizedOverride: 9.5,
      comment: 'Bumped',
    });
    expect(overridden.totalScore).toBe(8);
    expect(overridden.normalizedScore).toBe(9.5);
    expect(overridden.scoreRecordId).toBe(graded.scoreRecordId);
    const after = await scoresFor(d, student.id);
    expect(after.length).toBe(1);
    expect(after[0].score).toBe(9.5);
  });

  it('grade rejects a questionId that is not on the test with 400 unknown_question', async () => {
    const d = db();
    const { student, test } = await setup(d);
    const { attempt } = await attemptsSvc.start(d, test.id, student.id, new Date());
    const err = await expectThrown(() =>
      attemptsSvc.grade(d, attempt.id, {
        attemptId: attempt.id,
        grades: [{ questionId: 'no-such-question', manualPoints: 1 }],
      }),
    );
    expect(err.status).toBe(400);
    expect(await err.json()).toEqual({ error: 'unknown_question' });
  });

  it('reset deletes the attempt, its answers and its score record, and a retake starts fresh', async () => {
    const d = db();
    const { student, test, qs } = await setup(d, { questions: THREE_Q });
    const { attempt } = await attemptsSvc.start(d, test.id, student.id, new Date());
    await attemptsSvc.saveAnswers(
      d,
      attempt.id,
      student.id,
      [{ questionId: qs[0].id, answer: 'b' }],
      new Date(),
    );
    const submitted = await attemptsSvc.submit(d, attempt.id, student.id, new Date());
    expect(submitted.scoreRecordId).toBeTruthy();
    expect((await attemptsSvc.listAnswers(d, attempt.id)).length).toBe(3);

    await attemptsSvc.reset(d, attempt.id);

    expect(await attemptsSvc.listForTest(d, test.id)).toEqual([]);
    expect(await attemptsSvc.listAnswers(d, attempt.id)).toEqual([]);
    expect(await scoresFor(d, student.id)).toEqual([]);

    const again = await attemptsSvc.start(d, test.id, student.id, new Date());
    expect(again.attempt.id).not.toBe(attempt.id);
    expect(again.attempt.status).toBe('in_progress');
    expect(again.attempt.normalizedScore).toBeNull();
  });

  it('listOpenForStudent shows open online published tests and hides what the student cannot sit', async () => {
    const d = db();
    const { cls, student, test } = await setup(d);

    // A draft, a paper test and an online test for another class must not appear.
    const draft = await setup(d, { publish: false });
    await d.update(testsTable).set({ classId: cls.id }).where(eq(testsTable.id, draft.test.id));
    const paper = await setup(d, { mode: 'paper' });
    await d.update(testsTable).set({ classId: cls.id }).where(eq(testsTable.id, paper.test.id));
    const foreign = await setup(d); // its own class, this student is not in it

    const items = await attemptsSvc.listOpenForStudent(d, student.id, new Date());
    const ids = items.map((i) => i.test.id);
    expect(ids).toContain(test.id);
    expect(ids).not.toContain(draft.test.id);
    expect(ids).not.toContain(paper.test.id);
    expect(ids).not.toContain(foreign.test.id);

    const mine = items.find((i) => i.test.id === test.id);
    expect(mine.window).toBe('open');
    expect(mine.attempt).toBeNull();
    expect(mine.test.classId).toBe(cls.id);
    expect(mine.test.mode).toBe('online');

    // A closed test appears only once the student has an attempt on it.
    const closed = await setup(d);
    await d.update(testsTable).set({ classId: cls.id }).where(eq(testsTable.id, closed.test.id));
    await attemptsSvc.start(d, closed.test.id, student.id, new Date());
    await d
      .update(testsTable)
      .set({ closeAt: iso(-60 * 60 * 1000) })
      .where(eq(testsTable.id, closed.test.id));

    const withClosed = await attemptsSvc.listOpenForStudent(d, student.id, new Date());
    const closedItem = withClosed.find((i) => i.test.id === closed.test.id);
    expect(closedItem).toBeTruthy();
    expect(closedItem.window).toBe('closed');
    expect(closedItem.attempt.status).toBe('in_progress');
    // Open ones sort ahead of closed ones.
    const positions = withClosed.map((i) => i.window);
    expect(positions.indexOf('closed')).toBe(positions.length - 1);
  });
});
