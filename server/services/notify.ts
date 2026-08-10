import { and, gte, isNotNull } from 'drizzle-orm';
import { flashcardResults, staff, students } from '../db/schema';
import { createDb, type Db } from '../db/index';
import { expandEvents } from '../../shared/logic/recurrence';
import { iso, parseISO, toMin } from '../../shared/logic/dates';
import { previewLine } from '../../shared/logic/preview';
import * as classesSvc from './classes';
import * as eventsSvc from './events';
import * as gardenSvc from './garden';
import { getNotifPrefs } from './notif-prefs';
import * as previewSvc from './session-preview';
import * as push from './push';
import type { ExpoPushMessage } from './push';
import * as zalo from './zalo';

/**
 * The scheduled notification jobs. Called from `scheduled()` in workers/app.ts, and from the
 * debug endpoint while developing (waiting 15 minutes per iteration is not a feedback loop).
 *
 * **Timezone.** The whole user base is in Vietnam: ICT, UTC+7, no DST, ever. That offset is
 * hardcoded below rather than carried in a column. It is the right trade for one school in one
 * city — and it is the first thing to change if the school opens a second location, which is why
 * it is a single named constant and not seven scattered `+ 7`s.
 *
 * **Two channels, one sweep.** Each job decides WHAT to say once, then hands it to Expo push and
 * to Zalo (server/services/zalo.ts) separately. They reach different people — push reaches
 * students and staff who installed the app, Zalo reaches parents, most of whom have no account
 * (one is opt-in per school and per family) — so neither is a fallback for the other. Each keeps
 * its OWN idempotency keys (Zalo's carry a `zalo-` prefix): sharing them would mean the day Zalo
 * is switched on, every occurrence push already handled is silently marked done and no parent ever
 * hears about it. The Zalo pass always runs after the push pass and never throws, so a Zalo outage
 * cannot cost a push.
 *
 * `env` is optional throughout: without it — or without ZALO_BOT_TOKEN in it — the Zalo pass is
 * skipped entirely and these jobs behave exactly as they did before the channel existed.
 */

/** Indochina Time. UTC+7, no daylight saving. */
const ICT_OFFSET_MIN = 7 * 60;

