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
  materials,
  sessions,
  scoreRecords,
  behaviorRecords,
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
    const count = await feedbackSvc.countNew(db());
    expect(count).toBeGreaterThanOrEqual(1);
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
      label: 'Kiểm tra 15 phút',
    });
    expect(rec.id).toBeTruthy();
    expect(rec.score).toBe(7.5);

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
