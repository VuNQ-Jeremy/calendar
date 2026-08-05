import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { createDb } from '../server/db/index';
import * as classesSvc from '../server/services/classes';
import * as eventsSvc from '../server/services/events';
import * as peopleSvc from '../server/services/people';
import * as previewSvc from '../server/services/session-preview';
import { setNotifPrefs } from '../server/services/notif-prefs';
import { runClassReminders, runEveningPreview } from '../server/services/notify';
import { accounts, pushTokens } from '../server/db/schema';

/**
 * The evening "tomorrow's session" cron, and the preview text riding along on the 30-minute one.
 *
 * Same shape as notify.test.js — Expo's endpoint stubbed, ICT wall-clock helper — because the same
 * thing matters: what the job DECIDES to send. The idempotency assertions are the point. This job
 * runs once a day, but Cloudflare retries a throwing cron, and a parent-facing reminder sent twice
 * is how an app gets muted.
 */

function db() {
  return createDb(env);
}

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

async function seedStudentWithDevice(d, name, token) {
  const student = await peopleSvc.createStudent(d, {
    name,
    email: `${token}@example.test`,
    color: 'blue',
    classIds: [],
  });
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
  return student;
}

async function seedStaffWithDevice(d, name, token) {
  const staffRow = await peopleSvc.createStaff(d, {
    name,
    email: `${token}@example.test`,
    role: 'Teacher',
    color: 'orange',
  });
  const accountId = crypto.randomUUID();
  await d.insert(accounts).values({
    id: accountId,
    email: `${token}@example.test`,
    passwordHash: 'x',
    staffId: staffRow.id,
    createdAt: new Date().toISOString(),
  });
  await d.insert(pushTokens).values({
    id: crypto.randomUUID(),
    accountId,
    expoToken: token,
    platform: 'android',
    createdAt: new Date().toISOString(),
  });
  return staffRow;
}

/** A UTC moment whose ICT (UTC+7) wall clock is `hh:mm` on `dateIso`. */
function utcForIct(dateIso, hh, mm) {
  return new Date(
    `${dateIso}T${String(hh - 7).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`,
  );
}

