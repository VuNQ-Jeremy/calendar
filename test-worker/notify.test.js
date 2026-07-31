import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { createDb } from '../server/db/index';
import * as classesSvc from '../server/services/classes';
import * as eventsSvc from '../server/services/events';
import * as peopleSvc from '../server/services/people';
import { setNotifPrefs } from '../server/services/notif-prefs';
import { runClassReminders } from '../server/services/notify';
import { accounts, pushTokens } from '../server/db/schema';

/**
 * The class-starting-soon cron.
 *
 * The acceptance criterion that matters most here — "let it run across at least three cron ticks
 * and confirm exactly one notification" — cannot be checked on a device in a reasonable amount of
 * time, but it is pure logic over the `sent_notifications` ledger, so it can be checked here in
 * milliseconds. Duplicate class alerts are the fastest route to a muted app.
 *
 * Expo's HTTPS endpoint is stubbed: this asserts what the job DECIDES to send, which is the part
 * that can be wrong.
 */

function db() {
  return createDb(env);
}

/** Every message handed to exp.host across all calls since the last reset. */
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

/** A student with an account and a registered device. */
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

/**
 * A moment in UTC whose ICT (UTC+7) wall clock is `hh:mm` on `dateIso`.
 * The whole job reasons in Vietnam local time; the tests have to as well.
 */
function utcForIct(dateIso, hh, mm) {
  return new Date(
    `${dateIso}T${String(hh - 7).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`,
  );
}

describe('runClassReminders()', () => {
  it('notifies each enrolled device once, however many times the cron ticks', async () => {
    const d = db();
    await setNotifPrefs(d, { classReminders: true, classLeadMinutes: 30 });

    const student = await seedStudentWithDevice(d, 'Mai', 'ExponentPushToken[mai]');
    const cls = await classesSvc.create(d, {
      name: 'Maths',
      color: 'green',
      studentIds: [student.id],
    });
    const ev = await eventsSvc.create(d, {
      title: 'Maths',
      date: '2026-08-03',
      start: '09:00',
      end: '10:00',
      classId: cls.id,
      recurrence: 'none',
    });

    // 08:40 ICT — twenty minutes out, inside the 30-minute window.
    const n = await runClassReminders(d, utcForIct('2026-08-03', 8, 40));
    expect(n).toBe(1);
    expect(sent[0].to).toBe('ExponentPushToken[mai]');
    expect(sent[0].channelId).toBe('reminders');
    // The tap has to land somewhere specific, not on the home screen.
    expect(sent[0].data.url).toBe(`/event/${ev.id}`);

    // Two more ticks inside the same window: the ledger must swallow both.
    expect(await runClassReminders(d, utcForIct('2026-08-03', 8, 45))).toBe(0);
    expect(await runClassReminders(d, utcForIct('2026-08-03', 8, 55))).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it('fires again on the next occurrence of a weekly class', async () => {
    const d = db();
    await setNotifPrefs(d, { classReminders: true, classLeadMinutes: 30 });

    const student = await seedStudentWithDevice(d, 'Nam', 'ExponentPushToken[nam]');
    const cls = await classesSvc.create(d, {
      name: 'English',
      color: 'blue',
      studentIds: [student.id],
    });
    await eventsSvc.create(d, {
      title: 'English',
      date: '2026-08-03', // a Monday
      start: '14:00',
      classId: cls.id,
      recurrence: 'weekly',
    });

    expect(await runClassReminders(d, utcForIct('2026-08-03', 13, 40))).toBe(1);
    expect(await runClassReminders(d, utcForIct('2026-08-03', 13, 50))).toBe(0);
    // One week later. A weekly class is a single row with many occurrences: if the ledger key
    // were the event id alone, this would be silently swallowed forever after the first week.
    expect(await runClassReminders(d, utcForIct('2026-08-10', 13, 40))).toBe(1);
    expect(sent).toHaveLength(2);
  });

  it('sends nothing when class reminders are switched off', async () => {
    const d = db();
    await setNotifPrefs(d, { classReminders: false });

    const student = await seedStudentWithDevice(d, 'Linh', 'ExponentPushToken[linh]');
    const cls = await classesSvc.create(d, {
      name: 'Science',
      color: 'violet',
      studentIds: [student.id],
    });
    await eventsSvc.create(d, {
      title: 'Science',
      date: '2026-08-04',
      start: '09:00',
      classId: cls.id,
      recurrence: 'none',
    });

    expect(await runClassReminders(d, utcForIct('2026-08-04', 8, 40))).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('ignores a class that is further away than the lead time', async () => {
    const d = db();
    await setNotifPrefs(d, { classReminders: true, classLeadMinutes: 15 });

    const student = await seedStudentWithDevice(d, 'Tuan', 'ExponentPushToken[tuan]');
    const cls = await classesSvc.create(d, {
      name: 'History',
      color: 'cocoa',
      studentIds: [student.id],
    });
    await eventsSvc.create(d, {
      title: 'History',
      date: '2026-08-05',
      start: '11:00',
      classId: cls.id,
      recurrence: 'none',
    });

    // 10:30 ICT, a 15-minute lead: half an hour out is not yet due.
    expect(await runClassReminders(d, utcForIct('2026-08-05', 10, 30))).toBe(0);
    // 10:50 is.
    expect(await runClassReminders(d, utcForIct('2026-08-05', 10, 50))).toBe(1);
  });
});
