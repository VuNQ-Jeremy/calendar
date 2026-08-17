import { and, gte, isNotNull } from 'drizzle-orm';
import { flashcardResults, staff, students } from '../db/schema';
import { PRIMARY_TENANT_ID, TenantDb, type Db } from '../db/index';
import { createRawDb } from '../db/internal';
import { expandEvents } from '../../shared/logic/recurrence';
import { iso, parseISO, toMin } from '../../shared/logic/dates';
import { previewLine, type ComposedPreview } from '../../shared/logic/preview';
import * as classesSvc from './classes';
import * as eventsSvc from './events';
import * as gardenSvc from './garden';
import { accountsWanting, getNotifPrefsByAccount, getSchoolNotifPrefs } from './notif-prefs';
import * as previewSvc from './session-preview';
import * as push from './push';
import type { ExpoPushMessage } from './push';
import * as zalo from './zalo';
import * as vocabImages from './vocab-images';
import { record, setActorTenant } from './audit';
import { listActiveTenantIds } from './tenants';

/**
 * The scheduled notification jobs. Called from `scheduled()` in workers/app.ts, and from the
 * debug endpoint while developing (waiting 15 minutes per iteration is not a feedback loop).
 *
 * **Timezone.** The whole user base is in Vietnam: ICT, UTC+7, no DST, ever. That offset is
 * hardcoded below rather than carried in a column. Multi-tenancy did NOT relax this: every school
 * in the deployment is assumed to keep Vietnamese hours, so one cron tick means the same wall
 * clock for all of them. It stays a single named constant and not seven scattered `+ 7`s precisely
 * so that the day a school outside ICT signs up, the fix is a column read here rather than a hunt.
 *
 * **One sweep per school.** `runScheduled` walks `listActiveTenantIds` and runs the jobs below once
 * per school against a `TenantDb`. The jobs themselves know nothing about that: they read and write
 * through the scoped handle and see exactly one school's data, which is why their logic is unchanged
 * from the single-school version.
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

/** "Now", as the school experiences it. Exported for the forecast in ./notify-plan.ts. */
export function ictNow(at: Date): { dateIso: string; minutes: number } {
  const shifted = new Date(at.getTime() + ICT_OFFSET_MIN * 60_000);
  return {
    dateIso: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

export function addDaysIso(dateIso: string, days: number): string {
  const d = parseISO(dateIso);
  d.setDate(d.getDate() + days);
  return iso(d);
}

/** For an occurrence nobody wrote a preview for. previewLine returns '' for it. */
export const EMPTY_PREVIEW: ComposedPreview = { focusText: '', vocabTopic: null, tests: [] };

/* ── The shared vocabulary: keys, buckets, message texts ─────────────────────────────────────
 *
 * Everything in this section was lifted verbatim out of the four jobs below so that a SECOND
 * reader of the same rules exists: `server/services/notify-plan.ts` forecasts what these jobs will
 * send, and the /logs Notifications tab shows that forecast to an admin. A forecast that composes
 * its own keys or its own wording would drift the first time a string here is reworded, and it
 * would drift silently — the whole value of the tab is that it cannot lie about what will be sent.
 *
 * So: the jobs own WHEN and WHO. This section owns WHAT and under WHICH KEY. Both callers share it.
 */

/** Every idempotency key format in the system, in one place. See migrations/0015_notifications.sql. */
export const ledgerKey = {
  class: (eventId: string, date: string) => `class:${eventId}:${date}`,
  zaloClass: (eventId: string, date: string) => `zalo-class:${eventId}:${date}`,
  study: (studentId: string, bucket: string) => `study:${studentId}:${bucket}`,
  preview: (eventId: string, date: string) => `preview:${eventId}:${date}`,
  previewStaff: (date: string) => `preview-staff:${date}`,
  zaloPreview: (eventId: string, date: string) => `zalo-preview:${eventId}:${date}`,
  zaloPreviewStaff: (date: string) => `zalo-preview-staff:${date}`,
  gardenPenalty: (assignmentId: string, studentId: string) =>
    `garden-penalty:${assignmentId}:${studentId}`,
  gardenWilt: (studentId: string, dateIso: string) => `garden-wilt:${studentId}:${dateIso}`,
  gardenDrop: (studentId: string, nextDropDate: string) =>
    `garden-drop:${studentId}:${nextDropDate}`,
} as const;

/**
 * The study nudge's bucket: `YYYY-MM-A` for the 1st-14th, `YYYY-MM-B` from the 15th.
 *
 * Called a "week" key where it is used, but it is halves of a month — so the real guarantee is at
 * most two nudges per student per month, not one per seven days. Named honestly here.
 */
export function studyBucket(dateIso: string): string {
  return dateIso.slice(0, 8) + (Number(dateIso.slice(8, 10)) < 15 ? 'A' : 'B');
}

/** The fields the composers below read off an occurrence. */
type OccLike = {
  id: string;
  title: string;
  date: string;
  start?: string | null;
  location?: string | null;
  classId?: string | null;
};

/** A composed push message minus `to` — the caller fans one body out over its tokens. */
export type PushBody = Omit<ExpoPushMessage, 'to'>;

export function classReminderPush(
  cls: { name: string },
  ev: OccLike,
  focus: string | undefined,
): PushBody {
  return {
    title: cls.name,
    // The event's own "Room or place", not the class's — `classes.room` is gone from the
    // product. Same information for anyone who filled the field in, and it is per-occurrence.
    //
    // Only the teacher's own words go in this body, not the whole preview: a notification arriving
    // 30 minutes ahead is a nudge out the door, and the tests are already on the schedule screen.
    body:
      `${ev.title} · ${ev.start}${ev.location ? ` · ${ev.location}` : ''}` +
      (focus ? ` · ${focus.slice(0, 90)}` : ''),
    // Deep link straight to the occurrence, not the app's home screen.
    data: { url: `/event/${ev.id}`, kind: 'class' },
    channelId: 'reminders',
  };
}

/**
 * Longer than the push body on purpose. A push is a glanceable nudge for someone who is already
 * going; this is the message a parent reads to decide whether their child is ready.
 */
export function classReminderZaloText(
  cls: { name: string },
  ev: OccLike,
  focus: string | undefined,
): string {
  return (
    `🔔 ${cls.name} · ${ev.start}${ev.location ? ` · ${ev.location}` : ''}` +
    (focus ? `\n${focus.slice(0, 300)}` : '')
  );
}

export function studyNudgePush(): PushBody {
  return {
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
  };
}

export function previewPush(cls: { name: string }, ev: OccLike, line: string): PushBody {
  return {
    title: `Ngày mai: ${cls.name}${ev.start ? ` · ${ev.start}` : ''}`,
    // A session with nothing written about it still deserves the reminder that it exists.
    body: line || 'Chuẩn bị cho buổi học ngày mai nhé!',
    // `/schedule` only exists in builds carrying the student-schedule OTA. Do not ship this job
    // before that update has propagated, or taps dead-end on not-found — the same hazard the
    // digest's `/flashcards` comment above describes.
    data: { url: '/schedule', kind: 'preview' },
    channelId: 'reminders',
  };
}

export function previewZaloText(cls: { name: string }, ev: OccLike, line: string): string {
  return (
    `📚 Ngày mai: ${cls.name}${ev.start ? ` · ${ev.start}` : ''}\n` +
    (line || 'Chuẩn bị cho buổi học ngày mai nhé!')
  );
}

/**
 * The whole-day list a teacher gets. One composer, two consumers: the push body caps it at 400
 * characters and the Zalo text at 1500. Before this was hoisted the same `.map().join()` existed
 * twice in `runEveningPreview`, which is exactly the kind of duplication that drifts.
 */
export function staffDaySummary(
  occs: OccLike[],
  classes: { id: string; name: string }[],
  previews: Map<string, ComposedPreview>,
): string {
  return occs
    .map((ev) => {
      const cls = classes.find((c) => c.id === ev.classId);
      const line = previewLine(
        previews.get(previewSvc.previewKey(ev.id, ev.date)) ?? EMPTY_PREVIEW,
        60,
      );
      return `${ev.start ?? '--:--'} ${cls?.name ?? ev.title}${line ? ` — ${line}` : ''}`;
    })
    .join('\n');
}

export function staffPreviewPush(count: number, summary: string): PushBody {
  return {
    title: `Ngày mai có ${count} buổi dạy`,
    // Expo truncates long bodies itself; cap it so the notification tray stays readable.
    body: summary.slice(0, 400),
    data: { url: '/calendar', kind: 'preview' },
    channelId: 'reminders',
  };
}

export function staffPreviewZaloText(count: number, summary: string): string {
  return `Ngày mai có ${count} buổi dạy\n${summary.slice(0, 1500)}`;
}

/** One garden alert: which student, under which key, saying what. */
export type GardenAlert = { studentId: string; key: string; body: string };

/**
 * Turn a sweep's findings into alerts. Pure, so the forecast can run it over
 * `gardenSvc.forecastGardenSweep`'s output and get the same rows the cron would send.
 */
export function gardenAlertsFrom(sweep: gardenSvc.SweepResult, dateIso: string): GardenAlert[] {
  return [
    ...sweep.penalties.map((p) => ({
      studentId: p.studentId,
      key: ledgerKey.gardenPenalty(p.assignmentId, p.studentId),
      body: `Bài "${p.topicName}" đã quá hạn — cây tụt 1 bậc 😢. Cố lên bài sau nhé!`,
    })),
    ...sweep.wiltingToday.map((w) => ({
      studentId: w.studentId,
      key: ledgerKey.gardenWilt(w.studentId, dateIso),
      body: 'Cây của em đang héo 🥀 Học 1 bài từ vựng để cứu cây nhé!',
    })),
    ...sweep.droppingTomorrow.map((d) => ({
      studentId: d.studentId,
      key: ledgerKey.gardenDrop(d.studentId, d.nextDropDate),
      body: 'Mai cây sẽ tụt 1 bậc ⚠️ Học ngay 1 bài để giữ cây nào!',
    })),
  ];
}

export function gardenAlertPush(body: string): PushBody {
  return {
    title: 'Vườn cây của em',
    body,
    // `/flashcards`, not `/vocabulary`, for the same reason as the study nudge above: a phone
    // running a pre-rename bundle would dead-end on the new path.
    data: { url: '/flashcards', kind: 'garden' },
    channelId: 'study',
  };
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
export async function runClassReminders(
  db: TenantDb,
  at: Date = new Date(),
  env?: Env,
): Promise<number> {
  // Two reads, two jobs. `prefs` is the SCHOOL baseline: it decides whether this sweep runs at
  // all and how wide its window is. `perAccount` decides who inside that window actually
  // hears about it — see server/services/notif-prefs.ts on why the lead time is not personal.
  const [prefs, perAccount] = await Promise.all([
    getSchoolNotifPrefs(db),
    getNotifPrefsByAccount(db),
  ]);
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
  const keys = upcoming.map((e) => ledgerKey.class(e.id, e.date));
  const sent = await push.alreadySent(db, keys);
  const todo = upcoming.filter((e) => !sent.has(ledgerKey.class(e.id, e.date)));

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

    const accountIds = accountsWanting(
      perAccount,
      await push.accountIdsForStudents(db, cls.studentIds),
      'classReminders',
    );
    const tokens = await push.tokensForAccounts(db, accountIds);
    // The key is marked done even when nobody is registered: the occurrence HAS been processed,
    // and re-processing it on the next tick would just re-find nobody.
    doneKeys.push(ledgerKey.class(ev.id, ev.date));
    if (!tokens.length) continue;

    const focus = previews.get(previewSvc.previewKey(ev.id, ev.date))?.focusText.trim();
    const body = classReminderPush(cls, ev, focus);
    for (const to of tokens) messages.push({ to, ...body });
  }

  await deliver(db, messages);
  await push.markSent(db, doneKeys);

  // ---- Zalo: the same reminder, to the parents of the students in each class ----
  await zaloDeliver(
    db,
    env,
    upcoming.flatMap((ev) => {
      const cls = classes.find((c) => c.id === ev.classId);
      if (!cls) return [];
      const focus = previews.get(previewSvc.previewKey(ev.id, ev.date))?.focusText.trim();
      return [
        {
          key: ledgerKey.zaloClass(ev.id, ev.date),
          chatIds: () => zalo.chatsForParentsOfStudents(db, cls.studentIds),
          text: classReminderZaloText(cls, ev, focus),
        },
      ];
    }),
  );

  return messages.length;
}

/**
 * Job B — the daily digest. 01:00 UTC = 08:00 ICT, the `study` channel.
 *
 * `env` no longer does anything here: the daily housekeeping that needed it (R2 pruning) moved to
 * `runDailyHousekeeping`, which runs once for the whole deployment rather than once per school. The
 * parameter stays because the debug endpoints (app/routes/api.push.run.tsx, /logs → Notifications)
 * call all four jobs through one uniform `(db, at, env)` shape, and narrowing it here would break
 * those call sites to save nothing.
 */
export async function runDailyDigest(
  db: TenantDb,
  at: Date = new Date(),
  env?: Env,
): Promise<number> {
  void env; // accepted for signature parity with the other three jobs; see above.
  // Two reads, two jobs. `prefs` is the SCHOOL baseline: it decides whether this sweep runs at
  // all and how wide its window is. `perAccount` decides who inside that window actually
  // hears about it — see server/services/notif-prefs.ts on why the lead time is not personal.
  const [prefs, perAccount] = await Promise.all([
    getSchoolNotifPrefs(db),
    getNotifPrefsByAccount(db),
  ]);
  const { dateIso } = ictNow(at);
  const messages: ExpoPushMessage[] = [];
  const doneKeys: string[] = [];

  if (prefs.studyNudges) {
    // Gentle and infrequent by design: this is the one notification with no deadline behind it,
    // and the easiest to resent. Weekly at most, per student, and only after real inactivity.
    const QUIET_DAYS = 7;
    const cutoff = new Date(at.getTime() - QUIET_DAYS * 86_400_000).toISOString();

    const recent = await db.raw
      .select({ studentId: flashcardResults.studentId })
      .from(flashcardResults)
      .where(
        db.own(
          flashcardResults,
          and(isNotNull(flashcardResults.studentId), gte(flashcardResults.playedAt, cutoff)),
        ),
      );
    const active = new Set(recent.map((r) => r.studentId));

    const all = await db.raw
      .select({ id: students.id, name: students.name })
      .from(students)
      .where(db.own(students));
    const quiet = all.filter((s) => !active.has(s.id));

    // Half-month bucket: keeps this to at most two nudges per student per month even though the
    // digest runs daily. See `studyBucket`.
    const weekKey = studyBucket(dateIso);
    const keys = quiet.map((s) => ledgerKey.study(s.id, weekKey));
    const sent = await push.alreadySent(db, keys);

    for (const s of quiet) {
      const key = ledgerKey.study(s.id, weekKey);
      if (sent.has(key)) continue;
      doneKeys.push(key);
      const accountIds = accountsWanting(
        perAccount,
        await push.accountIdsForStudents(db, [s.id]),
        'studyNudges',
      );
      const body = studyNudgePush();
      for (const to of await push.tokensForAccounts(db, accountIds)) {
        messages.push({ to, ...body });
      }
    }
  }

  await deliver(db, messages);
  await push.markSent(db, doneKeys);
  return messages.length;
}

/**
 * The daily retention sweep, deployment half. Rides the 08:00 ICT slot rather than needing a cron of
 * its own, and runs ONCE, outside the per-school loop, on the unscoped handle.
 *
 * What lands here is what a school id cannot narrow: the two R2 sweeps walk a bucket that has no
 * school in it at all, and the objects `vocabImages.pruneImages` protects are pinned by
 * `flashcard_words`, which carries no `tenant_id`. Running these inside the loop would be N passes
 * over the same objects, N−1 of which find nothing left to do — it would make the R2 listing cost
 * scale with the number of schools for no benefit whatsoever.
 *
 * What does NOT land here is the two ledgers, `sent_notifications` and `zalo_pair_codes`. Both
 * gained a `tenant_id`, and their prunes (`push.pruneLedger`, `zalo.pruneCodes`) delete only the
 * caller's rows — so they are per-school, in `runTenantHousekeeping` below.
 */
export async function runDailyHousekeeping(db: Db, env?: Env): Promise<void> {
  // tenant-unscoped: retention sweep spans the deployment
  if (env?.FILES) await zalo.pruneMedia(env.FILES);
  // Vocabulary pictures nothing points at — a teacher who abandoned a generated topic after the
  // images were stored. Only objects older than a day go, so a review in progress is never cut
  // out from under itself. See server/services/vocab-images.ts.
  // tenant-unscoped: retention sweep spans the deployment
  if (env?.FILES) await vocabImages.pruneImages(db, env.FILES);
}

/**
 * The daily retention sweep, school half: the notification ledger and the spent Zalo pair codes.
 *
 * Both tables are keyed by school and both prunes are scoped, so this runs once per school rather
 * than once per deployment. It is two dated DELETEs, so the cost of the extra passes is real but
 * small. The thing worth knowing is what the loop implies: a SUSPENDED school stops being visited by
 * `runScheduled` and therefore stops having these trimmed. The rows are harmless — nothing reads a
 * suspended school's ledger — but they do not go away on their own either.
 */
async function runTenantHousekeeping(db: TenantDb): Promise<void> {
  await push.pruneLedger(db);
  // Spent and expired pairing codes. Same slot, same reasoning.
  await zalo.pruneCodes(db);
}

/**
 * Job C — tomorrow's sessions. 12:00 UTC = 19:00 ICT, the `reminders` channel.
 *
 * Evening on purpose. The 15-minute job already covers "your class starts soon", which is too late
 * to do anything about; this one lands while there is still an evening left to learn the words and
 * find the book. Students get one message per class they are in; staff get one summary of the
 * whole day, because the thing a teacher needs is the list, not five separate pings.
 */
export async function runEveningPreview(
  db: TenantDb,
  at: Date = new Date(),
  env?: Env,
): Promise<number> {
  // Two reads, two jobs. `prefs` is the SCHOOL baseline: it decides whether this sweep runs at
  // all and how wide its window is. `perAccount` decides who inside that window actually
  // hears about it — see server/services/notif-prefs.ts on why the lead time is not personal.
  const [prefs, perAccount] = await Promise.all([
    getSchoolNotifPrefs(db),
    getNotifPrefsByAccount(db),
  ]);
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
  const studentKeys = occs.map((e) => ledgerKey.preview(e.id, e.date));
  const sentStudent = await push.alreadySent(db, studentKeys);

  for (const ev of occs) {
    const key = ledgerKey.preview(ev.id, ev.date);
    if (sentStudent.has(key)) continue;
    const cls = classes.find((c) => c.id === ev.classId);
    if (!cls) continue;
    // Marked done even when nobody is registered, for the same reason as the class sweep.
    doneKeys.push(key);

    const tokens = await push.tokensForAccounts(
      db,
      accountsWanting(
        perAccount,
        await push.accountIdsForStudents(db, cls.studentIds),
        'previewEvening',
      ),
    );
    if (!tokens.length) continue;

    const line = previewLine(previews.get(previewSvc.previewKey(ev.id, ev.date)) ?? EMPTY_PREVIEW);
    const body = previewPush(cls, ev, line);
    for (const to of tokens) messages.push({ to, ...body });
  }

  // ---- Staff: one summary for the day ----
  //
  // Every staff account OF THIS SCHOOL gets it. There is no class_staff table (a deliberate
  // absence — a school has one or two teachers), so "the teachers of this class" is not a query
  // that exists yet.
  const staffKey = ledgerKey.previewStaff(tomorrow);
  if (!(await push.alreadySent(db, [staffKey])).has(staffKey)) {
    doneKeys.push(staffKey);
    const staffIds = (await db.raw.select({ id: staff.id }).from(staff).where(db.own(staff))).map(
      (r) => r.id,
    );
    const tokens = await push.tokensForAccounts(
      db,
      accountsWanting(perAccount, await push.accountIdsForStaff(db, staffIds), 'previewEvening'),
    );
    if (tokens.length) {
      const body = staffPreviewPush(occs.length, staffDaySummary(occs, classes, previews));
      for (const to of tokens) messages.push({ to, ...body });
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
  const zaloJobs: ZaloJob[] = [];
  for (const ev of occs) {
    const cls = classes.find((c) => c.id === ev.classId);
    if (!cls) continue;
    const line = previewLine(previews.get(previewSvc.previewKey(ev.id, ev.date)) ?? EMPTY_PREVIEW);
    const groupChat = await zalo.chatForClass(db, cls.id);
    zaloJobs.push({
      key: ledgerKey.zaloPreview(ev.id, ev.date),
      chatIds: async () =>
        groupChat ? [groupChat] : zalo.chatsForParentsOfStudents(db, cls.studentIds),
      text: previewZaloText(cls, ev, line),
    });
  }
  zaloJobs.push({
    key: ledgerKey.zaloPreviewStaff(tomorrow),
    chatIds: async () =>
      zalo.chatsForAccounts(
        db,
        await zalo.accountIdsForStaff(
          db,
          (await db.raw.select({ id: staff.id }).from(staff).where(db.own(staff))).map((r) => r.id),
        ),
      ),
    text: staffPreviewZaloText(occs.length, staffDaySummary(occs, classes, previews)),
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
export async function runGardenAlerts(db: TenantDb, at: Date = new Date()): Promise<number> {
  const nowIso = at.toISOString();
  const sweep = await gardenSvc.runGardenSweep(db, nowIso);
  // Two reads, two jobs. `prefs` is the SCHOOL baseline: it decides whether this sweep runs at
  // all and how wide its window is. `perAccount` decides who inside that window actually
  // hears about it — see server/services/notif-prefs.ts on why the lead time is not personal.
  const [prefs, perAccount] = await Promise.all([
    getSchoolNotifPrefs(db),
    getNotifPrefsByAccount(db),
  ]);
  if (!prefs.gardenAlerts) return 0;

  const { dateIso } = ictNow(at);
  const messages: ExpoPushMessage[] = [];
  const doneKeys: string[] = [];

  const alerts = gardenAlertsFrom(sweep, dateIso);

  const sent = await push.alreadySent(
    db,
    alerts.map((a) => a.key),
  );

  for (const alert of alerts) {
    if (sent.has(alert.key)) continue;
    // Marked done even when the student has no device registered: the occurrence HAS been
    // processed, exactly as in the class sweep above.
    doneKeys.push(alert.key);
    const accountIds = accountsWanting(
      perAccount,
      await push.accountIdsForStudents(db, [alert.studentId]),
      'gardenAlerts',
    );
    const body = gardenAlertPush(alert.body);
    for (const to of await push.tokensForAccounts(db, accountIds)) {
      messages.push({ to, ...body });
    }
  }

  await deliver(db, messages);
  await push.markSent(db, doneKeys);
  return messages.length;
}

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
 *
 * The tenant guard lives here, on the one path both jobs' Zalo passes go through, rather than at
 * the two call sites — a rule that has to be remembered twice is a rule that gets forgotten once.
 */
async function zaloDeliver(db: TenantDb, env: Env | undefined, jobs: ZaloJob[]): Promise<number> {
  if (!env || !zalo.isEnabled(env) || !jobs.length) return 0;
  // One bot token, so Zalo delivery belongs to the school that owns it. Per-school bots are
  // deferred; every other school's notifications go out by push only.
  if (db.tenantId !== PRIMARY_TENANT_ID) return 0;
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
async function deliver(db: TenantDb, messages: ExpoPushMessage[]): Promise<void> {
  if (!messages.length) return;
  const { dead } = await push.sendPush(messages);
  if (dead.length) {
    console.log('[push] pruning dead tokens', { n: dead.length });
    // tenant-unscoped: a dead Expo token is dead for every school. `push.pruneTokens` takes the
    // scoped handle for a uniform signature and drops to `db.raw` internally — `push_tokens` has
    // no `tenant_id` to filter on, and nothing here would want one.
    await push.pruneTokens(db, dead);
  }
}

/**
 * Cron entry point. Branches on the schedule that fired, once per school.
 *
 * **Every school gets its own try/catch.** One school's bad data must not silence every other
 * school's digest — a single unhandled throw halfway down the list used to be a missed sweep for
 * nobody in particular, and is now a missed sweep for everyone after the failure.
 *
 * **The per-tenant `ms` is logged on purpose.** These sweeps are sequential inside one Worker
 * invocation, so the deployment's total cron cost is the sum of the numbers in this log, and there
 * is a CPU-time ceiling it will eventually reach. That log is how the wall becomes visible while it
 * is still a graph and not an incident; the fix when it arrives (a queue, or a shard per tick) is a
 * change to this loop and nothing below it.
 */
export async function runScheduled(cron: string, env: Env, at: Date = new Date()): Promise<void> {
  const raw = createRawDb(env);
  const tenantIds = await listActiveTenantIds(raw);

  for (const tenantId of tenantIds) {
    const db = new TenantDb(raw, tenantId);
    // The ambient audit store follows the school being swept, so the summary row below — and any
    // audit a job writes on the way — is attributed to it rather than to whoever came first.
    setActorTenant(tenantId);
    const started = Date.now();
    try {
      // 08:00 ICT carries two jobs: the study digest and the garden. The garden runs second and its
      // own errors must not swallow the digest's result, so it is awaited separately.
      const sent =
        cron === '0 1 * * *'
          ? await runDailyDigest(db, at, env)
          : cron === '0 12 * * *'
            ? await runEveningPreview(db, at, env)
            : await runClassReminders(db, at, env);
      let garden = 0;
      if (cron === '0 1 * * *') {
        garden = await runGardenAlerts(db, at);
        await runTenantHousekeeping(db);
      }
      const ms = Date.now() - started;
      console.log('[cron]', { cron, tenant: tenantId, sent, garden, ms });
      // One summary row per school per cron run — not per bookkeeping write (markSent/pruneTokens/
      // pruneLedger/pruneCodes/pruneImages are pure noise at this granularity; runGardenAlerts
      // already writes its own garden_events audit). The system-store actor (workers/app.ts's
      // scheduled()) attributes it, and `setActorTenant` above places it.
      record({ action: 'mutation', meta: { tenant: tenantId, sent, garden, ms } });
    } catch (err) {
      // One school's bad data must not silence every other school's digest.
      console.error('[cron] tenant failed', { cron, tenant: tenantId, err: String(err) });
    }
  }

  // Outside the loop, on the unscoped handle: these sweep by age across the whole deployment, so
  // running them per school would be N passes over the same rows. See `runDailyHousekeeping`.
  if (cron === '0 1 * * *') {
    try {
      await runDailyHousekeeping(raw, env);
    } catch (err) {
      console.error('[cron] housekeeping failed', { cron, err: String(err) });
    }
  }
}
