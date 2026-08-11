import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { eq, sql } from 'drizzle-orm';
import { createDb } from '../server/db/index';
import * as classesSvc from '../server/services/classes';
import * as eventsSvc from '../server/services/events';
import * as peopleSvc from '../server/services/people';
import * as gardenSvc from '../server/services/garden';
import * as flashcardsSvc from '../server/services/flashcards';
import { setNotifPrefs } from '../server/services/notif-prefs';
import { runGardenAlerts, ledgerKey } from '../server/services/notify';
import * as push from '../server/services/push';
import {
  firstTickAtOrAfter,
  ictStamp,
  parseLedgerKey,
  planNotifications,
  sendPlannedNotification,
} from '../server/services/notify-plan';
import {
  accounts,
  gardenEvents,
  gardenPlants,
  gardenSnapshots,
  pushTokens,
  sentNotifications,
  vocabAssignments,
  zaloChats,
} from '../server/db/schema';

/**
 * The notification forecast behind /logs → Notifications.
 *
 * Two properties matter more than any single row it produces. **It must not lie** — the keys and the
 * message texts have to be the ones the cron will actually use, which is why they are imported from
 * notify.ts rather than restated here, and why several tests below compare a forecast row against a
 * real run. And **it must not write**: the digest job prunes the ledger and the garden job charges
 * penalties, so a forecast that reached for either would corrupt the thing it is describing.
 */

function db() {
  return createDb(env);
}

/**
 * Both delivery channels are stubbed, so a real run can be compared against a forecast without
 * leaving the process. They are told apart by URL: Expo takes an array of messages and answers with
 * a ticket each, Zalo takes one `{chat_id, text}` and answers `{ok:true}`.
 */
