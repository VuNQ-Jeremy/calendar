import { and, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import {
  accounts,
  flashcardResults,
  flashcardTopics,
  parentStudents,
  pushTokens,
  staff,
  students,
  vocabAssignments,
} from '../db/schema';
import type { Db } from '../db/index';
import { expandEvents } from '../../shared/logic/recurrence';
import { parseISO, toMin } from '../../shared/logic/dates';
import { previewLine } from '../../shared/logic/preview';
import * as classesSvc from './classes';
import * as eventsSvc from './events';
import * as gardenSvc from './garden';
import { getNotifPrefs, type NotifPrefs } from './notif-prefs';
import * as previewSvc from './session-preview';
import * as push from './push';
import * as zalo from './zalo';
import {
  EMPTY_PREVIEW,
  addDaysIso,
  classReminderPush,
  classReminderZaloText,
  gardenAlertPush,
  gardenAlertsFrom,
  ictNow,
  ledgerKey,
  previewPush,
  previewZaloText,
  type PushBody,
  staffDaySummary,
  staffPreviewPush,
  staffPreviewZaloText,
  studyBucket,
  studyNudgePush,
} from './notify';

/**
 * What the cron is GOING to send — the read-only twin of ./notify.ts.
 *
 * Why this exists: the four jobs compose and send in one pass, `sent_notifications` keeps only
 * `(key, sent_at)`, and the Zalo pass throws its send count away. So "will tomorrow's preview
 * actually reach this class's parents?" was unanswerable without reading code — and the most common
 * answer, "no, because no chat is linked", is invisible even in the ledger, because a key is marked
 * done whether or not anybody received anything. This module answers it, and the /logs Notifications
 * tab shows the answer.
 *
 * **It must never lie, and it must never write.**
 *
 * Never lie: the keys, the message texts and the audience rules are NOT reimplemented here. They are
 * imported from ./notify.ts, which exports them for exactly this reason. Reword a notification there
 * and this forecast changes with it. What this module owns is only the arithmetic ./notify.ts does
 * not have: given a whole week, which cron tick sends each occurrence.
 *
 * Never write: no `run*` job is ever called from here. That is not squeamishness — `runDailyDigest`
 * carries the daily housekeeping (it prunes the ledger, the Zalo pair codes and orphaned R2 images),
 * so "just dry-run the job" would delete the very ledger the tab is displaying. The garden is the
 * one job whose subjects can only be discovered by sweeping, and `gardenSvc.forecastGardenSweep`
 * exists so that discovery can happen with `persist: false`.
 */

export type JobKind =
  | 'class'
  | 'digest'
  | 'preview'
  | 'preview-staff'
  | 'garden-penalty'
  | 'garden-wilt'
  | 'garden-drop';

export type Channel = 'push' | 'zalo';

export type TargetKind = 'students' | 'staff' | 'parents' | 'group-chat' | 'student';

export type PlannedTarget = {
  kind: TargetKind;
  /** People (push) or chats (Zalo) this would reach right now. 0 ⇒ the key burns silently. */
  count: number;
  /** Push only: devices behind those people. A student with an account but no app has 0. */
  devices?: number;
  /** Resolved names, capped — the UI shows "+n more" from `count`. */
  names: string[];
};

export type PlannedNotification = {
  jobKind: JobKind;
  channel: Channel;
  /** The exact ledger key the job will write. Built with ./notify.ts's `ledgerKey`. */
  key: string;
  /** ICT wall clock of the tick that sends it, `YYYY-MM-DDTHH:mm`. */
  fireAtIct: string;
  /**
   * True when the fire time is a fact (an occurrence's clock), false when it is a prediction: the
   * digest and garden jobs re-evaluate their subjects at 08:00, so their rows mean "if this is
   * still true then".
   */
  exactFire: boolean;
  alreadySent: boolean;
  /** At least one device or chat resolves. False ⇒ the job will mark the key done and send nothing. */
  deliverable: boolean;
  target: PlannedTarget;
  /** Push only — Zalo messages have no title. */
  title?: string;
  /** The exact text that will be sent. */
  body: string;
  subject: {
    className?: string;
    eventTitle?: string;
    studentName?: string;
    date: string;
    start?: string | null;
  };
};

export type NotificationsPlan = {
  planned: PlannedNotification[];
  prefs: NotifPrefs;
  channels: {
    zaloEnabled: boolean;
    pushTokens: number;
    pushAccounts: number;
    zaloLinks: number;
    zaloByKind: { group: number; direct: number };
  };
  /** Next firing of each cron, ICT wall clock. */
  nextRuns: { class: string; digest: string; preview: string; garden: string };
  generatedAtIct: string;
  horizonDays: number;
  /** The occurrence cap was hit; the forecast is the earliest-firing slice. */
  truncated: boolean;
};

/** How many occurrences the forecast will walk before it stops. */
export const OCCURRENCE_CAP = 200;

/** Names listed per row before the UI falls back to a count. */
const NAME_CAP = 5;

// ---- ICT tick arithmetic ----

/** `YYYY-MM-DDTHH:mm` from an ICT day and a minute-of-day, normalising past midnight. */
export function ictStamp(dateIso: string, minutes: number): string {
  const dayShift = Math.floor(minutes / 1440);
  const m = ((minutes % 1440) + 1440) % 1440;
  const day = dayShift === 0 ? dateIso : addDaysIso(dateIso, dayShift);
  return `${day}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * The class sweep runs every 15 minutes, so a reminder does not fire at `start - lead` — it fires at
 * the first quarter-hour tick at or after it.
 *
 * ICT is UTC+7 and 420 is a multiple of 15, so UTC quarter-hours ARE ICT quarter-hours; the rounding
 * can be done entirely in ICT minutes without converting back. A 00:10 class with a 30-minute lead
 * therefore fires at 23:45 the previous ICT day, which is the same midnight straddle
 * `runClassReminders` handles with its `+1440`.
 */
export function firstTickAtOrAfter(minutes: number): number {
  return Math.ceil(minutes / 15) * 15;
}

/** Next quarter-hour tick strictly after now. */
function nextQuarterHour(dateIso: string, nowMin: number): string {
  return ictStamp(dateIso, Math.floor(nowMin / 15) * 15 + 15);
}

/** Next occurrence of a fixed ICT time-of-day, today if it has not passed. */
function nextDailyRun(dateIso: string, nowMin: number, atMinute: number): string {
  return atMinute > nowMin
    ? ictStamp(dateIso, atMinute)
    : ictStamp(addDaysIso(dateIso, 1), atMinute);
}

/** 08:00 and 19:00 ICT, the two daily slots. */
const DIGEST_MINUTE = 8 * 60;
const PREVIEW_MINUTE = 19 * 60;

/** An ICT stamp back to the UTC instant the cron would fire at — what the garden forecast evaluates. */
function ictStampToUtc(stamp: string): Date {
  return new Date(`${stamp}:00.000+07:00`);
}

// ---- Audience index ----

/**
 * Every recipient lookup the four jobs make, resolved once into memory.
 *
 * The jobs themselves do these per-occurrence (`accountIdsForStudents` then `tokensForAccounts`
 * inside the loop). That is fine for a cron sweeping a handful of occurrences; copying it into a
 * page loader that walks a week would be dozens of D1 subrequests. So every table is read once and
 * the maps below answer the rest.
 */
type AudienceIndex = {
  /**
   * The actual Expo tokens, not just a count. The count is what the forecast displays; the tokens
   * are what "send this one row" needs, and resolving them twice from two different code paths is
   * how a preview and its delivery would end up disagreeing about who gets it.
   */
  tokensByStudentId: Map<string, string[]>;
  staffTokens: string[];
  staffNames: string[];
  parentChatsByStudentId: Map<string, string[]>;
  groupChatByClassId: Map<string, string>;
  staffChatIds: string[];
  studentNameById: Map<string, string>;
  totals: {
    pushTokens: number;
    pushAccounts: number;
    zaloLinks: number;
    group: number;
    direct: number;
  };
};

async function buildAudienceIndex(db: Db): Promise<AudienceIndex> {
  const [accountRows, tokenRows, studentRows, staffRows, links, parentLinks] = await Promise.all([
    db
      .select({ id: accounts.id, studentId: accounts.studentId, staffId: accounts.staffId })
      .from(accounts),
    db
      .select({ accountId: pushTokens.accountId, expoToken: pushTokens.expoToken })
      .from(pushTokens),
    db.select({ id: students.id, name: students.name }).from(students),
    db.select({ id: staff.id, name: staff.name }).from(staff),
    zalo.listLinks(db),
    db
      .select({ parentId: parentStudents.parentId, studentId: parentStudents.studentId })
      .from(parentStudents),
  ]);

  const tokensByAccount = new Map<string, string[]>();
  for (const t of tokenRows) {
    if (!t.accountId) continue;
    tokensByAccount.set(t.accountId, [...(tokensByAccount.get(t.accountId) ?? []), t.expoToken]);
  }

  const tokensByStudentId = new Map<string, string[]>();
  const staffTokens: string[] = [];
  for (const a of accountRows) {
    const tokens = tokensByAccount.get(a.id) ?? [];
    if (!tokens.length) continue;
    if (a.studentId)
      tokensByStudentId.set(a.studentId, [
        ...(tokensByStudentId.get(a.studentId) ?? []),
        ...tokens,
      ]);
    else if (a.staffId) staffTokens.push(...tokens);
  }

  // The two routes `zalo.chatsForParentsOfStudents` unions: a chat paired to a parent RECORD that
  // has this student, and a chat paired straight to the student. Deduped, same as the service.
  const chatsByParentId = new Map<string, string[]>();
  const chatsByStudentId = new Map<string, string[]>();
  const groupChatByClassId = new Map<string, string>();
  const staffAccountIds = new Set(accountRows.filter((a) => a.staffId).map((a) => a.id));
  const staffChatIds: string[] = [];
  let group = 0;
  let direct = 0;
  for (const l of links) {
    if (l.kind === 'group') group++;
    else direct++;
    if (l.parentId)
      chatsByParentId.set(l.parentId, [...(chatsByParentId.get(l.parentId) ?? []), l.chatId]);
    if (l.studentId)
      chatsByStudentId.set(l.studentId, [...(chatsByStudentId.get(l.studentId) ?? []), l.chatId]);
    // First linked group per class wins, matching `zalo.chatForClass`.
    if (l.classId && !groupChatByClassId.has(l.classId))
      groupChatByClassId.set(l.classId, l.chatId);
    if (l.accountId && staffAccountIds.has(l.accountId)) staffChatIds.push(l.chatId);
  }

  const parentChatsByStudentId = new Map<string, string[]>();
  for (const pl of parentLinks) {
    const chats = chatsByParentId.get(pl.parentId);
    if (!chats?.length) continue;
    parentChatsByStudentId.set(pl.studentId, [
      ...(parentChatsByStudentId.get(pl.studentId) ?? []),
      ...chats,
    ]);
  }
  for (const [studentId, chats] of chatsByStudentId) {
    parentChatsByStudentId.set(studentId, [
      ...(parentChatsByStudentId.get(studentId) ?? []),
      ...chats,
    ]);
  }

  return {
    tokensByStudentId,
    staffTokens,
    staffNames: staffRows.map((s) => s.name),
    parentChatsByStudentId,
    groupChatByClassId,
    staffChatIds: [...new Set(staffChatIds)],
    studentNameById: new Map(studentRows.map((s) => [s.id, s.name])),
    totals: {
      pushTokens: tokenRows.length,
      pushAccounts: tokensByAccount.size,
      zaloLinks: links.length,
      group,
      direct,
    },
  };
}

/**
 * Where one planned row would actually be delivered. Server-side only — it never rides out in the
 * loader payload, so the browser cannot see the school's device tokens or chat ids.
 */
export type Recipients = { tokens: string[]; chatIds: string[] };

/** Push target for a class roster: the students who could actually be reached. */
function studentsTarget(
  studentIds: string[],
  idx: AudienceIndex,
): { target: PlannedTarget; tokens: string[] } {
  const withDevice = studentIds.filter((id) => (idx.tokensByStudentId.get(id) ?? []).length > 0);
  const tokens = studentIds.flatMap((id) => idx.tokensByStudentId.get(id) ?? []);
  return {
    target: {
      kind: 'students',
      count: withDevice.length,
      devices: tokens.length,
      names: withDevice.slice(0, NAME_CAP).map((id) => idx.studentNameById.get(id) ?? id),
    },
    tokens,
  };
}

/** Zalo target for a class: the group chat if one is linked, else each family privately. */
function parentsTarget(
  classId: string,
  studentIds: string[],
  idx: AudienceIndex,
): { target: PlannedTarget; chatIds: string[] } {
  const groupChat = idx.groupChatByClassId.get(classId);
  if (groupChat) {
    return { target: { kind: 'group-chat', count: 1, names: [] }, chatIds: [groupChat] };
  }
  const chats = [...new Set(studentIds.flatMap((id) => idx.parentChatsByStudentId.get(id) ?? []))];
  const named = studentIds
    .filter((id) => (idx.parentChatsByStudentId.get(id) ?? []).length > 0)
    .slice(0, NAME_CAP)
    .map((id) => idx.studentNameById.get(id) ?? id);
  return { target: { kind: 'parents', count: chats.length, names: named }, chatIds: chats };
}

// ---- The planners ----

type PlanCtx = {
  nowDateIso: string;
  nowMin: number;
  horizonDays: number;
  prefs: NotifPrefs;
  idx: AudienceIndex;
  zaloEnabled: boolean;
  classes: Awaited<ReturnType<typeof classesSvc.list>>;
};

/** Occurrences in the horizon that belong to a class, expanded once. */
async function horizonOccurrences(db: Db, ctx: PlanCtx) {
  // −1 day so an occurrence just after midnight, whose reminder fired yesterday evening, is still
  // seen; +1 past the horizon because `expandEvents` is inclusive and the preview job looks a day
  // ahead of the day it fires on.
  const from = addDaysIso(ctx.nowDateIso, -1);
  const to = addDaysIso(ctx.nowDateIso, ctx.horizonDays + 1);
  const all = await eventsSvc.listRange(db, from, to);
  return expandEvents(all, parseISO(from), parseISO(to))
    .filter((e) => !!e.classId)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || (a.start ?? '99:99').localeCompare(b.start ?? '99:99'),
    );
}

/**
 * The plan, plus where each row would actually go.
 *
 * `recipients` is keyed by ledger key (unique per row — the Zalo variants carry a `zalo-` prefix)
 * and is deliberately NOT part of `NotificationsPlan`: it holds device tokens and chat ids, which
 * have no business in a loader payload. Only `sendPlannedNotification` reads it.
 */
async function buildPlan(
  db: Db,
  env: Env | undefined,
  at: Date,
  horizonDays: number,
): Promise<{ plan: NotificationsPlan; recipients: Map<string, Recipients> }> {
  const { dateIso: nowDateIso, minutes: nowMin } = ictNow(at);
  const zaloEnabled = !!env && zalo.isEnabled(env);

  const [prefs, idx, classes] = await Promise.all([
    getNotifPrefs(db),
    buildAudienceIndex(db),
    classesSvc.list(db),
  ]);
  const ctx: PlanCtx = { nowDateIso, nowMin, horizonDays, prefs, idx, zaloEnabled, classes };
  const recipients = new Map<string, Recipients>();

  const occs = await horizonOccurrences(db, ctx);
  const previews = await previewSvc.composeMany(
    db,
    occs.map((e) => ({ id: e.id, classId: e.classId as string, date: e.date })),
  );

  const nextRuns = {
    class: nextQuarterHour(nowDateIso, nowMin),
    digest: nextDailyRun(nowDateIso, nowMin, DIGEST_MINUTE),
    preview: nextDailyRun(nowDateIso, nowMin, PREVIEW_MINUTE),
    garden: nextDailyRun(nowDateIso, nowMin, DIGEST_MINUTE),
  };

  const planned: PlannedNotification[] = [
    ...classRows(ctx, occs, previews, recipients),
    ...previewRows(ctx, occs, previews, recipients),
    ...(await digestRows(db, ctx, nextRuns.digest, recipients)),
    ...(await gardenRows(db, ctx, nextRuns.garden, recipients)),
  ];

  // Cheapest possible truncation point: after composing (strings are free) but before the one
  // ledger read, so a huge school pays for 200 keys rather than thousands.
  planned.sort((a, b) => a.fireAtIct.localeCompare(b.fireAtIct) || a.key.localeCompare(b.key));
  const truncated = planned.length > OCCURRENCE_CAP;
  const kept = truncated ? planned.slice(0, OCCURRENCE_CAP) : planned;

  const sent = await push.alreadySent(
    db,
    kept.map((p) => p.key),
  );
  for (const row of kept) row.alreadySent = sent.has(row.key);

  return {
    plan: {
      planned: kept,
      prefs,
      channels: {
        zaloEnabled,
        pushTokens: idx.totals.pushTokens,
        pushAccounts: idx.totals.pushAccounts,
        zaloLinks: idx.totals.zaloLinks,
        zaloByKind: { group: idx.totals.group, direct: idx.totals.direct },
      },
      nextRuns,
      generatedAtIct: ictStamp(nowDateIso, nowMin),
      horizonDays,
      truncated,
    },
    recipients,
  };
}

export async function planNotifications(
  db: Db,
  env: Env | undefined,
  at: Date = new Date(),
  horizonDays = 7,
): Promise<NotificationsPlan> {
  return (await buildPlan(db, env, at, horizonDays)).plan;
}

type Occ = Awaited<ReturnType<typeof horizonOccurrences>>[number];
type Previews = Awaited<ReturnType<typeof previewSvc.composeMany>>;

/** Job A rows: one push and one Zalo per occurrence whose reminder tick lands in the horizon. */
function classRows(
  ctx: PlanCtx,
  occs: Occ[],
  previews: Previews,
  rec: Map<string, Recipients>,
): PlannedNotification[] {
  if (!ctx.prefs.classReminders) return [];
  const out: PlannedNotification[] = [];
  const horizonEnd = addDaysIso(ctx.nowDateIso, ctx.horizonDays);

  for (const ev of occs) {
    if (!ev.start) continue;
    const cls = ctx.classes.find((c) => c.id === ev.classId);
    if (!cls) continue;

    const fireMin = firstTickAtOrAfter(toMin(ev.start) - ctx.prefs.classLeadMinutes);
    const fireAtIct = ictStamp(ev.date, fireMin);
    if (fireAtIct.slice(0, 10) < ctx.nowDateIso || fireAtIct.slice(0, 10) > horizonEnd) continue;

    const focus = previews.get(previewSvc.previewKey(ev.id, ev.date))?.focusText.trim();
    const subject = {
      className: cls.name,
      eventTitle: ev.title,
      date: ev.date,
      start: ev.start,
    };
    const { target, tokens } = studentsTarget(cls.studentIds, ctx.idx);
    const composed = classReminderPush(cls, ev, focus);
    const key = ledgerKey.class(ev.id, ev.date);
    rec.set(key, { tokens, chatIds: [] });
    out.push({
      jobKind: 'class',
      channel: 'push',
      key,
      fireAtIct,
      exactFire: true,
      alreadySent: false,
      deliverable: tokens.length > 0,
      target,
      title: composed.title,
      body: composed.body,
      subject,
    });
    if (ctx.zaloEnabled) {
      const parents = parentsTarget(cls.id, cls.studentIds, ctx.idx);
      const zaloKey = ledgerKey.zaloClass(ev.id, ev.date);
      rec.set(zaloKey, { tokens: [], chatIds: parents.chatIds });
      out.push({
        jobKind: 'class',
        channel: 'zalo',
        key: zaloKey,
        fireAtIct,
        exactFire: true,
        alreadySent: false,
        deliverable: parents.chatIds.length > 0,
        target: parents.target,
        body: classReminderZaloText(cls, ev, focus),
        subject,
      });
    }
  }
  return out;
}

/**
 * Job C rows: per-occurrence previews, plus one staff summary per day that has any.
 *
 * Fires at 19:00 the day BEFORE each occurrence, which is why an occurrence tomorrow may already
 * have been sent while one next week has not.
 */
function previewRows(
  ctx: PlanCtx,
  occs: Occ[],
  previews: Previews,
  rec: Map<string, Recipients>,
): PlannedNotification[] {
  if (!ctx.prefs.previewEvening) return [];
  const out: PlannedNotification[] = [];
  const firstTargetDay = addDaysIso(ctx.nowDateIso, ctx.nowMin < PREVIEW_MINUTE ? 1 : 2);
  const lastTargetDay = addDaysIso(ctx.nowDateIso, ctx.horizonDays);
  const byDay = new Map<string, Occ[]>();

  for (const ev of occs) {
    if (ev.date < firstTargetDay || ev.date > lastTargetDay) continue;
    const cls = ctx.classes.find((c) => c.id === ev.classId);
    if (!cls) continue;
    byDay.set(ev.date, [...(byDay.get(ev.date) ?? []), ev]);

    const fireAtIct = ictStamp(addDaysIso(ev.date, -1), PREVIEW_MINUTE);
    const line = previewLine(previews.get(previewSvc.previewKey(ev.id, ev.date)) ?? EMPTY_PREVIEW);
    const subject = { className: cls.name, eventTitle: ev.title, date: ev.date, start: ev.start };
    const { target, tokens } = studentsTarget(cls.studentIds, ctx.idx);
    const composed = previewPush(cls, ev, line);
    const key = ledgerKey.preview(ev.id, ev.date);
    rec.set(key, { tokens, chatIds: [] });
    out.push({
      jobKind: 'preview',
      channel: 'push',
      key,
      fireAtIct,
      exactFire: true,
      alreadySent: false,
      deliverable: tokens.length > 0,
      target,
      title: composed.title,
      body: composed.body,
      subject,
    });
    if (ctx.zaloEnabled) {
      const parents = parentsTarget(cls.id, cls.studentIds, ctx.idx);
      const zaloKey = ledgerKey.zaloPreview(ev.id, ev.date);
      rec.set(zaloKey, { tokens: [], chatIds: parents.chatIds });
      out.push({
        jobKind: 'preview',
        channel: 'zalo',
        key: zaloKey,
        fireAtIct,
        exactFire: true,
        alreadySent: false,
        deliverable: parents.chatIds.length > 0,
        target: parents.target,
        body: previewZaloText(cls, ev, line),
        subject,
      });
    }
  }

  // One staff digest per day with sessions. Same composer the job uses, so the 400/1500 caps and
  // the 60-character per-line trim are whatever notify.ts says they are.
  for (const [date, dayOccs] of byDay) {
    const fireAtIct = ictStamp(addDaysIso(date, -1), PREVIEW_MINUTE);
    const summary = staffDaySummary(dayOccs, ctx.classes, previews);
    const composed = staffPreviewPush(dayOccs.length, summary);
    const subject = { date };
    const key = ledgerKey.previewStaff(date);
    rec.set(key, { tokens: ctx.idx.staffTokens, chatIds: [] });
    out.push({
      jobKind: 'preview-staff',
      channel: 'push',
      key,
      fireAtIct,
      exactFire: true,
      alreadySent: false,
      deliverable: ctx.idx.staffTokens.length > 0,
      target: {
        kind: 'staff',
        count: ctx.idx.staffNames.length,
        devices: ctx.idx.staffTokens.length,
        names: ctx.idx.staffNames.slice(0, NAME_CAP),
      },
      title: composed.title,
      body: composed.body,
      subject,
    });
    if (ctx.zaloEnabled) {
      const zaloKey = ledgerKey.zaloPreviewStaff(date);
      rec.set(zaloKey, { tokens: [], chatIds: ctx.idx.staffChatIds });
      out.push({
        jobKind: 'preview-staff',
        channel: 'zalo',
        key: zaloKey,
        fireAtIct,
        exactFire: true,
        alreadySent: false,
        deliverable: ctx.idx.staffChatIds.length > 0,
        target: {
          kind: 'staff',
          count: ctx.idx.staffChatIds.length,
          names: ctx.idx.staffNames.slice(0, NAME_CAP),
        },
        body: staffPreviewZaloText(dayOccs.length, summary),
        subject,
      });
    }
  }
  return out;
}

/**
 * Job B rows. State-driven: only the next 08:00 is knowable, and the answer is re-derived then.
 *
 * The 7-day inactivity cutoff is measured from that next run, not from now — otherwise a student
 * who last played 6 days ago would be missing from a forecast of a run that will include them.
 */
async function digestRows(
  db: Db,
  ctx: PlanCtx,
  nextRunIct: string,
  rec: Map<string, Recipients>,
): Promise<PlannedNotification[]> {
  if (!ctx.prefs.studyNudges) return [];
  const runAt = ictStampToUtc(nextRunIct);
  const runDateIso = nextRunIct.slice(0, 10);
  const cutoff = new Date(runAt.getTime() - 7 * 86_400_000).toISOString();

  const recent = await db
    .select({ studentId: flashcardResults.studentId })
    .from(flashcardResults)
    .where(and(isNotNull(flashcardResults.studentId), gte(flashcardResults.playedAt, cutoff)));
  const active = new Set(recent.map((r) => r.studentId));

  const bucket = studyBucket(runDateIso);
  const composed = studyNudgePush();
  const out: PlannedNotification[] = [];
  for (const [studentId, name] of ctx.idx.studentNameById) {
    if (active.has(studentId)) continue;
    const tokens = ctx.idx.tokensByStudentId.get(studentId) ?? [];
    const key = ledgerKey.study(studentId, bucket);
    rec.set(key, { tokens, chatIds: [] });
    out.push({
      jobKind: 'digest',
      channel: 'push',
      key,
      fireAtIct: nextRunIct,
      exactFire: false,
      alreadySent: false,
      deliverable: tokens.length > 0,
      target: {
        kind: 'student',
        count: tokens.length > 0 ? 1 : 0,
        devices: tokens.length,
        names: [name],
      },
      title: composed.title,
      body: composed.body,
      subject: { studentName: name, date: runDateIso },
    });
  }
  return out;
}

/**
 * Job D rows, via the write-free `forecastGardenSweep`.
 *
 * Evaluated at the next 08:00 instant rather than now, so "wilting today" and "dropping tomorrow"
 * mean what they will mean when the cron fires. Push only — the garden job takes no `env` and so
 * has never had a Zalo channel.
 */
async function gardenRows(
  db: Db,
  ctx: PlanCtx,
  nextRunIct: string,
  rec: Map<string, Recipients>,
): Promise<PlannedNotification[]> {
  if (!ctx.prefs.gardenAlerts) return [];
  const runDateIso = nextRunIct.slice(0, 10);
  const sweep = await gardenSvc.forecastGardenSweep(db, ictStampToUtc(nextRunIct).toISOString());
  const alerts = gardenAlertsFrom(sweep, runDateIso);

  return alerts.map((a) => {
    const tokens = ctx.idx.tokensByStudentId.get(a.studentId) ?? [];
    const name = ctx.idx.studentNameById.get(a.studentId) ?? a.studentId;
    const composed = gardenAlertPush(a.body);
    rec.set(a.key, { tokens, chatIds: [] });
    return {
      jobKind: a.key.startsWith('garden-penalty:')
        ? ('garden-penalty' as const)
        : a.key.startsWith('garden-wilt:')
          ? ('garden-wilt' as const)
          : ('garden-drop' as const),
      channel: 'push' as const,
      key: a.key,
      fireAtIct: nextRunIct,
      exactFire: false,
      alreadySent: false,
      deliverable: tokens.length > 0,
      target: {
        kind: 'student' as const,
        count: tokens.length > 0 ? 1 : 0,
        devices: tokens.length,
        names: [name],
      },
      title: composed.title,
      body: composed.body,
      subject: { studentName: name, date: runDateIso },
    };
  });
}

// ---- Sending one planned row ----

/**
 * A garden penalty announces something the SWEEP does, not something the plant already shows.
 *
 * Every other alert in the system reports state a reader could derive for themselves — a wilting
 * plant is wilting whether or not anyone was told. `garden-penalty` is the exception: the stage is
 * only actually lost when `runGardenSweep` writes the transition, so sending that message on its own
 * would tell a child their plant dropped a stage while their own screen still shows it intact.
 * Sending it individually is therefore refused; the job button beside it sweeps first, then sends.
 */
const NOT_INDIVIDUALLY_SENDABLE: ReadonlySet<JobKind> = new Set(['garden-penalty']);

export type SendOneResult =
  | { ok: true; key: string; channel: Channel; sent: number }
  | { ok: false; reason: 'not_found' | 'already_sent' | 'no_recipients' | 'not_sendable' };

/**
 * Send exactly one planned notification now, and mark its key.
 *
 * The caller passes a KEY, never a body. Everything sent is re-derived here from the same planner
 * the screen rendered, which is what makes this safe to expose: a browser cannot dictate the text of
 * a message to the school's families, and what goes out is by construction what the admin was
 * looking at rather than what their tab was showing ten minutes ago.
 *
 * The key is marked sent exactly as the cron would mark it, so the scheduled run will skip this row.
 * That is the intended meaning of the button — "send this one now instead of later" — and it is why
 * the UI confirms before firing a row whose time has not come.
 */
export async function sendPlannedNotification(
  db: Db,
  env: Env | undefined,
  key: string,
  at: Date = new Date(),
): Promise<SendOneResult> {
  const { plan, recipients } = await buildPlan(db, env, at, 7);
  const row = plan.planned.find((p) => p.key === key);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.alreadySent) return { ok: false, reason: 'already_sent' };
  if (NOT_INDIVIDUALLY_SENDABLE.has(row.jobKind)) return { ok: false, reason: 'not_sendable' };

  const to = recipients.get(key) ?? { tokens: [], chatIds: [] };
  let sent = 0;
  if (row.channel === 'push') {
    if (!to.tokens.length) return { ok: false, reason: 'no_recipients' };
    const { dead } = await push.sendPush(
      to.tokens.map((token) => ({
        to: token,
        title: row.title ?? '',
        body: row.body,
        // The planner does not carry `data`/`channelId` on the row, so they are recomposed from the
        // same composers the cron uses — see pushEnvelopeFor.
        ...pushEnvelopeFor(row),
      })),
    );
    if (dead.length) await push.pruneTokens(db, dead);
    sent = to.tokens.length - dead.length;
  } else {
    if (!env || !zalo.isEnabled(env)) return { ok: false, reason: 'no_recipients' };
    if (!to.chatIds.length) return { ok: false, reason: 'no_recipients' };
    sent = await zalo.broadcastText(env, to.chatIds, row.body);
  }

  await push.markSent(db, [key]);
  return { ok: true, key, channel: row.channel, sent };
}

/**
 * The deep link and Android channel for a row, from the same composers the cron uses.
 *
 * Only `data` and `channelId` are taken: the title and body come off the planned row itself, which
 * is what the admin saw. Recomposing those here would risk the two disagreeing.
 */
function pushEnvelopeFor(row: PlannedNotification): Pick<PushBody, 'data' | 'channelId'> {
  switch (row.jobKind) {
    case 'class': {
      const { data, channelId } = classReminderPush({ name: '' }, blankOcc(row), undefined);
      return { data, channelId };
    }
    case 'preview': {
      const { data, channelId } = previewPush({ name: '' }, blankOcc(row), '');
      return { data, channelId };
    }
    case 'preview-staff': {
      const { data, channelId } = staffPreviewPush(0, '');
      return { data, channelId };
    }
    case 'digest': {
      const { data, channelId } = studyNudgePush();
      return { data, channelId };
    }
    default: {
      const { data, channelId } = gardenAlertPush('');
      return { data, channelId };
    }
  }
}

/**
 * The composers read `id` off an occurrence to build the deep link, and nothing else that matters
 * for the envelope. The class reminder's `/event/:id` is the only id-bearing link, and the planned
 * row's key ends in the event id it was built from.
 */
function blankOcc(row: PlannedNotification): { id: string; title: string; date: string } {
  const parts = parseLedgerKey(row.key);
  const id = 'eventId' in parts ? parts.eventId : '';
  return { id, title: row.subject.eventTitle ?? '', date: row.subject.date };
}

// ---- The ledger, read backwards ----

export type ParsedLedgerKey =
  | { job: 'class' | 'preview'; channel: Channel; eventId: string; date: string }
  | { job: 'preview-staff'; channel: Channel; date: string }
  | { job: 'digest'; channel: 'push'; studentId: string; bucket: string }
  | { job: 'garden-penalty'; channel: 'push'; assignmentId: string; studentId: string }
  | { job: 'garden-wilt' | 'garden-drop'; channel: 'push'; studentId: string; date: string }
  | { job: 'unknown' };

/**
 * Read a `sent_notifications` key back into its parts.
 *
 * Splitting on `:` is safe: the only variable parts are UUIDs, ISO dates and half-month buckets,
 * none of which contain a colon. Unknown prefixes resolve to `{ job: 'unknown' }` rather than
 * throwing — the ledger outlives the jobs that wrote it, and `migrations/0018_drop_homework.sql`
 * is the precedent for a retired prefix.
 */
export function parseLedgerKey(key: string): ParsedLedgerKey {
  const zaloPrefixed = key.startsWith('zalo-');
  const channel: Channel = zaloPrefixed ? 'zalo' : 'push';
  const bare = zaloPrefixed ? key.slice('zalo-'.length) : key;
  const parts = bare.split(':');

  if (parts[0] === 'class' && parts.length === 3) {
    return { job: 'class', channel, eventId: parts[1], date: parts[2] };
  }
  if (parts[0] === 'preview' && parts.length === 3) {
    return { job: 'preview', channel, eventId: parts[1], date: parts[2] };
  }
  if (parts[0] === 'preview-staff' && parts.length === 2) {
    return { job: 'preview-staff', channel, date: parts[1] };
  }
  // The three below are push-only jobs, so a `zalo-` prefixed variant is not a thing that exists.
  if (!zaloPrefixed && parts[0] === 'study' && parts.length === 3) {
    return { job: 'digest', channel: 'push', studentId: parts[1], bucket: parts[2] };
  }
  if (!zaloPrefixed && parts[0] === 'garden-penalty' && parts.length === 3) {
    return { job: 'garden-penalty', channel: 'push', assignmentId: parts[1], studentId: parts[2] };
  }
  if (!zaloPrefixed && parts[0] === 'garden-wilt' && parts.length === 3) {
    return { job: 'garden-wilt', channel: 'push', studentId: parts[1], date: parts[2] };
  }
  if (!zaloPrefixed && parts[0] === 'garden-drop' && parts.length === 3) {
    return { job: 'garden-drop', channel: 'push', studentId: parts[1], date: parts[2] };
  }
  return { job: 'unknown' };
}

/** One row of the "recently sent" panel: the raw ledger entry plus whatever it could be joined to. */
export type SentEntry = {
  key: string;
  sentAt: string;
  job: ParsedLedgerKey['job'];
  channel: Channel | null;
  /** Human label — class + event, student name, or the date for a staff digest. */
  label: string;
  date: string | null;
};

/**
 * The ledger tail, enriched for display.
 *
 * Everything is joined in bulk from ids actually present in the window, so an empty ledger costs
 * nothing. A subject that has since been deleted keeps its row and gets a null label — the log is
 * a record of what happened, and hiding rows whose event was deleted would make it a worse one.
 */
export async function listSentLog(db: Db, limit = 100): Promise<SentEntry[]> {
  const rows = await push.listRecentSent(db, limit);
  if (!rows.length) return [];

  const parsed = rows.map((r) => ({ ...r, parts: parseLedgerKey(r.key) }));
  const eventIds = new Set<string>();
  const studentIds = new Set<string>();
  const assignmentIds = new Set<string>();
  for (const p of parsed) {
    if ('eventId' in p.parts) eventIds.add(p.parts.eventId);
    if ('studentId' in p.parts) studentIds.add(p.parts.studentId);
    if ('assignmentId' in p.parts) assignmentIds.add(p.parts.assignmentId);
  }

  const [eventRows, classRows, studentRows, assignmentRows] = await Promise.all([
    eventIds.size ? eventsSvc.list(db) : Promise.resolve([]),
    eventIds.size ? classesSvc.listLite(db) : Promise.resolve([]),
    studentIds.size
      ? db
          .select({ id: students.id, name: students.name })
          .from(students)
          .where(inArray(students.id, [...studentIds]))
      : Promise.resolve([]),
    assignmentIds.size
      ? db
          .select({ id: vocabAssignments.id, topicName: flashcardTopics.name })
          .from(vocabAssignments)
          .innerJoin(flashcardTopics, eq(flashcardTopics.id, vocabAssignments.topicId))
          .where(inArray(vocabAssignments.id, [...assignmentIds]))
      : Promise.resolve([]),
  ]);
  const eventById = new Map(eventRows.map((e) => [e.id, e]));
  const classById = new Map(classRows.map((c) => [c.id, c.name]));
  const studentById = new Map(studentRows.map((s) => [s.id, s.name]));
  const assignmentById = new Map(assignmentRows.map((a) => [a.id, a.topicName]));

  return parsed.map(({ key, sentAt, parts }) => {
    if (parts.job === 'unknown') {
      return { key, sentAt, job: parts.job, channel: null, label: '', date: null };
    }
    if (parts.job === 'class' || parts.job === 'preview') {
      const ev = eventById.get(parts.eventId);
      const cls = ev?.classId ? classById.get(ev.classId) : undefined;
      return {
        key,
        sentAt,
        job: parts.job,
        channel: parts.channel,
        label: ev ? [cls, ev.title].filter(Boolean).join(' · ') : '',
        date: parts.date,
      };
    }
    if (parts.job === 'preview-staff') {
      return { key, sentAt, job: parts.job, channel: parts.channel, label: '', date: parts.date };
    }
    if (parts.job === 'garden-penalty') {
      const who = studentById.get(parts.studentId) ?? '';
      const topic = assignmentById.get(parts.assignmentId);
      return {
        key,
        sentAt,
        job: parts.job,
        channel: 'push',
        label: [who, topic].filter(Boolean).join(' · '),
        date: null,
      };
    }
    if (parts.job === 'digest') {
      return {
        key,
        sentAt,
        job: parts.job,
        channel: 'push',
        label: studentById.get(parts.studentId) ?? '',
        date: null,
      };
    }
    if (parts.job === 'garden-wilt' || parts.job === 'garden-drop') {
      return {
        key,
        sentAt,
        job: parts.job,
        channel: 'push',
        label: studentById.get(parts.studentId) ?? '',
        date: parts.date,
      };
    }
    return { key, sentAt, job: 'unknown', channel: null, label: '', date: null };
  });
}
