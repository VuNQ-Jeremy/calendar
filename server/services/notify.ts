import { and, eq, gte, isNotNull } from 'drizzle-orm';
import { classStudents, flashcardResults, students } from '../db/schema';
import { createDb, type Db } from '../db/index';
import { expandEvents } from '../../shared/logic/recurrence';
import { iso, parseISO, toMin } from '../../shared/logic/dates';
import * as classesSvc from './classes';
import * as eventsSvc from './events';
import * as homeworkSvc from './homework';
import { getNotifPrefs } from './notif-prefs';
import * as push from './push';
import type { ExpoPushMessage } from './push';

/**
 * The scheduled notification jobs. Called from `scheduled()` in workers/app.ts, and from the
 * debug endpoint while developing (waiting 15 minutes per iteration is not a feedback loop).
 *
 * **Timezone.** The whole user base is in Vietnam: ICT, UTC+7, no DST, ever. That offset is
 * hardcoded below rather than carried in a column. It is the right trade for one school in one
 * city — and it is the first thing to change if the school opens a second location, which is why
 * it is a single named constant and not seven scattered `+ 7`s.
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
export async function runClassReminders(db: Db, at: Date = new Date()): Promise<number> {
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
  if (!todo.length) return 0;

  const classes = await classesSvc.list(db);
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

    for (const to of tokens) {
      messages.push({
        to,
        title: cls.name,
        // The event's own "Room or place", not the class's — `classes.room` is gone from the
        // product. Same information for anyone who filled the field in, and it is per-occurrence.
        body: `${ev.title} · ${ev.start}${ev.location ? ` · ${ev.location}` : ''}`,
        // Deep link straight to the occurrence, not the app's home screen.
        data: { url: `/event/${ev.id}`, kind: 'class' },
        channelId: 'reminders',
      });
    }
  }

  await deliver(db, messages);
  await push.markSent(db, doneKeys);
  return messages.length;
}

/**
 * Job B — the daily digest. 01:00 UTC = 08:00 ICT, `homework` and `study` channels.
 *
 * Homework due TOMORROW, not today: a reminder on the morning something is due is a reminder
 * you cannot act on.
 */
export async function runDailyDigest(db: Db, at: Date = new Date()): Promise<number> {
  const prefs = await getNotifPrefs(db);
  const { dateIso } = ictNow(at);
  const messages: ExpoPushMessage[] = [];
  const doneKeys: string[] = [];

  if (prefs.homeworkReminders) {
    const tomorrow = addDaysIso(dateIso, 1);
    const due = (await homeworkSvc.list(db)).filter(
      (h) => !h.done && h.due === tomorrow && h.classId,
    );
    const keys = due.map((h) => `homework:${h.id}:${tomorrow}`);
    const sent = await push.alreadySent(db, keys);

    for (const h of due) {
      const key = `homework:${h.id}:${tomorrow}`;
      if (sent.has(key)) continue;
      doneKeys.push(key);

      const roster = await db
        .select({ studentId: classStudents.studentId })
        .from(classStudents)
        .where(eq(classStudents.classId, h.classId!));
      const accountIds = await push.accountIdsForStudents(
        db,
        roster.map((r) => r.studentId),
      );
      for (const to of await push.tokensForAccounts(db, accountIds)) {
        messages.push({
          to,
          title: h.title,
          body: `${h.points != null ? `${h.points} pts · ` : ''}due tomorrow`,
          data: { url: `/homework/${h.id}`, kind: 'homework' },
          channelId: 'homework',
        });
      }
    }
  }

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
  return messages.length;
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
  const sent =
    cron === '0 1 * * *' ? await runDailyDigest(db, at) : await runClassReminders(db, at);
  console.log('[cron]', { cron, sent, ms: Date.now() - started });
}