describe('runEveningPreview()', () => {
  it("sends tomorrow's preview once, however many times the job is re-run", async () => {
    const d = db();
    await setNotifPrefs(d, { previewEvening: true });

    const student = await seedStudentWithDevice(d, 'Mai', 'ExponentPushToken[p-mai]');
    const cls = await classesSvc.create(d, {
      name: 'Toán 9',
      color: 'green',
      studentIds: [student.id],
    });
    const ev = await eventsSvc.create(d, {
      title: 'Toán 9',
      date: '2026-09-08',
      start: '18:00',
      end: '19:30',
      classId: cls.id,
      recurrence: 'none',
    });
    await previewSvc.save(d, {
      eventId: ev.id,
      date: '2026-09-08',
      focusText: 'Unit 5 — câu điều kiện',
      vocabTopicId: null,
    });

    // 19:00 ICT the evening BEFORE.
    const n = await runEveningPreview(d, utcForIct('2026-09-07', 19, 0));
    expect(n).toBe(1);
    expect(sent[0].to).toBe('ExponentPushToken[p-mai]');
    expect(sent[0].channelId).toBe('reminders');
    expect(sent[0].title).toContain('Toán 9');
    expect(sent[0].body).toContain('Unit 5');
    // The tap must land on the student's schedule, not the app's home screen.
    expect(sent[0].data.url).toBe('/schedule');

    // A retried cron must not repeat it.
    expect(await runEveningPreview(d, utcForIct('2026-09-07', 19, 15))).toBe(0);
    expect(await runEveningPreview(d, utcForIct('2026-09-07', 20, 0))).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it('fires again for the next occurrence of a weekly class', async () => {
    const d = db();
    await setNotifPrefs(d, { previewEvening: true });

    const student = await seedStudentWithDevice(d, 'Nam', 'ExponentPushToken[p-nam]');
    const cls = await classesSvc.create(d, {
      name: 'Anh văn',
      color: 'blue',
      studentIds: [student.id],
    });
    await eventsSvc.create(d, {
      title: 'Anh văn',
      date: '2026-09-14', // a Monday
      start: '17:00',
      classId: cls.id,
      recurrence: 'weekly',
    });

    expect(await runEveningPreview(d, utcForIct('2026-09-13', 19, 0))).toBe(1);
    expect(await runEveningPreview(d, utcForIct('2026-09-13', 19, 30))).toBe(0);
    // A week on. If the ledger key were the event id alone this would be swallowed forever.
    expect(await runEveningPreview(d, utcForIct('2026-09-20', 19, 0))).toBe(1);
    expect(sent).toHaveLength(2);
  });

  it('still sends when nobody wrote a preview, with a fallback body', async () => {
    const d = db();
    await setNotifPrefs(d, { previewEvening: true });

    const student = await seedStudentWithDevice(d, 'Linh', 'ExponentPushToken[p-linh]');
    const cls = await classesSvc.create(d, {
      name: 'Lý 10',
      color: 'violet',
      studentIds: [student.id],
    });
    await eventsSvc.create(d, {
      title: 'Lý 10',
      date: '2026-09-10',
      start: '08:00',
      classId: cls.id,
      recurrence: 'none',
    });

    expect(await runEveningPreview(d, utcForIct('2026-09-09', 19, 0))).toBe(1);
    expect(sent[0].body).toContain('ngày mai');
  });

  it('sends nothing when the evening preview is switched off', async () => {
    const d = db();
    await setNotifPrefs(d, { previewEvening: false });

    const student = await seedStudentWithDevice(d, 'Tuan', 'ExponentPushToken[p-tuan]');
    const cls = await classesSvc.create(d, {
      name: 'Hoá 11',
      color: 'cocoa',
      studentIds: [student.id],
    });
    await eventsSvc.create(d, {
      title: 'Hoá 11',
      date: '2026-09-12',
      start: '09:00',
      classId: cls.id,
      recurrence: 'none',
    });

    expect(await runEveningPreview(d, utcForIct('2026-09-11', 19, 0))).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('gives staff one summary of the whole day, not one message per class', async () => {
    const d = db();
    await setNotifPrefs(d, { previewEvening: true });

    await seedStaffWithDevice(d, 'Cô Hương', 'ExponentPushToken[p-staff]');
    const a = await classesSvc.create(d, { name: 'Lớp A', color: 'green', studentIds: [] });
    const b = await classesSvc.create(d, { name: 'Lớp B', color: 'blue', studentIds: [] });
    await eventsSvc.create(d, {
      title: 'Lớp A',
      date: '2026-09-16',
      start: '17:00',
      classId: a.id,
      recurrence: 'none',
    });
    await eventsSvc.create(d, {
      title: 'Lớp B',
      date: '2026-09-16',
      start: '19:00',
      classId: b.id,
      recurrence: 'none',
    });

    // No students have devices, so every message sent here is the staff summary.
    expect(await runEveningPreview(d, utcForIct('2026-09-15', 19, 0))).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('ExponentPushToken[p-staff]');
    expect(sent[0].data.url).toBe('/calendar');
    // Both classes, in start-time order.
    expect(sent[0].body).toContain('Lớp A');
    expect(sent[0].body).toContain('Lớp B');
    expect(sent[0].body.indexOf('Lớp A')).toBeLessThan(sent[0].body.indexOf('Lớp B'));

    // And once per day, not once per re-run.
    expect(await runEveningPreview(d, utcForIct('2026-09-15', 20, 0))).toBe(0);
  });
});

describe('runClassReminders() with a preview', () => {
  it("appends the teacher's focus text to the 30-minute reminder", async () => {
    const d = db();
    await setNotifPrefs(d, { classReminders: true, classLeadMinutes: 30 });

    const student = await seedStudentWithDevice(d, 'Hà', 'ExponentPushToken[r-ha]');
    const cls = await classesSvc.create(d, {
      name: 'Toán 8',
      color: 'green',
      studentIds: [student.id],
    });
    const ev = await eventsSvc.create(d, {
      title: 'Toán 8',
      date: '2026-09-22',
      start: '09:00',
      classId: cls.id,
      recurrence: 'none',
    });
    await previewSvc.save(d, {
      eventId: ev.id,
      date: '2026-09-22',
      focusText: 'Kiểm tra 15 phút chương 2',
      vocabTopicId: null,
    });

    expect(await runClassReminders(d, utcForIct('2026-09-22', 8, 40))).toBe(1);
    expect(sent[0].body).toContain('09:00');
    expect(sent[0].body).toContain('Kiểm tra 15 phút chương 2');
  });

  it('leaves the reminder body alone when there is no preview', async () => {
    const d = db();
    await setNotifPrefs(d, { classReminders: true, classLeadMinutes: 30 });

    const student = await seedStudentWithDevice(d, 'Bảo', 'ExponentPushToken[r-bao]');
    const cls = await classesSvc.create(d, {
      name: 'Văn 8',
      color: 'rose',
      studentIds: [student.id],
    });
    await eventsSvc.create(d, {
      title: 'Văn 8',
      date: '2026-09-23',
      start: '15:00',
      classId: cls.id,
      location: 'Phòng 2',
      recurrence: 'none',
    });

    expect(await runClassReminders(d, utcForIct('2026-09-23', 14, 40))).toBe(1);
    expect(sent[0].body).toBe('Văn 8 · 15:00 · Phòng 2');
  });
});