let sent = [];
let zaloSent = [];
beforeEach(() => {
  sent = [];
  zaloSent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      if (String(url).includes('exp.host')) {
        sent.push(...body);
        return new Response(JSON.stringify({ data: body.map(() => ({ status: 'ok' })) }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      zaloSent.push(body);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});

/** A moment in UTC whose ICT (UTC+7) wall clock is `hh:mm` on `dateIso`. */
function utcForIct(dateIso, hh, mm = 0) {
  return new Date(
    `${dateIso}T${String(hh - 7).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`,
  );
}

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
 * A living plant for `studentId`.
 *
 * Required for any penalty test: `applyDeadlineCheck` returns null for an empty pot — "nothing to
 * lose" — so a student with no `garden_plants` row is never penalized, by the forecast or the sweep.
 * `lastCareDay` is today so the plant is not also wilting, keeping the assertion on the penalty.
 */
async function seedPlant(d, studentId, at = new Date()) {
  const vnToday = new Date(at.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
  await d.insert(gardenPlants).values({
    studentId,
    potColor: 'orange',
    stage: 3,
    isDead: false,
    lastCareDay: vnToday,
    updatedAt: at.toISOString(),
  });
}

async function countRows(d, table) {
  const rows = await d.select({ n: sql`count(*)` }).from(table);
  return Number(rows[0]?.n ?? 0);
}

/** Only this run's rows: the suite shares one database. */
function rowsFor(plan, predicate) {
  return plan.planned.filter(predicate);
}

describe('tick arithmetic', () => {
  it('rounds a send time up to the next quarter-hour sweep', () => {
    // The cron only wakes at :00/:15/:30/:45, so a reminder due at 08:31 goes out at 08:45.
    expect(firstTickAtOrAfter(8 * 60 + 30)).toBe(8 * 60 + 30);
    expect(firstTickAtOrAfter(8 * 60 + 31)).toBe(8 * 60 + 45);
    expect(firstTickAtOrAfter(8 * 60 + 44)).toBe(8 * 60 + 45);
  });

  it('carries a negative minute-of-day back into the previous ICT day', () => {
    // A 00:10 class with a 30-minute lead is due at 23:40 the day before.
    expect(ictStamp('2026-08-11', -20)).toBe('2026-08-10T23:40');
    expect(ictStamp('2026-08-11', 0)).toBe('2026-08-11T00:00');
    expect(ictStamp('2026-08-11', 1450)).toBe('2026-08-12T00:10');
  });
});

describe('planNotifications() — class reminders', () => {
  it('predicts the tick, key, text and audience of a class reminder', async () => {
    const d = db();
    await setNotifPrefs(d, { classReminders: true, classLeadMinutes: 30 });
    const student = await seedStudentWithDevice(d, 'Mai', `ExponentPushToken[plan-${Date.now()}]`);
    const cls = await classesSvc.create(d, {
      name: `Plan Maths ${Date.now()}`,
      color: 'green',
      studentIds: [student.id],
    });
    const ev = await eventsSvc.create(d, {
      title: 'Plan Maths',
      date: '2026-08-13',
      start: '09:00',
      classId: cls.id,
      recurrence: 'none',
    });

    const plan = await planNotifications(d, undefined, utcForIct('2026-08-11', 10, 0));
    const rows = rowsFor(plan, (p) => p.key === ledgerKey.class(ev.id, '2026-08-13'));
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.fireAtIct).toBe('2026-08-13T08:30');
    expect(row.exactFire).toBe(true);
    expect(row.channel).toBe('push');
    expect(row.alreadySent).toBe(false);
    expect(row.deliverable).toBe(true);
    expect(row.target).toMatchObject({ kind: 'students', count: 1, devices: 1 });
    expect(row.target.names).toContain('Mai');
    expect(row.title).toBe(cls.name);
    expect(row.body).toContain('09:00');
  });

  it('puts a just-after-midnight class on the previous evening tick', async () => {
    const d = db();
    await setNotifPrefs(d, { classReminders: true, classLeadMinutes: 30 });
    const student = await seedStudentWithDevice(d, 'Nam', `ExponentPushToken[mid-${Date.now()}]`);
    const cls = await classesSvc.create(d, {
      name: `Midnight ${Date.now()}`,
      color: 'blue',
      studentIds: [student.id],
    });
    const ev = await eventsSvc.create(d, {
      title: 'Midnight',
      date: '2026-08-13',
      start: '00:10',
      classId: cls.id,
      recurrence: 'none',
    });

    const plan = await planNotifications(d, undefined, utcForIct('2026-08-11', 10, 0));
    const row = rowsFor(plan, (p) => p.key === ledgerKey.class(ev.id, '2026-08-13'))[0];
    // 00:10 − 30min = 23:40 the previous day, rounded up to the 23:45 sweep.
    expect(row.fireAtIct).toBe('2026-08-12T23:45');
  });

  it('marks a row already sent once the real job has run it', async () => {
    const d = db();
    await setNotifPrefs(d, { classReminders: true, classLeadMinutes: 30 });
    const student = await seedStudentWithDevice(d, 'Linh', `ExponentPushToken[sent-${Date.now()}]`);
    const cls = await classesSvc.create(d, {
      name: `Already ${Date.now()}`,
      color: 'violet',
      studentIds: [student.id],
    });
    const ev = await eventsSvc.create(d, {
      title: 'Already',
      date: '2026-08-13',
      start: '09:00',
      classId: cls.id,
      recurrence: 'none',
    });
    const key = ledgerKey.class(ev.id, '2026-08-13');

    await push.markSent(d, [key]);
    const plan = await planNotifications(d, undefined, utcForIct('2026-08-11', 10, 0));
    expect(rowsFor(plan, (p) => p.key === key)[0].alreadySent).toBe(true);
  });

  it('flags a class nobody can be reached about', async () => {
    const d = db();
    await setNotifPrefs(d, { classReminders: true, classLeadMinutes: 30 });
    // A student with no account, therefore no device.
    const student = await peopleSvc.createStudent(d, {
      name: 'Offline',
      email: `off${crypto.randomUUID()}@example.test`,
      color: 'orange',
      classIds: [],
    });
    const cls = await classesSvc.create(d, {
      name: `Unreachable ${Date.now()}`,
      color: 'cocoa',
      studentIds: [student.id],
    });
    const ev = await eventsSvc.create(d, {
      title: 'Unreachable',
      date: '2026-08-13',
      start: '11:00',
      classId: cls.id,
      recurrence: 'none',
    });

    const plan = await planNotifications(d, undefined, utcForIct('2026-08-11', 10, 0));
    const row = rowsFor(plan, (p) => p.key === ledgerKey.class(ev.id, '2026-08-13'))[0];
    expect(row.deliverable).toBe(false);
    expect(row.target.devices).toBe(0);
  });

  it('lists nothing for a job whose pref is off', async () => {
    const d = db();
    await setNotifPrefs(d, { classReminders: false });
    try {
      const plan = await planNotifications(d, undefined, utcForIct('2026-08-11', 10, 0));
      expect(rowsFor(plan, (p) => p.jobKind === 'class')).toEqual([]);
      expect(plan.prefs.classReminders).toBe(false);
    } finally {
      await setNotifPrefs(d, { classReminders: true, classLeadMinutes: 30 });
    }
  });
});

describe('planNotifications() — evening previews', () => {
  it('fires at 19:00 the day before, and adds one staff summary per day', async () => {
    const d = db();
    await setNotifPrefs(d, { previewEvening: true });
    const student = await seedStudentWithDevice(d, 'Hoa', `ExponentPushToken[prev-${Date.now()}]`);
    const cls = await classesSvc.create(d, {
      name: `Preview ${Date.now()}`,
      color: 'green',
      studentIds: [student.id],
    });
    const ev = await eventsSvc.create(d, {
      title: 'Preview',
      date: '2026-08-14',
      start: '08:00',
      classId: cls.id,
      recurrence: 'none',
    });

    const plan = await planNotifications(d, undefined, utcForIct('2026-08-11', 10, 0));
    const row = rowsFor(plan, (p) => p.key === ledgerKey.preview(ev.id, '2026-08-14'))[0];
    expect(row.fireAtIct).toBe('2026-08-13T19:00');
    expect(row.title).toContain('Ngày mai');

    const staff = rowsFor(plan, (p) => p.key === ledgerKey.previewStaff('2026-08-14'));
    expect(staff).toHaveLength(1);
    expect(staff[0].target.kind).toBe('staff');
    expect(staff[0].fireAtIct).toBe('2026-08-13T19:00');
  });

  it('skips a day whose 19:00 slot has already gone', async () => {
    const d = db();
    await setNotifPrefs(d, { previewEvening: true });
    const cls = await classesSvc.create(d, {
      name: `Past slot ${Date.now()}`,
      color: 'blue',
      studentIds: [],
    });
    const ev = await eventsSvc.create(d, {
      title: 'Past slot',
      date: '2026-08-12',
      start: '08:00',
      classId: cls.id,
      recurrence: 'none',
    });

    // 20:00 on the 11th: the preview for the 12th was due an hour ago, so the earliest day this
    // forecast can still speak about is the 13th.
    const plan = await planNotifications(d, undefined, utcForIct('2026-08-11', 20, 0));
    expect(rowsFor(plan, (p) => p.key === ledgerKey.preview(ev.id, '2026-08-12'))).toEqual([]);
  });
});

describe('planNotifications() — Zalo', () => {
  it('plans no Zalo rows without a bot token, and parent rows with one', async () => {
    const d = db();
    await setNotifPrefs(d, { classReminders: true, classLeadMinutes: 30 });
    const student = await seedStudentWithDevice(
      d,
      'Zalo Kid',
      `ExponentPushToken[z-${Date.now()}]`,
    );
    const cls = await classesSvc.create(d, {
      name: `Zalo class ${Date.now()}`,
      color: 'rose',
      studentIds: [student.id],
    });
    const ev = await eventsSvc.create(d, {
      title: 'Zalo class',
      date: '2026-08-13',
      start: '09:00',
      classId: cls.id,
      recurrence: 'none',
    });
    // A chat paired straight to the student — one of the two routes chatsForParentsOfStudents unions.
    await d.insert(zaloChats).values({
      id: crypto.randomUUID(),
      chatId: `chat-${crypto.randomUUID()}`,
      kind: 'user',
      studentId: student.id,
      createdAt: new Date().toISOString(),
    });
    const zaloKey = ledgerKey.zaloClass(ev.id, '2026-08-13');

    const noToken = await planNotifications(d, undefined, utcForIct('2026-08-11', 10, 0));
    expect(rowsFor(noToken, (p) => p.channel === 'zalo')).toEqual([]);
    expect(noToken.channels.zaloEnabled).toBe(false);

    const withToken = await planNotifications(
      d,
      { ZALO_BOT_TOKEN: 'test-token' },
      utcForIct('2026-08-11', 10, 0),
    );
    const row = rowsFor(withToken, (p) => p.key === zaloKey)[0];
    expect(row.channel).toBe('zalo');
    expect(row.target.kind).toBe('parents');
    expect(row.target.count).toBe(1);
    expect(row.deliverable).toBe(true);
    // Zalo messages carry no title, and the text is the longer parent-facing one.
    expect(row.title).toBeUndefined();
    expect(row.body).toContain('🔔');
  });

  it('reports a class group chat as one recipient rather than each family', async () => {
    const d = db();
    await setNotifPrefs(d, { previewEvening: true });
    const a = await seedStudentWithDevice(d, 'Group A', `ExponentPushToken[ga-${Date.now()}]`);
    const b = await seedStudentWithDevice(d, 'Group B', `ExponentPushToken[gb-${Date.now()}]`);
    const cls = await classesSvc.create(d, {
      name: `Group class ${Date.now()}`,
      color: 'green',
      studentIds: [a.id, b.id],
    });
    const ev = await eventsSvc.create(d, {
      title: 'Group class',
      date: '2026-08-14',
      start: '08:00',
      classId: cls.id,
      recurrence: 'none',
    });
    await d.insert(zaloChats).values({
      id: crypto.randomUUID(),
      chatId: `grp-${crypto.randomUUID()}`,
      kind: 'group',
      classId: cls.id,
      createdAt: new Date().toISOString(),
    });

    const plan = await planNotifications(
      d,
      { ZALO_BOT_TOKEN: 'test-token' },
      utcForIct('2026-08-11', 10, 0),
    );
    const row = rowsFor(plan, (p) => p.key === ledgerKey.zaloPreview(ev.id, '2026-08-14'))[0];
    // The group chat wins over per-family delivery — never both, or a parent gets it twice.
    expect(row.target.kind).toBe('group-chat');
    expect(row.target.count).toBe(1);
  });
});

describe('planNotifications() — study nudges', () => {
  it('names a quiet student under the next run’s half-month bucket', async () => {
    const d = db();
    await setNotifPrefs(d, { studyNudges: true });
    try {
      const student = await seedStudentWithDevice(d, 'Quiet', `ExponentPushToken[q-${Date.now()}]`);
      // Planning at 10:00 on the 11th: the next 08:00 run is the 12th, which is bucket A.
      const plan = await planNotifications(d, undefined, utcForIct('2026-08-11', 10, 0));
      const row = rowsFor(plan, (p) => p.key === ledgerKey.study(student.id, '2026-08-A'))[0];
      expect(row).toBeDefined();
      expect(row.jobKind).toBe('digest');
      // A prediction, not a schedule: the 7-day inactivity test is redone when the cron fires.
      expect(row.exactFire).toBe(false);
      expect(row.fireAtIct).toBe('2026-08-12T08:00');
      expect(row.body).toBe('A few minutes of vocabulary?');
    } finally {
      await setNotifPrefs(d, { studyNudges: false });
    }
  });

  it('uses bucket B for a run on or after the 15th', async () => {
    const d = db();
    await setNotifPrefs(d, { studyNudges: true });
    try {
      const student = await seedStudentWithDevice(
        d,
        'Bucket B',
        `ExponentPushToken[b-${Date.now()}]`,
      );
      const plan = await planNotifications(d, undefined, utcForIct('2026-08-14', 10, 0));
      expect(rowsFor(plan, (p) => p.key === ledgerKey.study(student.id, '2026-08-B'))).toHaveLength(
        1,
      );
    } finally {
      await setNotifPrefs(d, { studyNudges: false });
    }
  });

  it('leaves out a student who has played recently', async () => {
    const d = db();
    await setNotifPrefs(d, { studyNudges: true });
    try {
      const student = await seedStudentWithDevice(
        d,
        'Active',
        `ExponentPushToken[a-${Date.now()}]`,
      );
      const name = `Nudge topic ${crypto.randomUUID()}`;
      await flashcardsSvc.createTopic(d, { name, color: 'violet' });
      const topic = (await flashcardsSvc.listTopics(d)).find((t) => t.name === name);
      await flashcardsSvc.createWord(d, topic.id, { word: 'now', meaningVi: 'bây giờ' });
      const words = await flashcardsSvc.listWords(d, topic.id);
      await flashcardsSvc.recordResult(
        d,
        { kind: 'student', id: student.id },
        {
          topicId: topic.id,
          mode: 'flip',
          score: 1,
          total: 1,
          answers: [{ wordId: words[0].id, correct: true }],
        },
      );

      // Planned relative to the next 08:00 run, whose 7-day window still contains that round.
      const plan = await planNotifications(d, undefined, new Date());
      expect(
        rowsFor(plan, (p) => p.jobKind === 'digest' && p.subject.studentName === 'Active'),
      ).toEqual([]);
    } finally {
      await setNotifPrefs(d, { studyNudges: false });
    }
  });
});

describe('forecastGardenSweep()', () => {
  it('finds the same penalty the real sweep charges, without writing anything', async () => {
    const d = db();
    const student = await peopleSvc.createStudent(d, {
      name: 'Overdue',
      email: `od${crypto.randomUUID()}@example.test`,
      color: 'green',
      classIds: [],
    });
    const cls = await classesSvc.create(d, {
      name: `Garden class ${Date.now()}`,
      color: 'green',
      studentIds: [student.id],
    });
    const name = `Garden topic ${crypto.randomUUID()}`;
    await flashcardsSvc.createTopic(d, { name, color: 'green' });
    const topic = (await flashcardsSvc.listTopics(d)).find((t) => t.name === name);

    const now = new Date();
    await seedPlant(d, student.id, now);
    const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
    const assignmentId = crypto.randomUUID();
    await d.insert(vocabAssignments).values({
      id: assignmentId,
      classId: cls.id,
      topicId: topic.id,
      requiredCount: 3,
      minScorePct: 70,
      deadline: yesterday,
      createdAt: new Date(now.getTime() - 7 * 86_400_000).toISOString(),
    });

    const before = {
      events: await countRows(d, gardenEvents),
      plants: await countRows(d, gardenPlants),
      snapshots: await countRows(d, gardenSnapshots),
      ledger: await countRows(d, sentNotifications),
    };

    const forecast = await gardenSvc.forecastGardenSweep(d, now.toISOString());
    expect(forecast.penalties.some((p) => p.assignmentId === assignmentId)).toBe(true);
    expect(forecast.snapshotsWritten).toBe(0);

    // The whole point: a forecast is a read.
    expect(await countRows(d, gardenEvents)).toBe(before.events);
    expect(await countRows(d, gardenPlants)).toBe(before.plants);
    expect(await countRows(d, gardenSnapshots)).toBe(before.snapshots);
    expect(await countRows(d, sentNotifications)).toBe(before.ledger);

    // And the real sweep agrees about who is affected, then writes.
    const real = await gardenSvc.runGardenSweep(d, now.toISOString());
    expect(real.penalties.some((p) => p.assignmentId === assignmentId)).toBe(true);
    const charged = await d.select().from(gardenEvents).where(eq(gardenEvents.refId, assignmentId));
    expect(charged.length).toBeGreaterThan(0);
  });

  it('surfaces a predicted penalty as a garden row in the plan', async () => {
    const d = db();
    await setNotifPrefs(d, { gardenAlerts: true });
    const student = await seedStudentWithDevice(
      d,
      'Garden Kid',
      `ExponentPushToken[g-${Date.now()}]`,
    );
    const cls = await classesSvc.create(d, {
      name: `Garden plan ${Date.now()}`,
      color: 'green',
      studentIds: [student.id],
    });
    const name = `Garden plan topic ${crypto.randomUUID()}`;
    await flashcardsSvc.createTopic(d, { name, color: 'green' });
    const topic = (await flashcardsSvc.listTopics(d)).find((t) => t.name === name);
    const now = new Date();
    await seedPlant(d, student.id, now);
    const assignmentId = crypto.randomUUID();
    await d.insert(vocabAssignments).values({
      id: assignmentId,
      classId: cls.id,
      topicId: topic.id,
      requiredCount: 3,
      minScorePct: 70,
      deadline: new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10),
      createdAt: new Date(now.getTime() - 7 * 86_400_000).toISOString(),
    });

    const plan = await planNotifications(d, undefined, now);
    const row = rowsFor(
      plan,
      (p) => p.key === ledgerKey.gardenPenalty(assignmentId, student.id),
    )[0];
    expect(row).toBeDefined();
    expect(row.jobKind).toBe('garden-penalty');
    expect(row.channel).toBe('push');
    expect(row.exactFire).toBe(false);
    expect(row.deliverable).toBe(true);
    expect(row.body).toContain('quá hạn');
  });
});

describe('planNotifications() writes nothing at all', () => {
  it('leaves the ledger untouched and sends no message', async () => {
    const d = db();
    await setNotifPrefs(d, {
      classReminders: true,
      classLeadMinutes: 30,
      previewEvening: true,
      studyNudges: true,
      gardenAlerts: true,
    });
    try {
      const student = await seedStudentWithDevice(
        d,
        'Nowrite',
        `ExponentPushToken[nw-${Date.now()}]`,
      );
      const cls = await classesSvc.create(d, {
        name: `Nowrite ${Date.now()}`,
        color: 'blue',
        studentIds: [student.id],
      });
      await eventsSvc.create(d, {
        title: 'Nowrite',
        date: '2026-08-13',
        start: '09:00',
        classId: cls.id,
        recurrence: 'none',
      });

      const before = await countRows(d, sentNotifications);
      const plan = await planNotifications(
        d,
        { ZALO_BOT_TOKEN: 'test-token' },
        utcForIct('2026-08-11', 10, 0),
      );
      expect(plan.planned.length).toBeGreaterThan(0);
      expect(await countRows(d, sentNotifications)).toBe(before);
      // Nothing reached Expo or Zalo: the forecast never calls a delivery path.
      expect(sent).toEqual([]);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      await setNotifPrefs(d, {
        classReminders: true,
        classLeadMinutes: 30,
        previewEvening: true,
        studyNudges: false,
        gardenAlerts: true,
      });
    }
  });

  it('does not prune the ledger the way the digest job would', async () => {
    const d = db();
    // A row old enough that runDailyDigest's pruneLedger(30) would delete it.
    const stale = `plan-stale-${crypto.randomUUID()}`;
    await d.insert(sentNotifications).values({
      key: stale,
      sentAt: new Date(Date.now() - 90 * 86_400_000).toISOString(),
    });

    await planNotifications(d, undefined, new Date());

    const still = await d.select().from(sentNotifications).where(eq(sentNotifications.key, stale));
    expect(still).toHaveLength(1);
  });
});

describe('sendPlannedNotification()', () => {
  /** A class one week out, with one enrolled device — one planned push row, not yet due. */
  async function seedFutureClass(d, label) {
    await setNotifPrefs(d, { classReminders: true, classLeadMinutes: 30 });
    const student = await seedStudentWithDevice(
      d,
      label,
      `ExponentPushToken[${label}-${Date.now()}]`,
    );
    const cls = await classesSvc.create(d, {
      name: `${label} ${Date.now()}`,
      color: 'green',
      studentIds: [student.id],
    });
    const ev = await eventsSvc.create(d, {
      title: label,
      date: '2026-08-13',
      start: '09:00',
      classId: cls.id,
      recurrence: 'none',
    });
    return { student, cls, ev, key: ledgerKey.class(ev.id, '2026-08-13') };
  }

  it('sends one row, to that row’s devices only, and marks its key', async () => {
    const d = db();
    const { key } = await seedFutureClass(d, 'SendOne');

    const at = utcForIct('2026-08-11', 10, 0);
    const result = await sendPlannedNotification(d, undefined, key, at);
    expect(result).toMatchObject({ ok: true, channel: 'push', sent: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toContain('SendOne');

    // The key is now in the ledger, so the scheduled run will skip this occurrence...
    expect(await push.alreadySent(d, [key])).toEqual(new Set([key]));
    // ...and the forecast says so.
    const plan = await planNotifications(d, undefined, at);
    expect(rowsFor(plan, (p) => p.key === key)[0].alreadySent).toBe(true);
  });

  it('refuses to send the same row twice', async () => {
    const d = db();
    const { key } = await seedFutureClass(d, 'Twice');
    const at = utcForIct('2026-08-11', 10, 0);

    expect((await sendPlannedNotification(d, undefined, key, at)).ok).toBe(true);
    expect(await sendPlannedNotification(d, undefined, key, at)).toEqual({
      ok: false,
      reason: 'already_sent',
    });
    // The second attempt must not have reached Expo.
    expect(sent).toHaveLength(1);
  });

  it('refuses a key that is not in the plan', async () => {
    const d = db();
    expect(
      await sendPlannedNotification(d, undefined, 'class:no-such-event:2026-08-13', new Date()),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(sent).toEqual([]);
  });

  it('refuses a row with nobody to send to, and leaves the key unburned', async () => {
    const d = db();
    await setNotifPrefs(d, { classReminders: true, classLeadMinutes: 30 });
    const student = await peopleSvc.createStudent(d, {
      name: 'No device',
      email: `nd${crypto.randomUUID()}@example.test`,
      color: 'orange',
      classIds: [],
    });
    const cls = await classesSvc.create(d, {
      name: `Nobody ${Date.now()}`,
      color: 'cocoa',
      studentIds: [student.id],
    });
    const ev = await eventsSvc.create(d, {
      title: 'Nobody',
      date: '2026-08-13',
      start: '09:00',
      classId: cls.id,
      recurrence: 'none',
    });
    const key = ledgerKey.class(ev.id, '2026-08-13');

    expect(
      await sendPlannedNotification(d, undefined, key, utcForIct('2026-08-11', 10, 0)),
    ).toEqual({ ok: false, reason: 'no_recipients' });
    // Refusing must not mark it — the scheduled run should still get its turn.
    expect(await push.alreadySent(d, [key])).toEqual(new Set());
  });

  it('charges the stage before announcing it, so a garden penalty is not a lie', async () => {
    const d = db();
    await setNotifPrefs(d, { gardenAlerts: true });
    const student = await seedStudentWithDevice(
      d,
      'Penalty',
      `ExponentPushToken[pen-${Date.now()}]`,
    );
    const cls = await classesSvc.create(d, {
      name: `Penalty class ${Date.now()}`,
      color: 'green',
      studentIds: [student.id],
    });
    const name = `Penalty topic ${crypto.randomUUID()}`;
    await flashcardsSvc.createTopic(d, { name, color: 'green' });
    const topic = (await flashcardsSvc.listTopics(d)).find((t) => t.name === name);
    const now = new Date();
    await seedPlant(d, student.id, now);
    const assignmentId = crypto.randomUUID();
    await d.insert(vocabAssignments).values({
      id: assignmentId,
      classId: cls.id,
      topicId: topic.id,
      requiredCount: 3,
      minScorePct: 70,
      deadline: new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10),
      createdAt: new Date(now.getTime() - 7 * 86_400_000).toISOString(),
    });
    const key = ledgerKey.gardenPenalty(assignmentId, student.id);

    // Nothing is charged until the button is pressed.
    const chargedBefore = await d
      .select()
      .from(gardenEvents)
      .where(eq(gardenEvents.refId, assignmentId));
    expect(chargedBefore).toHaveLength(0);

    const result = await sendPlannedNotification(d, undefined, key, now);
    expect(result).toMatchObject({ ok: true, channel: 'push' });
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toContain('quá hạn');

    // The stage the message announces has actually been taken, so the student's own screen agrees.
    const chargedAfter = await d
      .select()
      .from(gardenEvents)
      .where(eq(gardenEvents.refId, assignmentId));
    expect(chargedAfter).toHaveLength(1);
    expect(chargedAfter[0].type).toBe('deadline_drop');

    // And the ledger key stops the cron re-announcing it at 08:00.
    expect(await push.alreadySent(d, [key])).toEqual(new Set([key]));
  });

  it('sends a Zalo row over Zalo, not over push', async () => {
    const d = db();
    await setNotifPrefs(d, { classReminders: true, classLeadMinutes: 30 });
    const student = await seedStudentWithDevice(
      d,
      'ZaloSend',
      `ExponentPushToken[zs-${Date.now()}]`,
    );
    const cls = await classesSvc.create(d, {
      name: `Zalo send ${Date.now()}`,
      color: 'rose',
      studentIds: [student.id],
    });
    const ev = await eventsSvc.create(d, {
      title: 'Zalo send',
      date: '2026-08-13',
      start: '09:00',
      classId: cls.id,
      recurrence: 'none',
    });
    await d.insert(zaloChats).values({
      id: crypto.randomUUID(),
      chatId: `chat-${crypto.randomUUID()}`,
      kind: 'user',
      studentId: student.id,
      createdAt: new Date().toISOString(),
    });
    const key = ledgerKey.zaloClass(ev.id, '2026-08-13');

    const result = await sendPlannedNotification(
      d,
      { ZALO_BOT_TOKEN: 'test-token' },
      key,
      utcForIct('2026-08-11', 10, 0),
    );
    expect(result.ok).toBe(true);
    expect(result.channel).toBe('zalo');
    // It went out over Zalo, carrying the parent-facing text — and no push was built.
    expect(sent).toEqual([]);
    expect(zaloSent).toHaveLength(1);
    expect(zaloSent[0].text).toContain('🔔');
    // And the push twin of the same occurrence is untouched.
    expect(await push.alreadySent(d, [ledgerKey.class(ev.id, '2026-08-13')])).toEqual(new Set());
  });
});

describe('parseLedgerKey()', () => {
  it('reads every prefix the jobs write', () => {
    expect(parseLedgerKey('class:ev1:2026-08-11')).toEqual({
      job: 'class',
      channel: 'push',
      eventId: 'ev1',
      date: '2026-08-11',
    });
    expect(parseLedgerKey('zalo-class:ev1:2026-08-11')).toEqual({
      job: 'class',
      channel: 'zalo',
      eventId: 'ev1',
      date: '2026-08-11',
    });
    expect(parseLedgerKey('preview:ev2:2026-08-12')).toEqual({
      job: 'preview',
      channel: 'push',
      eventId: 'ev2',
      date: '2026-08-12',
    });
    expect(parseLedgerKey('zalo-preview:ev2:2026-08-12')).toEqual({
      job: 'preview',
      channel: 'zalo',
      eventId: 'ev2',
      date: '2026-08-12',
    });
    expect(parseLedgerKey('preview-staff:2026-08-12')).toEqual({
      job: 'preview-staff',
      channel: 'push',
      date: '2026-08-12',
    });
    expect(parseLedgerKey('zalo-preview-staff:2026-08-12')).toEqual({
      job: 'preview-staff',
      channel: 'zalo',
      date: '2026-08-12',
    });
    expect(parseLedgerKey('study:s1:2026-08-A')).toEqual({
      job: 'digest',
      channel: 'push',
      studentId: 's1',
      bucket: '2026-08-A',
    });
    expect(parseLedgerKey('garden-penalty:a1:s1')).toEqual({
      job: 'garden-penalty',
      channel: 'push',
      assignmentId: 'a1',
      studentId: 's1',
    });
    expect(parseLedgerKey('garden-wilt:s1:2026-08-11')).toEqual({
      job: 'garden-wilt',
      channel: 'push',
      studentId: 's1',
      date: '2026-08-11',
    });
    expect(parseLedgerKey('garden-drop:s1:2026-08-18')).toEqual({
      job: 'garden-drop',
      channel: 'push',
      studentId: 's1',
      date: '2026-08-18',
    });
  });

  it('does not choke on a key from a retired job', () => {
    // migrations/0018_drop_homework.sql deleted these, but the ledger outlives its writers.
    expect(parseLedgerKey('homework:h1:2026-08-11')).toEqual({ job: 'unknown' });
    expect(parseLedgerKey('nonsense')).toEqual({ job: 'unknown' });
    expect(parseLedgerKey('class:missing-date')).toEqual({ job: 'unknown' });
  });
});

describe('runGardenAlerts() still works after the sweep split', () => {
  it('sends an alert for a wilting plant exactly once', async () => {
    const d = db();
    await setNotifPrefs(d, { gardenAlerts: true });
    const student = await seedStudentWithDevice(d, 'Wilting', `ExponentPushToken[w-${Date.now()}]`);
    // Plant last cared for long enough ago that today is its first wilted day.
    const settings = await gardenSvc.getGardenSettings(d);
    const now = new Date();
    const vnToday = new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
    const lastCare = new Date(
      new Date(`${vnToday}T00:00:00Z`).getTime() - settings.wiltAfterDays * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    await d.insert(gardenPlants).values({
      studentId: student.id,
      potColor: 'orange',
      stage: 3,
      isDead: false,
      lastCareDay: lastCare,
      updatedAt: now.toISOString(),
    });

    const first = await runGardenAlerts(d, now);
    expect(first).toBeGreaterThan(0);
    // The ledger key is date-scoped, so a second run the same day says nothing.
    expect(await runGardenAlerts(d, now)).toBe(0);
  });
});
