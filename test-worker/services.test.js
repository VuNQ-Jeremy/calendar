import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { and, eq, sql } from 'drizzle-orm';
import { createDb } from '../server/db/index';
import * as classesSvc from '../server/services/classes';
import * as eventsSvc from '../server/services/events';
import * as materialsSvc from '../server/services/materials';
import * as classMaterialsSvc from '../server/services/class-materials';
import * as themeSvc from '../server/services/theme';
import * as userSettingsSvc from '../server/services/user-settings';
import * as feedbackSvc from '../server/services/feedback';
import * as authSvc from '../server/services/auth';
import * as peopleSvc from '../server/services/people';
import * as invitesSvc from '../server/services/invites';
import * as assessSvc from '../server/services/assessments';
import * as typesSvc from '../server/services/assessment-types';
import * as attendanceSvc from '../server/services/attendance';
import * as parentPortalSvc from '../server/services/parent-portal';
import * as gradeLevelsSvc from '../server/services/grade-levels';
import * as tuitionSvc from '../server/services/tuition';
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
  materials,
  sessions,
  scoreRecords,
  behaviorRecords,
  attendanceRecords,
  settings,
  userSettings,
  questions as questionsTable,
  tests as testsTable,
  testQuestions,
  testAttempts,
  testAnswers,
  classPrices,
  tuitionLines,
  tuitionMonths,
} from '../server/db/schema';

function db() {
  return createDb(env);
}