/** "Now", as the school experiences it. */
function ictNow(at: Date): { dateIso: string; minutes: number } {
  const shifted = new Date(at.getTime() + ICT_OFFSET_MIN * 60_000);
  return {
    dateIso: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

function addDaysIso(dateIso: string, days: number): string {
  const d = parseISO(dateIso);
  d.setDate(d.getDate() + days);
  return iso(d);
}

/**
 * Job A — a class starts soon. Every 15 minutes, `reminders` channel.
 *
 * **Recurrence is the whole difficulty.** A weekly class is ONE row in `events` with many
 * occurrences, so a naive `WHERE date = today` misses every week but the first. This uses
 * `expandEvents` from `@shared/logic/recurrence` — the same function the web calendar and the
 * mobile agenda use. If this job and the calendar disagreed about when a class runs, users would
 * be notified for classes that are not happening, which is worse than not being notified at all.
 */
export async function runClassReminders(db: Db, at: Date = new Date(), env?: Env): Promise<number> {
  const prefs = await getNotifPrefs(db);
  if (!prefs.classReminders) return 0;

  const { dateIso, minutes: nowMin } = ictNow(at);
  const lead = prefs.classLeadMinutes;

  // Expand across yesterday..tomorrow rather than just today: the window can straddle midnight
  // ICT, and expandEvents works on whole days.
  const all = await eventsSvc.list(db);
  const occurrences = expandEvents(
    all,
    parseISO(addDaysIso(dateIso, -1)),
    parseISO(addDaysIso(dateIso, 1)),
  ).filter((e) => e.date === dateIso || e.date === addDaysIso(dateIso, 1));

  // Due to start within the lead window. `nowMin + lead` may exceed 1440, which is exactly how a
  // 23:50 sweep reaches a 00:10 class on the following date.
  const upcoming = occurrences.filter((e) => {
    if (!e.start || !e.classId) return false;
    const startMin = toMin(e.start) + (e.date === dateIso ? 0 : 1440);
    return startMin > nowMin && startMin <= nowMin + lead;
  });
  if (!upcoming.length) return 0;

  // Idempotency FIRST: with a 15-minute cron and a 30-minute window every occurrence is seen
  // two or three times, and duplicate class alerts are how an app gets muted.
  const keys = upcoming.map((e) => `class:${e.id}:${e.date}`);
  const sent = await push.alreadySent(db, keys);
  const todo = upcoming.filter((e) => !sent.has(`class:${e.id}:${e.date}`));

  const classes = await classesSvc.list(db);
  // What the teacher said this occurrence covers, so the reminder is about the lesson and not just
  // the clock. Composed in one bulk call for the whole sweep — over `upcoming`, not `todo`,
  // because the Zalo pass below keeps its own ledger and may still owe a message for an
  // occurrence push has already handled.
  const previews = await previewSvc.composeMany(
    db,
    upcoming
      .filter((e) => e.classId)
      .map((e) => ({ id: e.id, classId: e.classId as string, date: e.date })),
  );
  const messages: ExpoPushMessage[] = [];
  const doneKeys: string[] = [];

  for (const ev of todo) {
    const cls = classes.find((c) => c.id === ev.classId);
    if (!cls) continue;

    const accountIds = await push.accountIdsForStudents(db, cls.studentIds);
    const tokens = await push.tokensForAccounts(db, accountIds);
    // The key is marked done even when nobody is registered: the occurrence HAS been processed,
    // and re-processing it on the next tick would just re-find nobody.
    doneKeys.push(`class:${ev.id}:${ev.date}`);
    if (!tokens.length) continue;

    // Only the teacher's own words go in this body, not the whole preview: a notification arriving
    // 30 minutes ahead is a nudge out the door, and the tests are already on the schedule screen.
    const focus = previews.get(previewSvc.previewKey(ev.id, ev.date))?.focusText.trim();

    for (const to of tokens) {
      messages.push({
        to,
        title: cls.name,
        // The event's own "Room or place", not the class's — `classes.room` is gone from the
        // product. Same information for anyone who filled the field in, and it is per-occurrence.
        body:
          `${ev.title} · ${ev.start}${ev.location ? ` · ${ev.location}` : ''}` +
          (focus ? ` · ${focus.slice(0, 90)}` : ''),
        // Deep link straight to the occurrence, not the app's home screen.
        data: { url: `/event/${ev.id}`, kind: 'class' },
        channelId: 'reminders',
      });
    }
  }

  await deliver(db, messages);
  await push.markSent(db, doneKeys);

  // ---- Zalo: the same reminder, to the parents of the students in each class ----
  //
  // Longer than the push body on purpose. A push is a glanceable nudge for someone who is
  // already going; this is the message a parent reads to decide whether their child is ready.
  await zaloDeliver(
    db,
    env,
    upcoming.flatMap((ev) => {
      const cls = classes.find((c) => c.id === ev.classId);
      if (!cls) return [];
      const focus = previews.get(previewSvc.previewKey(ev.id, ev.date))?.focusText.trim();
      return [
        {
          key: `zalo-class:${ev.id}:${ev.date}`,
          chatIds: () => zalo.chatsForParentsOfStudents(db, cls.studentIds),
          text:
            `🔔 ${cls.name} · ${ev.start}${ev.location ? ` · ${ev.location}` : ''}` +
            (focus ? `\n${focus.slice(0, 300)}` : ''),
        },
      ];
    }),
  );

  return messages.length;
}

/** Job B — the daily digest. 01:00 UTC = 08:00 ICT, the `study` channel. */
export async function runDailyDigest(db: Db, at: Date = new Date(), env?: Env): Promise<number> {
  const prefs = await getNotifPrefs(db);
  const { dateIso } = ictNow(at);
  const messages: ExpoPushMessage[] = [];
  const doneKeys: string[] = [];

  if (prefs.studyNudges) {
    // Gentle and infrequent by design: this is the one notification with no deadline behind it,
    // and the easiest to resent. Weekly at most, per student, and only after real inactivity.
    const QUIET_DAYS = 7;
    const cutoff = new Date(at.getTime() - QUIET_DAYS * 86_400_000).toISOString();

    const recent = await db
      .select({ studentId: flashcardResults.studentId })
      .from(flashcardResults)
      .where(and(isNotNull(flashcardResults.studentId), gte(flashcardResults.playedAt, cutoff)));
    const active = new Set(recent.map((r) => r.studentId));

    const all = await db.select({ id: students.id, name: students.name }).from(students);
    const quiet = all.filter((s) => !active.has(s.id));

    // Weekly key: the ISO week-ish bucket keeps this to one nudge per student per 7 days even
    // though the digest runs daily.
    const weekKey = dateIso.slice(0, 8) + (Number(dateIso.slice(8, 10)) < 15 ? 'A' : 'B');
    const keys = quiet.map((s) => `study:${s.id}:${weekKey}`);
    const sent = await push.alreadySent(db, keys);

    for (const s of quiet) {
      const key = `study:${s.id}:${weekKey}`;
      if (sent.has(key)) continue;
      doneKeys.push(key);
      const accountIds = await push.accountIdsForStudents(db, [s.id]);
      for (const to of await push.tokensForAccounts(db, accountIds)) {
        messages.push({
          to,
          title: 'Mochi',
          body: 'A few minutes of vocabulary?',
          // Deliberately still `/flashcards`, even though the screen now lives at /vocabulary.
          // The Worker deploys the moment we push, but phones only pick up the matching JS on
          // their second launch after an OTA publish — sending the new path immediately would
          // dead-end notification taps on every not-yet-updated install. Installed builds
          // handle this path natively and updated ones remap it (mobile/lib/push.ts). Safe to
          // switch to /vocabulary once no pre-rename build is in the wild.
          data: { url: '/flashcards', kind: 'study' },
          channelId: 'study',
        });
      }
    }
  }

  await deliver(db, messages);
  await push.markSent(db, doneKeys);
  // Housekeeping rides along with the daily job rather than needing a cron of its own.
  await push.pruneLedger(db);
  // Spent and expired Zalo pairing codes, and the share-card images whose capability URLs should
  // stop working. Same slot, same reasoning.
  await zalo.pruneCodes(db);
  if (env?.FILES) await zalo.pruneMedia(env.FILES);
  return messages.length;
}

/**
 * Job C — tomorrow's sessions. 12:00 UTC = 19:00 ICT, the `reminders` channel.
 *
 * Evening on purpose. The 15-minute job already covers "your class starts soon", which is too late
 * to do anything about; this one lands while there is still an evening left to learn the words and
 * find the book. Students get one message per class they are in; staff get one summary of the
 * whole day, because the thing a teacher needs is the list, not five separate pings.
 */
export async function runEveningPreview(db: Db, at: Date = new Date(), env?: Env): Promise<number> {
  const prefs = await getNotifPrefs(db);
  if (!prefs.previewEvening) return 0;

  const { dateIso } = ictNow(at);
  const tomorrow = addDaysIso(dateIso, 1);

  const all = await eventsSvc.list(db);
  // Same expansion the calendar and the 15-minute sweep use, so all three agree on which weeks a
  // recurring class actually runs.
  const occs = expandEvents(all, parseISO(tomorrow), parseISO(tomorrow))
    .filter((e) => e.date === tomorrow && !!e.classId)
    .sort((a, b) => (a.start ?? '99:99').localeCompare(b.start ?? '99:99'));
  if (!occs.length) return 0;

  const [classes, previews] = await Promise.all([
    classesSvc.list(db),
    previewSvc.composeMany(
      db,
      occs.map((e) => ({ id: e.id, classId: e.classId as string, date: e.date })),
    ),
  ]);

  const messages: ExpoPushMessage[] = [];
  const doneKeys: string[] = [];

  // ---- Students: one message per occurrence, idempotent per (event, date) ----
  const studentKeys = occs.map((e) => `preview:${e.id}:${e.date}`);
  const sentStudent = await push.alreadySent(db, studentKeys);

  for (const ev of occs) {
    const key = `preview:${ev.id}:${ev.date}`;
    if (sentStudent.has(key)) continue;
    const cls = classes.find((c) => c.id === ev.classId);
    if (!cls) continue;
    // Marked done even when nobody is registered, for the same reason as the class sweep.
    doneKeys.push(key);

    const tokens = await push.tokensForAccounts(
      db,
      await push.accountIdsForStudents(db, cls.studentIds),
    );
    if (!tokens.length) continue;

    const line = previewLine(previews.get(previewSvc.previewKey(ev.id, ev.date)) ?? EMPTY_PREVIEW);
    for (const to of tokens) {
      messages.push({
        to,
        title: `Ngày mai: ${cls.name}${ev.start ? ` · ${ev.start}` : ''}`,
        // A session with nothing written about it still deserves the reminder that it exists.
        body: line || 'Chuẩn bị cho buổi học ngày mai nhé!',
        // `/schedule` only exists in builds carrying the student-schedule OTA. Do not ship this job
        // before that update has propagated, or taps dead-end on not-found — the same hazard the
        // digest's `/flashcards` comment above describes.
        data: { url: '/schedule', kind: 'preview' },
        channelId: 'reminders',
      });
    }
  }

  // ---- Staff: one summary for the day ----
  //
  // Every staff account gets it. There is no class_staff table (a deliberate absence — the school
  // has one or two teachers), so "the teachers of this class" is not a query that exists yet.
  const staffKey = `preview-staff:${tomorrow}`;
  if (!(await push.alreadySent(db, [staffKey])).has(staffKey)) {
    doneKeys.push(staffKey);
    const staffIds = (await db.select({ id: staff.id }).from(staff)).map((r) => r.id);
    const tokens = await push.tokensForAccounts(db, await push.accountIdsForStaff(db, staffIds));
    if (tokens.length) {
      const summary = occs
        .map((ev) => {
          const cls = classes.find((c) => c.id === ev.classId);
          const line = previewLine(
            previews.get(previewSvc.previewKey(ev.id, ev.date)) ?? EMPTY_PREVIEW,
            60,
          );
          return `${ev.start ?? '--:--'} ${cls?.name ?? ev.title}${line ? ` — ${line}` : ''}`;
        })
        .join('\n');
      for (const to of tokens) {
        messages.push({
          to,
          title: `Ngày mai có ${occs.length} buổi dạy`,
          // Expo truncates long bodies itself; cap it so the notification tray stays readable.
          body: summary.slice(0, 400),
          data: { url: '/calendar', kind: 'preview' },
          channelId: 'reminders',
        });
      }
    }
  }

  await deliver(db, messages);
  await push.markSent(db, doneKeys);

  // ---- Zalo ----
  //
  // Two audiences, and the split is the point of the evening slot. Each class's parents get that
  // class's own preview — in the class group chat if one is linked, otherwise privately to each
  // parent, never both, or a parent with a child in the group gets it twice. Staff get the same
  // whole-day summary they get on push.
  const staffSummary = () =>
    occs
      .map((ev) => {
        const cls = classes.find((c) => c.id === ev.classId);
        const line = previewLine(
          previews.get(previewSvc.previewKey(ev.id, ev.date)) ?? EMPTY_PREVIEW,
          60,
        );
        return `${ev.start ?? '--:--'} ${cls?.name ?? ev.title}${line ? ` — ${line}` : ''}`;
      })
      .join('\n');

  const zaloJobs: ZaloJob[] = [];
  for (const ev of occs) {
    const cls = classes.find((c) => c.id === ev.classId);
    if (!cls) continue;
    const line = previewLine(previews.get(previewSvc.previewKey(ev.id, ev.date)) ?? EMPTY_PREVIEW);
    const groupChat = await zalo.chatForClass(db, cls.id);
    zaloJobs.push({
      key: `zalo-preview:${ev.id}:${ev.date}`,
      chatIds: async () =>
        groupChat ? [groupChat] : zalo.chatsForParentsOfStudents(db, cls.studentIds),
      text:
        `📚 Ngày mai: ${cls.name}${ev.start ? ` · ${ev.start}` : ''}\n` +
        (line || 'Chuẩn bị cho buổi học ngày mai nhé!'),
    });
  }
  zaloJobs.push({
    key: `zalo-preview-staff:${tomorrow}`,
    chatIds: async () =>
      zalo.chatsForAccounts(
        db,
        await zalo.accountIdsForStaff(
          db,
          (await db.select({ id: staff.id }).from(staff)).map((r) => r.id),
        ),
      ),
    text: `Ngày mai có ${occs.length} buổi dạy\n${staffSummary().slice(0, 1500)}`,
  });
  await zaloDeliver(db, env, zaloJobs);

  return messages.length;
}

/**
 * Job D — the garden. Rides the 08:00 ICT slot with the daily digest.
 *
 * The sweep itself (missed deadlines, overdue decay, the month-end album) lives in
 * `gardenSvc.runGardenSweep`; this only turns what it reports into pushes. That split matters: the
 * plant's state is DERIVED from elapsed time on every read, so a notification can only ever
 * announce something the student's own screen already shows. A skipped run therefore costs a
 * message, never a wrong plant — which is also why the ledger keys below are date-scoped. A
 * "wilting today" push two days late would be a lie, so it is simply never sent.
 */
export async function runGardenAlerts(db: Db, at: Date = new Date()): Promise<number> {
  const nowIso = at.toISOString();
  const sweep = await gardenSvc.runGardenSweep(db, nowIso);
  const prefs = await getNotifPrefs(db);
  if (!prefs.gardenAlerts) return 0;

  const { dateIso } = ictNow(at);
  const messages: ExpoPushMessage[] = [];
  const doneKeys: string[] = [];

  type Alert = { studentId: string; key: string; body: string };
  const alerts: Alert[] = [
    ...sweep.penalties.map((p) => ({
      studentId: p.studentId,
      key: `garden-penalty:${p.assignmentId}:${p.studentId}`,
      body: `Bài "${p.topicName}" đã quá hạn — cây tụt 1 bậc 😢. Cố lên bài sau nhé!`,
    })),
    ...sweep.wiltingToday.map((w) => ({
      studentId: w.studentId,
      key: `garden-wilt:${w.studentId}:${dateIso}`,
      body: 'Cây của em đang héo 🥀 Học 1 bài từ vựng để cứu cây nhé!',
    })),
    ...sweep.droppingTomorrow.map((d) => ({
      studentId: d.studentId,
      key: `garden-drop:${d.studentId}:${d.nextDropDate}`,
      body: 'Mai cây sẽ tụt 1 bậc ⚠️ Học ngay 1 bài để giữ cây nào!',
    })),
  ];

  const sent = await push.alreadySent(
    db,
    alerts.map((a) => a.key),
  );

  for (const alert of alerts) {
    if (sent.has(alert.key)) continue;
    // Marked done even when the student has no device registered: the occurrence HAS been
    // processed, exactly as in the class sweep above.
    doneKeys.push(alert.key);
    const accountIds = await push.accountIdsForStudents(db, [alert.studentId]);
    for (const to of await push.tokensForAccounts(db, accountIds)) {
      messages.push({
        to,
        title: 'Vườn cây của em',
        body: alert.body,
        // `/flashcards`, not `/vocabulary`, for the same reason as the study nudge above: a phone
        // running a pre-rename bundle would dead-end on the new path.
        data: { url: '/flashcards', kind: 'garden' },
        channelId: 'study',
      });
    }
  }

  await deliver(db, messages);
  await push.markSent(db, doneKeys);
  return messages.length;
}

/** For an occurrence nobody wrote a preview for. previewLine returns '' for it. */
const EMPTY_PREVIEW = { focusText: '', vocabTopic: null, tests: [] };

/**
 * One Zalo message, to whoever `chatIds` resolves to, once per `key` ever.
 *
 * `chatIds` is a thunk so the lookup is skipped entirely for keys already sent — which, on a
 * 15-minute sweep over a 30-minute window, is most of them.
 */
type ZaloJob = { key: string; chatIds: () => Promise<string[]>; text: string };

/**
 * The Zalo half of a job. Never throws.
 *
 * Keys are marked done even when nobody is linked, for the same reason the push passes do: the
 * occurrence HAS been processed, and re-processing it next tick would just re-find nobody.
 *
 * The whole pass is wrapped in a try/catch rather than relying on the service's own error
 * swallowing. If this threw, it would take the enclosing job's return value with it — and Zalo
 * being down is not a reason for the class-reminder cron to report failure.
 */
async function zaloDeliver(db: Db, env: Env | undefined, jobs: ZaloJob[]): Promise<number> {
  if (!env || !zalo.isEnabled(env) || !jobs.length) return 0;
  try {
    const already = await push.alreadySent(
      db,
      jobs.map((j) => j.key),
    );
    const todo = jobs.filter((j) => !already.has(j.key));
    if (!todo.length) return 0;

    let sent = 0;
    for (const job of todo) {
      const chatIds = await job.chatIds();
      if (chatIds.length) sent += await zalo.broadcastText(env, chatIds, job.text);
    }
    await push.markSent(
      db,
      todo.map((j) => j.key),
    );
    return sent;
  } catch (err) {
    console.error('[zalo] pass failed', { err: String(err) });
    return 0;
  }
}

/** Send, then delete whatever Expo said is gone. */
async function deliver(db: Db, messages: ExpoPushMessage[]): Promise<void> {
  if (!messages.length) return;
  const { dead } = await push.sendPush(messages);
  if (dead.length) {
    console.log('[push] pruning dead tokens', { n: dead.length });
    await push.pruneTokens(db, dead);
  }
}

/** Cron entry point. Branches on the schedule that fired. */
export async function runScheduled(cron: string, env: Env, at: Date = new Date()): Promise<void> {
  const db = createDb(env);
  const started = Date.now();
  // 08:00 ICT carries two jobs: the study digest and the garden. The garden runs second and its
  // own errors must not swallow the digest's result, so it is awaited separately.
  const sent =
    cron === '0 1 * * *'
      ? await runDailyDigest(db, at, env)
      : cron === '0 12 * * *'
        ? await runEveningPreview(db, at, env)
        : await runClassReminders(db, at, env);
  let garden = 0;
  if (cron === '0 1 * * *') garden = await runGardenAlerts(db, at);
  console.log('[cron]', { cron, sent, garden, ms: Date.now() - started });
}