describe('classes service', () => {
  it('creates and lists a class', async () => {
    const cls = await classesSvc.create(db(), {
      name: 'Math 101',
      color: 'blue',
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
      studentIds: [],
    });
    await classesSvc.remove(db(), cls.id);
    const list = await classesSvc.list(db());
    expect(list.some((c) => c.id === cls.id)).toBe(false);
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

// ---- Per-account settings (migration 0043) ----

describe('user-settings service', () => {
  it('falls back to the global settings row, then to defaults', async () => {
    const stamp = crypto.randomUUID();
    const { accountId } = await seedStaffAccount(db(), {
      email: `us-fallback-${stamp}@test.com`,
      password: 'pw',
    });
    const key = `probe-${stamp}`;
    const defaults = { a: 1, b: 'x' };

    // Nothing anywhere -> defaults.
    expect(await userSettingsSvc.readJson(db(), accountId, key, defaults)).toEqual(defaults);

    // Global row only -> global, merged over defaults (b survives).
    await userSettingsSvc.writeSchoolJson(db(), key, { a: 2 });
    expect(await userSettingsSvc.readJson(db(), accountId, key, defaults)).toEqual({
      a: 2,
      b: 'x',
    });

    // My row wins over the global row.
    await userSettingsSvc.writeJson(db(), accountId, key, { a: 3, b: 'mine' });
    expect(await userSettingsSvc.readJson(db(), accountId, key, defaults)).toEqual({
      a: 3,
      b: 'mine',
    });
    // …and the global row is untouched by that write.
    expect(await userSettingsSvc.readSchoolJson(db(), key, defaults)).toEqual({ a: 2, b: 'x' });
  });

  it('keeps two accounts independent', async () => {
    const stamp = crypto.randomUUID();
    const a = await seedStaffAccount(db(), { email: `us-a-${stamp}@test.com`, password: 'pw' });
    const b = await seedStaffAccount(db(), { email: `us-b-${stamp}@test.com`, password: 'pw' });
    const key = `k-${stamp}`;
    const defaults = { v: 0 };

    await userSettingsSvc.writeJson(db(), a.accountId, key, { v: 1 });
    expect(await userSettingsSvc.readJson(db(), a.accountId, key, defaults)).toEqual({ v: 1 });
    expect(await userSettingsSvc.readJson(db(), b.accountId, key, defaults)).toEqual({ v: 0 });
  });

  it('upserts rather than duplicating, and bulk-reads every account at once', async () => {
    const stamp = crypto.randomUUID();
    const key = `bulk-${stamp}`;
    const a = await seedStaffAccount(db(), { email: `us-c-${stamp}@test.com`, password: 'pw' });
    await userSettingsSvc.writeJson(db(), a.accountId, key, { v: 1 });
    await userSettingsSvc.writeJson(db(), a.accountId, key, { v: 2 });

    const rows = await db()
      .select()
      .from(userSettings)
      .where(and(eq(userSettings.accountId, a.accountId), eq(userSettings.key, key)));
    expect(rows).toHaveLength(1);

    const all = await userSettingsSvc.readJsonForAll(db(), key, { v: 0 });
    expect(all.get(a.accountId)).toEqual({ v: 2 });
  });

  it('a corrupt row degrades to the fallback instead of throwing', async () => {
    const stamp = crypto.randomUUID();
    const a = await seedStaffAccount(db(), { email: `us-d-${stamp}@test.com`, password: 'pw' });
    await db()
      .insert(userSettings)
      .values({ accountId: a.accountId, key: `bad-${stamp}`, value: 'not json' });
    expect(await userSettingsSvc.readJson(db(), a.accountId, `bad-${stamp}`, { v: 7 })).toEqual({
      v: 7,
    });
  });

  it('deleting the account takes its preferences with it', async () => {
    const stamp = crypto.randomUUID();
    const a = await seedStaffAccount(db(), { email: `us-e-${stamp}@test.com`, password: 'pw' });
    await userSettingsSvc.writeJson(db(), a.accountId, `casc-${stamp}`, { v: 1 });
    await db().delete(accounts).where(eq(accounts.id, a.accountId));
    const left = await db()
      .select()
      .from(userSettings)
      .where(eq(userSettings.accountId, a.accountId));
    expect(left).toHaveLength(0);
  });
});

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

/**
 * Linked invites — the code the People screen mints for someone who already exists.
 *
 * The whole point is that redeeming must NOT create a second person: before this, a
 * student the school had entered and then invited ended up in the roster twice.
 */
describe('auth service — linked invite redemption', () => {
  it('mints a linked code and attaches an account to the existing student', async () => {
    const d = db();
    const student = await peopleSvc.createStudent(d, {
      name: 'Linked Student',
      color: 'blue',
      classIds: [],
    });
    const before = (await peopleSvc.listStudents(d)).length;

    const [invite] = await invitesSvc.createLinked(d, [{ role: 'Student', studentId: student.id }]);
    expect(invite.code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    expect(invite.studentId).toBe(student.id);

    const result = await authSvc.redeemInvite(d, invite.code, {
      name: 'Whatever They Typed',
      email: 'linked-student@test.com',
      password: 'pw123456',
    });
    expect(result).not.toBeNull();

    // No duplicate row, and the name staff entered is the one that survives.
    const after = await peopleSvc.listStudents(d);
    expect(after.length).toBe(before);
    expect(after.find((s) => s.id === student.id)?.name).toBe('Linked Student');

    const account = await d.query.accounts.findFirst({
      where: eq(accounts.studentId, student.id),
    });
    expect(account?.id).toBe(result.accountId);

    const list = await invitesSvc.list(d);
    expect(list.find((i) => i.id === invite.id)?.used).toBe(true);
    expect(list.find((i) => i.id === invite.id)?.personName).toBe('Linked Student');
  });

  // The legacy path hardcodes role 'Teacher'; an Admin invited by code must stay an Admin.
  it('leaves a linked staff row its own role and colour', async () => {
    const d = db();
    const member = await peopleSvc.createStaff(d, {
      name: 'Linked Admin',
      role: 'Admin',
      color: 'cocoa',
    });
    const [invite] = await invitesSvc.createLinked(d, [{ role: 'Staff', staffId: member.id }]);
    await authSvc.redeemInvite(d, invite.code, {
      name: 'Ignored',
      password: 'pw123456',
    });
    const after = (await peopleSvc.listStaff(d)).find((s) => s.id === member.id);
    expect(after.role).toBe('Admin');
    expect(after.color).toBe('cocoa');
  });

  it('backfills an email only when staff left it blank', async () => {
    const d = db();
    const blank = await peopleSvc.createStudent(d, {
      name: 'No Email',
      color: 'blue',
      classIds: [],
    });
    const set = await peopleSvc.createStudent(d, {
      name: 'Has Email',
      email: 'staff-entered@test.com',
      color: 'blue',
      classIds: [],
    });
    const codes = await invitesSvc.createLinked(d, [
      { role: 'Student', studentId: blank.id },
      { role: 'Student', studentId: set.id },
    ]);
    await authSvc.redeemInvite(d, codes[0].code, {
      name: 'x',
      email: 'they-signed-up@test.com',
      password: 'pw123456',
    });
    await authSvc.redeemInvite(d, codes[1].code, {
      name: 'x',
      email: 'different@test.com',
      password: 'pw123456',
    });
    const after = await peopleSvc.listStudents(d);
    expect(after.find((s) => s.id === blank.id)?.email).toBe('they-signed-up@test.com');
    expect(after.find((s) => s.id === set.id)?.email).toBe('staff-entered@test.com');
  });

  // Staff can issue a second code before the first is redeemed. One login per person.
  it('refuses a second code once the person has an account', async () => {
    const d = db();
    const student = await peopleSvc.createStudent(d, {
      name: 'Twice Invited',
      color: 'blue',
      classIds: [],
    });
    const first = await invitesSvc.createLinked(d, [{ role: 'Student', studentId: student.id }]);
    const second = await invitesSvc.createLinked(d, [{ role: 'Student', studentId: student.id }]);

    expect(
      await authSvc.redeemInvite(d, first[0].code, { name: 'x', password: 'pw123456' }),
    ).not.toBeNull();
    expect(
      await authSvc.redeemInvite(d, second[0].code, { name: 'x', password: 'pw999999' }),
    ).toBeNull();
  });

  // ON DELETE CASCADE: removing the person removes the code they were never going to use.
  it('drops a linked invite when the person is deleted', async () => {
    const d = db();
    const student = await peopleSvc.createStudent(d, {
      name: 'Deleted Soon',
      color: 'blue',
      classIds: [],
    });
    const [invite] = await invitesSvc.createLinked(d, [{ role: 'Student', studentId: student.id }]);
    await peopleSvc.removeStudent(d, student.id);
    const list = await invitesSvc.list(d);
    expect(list.some((i) => i.id === invite.id)).toBe(false);
  });

  // Linking a sibling's parent must not mint them a second code: the first is either
  // already spent (they have an account) or still waiting in the Invites tab.
  it('only wants a code for someone who has neither an account nor one waiting', async () => {
    const d = db();
    const fresh = await peopleSvc.createParent(d, {
      name: 'Fresh',
      color: 'green',
      studentIds: [],
    });
    const target = { role: 'Parent', parentId: fresh.id };
    // A parent carried over from before linked invites: nothing issued, so mint one.
    expect(await invitesSvc.needsInvite(d, target)).toBe(true);

    const [open] = await invitesSvc.createLinked(d, [target]);
    expect(await invitesSvc.needsInvite(d, target)).toBe(false); // code still waiting

    await authSvc.redeemInvite(d, open.code, { name: 'x', password: 'pw123456' });
    expect(await invitesSvc.needsInvite(d, target)).toBe(false); // now they have a login
  });

  it('links a second child to an existing parent without dropping the first', async () => {
    const d = db();
    const first = await peopleSvc.createStudent(d, { name: 'Older', color: 'blue', classIds: [] });
    const second = await peopleSvc.createStudent(d, {
      name: 'Younger',
      color: 'blue',
      classIds: [],
    });
    const parent = await peopleSvc.createParent(d, {
      name: 'One Mother',
      color: 'green',
      studentIds: [first.id],
    });

    await peopleSvc.linkParentToStudent(d, parent.id, second.id);
    // Re-linking is a no-op, not a primary-key error.
    await peopleSvc.linkParentToStudent(d, parent.id, second.id);

    const after = await peopleSvc.findParent(d, parent.id);
    expect(after.studentIds.sort()).toEqual([first.id, second.id].sort());
    // And still exactly one parent row for the family.
    expect((await peopleSvc.listParents(d)).filter((p) => p.name === 'One Mother')).toHaveLength(1);
  });

  it('resolves a parent account to kind parent', async () => {
    const d = db();
    const parent = await peopleSvc.createParent(d, {
      name: 'Signed In Parent',
      color: 'green',
      relation: 'Mother',
      studentIds: [],
    });
    const [invite] = await invitesSvc.createLinked(d, [{ role: 'Parent', parentId: parent.id }]);
    const result = await authSvc.redeemInvite(d, invite.code, {
      name: 'x',
      email: 'signed-in-parent@test.com',
      password: 'pw123456',
    });
    expect(result).not.toBeNull();

    const token = await authSvc.createSession(d, result.accountId, true);
    const session = await authSvc.userFromToken(d, token);
    expect(session.kind).toBe('parent');
    expect(session.user.id).toBe(parent.id);
    expect(session.user.name).toBe('Signed In Parent');
    expect(session.user.role).toBe('Parent');
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
  // The row is inserted directly rather than through classesSvc.create, because the weekly
  // schedule editor was removed from the product on 2026-07-29 (commit 25bdb89): `schedule`
  // is gone from ClassInput, so create() silently drops it and no public API can produce a
  // class_schedule row any more. The table stays dormant so the decision is reversible
  // without a migration, and this test guards the ON DELETE CASCADE that makes it safe to
  // leave sitting there. Going through create() left the assertion vacuous — it failed in
  // setup, so the cascade below was never actually reached.
  it('cascades class_schedule rows', async () => {
    const d = db();
    const cls = await classesSvc.create(d, {
      name: 'Cascade Test',
      color: 'blue',
      studentIds: [],
    });

    await d
      .insert(classSchedule)
      .values({ classId: cls.id, day: 1, startTime: '09:00', endTime: '10:00' });

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

  it('cascades class_materials rows but keeps the material itself', async () => {
    const d = db();
    const cls = await classesSvc.create(d, {
      name: 'Mat Class',
      color: 'rose',
      studentIds: [],
    });
    const mat = await materialsSvc.create(d, {
      title: 'Mat Item',
      type: 'notes',
      favorite: false,
    });
    await classMaterialsSvc.setForClass(d, cls.id, [mat.id]);

    await classesSvc.remove(d, cls.id);

    expect(await classMaterialsSvc.listForClass(d, cls.id)).toEqual([]);
    // The file survives the class — it is library content, not class content.
    const matRows = await d.select().from(materials).where(eq(materials.id, mat.id));
    expect(matRows).toHaveLength(1);
  });
});

describe('class materials — the shared library', () => {
  it('links one material to two classes, and replaces a class set wholesale', async () => {
    const d = db();
    const a = await classesSvc.create(d, { name: 'Class A', color: 'green', studentIds: [] });
    const b = await classesSvc.create(d, { name: 'Class B', color: 'blue', studentIds: [] });
    const m1 = await materialsSvc.create(d, { title: 'Shared', type: 'notes', favorite: false });
    const m2 = await materialsSvc.create(d, { title: 'Other', type: 'notes', favorite: false });

    await classMaterialsSvc.setForClass(d, a.id, [m1.id]);
    await classMaterialsSvc.setForClass(d, b.id, [m1.id, m2.id]);

    // Attaching to B did not steal it from A — that was the whole bug (feedback F-21).
    expect(await classMaterialsSvc.listForClass(d, a.id)).toEqual([m1.id]);
    expect(await classMaterialsSvc.listForClass(d, b.id)).toEqual([m1.id, m2.id]);

    // Replace-set: the submitted list becomes the whole set, for that class only.
    await classMaterialsSvc.setForClass(d, b.id, [m2.id]);
    expect(await classMaterialsSvc.listForClass(d, b.id)).toEqual([m2.id]);
    expect(await classMaterialsSvc.listForClass(d, a.id)).toEqual([m1.id]);
  });

  it('listAll returns every pair, across classes', async () => {
    const d = db();
    const a = await classesSvc.create(d, { name: 'Pairs A', color: 'green', studentIds: [] });
    const b = await classesSvc.create(d, { name: 'Pairs B', color: 'blue', studentIds: [] });
    const m = await materialsSvc.create(d, { title: 'Both', type: 'notes', favorite: false });
    await classMaterialsSvc.setForClass(d, a.id, [m.id]);
    await classMaterialsSvc.setForClass(d, b.id, [m.id]);

    const pairs = await classMaterialsSvc.listAll(d);
    expect(pairs).toEqual(
      expect.arrayContaining([
        { classId: a.id, materialId: m.id },
        { classId: b.id, materialId: m.id },
      ]),
    );
  });

  it('deleting the material drops its class links', async () => {
    const d = db();
    const cls = await classesSvc.create(d, { name: 'Class C', color: 'violet', studentIds: [] });
    const mat = await materialsSvc.create(d, { title: 'Doomed', type: 'notes', favorite: false });
    await classMaterialsSvc.setForClass(d, cls.id, [mat.id]);

    await materialsSvc.remove(d, mat.id);

    expect(await classMaterialsSvc.listForClass(d, cls.id)).toEqual([]);
  });
});

describe('FK cascade — delete student', () => {
  it('cascades class_students and parent_students rows', async () => {
    const d = db();
    const cls = await classesSvc.create(d, {
      name: 'FK Class',
      color: 'blue',
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

describe('monthly remarks provenance', () => {
  it('stamps created_at/updated_at/staff_id on create; created_at and sent_at survive the upsert', async () => {
    const d = db();
    const teacher = await peopleSvc.createStaff(d, { name: 'T', role: 'Teacher', color: 'blue' });
    const student = await peopleSvc.createStudent(d, { name: 'S', color: 'green', classIds: [] });
    const input = { studentId: student.id, month: '2026-07', ratings: { rc: 4 }, comment: 'x' };

    const first = await assessSvc.createRemark(d, input, teacher.id);
    expect(first.staffId).toBe(teacher.id);
    expect(first.createdAt).toBeTruthy();
    expect(first.updatedAt).toBeTruthy();
    expect(first.sentAt).toBeNull();

    await assessSvc.markRemarkSent(d, first.id);
    const second = await assessSvc.createRemark(d, { ...input, comment: 'y' }, null);
    expect(second.id).toBe(first.id); // upsert landed on the same row
    expect(second.createdAt).toBe(first.createdAt); // first save survives
    expect(second.sentAt).toBeTruthy(); // delivery survives a re-save
    expect(second.staffId).toBeNull(); // last author wins

    const patched = await assessSvc.updateRemark(d, first.id, { comment: 'z' }, teacher.id);
    expect(patched.staffId).toBe(teacher.id);
    expect(patched.comment).toBe('z');
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

  /**
   * Read one question back through the service's own mapping (there is no `get` export). The suite
   * shares a single database with no per-test cleanup, so every assertion below is scoped to the ids
   * the test created rather than to the state of a whole table.
   */
  async function getQuestion(d, id) {
    return (await questionsSvc.list(d)).find((q) => q.id === id);
  }

  async function idsPresent(d, ids) {
    const all = new Set(
      (await d.select({ id: questionsTable.id }).from(questionsTable)).map((r) => r.id),
    );
    return ids.filter((id) => all.has(id));
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

  it('removeMany deletes the free questions and keeps the ones a test uses', async () => {
    const d = db();
    const free1 = await questionsSvc.create(d, mcqInput({ prompt: 'Free 1' }));
    const free2 = await questionsSvc.create(d, mcqInput({ prompt: 'Free 2' }));
    const linked = await questionsSvc.create(d, mcqInput({ prompt: 'Linked' }));
    const testId = await seedTest(d, 'Keeps One');
    await linkQuestion(d, testId, linked.id);

    const result = await questionsSvc.removeMany(d, [free1.id, linked.id, free2.id]);
    expect(result).toEqual({ deleted: 2, skippedInUse: 1 });

    // The whole point: the batch does NOT fail because one member was in use, and the in-use one
    // is still there afterwards rather than having been taken with the rest.
    expect(await idsPresent(d, [free1.id, free2.id, linked.id])).toEqual([linked.id]);
  });

  it('removeMany handles more ids than one statement can bind', async () => {
    const d = db();
    const created = await questionsSvc.createMany(
      d,
      Array.from({ length: 120 }, (_, i) => mcqInput({ prompt: `Bulk del ${i}` })),
    );
    const ids = created.map((q) => q.id);
    const result = await questionsSvc.removeMany(d, ids);
    expect(result).toEqual({ deleted: 120, skippedInUse: 0 });
    expect(await idsPresent(d, ids)).toEqual([]);
  });

  it('removeMany on an empty selection touches nothing', async () => {
    const d = db();
    const q = await questionsSvc.create(d, mcqInput({ prompt: 'Survivor' }));
    expect(await questionsSvc.removeMany(d, [])).toEqual({ deleted: 0, skippedInUse: 0 });
    expect(await idsPresent(d, [q.id])).toEqual([q.id]);
  });

  it('bulkSetMeta writes grade level and difficulty across a chunk boundary', async () => {
    const d = db();
    const created = await questionsSvc.createMany(
      d,
      Array.from({ length: 120 }, (_, i) =>
        mcqInput({ prompt: `Meta ${i}`, gradeLevelId: null, difficulty: 'easy' }),
      ),
    );
    const ids = created.map((q) => q.id);
    const n = await questionsSvc.bulkSetMeta(d, ids, {
      gradeLevelId: 'gl9',
      difficulty: 'hard',
    });
    expect(n).toBe(120);

    const idSet = new Set(ids);
    const rows = (await d.select().from(questionsTable)).filter((r) => idSet.has(r.id));
    expect(rows.length).toBe(120);
    expect(rows.every((r) => r.gradeLevelId === 'gl9' && r.difficulty === 'hard')).toBe(true);
  });

  it('bulkSetMeta clears a field when given null, and leaves the other alone', async () => {
    const d = db();
    const q = await questionsSvc.create(d, mcqInput({ gradeLevelId: 'gl6', difficulty: 'medium' }));
    await questionsSvc.bulkSetMeta(d, [q.id], { difficulty: null });
    const after = await getQuestion(d, q.id);
    expect(after.difficulty).toBe(null);
    expect(after.gradeLevelId).toBe('gl6');
  });

  it('bulkSetMeta works on a question locked by an attempt — metadata is not the answer', async () => {
    const d = db();
    const q = await questionsSvc.create(d, mcqInput({ prompt: 'Locked but taggable' }));
    const testId = await seedTest(d, 'Attempted Test');
    await linkQuestion(d, testId, q.id);
    await seedAttempt(d, testId);

    // `update` would 409 here if the patch touched type/options/answerKey. Grade and difficulty
    // cannot invalidate a graded attempt, so the bulk path is allowed to write them.
    await questionsSvc.bulkSetMeta(d, [q.id], { difficulty: 'hard' });
    expect((await getQuestion(d, q.id)).difficulty).toBe('hard');
  });

  it('bulkAddTags merges without duplicating, and skips rows that already have the tag', async () => {
    const d = db();
    const a = await questionsSvc.create(d, mcqInput({ prompt: 'A', tags: ['algebra'] }));
    const b = await questionsSvc.create(d, mcqInput({ prompt: 'B', tags: ['geometry'] }));

    expect(await questionsSvc.bulkAddTags(d, [a.id, b.id], ['unit 3'])).toBe(2);
    expect((await getQuestion(d, a.id)).tags).toEqual(['algebra', 'unit 3']);
    expect((await getQuestion(d, b.id)).tags).toEqual(['geometry', 'unit 3']);

    // Re-running the same add is free: both rows already carry it, so nothing is written and
    // updatedAt (which the bank sorts by) does not churn.
    expect(await questionsSvc.bulkAddTags(d, [a.id, b.id], ['unit 3'])).toBe(0);
    expect((await getQuestion(d, a.id)).tags).toEqual(['algebra', 'unit 3']);
  });

  it('bulkAddTags respects the twenty-tag cap rather than dropping an older tag', async () => {
    const d = db();
    const full = Array.from({ length: 20 }, (_, i) => `t${i}`);
    const q = await questionsSvc.create(d, mcqInput({ tags: full }));
    await questionsSvc.bulkAddTags(d, [q.id], ['overflow']);
    const after = await getQuestion(d, q.id);
    expect(after.tags).toEqual(full);
    expect(after.tags).not.toContain('overflow');
  });

  it('createMany inserts every row and returns them in submitted order', async () => {
    const d = db();
    const inputs = ['Bulk A', 'Bulk B', 'Bulk C'].map((prompt) => mcqInput({ prompt }));
    const created = await questionsSvc.createMany(d, inputs);

    expect(created.map((r) => r.prompt)).toEqual(['Bulk A', 'Bulk B', 'Bulk C']);
    expect(new Set(created.map((r) => r.id)).size).toBe(3);
    // JSON columns must round-trip the same way the single-row create does.
    expect(created[0].options).toEqual(OPTS);
    expect(created[0].answerKey).toBe('b');
    expect(created[0].tags).toEqual(['algebra']);

    const list = await questionsSvc.list(d);
    for (const row of created) expect(list.some((item) => item.id === row.id)).toBe(true);
  });

  it('createMany on an empty list is a no-op', async () => {
    expect(await questionsSvc.createMany(db(), [])).toEqual([]);
  });

  it('round-trips the shared passage through create, createMany and update', async () => {
    const d = db();
    const passage = 'Read the passage.\n\nWater covers most of the planet.';

    const single = await questionsSvc.create(
      d,
      mcqInput({ prompt: 'With passage', context: passage }),
    );
    expect(single.context).toBe(passage);
    // A question with no passage stores null, not an empty string — the take screen keys off that.
    expect((await questionsSvc.create(d, mcqInput({ prompt: 'No passage' }))).context).toBeNull();

    const bulk = await questionsSvc.createMany(d, [
      mcqInput({ prompt: 'Bulk with passage', context: passage }),
      mcqInput({ prompt: 'Bulk without' }),
    ]);
    expect(bulk.map((r) => r.context)).toEqual([passage, null]);

    const edited = await questionsSvc.update(d, single.id, { context: 'A different passage.' });
    expect(edited.context).toBe('A different passage.');
    // Clearing it must survive the merge-and-revalidate path in `update`.
    expect((await questionsSvc.update(d, single.id, { context: null })).context).toBeNull();
    // An unrelated patch leaves it alone.
    const kept = await questionsSvc.update(d, bulk[0].id, { prompt: 'Renamed' });
    expect(kept.context).toBe(passage);
  });

  it('appendQuestions keeps the questions already on the test', async () => {
    const d = db();
    const existing = await questionsSvc.create(d, mcqInput({ prompt: 'Was already here' }));
    const testId = await seedTest(d, 'Append Test');
    await testsSvc.setQuestions(d, testId, [{ questionId: existing.id, points: 2 }]);

    const added = await questionsSvc.createMany(d, [
      mcqInput({ prompt: 'Imported 1' }),
      mcqInput({ prompt: 'Imported 2' }),
    ]);
    const links = await testsSvc.appendQuestions(
      d,
      testId,
      added.map((row) => ({ questionId: row.id, points: 1 })),
    );

    // The original link survives with its own points, and the new ones land after it in order.
    expect(links.map((l) => l.questionId)).toEqual([existing.id, added[0].id, added[1].id]);
    expect(links.map((l) => l.sortOrder)).toEqual([0, 1, 2]);
    expect(links.find((l) => l.questionId === existing.id).points).toBe(2);
  });

  it('appendQuestions skips a question the test already links', async () => {
    const d = db();
    const q = await questionsSvc.create(d, mcqInput({ prompt: 'Already linked' }));
    const testId = await seedTest(d, 'Dedupe Test');
    await testsSvc.setQuestions(d, testId, [{ questionId: q.id, points: 3 }]);

    const links = await testsSvc.appendQuestions(d, testId, [{ questionId: q.id, points: 1 }]);
    expect(links.length).toBe(1);
    // Not re-added and not repriced — the existing link is left exactly as it was.
    expect(links[0].points).toBe(3);
  });

  it('appendQuestions throws 409 test_has_attempts once the test has been sat', async () => {
    const d = db();
    const seeded = await questionsSvc.create(d, mcqInput({ prompt: 'On sat test' }));
    const testId = await seedTest(d, 'Sat Test');
    await linkQuestion(d, testId, seeded.id);
    await seedAttempt(d, testId, 'Append Blocked Student');

    const fresh = await questionsSvc.create(d, mcqInput({ prompt: 'Too late' }));
    let err = null;
    try {
      await testsSvc.appendQuestions(d, testId, [{ questionId: fresh.id, points: 1 }]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Response);
    expect(err.status).toBe(409);
    expect(await err.json()).toEqual({ error: 'test_has_attempts' });
  });

  it('setQuestions saves a full 100-question test', async () => {
    // Regression: one INSERT per link binds 4 parameters per row, and D1 rejects a statement
    // over 100 of them — so this used to die with `D1_ERROR: too many SQL variables` somewhere
    // past 25 questions. Same ceiling applies to the unknown-question `inArray` check.
    const d = db();
    const testId = await seedTest(d, 'Hundred Test');
    const created = await questionsSvc.createMany(
      d,
      Array.from({ length: 100 }, (_, i) => mcqInput({ prompt: `Q${i}` })),
    );

    const links = await testsSvc.setQuestions(
      d,
      testId,
      created.map((row) => ({ questionId: row.id, points: 1 })),
    );
    expect(links.length).toBe(100);
    // Order is preserved across the chunk boundaries, not just within a chunk.
    expect(links.map((l) => l.questionId)).toEqual(created.map((row) => row.id));
    expect(links.map((l) => l.sortOrder)).toEqual(created.map((_, i) => i));
  });

  it('appendQuestions refuses to push a test past 100 questions', async () => {
    const d = db();
    const testId = await seedTest(d, 'Full Test');
    const existing = await questionsSvc.createMany(
      d,
      Array.from({ length: 99 }, (_, i) => mcqInput({ prompt: `Seat ${i}` })),
    );
    await testsSvc.setQuestions(
      d,
      testId,
      existing.map((row) => ({ questionId: row.id, points: 1 })),
    );

    const extra = await questionsSvc.createMany(d, [
      mcqInput({ prompt: 'Fits' }),
      mcqInput({ prompt: 'Overflows' }),
    ]);
    let err = null;
    try {
      await testsSvc.appendQuestions(
        d,
        testId,
        extra.map((row) => ({ questionId: row.id, points: 1 })),
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Response);
    expect(err.status).toBe(400);
    expect(await err.json()).toEqual({ error: 'too_many_questions' });
    // Rejected before any write: the test still holds exactly what it did.
    expect((await testsSvc.listQuestionLinks(d, testId)).length).toBe(99);
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

  /**
   * LAST IN THIS DESCRIBE ON PURPOSE. `wipe` is global by definition and this suite shares one
   * database with no per-test cleanup, so anything running after these would find the bank emptied
   * out from under it. Keep new question tests above this line.
   */
  describe('wipe', () => {
    it('empties the bank, detaches every test, and cascades the students answers away', async () => {
      const d = db();
      const linked = await questionsSvc.create(d, mcqInput({ prompt: 'On a test' }));
      const testId = await seedTest(d, 'Wipe Test');
      await linkQuestion(d, testId, linked.id);
      const { attemptId } = await seedAttempt(d, testId, 'Wipe Student');
      await d
        .insert(testAnswers)
        .values({ attemptId, questionId: linked.id, answer: '"b"', correct: 1 });

      // Counted rather than hard-coded: earlier tests in this file left their own rows behind.
      const [{ n: before }] = await d.select({ n: sql`count(*)` }).from(questionsTable);
      const result = await questionsSvc.wipe(d);
      expect(result.deleted).toBe(Number(before));
      expect(result.detachedFromTests).toBeGreaterThanOrEqual(1);

      expect(await d.select().from(questionsTable)).toEqual([]);
      expect(await d.select().from(testQuestions)).toEqual([]);
      // test_answers.questionId DOES cascade, so this row is gone with it. That is the real cost of
      // the wipe, and the confirmation dialog says so in as many words.
      expect(await d.select().from(testAnswers)).toEqual([]);
      // The test and the attempt survive, so any score already recorded is untouched.
      expect((await d.select().from(testsTable).where(eq(testsTable.id, testId))).length).toBe(1);
      expect(
        (await d.select().from(testAttempts).where(eq(testAttempts.id, attemptId))).length,
      ).toBe(1);
    });

    it('reports nothing and does not throw on an already empty bank', async () => {
      const d = db();
      expect(await questionsSvc.wipe(d)).toEqual({ deleted: 0, detachedFromTests: 0 });
    });
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

  it('update refuses a mode change once an attempt exists, and keeps the stored mode', async () => {
    const d = db();
    const t = await testsSvc.create(d, {
      title: 'WP2a Mode Lock',
      mode: 'online',
      closeAt: '2026-08-01T10:00:00.000Z',
    });
    const q = await makeQuestion(d, 'Mode Lock Q');
    await testsSvc.setQuestions(d, t.id, [{ questionId: q.id, points: 1 }]);
    await testsSvc.publish(d, t.id);

    // With no attempts yet the door is still open, both ways.
    expect((await testsSvc.update(d, t.id, { mode: 'paper' })).mode).toBe('paper');
    expect((await testsSvc.update(d, t.id, { mode: 'online' })).mode).toBe('online');

    await seedAttempt(d, t.id, { source: 'online', status: 'submitted' });

    const err = await expectThrown(() => testsSvc.update(d, t.id, { mode: 'paper' }));
    expect(err.status).toBe(409);
    expect(await err.json()).toEqual({ error: 'test_has_attempts' });
    expect((await testsSvc.get(d, t.id)).mode).toBe('online');

    // Re-sending the mode it already has is not a change, so it still succeeds.
    const same = await testsSvc.update(d, t.id, { mode: 'online', title: 'WP2a Mode Lock II' });
    expect(same.mode).toBe('online');
    expect(same.title).toBe('WP2a Mode Lock II');
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

    const { attempts } = await testsSvc.savePaperScores(d, test.id, [
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

    const { attempts: first } = await testsSvc.savePaperScores(d, test.id, [
      { studentId: s1.id, score: 6, comment: 'ok' },
    ]);
    const scoreRecordId = first.find((a) => a.studentId === s1.id).scoreRecordId;

    const { attempts: second } = await testsSvc.savePaperScores(d, test.id, [
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

    const { attempts: after } = await testsSvc.savePaperScores(d, test.id, [
      { studentId: s1.id, score: null, comment: null },
    ]);
    expect(after.find((a) => a.studentId === s1.id)).toBeUndefined();
    expect(after.length).toBe(0);
    expect(await scoresFor(d, s1.id)).toEqual([]);
  });

  it('invariant: a comment-only entry keeps the attempt but drops the score record', async () => {
    const d = db();
    const { s1, test } = await setup(d);
    const { attempts: first } = await testsSvc.savePaperScores(d, test.id, [
      { studentId: s1.id, score: 7, comment: 'scored' },
    ]);
    const scoreRecordId = first.find((a) => a.studentId === s1.id).scoreRecordId;
    expect(scoreRecordId).toBeTruthy();

    const { attempts: after } = await testsSvc.savePaperScores(d, test.id, [
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
    const { attempts } = await testsSvc.savePaperScores(d, test.id, [
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

  it('update clearing date to null propagates today in ICT to linked score records', async () => {
    const d = db();
    const { s1, test } = await setup(d);
    await testsSvc.savePaperScores(d, test.id, [{ studentId: s1.id, score: 6, comment: null }]);

    const before = await scoresFor(d, s1.id);
    expect(before.length).toBe(1);
    expect(before[0].date).toBe('2026-06-23');

    const expected = ictDateOf(new Date().toISOString());
    const updated = await testsSvc.update(d, test.id, { date: null });
    expect(updated.date).toBeNull();

    const rows = await scoresFor(d, s1.id);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(before[0].id);
    expect(rows[0].date).not.toBe('2026-06-23');
    expect(rows[0].date).toBe(expected);
  });

  it('update clearing classId to null propagates null to linked score records', async () => {
    const d = db();
    const { cls, s1, test } = await setup(d);
    await testsSvc.savePaperScores(d, test.id, [{ studentId: s1.id, score: 6, comment: null }]);

    const before = await scoresFor(d, s1.id);
    expect(before.length).toBe(1);
    expect(before[0].classId).toBe(cls.id);

    const updated = await testsSvc.update(d, test.id, { classId: null });
    expect(updated.classId).toBeNull();

    const rows = await scoresFor(d, s1.id);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(before[0].id);
    expect(rows[0].classId).toBeNull();
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

  it('skipped names the students whose online attempt blocked their paper record', async () => {
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

    const { attempts, skipped } = await testsSvc.savePaperScores(d, test.id, [
      { studentId: s1.id, score: 10, comment: 'paper override attempt' },
      { studentId: s2.id, score: 8, comment: 'fine' },
    ]);
    expect(skipped).toEqual([s1.id]);

    // A's attempt is untouched and no gradebook row was invented for them.
    const online = attempts.find((a) => a.studentId === s1.id);
    expect(online.id).toBe(onlineId);
    expect(online.source).toBe('online');
    expect(online.status).toBe('submitted');
    expect(online.normalizedScore).toBe(4.5);
    expect(online.comment).toBeNull();
    expect(online.scoreRecordId).toBeNull();
    expect(await scoresFor(d, s1.id)).toEqual([]);

    // B, who had nothing, is written normally.
    const paper = attempts.find((a) => a.studentId === s2.id);
    expect(paper.source).toBe('paper');
    expect(paper.status).toBe('graded');
    expect(paper.normalizedScore).toBe(8);
    const rows = await scoresFor(d, s2.id);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(paper.scoreRecordId);
    expect(rows[0].score).toBe(8);
    expect(rows[0].notes).toBe('fine');
  });

  it('skipped is empty on an ordinary all-paper save', async () => {
    const d = db();
    const { s1, s2, test } = await setup(d);

    const { attempts, skipped } = await testsSvc.savePaperScores(d, test.id, [
      { studentId: s1.id, score: 5, comment: null },
      { studentId: s2.id, score: null, comment: 'absent' },
    ]);
    expect(skipped).toEqual([]);
    expect(attempts.length).toBe(2);
    expect(attempts.every((a) => a.source === 'paper')).toBe(true);
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

    const { attempts: first } = await testsSvc.savePaperScores(d, test.id, payload);
    const { attempts: second } = await testsSvc.savePaperScores(d, test.id, payload);

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
        ['context', 'id', 'options', 'points', 'prompt', 'sortOrder', 'type'].sort(),
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

  it('reviewForStudent returns answer keys, explanations and marks once the attempt is graded', async () => {
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
        { questionId: qs[0].id, answer: 'a' },
        { questionId: qs[1].id, answer: 'Some prose.' },
      ],
      new Date(),
    );
    await attemptsSvc.submit(d, attempt.id, student.id, new Date());
    await attemptsSvc.grade(d, attempt.id, {
      attemptId: attempt.id,
      grades: [{ questionId: qs[1].id, manualPoints: 6, feedback: 'Good argument' }],
      comment: 'Well done',
    });

    const review = await attemptsSvc.reviewForStudent(d, attempt.id, student.id);
    expect(review.attempt.id).toBe(attempt.id);
    expect(review.attempt.status).toBe('graded');
    expect(review.attempt.comment).toBe('Well done');

    // Questions in sortOrder, WITH the key material.
    expect(review.questions.map((q) => q.id)).toEqual([qs[0].id, qs[1].id]);
    expect(review.questions[0].answerKey).toBe('b');
    expect(review.questions[0].explanation).toBe('Because reasons');
    expect(review.questions[0].options).toEqual(OPTS);
    expect(review.questions[1].answerKey).toBeNull(); // essay has no key

    const mcq = review.answers.find((a) => a.questionId === qs[0].id);
    expect(mcq.answer).toBe('a');
    expect(mcq.autoCorrect).toBe(false);
    expect(mcq.autoPoints).toBe(0);
    const essay = review.answers.find((a) => a.questionId === qs[1].id);
    expect(essay.manualPoints).toBe(6);
    expect(essay.feedback).toBe('Good argument');
  });

  it('reviewForStudent refuses an ungraded attempt with 409 not_graded and leaks nothing', async () => {
    const d = db();
    const { student, test, qs } = await setup(d, {
      questions: [
        { type: 'mcq', prompt: 'Pick b', options: OPTS, answerKey: 'b', points: 2 },
        { type: 'essay', prompt: 'Discuss', answerKey: null, points: 8 },
      ],
    });
    const { attempt } = await attemptsSvc.start(d, test.id, student.id, new Date());

    // in_progress
    const open = await expectThrown(() => attemptsSvc.reviewForStudent(d, attempt.id, student.id));
    expect(open.status).toBe(409);
    expect(await open.json()).toEqual({ error: 'not_graded' });

    await attemptsSvc.saveAnswers(
      d,
      attempt.id,
      student.id,
      [{ questionId: qs[1].id, answer: 'Some prose.' }],
      new Date(),
    );
    const submitted = await attemptsSvc.submit(d, attempt.id, student.id, new Date());
    expect(submitted.status).toBe('needs_grading');

    const err = await expectThrown(() => attemptsSvc.reviewForStudent(d, attempt.id, student.id));
    expect(err.status).toBe(409);
    // The body is the error code and nothing else — no questions, no keys, no marks.
    const body = await err.json();
    expect(body).toEqual({ error: 'not_graded' });
    expect(JSON.stringify(body)).not.toContain('answerKey');
    expect(JSON.stringify(body)).not.toContain('Because reasons');
  });

  it('reviewForStudent 404s for another student, indistinguishable from a missing attempt', async () => {
    const d = db();
    const { student, outsider, test, qs } = await setup(d);
    const { attempt } = await attemptsSvc.start(d, test.id, student.id, new Date());
    await attemptsSvc.saveAnswers(
      d,
      attempt.id,
      student.id,
      [{ questionId: qs[0].id, answer: 'b' }],
      new Date(),
    );
    const graded = await attemptsSvc.submit(d, attempt.id, student.id, new Date());
    expect(graded.status).toBe('graded');

    const stolen = await expectThrown(() =>
      attemptsSvc.reviewForStudent(d, attempt.id, outsider.id),
    );
    expect(stolen.status).toBe(404);
    expect(await stolen.json()).toEqual({ error: 'attempt_not_found' });

    const missing = await expectThrown(() =>
      attemptsSvc.reviewForStudent(d, 'no-such-attempt', student.id),
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'attempt_not_found' });
  });

  it('start still hands out key-free questions after the review API was added', async () => {
    const d = db();
    const { student, test } = await setup(d, { questions: THREE_Q });
    const res = await attemptsSvc.start(d, test.id, student.id, new Date());
    expect(res.questions.length).toBe(3);
    for (const q of res.questions) {
      expect('answerKey' in q).toBe(false);
      expect('explanation' in q).toBe(false);
      expect(Object.keys(q).sort()).toEqual(
        ['context', 'id', 'options', 'points', 'prompt', 'sortOrder', 'type'].sort(),
      );
    }
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

// ---- Tuition (học phí) ----
//
// Each test picks its own month so the shared test database cannot leak attendance between them.

describe('tuition — price effective dating', () => {
  it('bills a month at the price in force on its 1st', () => {
    const prices = [
      { id: 'p1', classId: 'c1', priceVnd: 100_000, effectiveFrom: '2031-01-01' },
      { id: 'p2', classId: 'c1', priceVnd: 150_000, effectiveFrom: '2031-06-01' },
      { id: 'p3', classId: 'c2', priceVnd: 999_000, effectiveFrom: '2031-01-01' },
    ];
    expect(tuitionSvc.priceForMonth(prices, 'c1', '2031-03')).toBe(100_000);
    expect(tuitionSvc.priceForMonth(prices, 'c1', '2031-06')).toBe(150_000);
    expect(tuitionSvc.priceForMonth(prices, 'c1', '2031-12')).toBe(150_000);
    // Before any price exists, and for a class with no price at all.
    expect(tuitionSvc.priceForMonth(prices, 'c1', '2030-12')).toBe(null);
    expect(tuitionSvc.priceForMonth(prices, 'c3', '2031-03')).toBe(null);
  });

  it('applies a mid-month price change only from the following month', () => {
    const prices = [
      { id: 'p1', classId: 'c1', priceVnd: 100_000, effectiveFrom: '2031-01-01' },
      { id: 'p2', classId: 'c1', priceVnd: 200_000, effectiveFrom: '2031-03-10' },
    ];
    expect(tuitionSvc.priceForMonth(prices, 'c1', '2031-03')).toBe(100_000);
    expect(tuitionSvc.priceForMonth(prices, 'c1', '2031-04')).toBe(200_000);
  });
});

async function tuitionFixture(d, { month, price = 100_000, name }) {
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
  if (price != null) {
    await tuitionSvc.setPrice(d, {
      classId: cls.id,
      priceVnd: price,
      effectiveFrom: `${month}-01`,
    });
  }
  return { cls, student, ev };
}

describe('tuition — computing a month from attendance', () => {
  it('counts billable statuses only, and never bills an unmarked student', async () => {
    const d = db();
    const month = '2031-01';
    const { cls, student, ev } = await tuitionFixture(d, { month, name: 'Tuition Billable' });
    const other = await peopleSvc.createStudent(d, {
      name: 'Tuition Unmarked Student',
      color: 'green',
      classIds: [cls.id],
    });

    // 2 present, 1 late, 1 absent, 1 excused across five occurrence dates of the same event.
    for (const [date, status] of [
      [`${month}-02`, 'present'],
      [`${month}-09`, 'present'],
      [`${month}-16`, 'late'],
      [`${month}-23`, 'absent'],
      [`${month}-30`, 'excused'],
    ]) {
      await attendanceSvc.saveOccurrence(d, ev.id, date, [{ studentId: student.id, status }]);
    }

    const dflt = await tuitionSvc.computeMonthLines(d, month, tuitionSvc.DEFAULT_TUITION_SETTINGS);
    const line = dflt.lines.find((l) => l.studentId === student.id && l.classId === cls.id);
    // The default bills everything except excused: 2 present + 1 late + 1 absent.
    expect(line.sessions).toBe(4);
    expect(line.unitPriceVnd).toBe(100_000);
    expect(line.amountVnd).toBe(400_000);
    expect(line.statusCounts).toEqual({ present: 2, late: 1, absent: 1, excused: 1 });
    // The classmate nobody ever marked has no line at all.
    expect(dflt.lines.some((l) => l.studentId === other.id)).toBe(false);

    // A stricter policy: only sessions actually attended.
    const strict = await tuitionSvc.computeMonthLines(d, month, {
      billableStatuses: ['present', 'late'],
    });
    const strictLine = strict.lines.find((l) => l.studentId === student.id);
    expect(strictLine.sessions).toBe(3);
    expect(strictLine.amountVnd).toBe(300_000);
  });

  it('records which dates were billed, and freezes them into the snapshot', async () => {
    const d = db();
    const month = '2031-08';
    const { student, ev } = await tuitionFixture(d, { month, name: 'Tuition Dates' });

    // Two billable sessions and one excused one; only the billable dates should be listed.
    await attendanceSvc.saveOccurrence(d, ev.id, `${month}-04`, [
      { studentId: student.id, status: 'present' },
    ]);
    await attendanceSvc.saveOccurrence(d, ev.id, `${month}-18`, [
      { studentId: student.id, status: 'late' },
    ]);
    await attendanceSvc.saveOccurrence(d, ev.id, `${month}-25`, [
      { studentId: student.id, status: 'excused' },
    ]);

    const open = await tuitionSvc.getMonthReport(d, month);
    const line = open.lines.find((l) => l.studentId === student.id);
    expect(line.sessions).toBe(2);
    expect(line.dates).toEqual([`${month}-04`, `${month}-18`]);

    // The dates survive the close, which is what lets a closed month print its session list.
    await tuitionSvc.closeMonth(d, month, 'Test Admin');
    const closed = await tuitionSvc.getMonthReport(d, month);
    expect(closed.status).toBe('closed');
    expect(closed.lines.find((l) => l.studentId === student.id).dates).toEqual([
      `${month}-04`,
      `${month}-18`,
    ]);
  });

  it('aggregates per student and class, and respects the month boundaries', async () => {
    const d = db();
    const month = '2031-02';
    const a = await tuitionFixture(d, { month, name: 'Tuition Class A', price: 100_000 });
    const b = await tuitionFixture(d, { month, name: 'Tuition Class B', price: 250_000 });
    await peopleSvc.updateStudent(d, a.student.id, { classIds: [a.cls.id, b.cls.id] });

    await attendanceSvc.saveOccurrence(d, a.ev.id, `${month}-01`, [
      { studentId: a.student.id, status: 'present' },
    ]);
    await attendanceSvc.saveOccurrence(d, a.ev.id, `${month}-28`, [
      { studentId: a.student.id, status: 'present' },
    ]);
    await attendanceSvc.saveOccurrence(d, b.ev.id, `${month}-10`, [
      { studentId: a.student.id, status: 'present' },
    ]);
    // Just outside the month on both sides — neither may be billed to it.
    await attendanceSvc.saveOccurrence(d, a.ev.id, '2031-01-31', [
      { studentId: a.student.id, status: 'present' },
    ]);
    await attendanceSvc.saveOccurrence(d, a.ev.id, '2031-03-01', [
      { studentId: a.student.id, status: 'present' },
    ]);

    const { lines } = await tuitionSvc.computeMonthLines(
      d,
      month,
      tuitionSvc.DEFAULT_TUITION_SETTINGS,
    );
    const mine = lines.filter((l) => l.studentId === a.student.id);
    expect(mine.length).toBe(2);
    expect(mine.find((l) => l.classId === a.cls.id).sessions).toBe(2);
    expect(mine.find((l) => l.classId === a.cls.id).amountVnd).toBe(200_000);
    expect(mine.find((l) => l.classId === b.cls.id).sessions).toBe(1);
    expect(mine.find((l) => l.classId === b.cls.id).amountVnd).toBe(250_000);
  });

  it('ignores attendance on an event with no class, and reports classes with no price', async () => {
    const d = db();
    const month = '2031-03';
    const student = await peopleSvc.createStudent(d, {
      name: 'Tuition Classless Student',
      color: 'rose',
      classIds: [],
    });
    const classless = await eventsSvc.create(d, {
      title: 'Tuition Classless Event',
      date: `${month}-05`,
      recurrence: 'none',
    });
    await attendanceSvc.saveOccurrence(d, classless.id, `${month}-05`, [
      { studentId: student.id, status: 'present' },
    ]);

    const unpriced = await tuitionFixture(d, { month, name: 'Tuition Unpriced', price: null });
    await attendanceSvc.saveOccurrence(d, unpriced.ev.id, `${month}-05`, [
      { studentId: unpriced.student.id, status: 'present' },
    ]);

    const { lines, missingPriceClasses } = await tuitionSvc.computeMonthLines(
      d,
      month,
      tuitionSvc.DEFAULT_TUITION_SETTINGS,
    );
    expect(lines.some((l) => l.studentId === student.id)).toBe(false);
    expect(lines.some((l) => l.classId === unpriced.cls.id)).toBe(false);
    expect(missingPriceClasses.some((c) => c.id === unpriced.cls.id)).toBe(true);
  });
});

describe('tuition — closing a month freezes it', () => {
  it('keeps amounts fixed against later attendance, price and setting edits', async () => {
    const d = db();
    const month = '2031-04';
    const { cls, student, ev } = await tuitionFixture(d, { month, name: 'Tuition Freeze' });
    await attendanceSvc.saveOccurrence(d, ev.id, `${month}-02`, [
      { studentId: student.id, status: 'present' },
    ]);
    await attendanceSvc.saveOccurrence(d, ev.id, `${month}-09`, [
      { studentId: student.id, status: 'present' },
    ]);

    await tuitionSvc.closeMonth(d, month, 'Test Admin');
    const closed = await tuitionSvc.getMonthReport(d, month);
    expect(closed.status).toBe('closed');
    expect(closed.closedBy).toBe('Test Admin');
    expect(closed.closedAt).toBeTruthy();
    expect(closed.lines.find((l) => l.studentId === student.id).sessions).toBe(2);
    expect(closed.lines.find((l) => l.studentId === student.id).amountVnd).toBe(200_000);
    // A closed month reads a snapshot, so it prices nothing and can never lack a price.
    expect(closed.missingPriceClasses).toEqual([]);

    // Everything that would move the number if the month were still open.
    await attendanceSvc.saveOccurrence(d, ev.id, `${month}-16`, [
      { studentId: student.id, status: 'present' },
    ]);
    await tuitionSvc.setPrice(d, {
      classId: cls.id,
      priceVnd: 500_000,
      effectiveFrom: `${month}-01`,
    });
    await tuitionSvc.setTuitionSettings(d, { billableStatuses: ['present'] });

    const after = await tuitionSvc.getMonthReport(d, month);
    expect(after.lines.find((l) => l.studentId === student.id).sessions).toBe(2);
    expect(after.lines.find((l) => l.studentId === student.id).amountVnd).toBe(200_000);

    // Reopening drops the snapshot; the third session shows up, at the new price.
    await tuitionSvc.reopenMonth(d, month);
    const reopened = await tuitionSvc.getMonthReport(d, month);
    expect(reopened.status).toBe('open');
    expect(await d.select().from(tuitionLines).where(eq(tuitionLines.month, month))).toEqual([]);
    const live = reopened.lines.find((l) => l.studentId === student.id);
    expect(live.sessions).toBe(3);
    expect(live.unitPriceVnd).toBe(500_000);
    expect(live.amountVnd).toBe(1_500_000);

    // Re-closing replaces the snapshot rather than colliding with the old rows.
    await tuitionSvc.closeMonth(d, month, 'Test Admin');
    const reclosed = await tuitionSvc.getMonthReport(d, month);
    expect(reclosed.status).toBe('closed');
    expect(reclosed.lines.find((l) => l.studentId === student.id).amountVnd).toBe(1_500_000);
    expect(
      (await d.select().from(tuitionMonths).where(eq(tuitionMonths.month, month))).length,
    ).toBe(1);

    await tuitionSvc.setTuitionSettings(d, tuitionSvc.DEFAULT_TUITION_SETTINGS);
  });

  it('refuses to close a month whose class has no price', async () => {
    const d = db();
    const month = '2031-05';
    const { ev, student, cls } = await tuitionFixture(d, {
      month,
      name: 'Tuition NoPrice',
      price: null,
    });
    await attendanceSvc.saveOccurrence(d, ev.id, `${month}-02`, [
      { studentId: student.id, status: 'present' },
    ]);

    await expect(tuitionSvc.closeMonth(d, month, 'Test Admin')).rejects.toThrow(/no price/i);
    // Nothing was written: the month stays open.
    expect((await tuitionSvc.getMonthStatus(d, month)).status).toBe('open');

    await tuitionSvc.setPrice(d, {
      classId: cls.id,
      priceVnd: 80_000,
      effectiveFrom: `${month}-01`,
    });
    await tuitionSvc.closeMonth(d, month, 'Test Admin');
    expect((await tuitionSvc.getMonthStatus(d, month)).status).toBe('closed');
  });

  it('keeps a closed month readable after its class is deleted', async () => {
    const d = db();
    const month = '2031-06';
    const { cls, student, ev } = await tuitionFixture(d, { month, name: 'Tuition Vanishing' });
    await attendanceSvc.saveOccurrence(d, ev.id, `${month}-02`, [
      { studentId: student.id, status: 'present' },
    ]);
    await tuitionSvc.closeMonth(d, month, 'Test Admin');

    await classesSvc.remove(d, cls.id);

    const after = await tuitionSvc.getMonthReport(d, month);
    const line = after.lines.find((l) => l.studentId === student.id);
    expect(line.className).toBe('Tuition Vanishing');
    expect(line.amountVnd).toBe(100_000);
    // The price rows cascaded away with the class; the frozen line does not depend on them.
    expect(await d.select().from(classPrices).where(eq(classPrices.classId, cls.id))).toEqual([]);
  });
});

describe('tuition — payments and adjustments', () => {
  it('upserts one row per student-month and stays editable after close', async () => {
    const d = db();
    const month = '2031-07';
    const { student, ev } = await tuitionFixture(d, { month, name: 'Tuition Payment' });
    await attendanceSvc.saveOccurrence(d, ev.id, `${month}-02`, [
      { studentId: student.id, status: 'present' },
    ]);

    await tuitionSvc.saveStudentMonth(d, month, student.id, {
      adjustmentVnd: -20_000,
      adjustmentNote: 'Giảm giá em thứ hai',
    });
    // The payment modal and the adjustment modal send separate patches; neither may clear the other.
    const row = await tuitionSvc.saveStudentMonth(d, month, student.id, {
      paidVnd: 50_000,
      paidAt: `${month}-05`,
      paymentNote: 'Chuyển khoản',
    });
    expect(row.adjustmentVnd).toBe(-20_000);
    expect(row.adjustmentNote).toBe('Giảm giá em thứ hai');
    expect(row.paidVnd).toBe(50_000);
    expect(row.paidAt).toBe(`${month}-05`);

    const open = await tuitionSvc.getMonthReport(d, month);
    const sm = open.studentMonths.find((s) => s.studentId === student.id);
    const due = open.lines
      .filter((l) => l.studentId === student.id)
      .reduce((n, l) => n + l.amountVnd, 0);
    // 100.000 billed − 20.000 adjustment − 50.000 paid → 30.000 still owed.
    expect(due + sm.adjustmentVnd - sm.paidVnd).toBe(30_000);

    // Money is collected after the month closes, so the row must survive close and stay writable.
    await tuitionSvc.closeMonth(d, month, 'Test Admin');
    const afterClose = await tuitionSvc.getMonthReport(d, month);
    expect(afterClose.studentMonths.find((s) => s.studentId === student.id).paidVnd).toBe(50_000);
    const settled = await tuitionSvc.saveStudentMonth(d, month, student.id, {
      paidVnd: 80_000,
      paidAt: `${month}-20`,
    });
    expect(settled.paidVnd).toBe(80_000);
    expect(settled.adjustmentNote).toBe('Giảm giá em thứ hai');

    await tuitionSvc.reopenMonth(d, month);
    const afterReopen = await tuitionSvc.getMonthReport(d, month);
    expect(afterReopen.studentMonths.find((s) => s.studentId === student.id).paidVnd).toBe(80_000);
  });
});

describe('tuition — settings', () => {
  it('round-trips billable statuses and falls back to the default when unset or empty', async () => {
    const d = db();
    expect(await tuitionSvc.getTuitionSettings(d)).toEqual(tuitionSvc.DEFAULT_TUITION_SETTINGS);
    const saved = await tuitionSvc.setTuitionSettings(d, { billableStatuses: ['present'] });
    expect(saved.billableStatuses).toEqual(['present']);
    expect((await tuitionSvc.getTuitionSettings(d)).billableStatuses).toEqual(['present']);
    // An empty list would bill nothing at all — read it back as "not configured".
    await tuitionSvc.setTuitionSettings(d, { billableStatuses: [] });
    expect(await tuitionSvc.getTuitionSettings(d)).toEqual(tuitionSvc.DEFAULT_TUITION_SETTINGS);
    await tuitionSvc.setTuitionSettings(d, tuitionSvc.DEFAULT_TUITION_SETTINGS);
  });
});

describe('parent portal — settings', () => {
  it('defaults to disabled, round-trips, and survives a corrupt row', async () => {
    const d = db();
    // Off by default: the portal ships dark and an admin opens it deliberately.
    expect(await parentPortalSvc.getParentPortal(d)).toEqual(parentPortalSvc.DEFAULT_PARENT_PORTAL);
    expect((await parentPortalSvc.getParentPortal(d)).enabled).toBe(false);

    expect((await parentPortalSvc.setParentPortal(d, { enabled: true })).enabled).toBe(true);
    expect((await parentPortalSvc.getParentPortal(d)).enabled).toBe(true);

    // A hand-edited or half-written settings row must not 500 the app shell for every parent.
    await d
      .insert(settings)
      .values({ key: 'parent-portal', value: 'not json' })
      .onConflictDoUpdate({ target: settings.key, set: { value: 'not json' } });
    expect(await parentPortalSvc.getParentPortal(d)).toEqual(parentPortalSvc.DEFAULT_PARENT_PORTAL);

    await parentPortalSvc.setParentPortal(d, { enabled: false });
  });
});

describe('parent portal — authorization', () => {
  it('gates on the toggle and on the parent_students link', async () => {
    const d = db();
    const mine = await peopleSvc.createStudent(d, {
      name: 'Portal Own Child',
      color: 'blue',
      classIds: [],
    });
    const other = await peopleSvc.createStudent(d, {
      name: 'Portal Other Child',
      color: 'green',
      classIds: [],
    });
    const parent = await peopleSvc.createParent(d, {
      name: 'Portal Parent',
      color: 'green',
      studentIds: [mine.id],
    });

    // studentIdsOfParent is the authorization set the rest of the portal is built on.
    expect(await peopleSvc.studentIdsOfParent(d, parent.id)).toEqual([mine.id]);

    // Portal OFF: even their own child is refused, with a 403 rather than an empty list — an
    // empty list would read as "you have no children" and the screen would say so.
    await parentPortalSvc.setParentPortal(d, { enabled: false });
    await expect(parentPortalSvc.portalChildIds(d, parent.id)).rejects.toMatchObject({
      status: 403,
    });
    await expect(parentPortalSvc.portalChild(d, parent.id, mine.id)).rejects.toMatchObject({
      status: 403,
    });

    // Portal ON: own child passes, another family's child is still refused.
    await parentPortalSvc.setParentPortal(d, { enabled: true });
    expect(await parentPortalSvc.portalChildIds(d, parent.id)).toEqual([mine.id]);
    await expect(parentPortalSvc.portalChild(d, parent.id, mine.id)).resolves.toBeUndefined();
    await expect(parentPortalSvc.portalChild(d, parent.id, other.id)).rejects.toMatchObject({
      status: 403,
    });

    // A parent nobody linked a child to gets an empty set, not an error.
    const childless = await peopleSvc.createParent(d, {
      name: 'Portal Childless Parent',
      color: 'green',
      studentIds: [],
    });
    expect(await parentPortalSvc.portalChildIds(d, childless.id)).toEqual([]);

    await parentPortalSvc.setParentPortal(d, { enabled: false });
    await peopleSvc.removeParent(d, parent.id);
    await peopleSvc.removeParent(d, childless.id);
    await peopleSvc.removeStudent(d, mine.id);
    await peopleSvc.removeStudent(d, other.id);
  });
});

describe('attendance — history for one student', () => {
  it('lists sessions newest first, keeps class-less events, and honours the range', async () => {
    const d = db();
    const student = await peopleSvc.createStudent(d, {
      name: 'History Student',
      color: 'blue',
      classIds: [],
    });
    const cls = await classesSvc.create(d, {
      name: 'History Class',
      color: 'green',
      studentIds: [],
      schedule: [],
    });
    const classEvent = await eventsSvc.create(d, {
      title: 'History Class Session',
      date: '2026-05-04',
      start: '09:00',
      end: '10:30',
      classId: cls.id,
      recurrence: 'none',
    });
    // No classId: an ad-hoc one-off. The monthly SUMMARY drops these (a summary is per class);
    // this list must keep them, or it disagrees with what the family remembers.
    const adHoc = await eventsSvc.create(d, {
      title: 'Extra Revision',
      date: '2026-05-20',
      start: '15:00',
      recurrence: 'none',
    });
    // Outside the range below — proves the bounds are actually applied.
    const nextMonth = await eventsSvc.create(d, {
      title: 'June Session',
      date: '2026-06-02',
      classId: cls.id,
      recurrence: 'none',
    });

    await attendanceSvc.saveOccurrence(d, classEvent.id, '2026-05-04', [
      { studentId: student.id, status: 'present' },
    ]);
    await attendanceSvc.saveOccurrence(d, adHoc.id, '2026-05-20', [
      { studentId: student.id, status: 'absent' },
    ]);
    await attendanceSvc.saveOccurrence(d, nextMonth.id, '2026-06-02', [
      { studentId: student.id, status: 'present' },
    ]);

    const may = await attendanceSvc.historyForStudent(d, student.id, {
      from: '2026-05-01',
      to: '2026-05-31',
    });
    expect(may.map((r) => r.date)).toEqual(['2026-05-20', '2026-05-04']); // newest first
    expect(may[0]).toMatchObject({
      status: 'absent',
      eventTitle: 'Extra Revision',
      classId: null,
      className: null, // the LEFT join, not a dropped row
    });
    expect(may[1]).toMatchObject({
      status: 'present',
      className: 'History Class',
      startTime: '09:00',
      endTime: '10:30',
    });

    // Inclusive bounds: a session exactly on `from`/`to` is in.
    const oneDay = await attendanceSvc.historyForStudent(d, student.id, {
      from: '2026-05-04',
      to: '2026-05-04',
    });
    expect(oneDay.length).toBe(1);

    // Another student's rows never leak in.
    const sibling = await peopleSvc.createStudent(d, {
      name: 'History Sibling',
      color: 'rose',
      classIds: [],
    });
    expect(
      await attendanceSvc.historyForStudent(d, sibling.id, {
        from: '2026-05-01',
        to: '2026-05-31',
      }),
    ).toEqual([]);

    await eventsSvc.remove(d, classEvent.id);
    await eventsSvc.remove(d, adHoc.id);
    await eventsSvc.remove(d, nextMonth.id);
    await classesSvc.remove(d, cls.id);
    await peopleSvc.removeStudent(d, student.id);
    await peopleSvc.removeStudent(d, sibling.id);
  });
});
