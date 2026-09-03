/**
 * Practice crons.
 *
 * 20:00 ICT — remind students who still have open copies today (channel 'reminders', pref
 * `practiceReminders`). 00:00 ICT — finalize YESTERDAY (the ICT day that just ended): record
 * misses via practiceSvc.finalizeDay, push the penalty alert, Zalo-text paired parents.
 * Both are idempotent through the sent_notifications ledger and finalizeDay's own UNIQUE guard.
 *
 * The copy is Vietnamese, read straight off the shared string table rather than duplicated here,
 * for the same reason notify.ts keeps its composers in one section: a message the /logs forecast
 * and the sender word differently is a message nobody can verify.
 */
import { PRIMARY_TENANT_ID, type TenantDb } from '../db/index';
import { addDaysIso, deliver, ictNow, ledgerKey } from './notify';
import * as push from './push';
import type { ExpoPushMessage } from './push';
import * as zalo from './zalo';
import * as practiceSvc from './practice';
import * as peopleSvc from './people';
import { accountsWanting, getNotifPrefsByAccount } from './notif-prefs';
import { STRINGS } from '../../shared/i18n/strings';

/** Vietnamese copy for pushes/Zalo — the school's language; the phone shows pushes as sent. */
const vi = STRINGS.vi as unknown as Record<string, string>;

const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

/** 'YYYY-MM-DD' → 'DD/MM', the form every Vietnamese message in this app uses. */
const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

/**
 * 20:00 ICT: "you still have practice open tonight".
 *
 * Keyed per (student, day) rather than per task — a student with four unfinished tasks gets one
 * nudge, and a second sweep on the same evening sends nothing.
 */
export async function runPracticeReminders(
  db: TenantDb,
  at: Date = new Date(),
  _env?: Env,
): Promise<number> {
  const { dateIso: today } = ictNow(at);
  const [settings, perAccount] = await Promise.all([
    practiceSvc.listSettings(db),
    getNotifPrefsByAccount(db),
  ]);
  const messages: ExpoPushMessage[] = [];
  const doneKeys: string[] = [];

  for (const s of settings.filter((x) => x.enabled)) {
    const days = await practiceSvc.practiceDays(db, s.classId, today, today);
    if (!days.length) continue;
    const copies = await practiceSvc.listStudentTasks(db, s.classId, today, today);
    const openByStudent = new Map<string, number>();
    for (const c of copies) {
      if (c.status === 'open' || c.status === 'rejected') {
        openByStudent.set(c.studentId, (openByStudent.get(c.studentId) ?? 0) + 1);
      }
    }
    if (!openByStudent.size) continue;
    const already = await push.alreadySent(
      db,
      [...openByStudent.keys()].map((sid) => ledgerKey.practiceRemind(sid, today)),
    );
    for (const [studentId, n] of openByStudent) {
      const key = ledgerKey.practiceRemind(studentId, today);
      if (already.has(key)) continue;
      // Marked done even when nobody has a device: the evening HAS been processed.
      doneKeys.push(key);
      const accountIds = accountsWanting(
        perAccount,
        await push.accountIdsForStudents(db, [studentId]),
        'practiceReminders',
      );
      const body = {
        title: vi.push_pr_remind_title,
        body: fill(vi.push_pr_remind_body, { n }),
        data: { url: '/practice', kind: 'practice' },
        channelId: 'reminders' as const,
      };
      for (const to of await push.tokensForAccounts(db, accountIds)) messages.push({ to, ...body });
    }
  }

  await deliver(db, messages);
  await push.markSent(db, doneKeys);
  return messages.length;
}

/**
 * 00:00 ICT: close yesterday.
 *
 * `finalizeDay` is the thing that decides a miss; this runner only turns what it reports into a
 * push and a parent message. Yesterday and not today, because a practice day's deadline is the
 * end of that day — at 00:05 ICT the day that just ended is the one that can be judged.
 */
export async function runPracticeFinalize(
  db: TenantDb,
  at: Date = new Date(),
  env?: Env,
): Promise<number> {
  const { dateIso: today } = ictNow(at);
  const yesterday = addDaysIso(today, -1);
  const [settings, perAccount, studentsList] = await Promise.all([
    practiceSvc.listSettings(db),
    getNotifPrefsByAccount(db),
    peopleSvc.listStudents(db),
  ]);
  const nameOf = (id: string) => studentsList.find((s) => s.id === id)?.name ?? id;
  const messages: ExpoPushMessage[] = [];
  const doneKeys: string[] = [];
  let sent = 0;

  for (const s of settings.filter((x) => x.enabled)) {
    const outcomes = await practiceSvc.finalizeDay(db, s.classId, yesterday);
    for (const o of outcomes) {
      const key = ledgerKey.practiceMiss(o.studentId, o.classId, o.date);
      const already = await push.alreadySent(db, [key]);
      if (already.has(key)) continue;
      doneKeys.push(key);

      if (!o.excused && o.nextDay) {
        const accountIds = accountsWanting(
          perAccount,
          await push.accountIdsForStudents(db, [o.studentId]),
          'practiceReminders',
        );
        const body = {
          title: vi.push_pr_penalty_title,
          body: fill(vi.push_pr_penalty_body, { date: dm(o.nextDay), n: o.multiplier }),
          data: { url: '/practice', kind: 'practice' },
          channelId: 'reminders' as const,
        };
        for (const to of await push.tokensForAccounts(db, accountIds)) {
          messages.push({ to, ...body });
        }
      }

      // Parents by Zalo — one bot token, primary tenant only (the same rule zaloDeliver applies
      // in notify.ts). Never allowed to throw: a Zalo outage must not lose the misses above.
      if (env && zalo.isEnabled(env) && db.tenantId === PRIMARY_TENANT_ID) {
        try {
          const summary = await practiceSvc.studentMonthSummary(
            db,
            o.classId,
            o.studentId,
            o.date.slice(0, 7),
          );
          const kind = o.excused
            ? vi.zalo_pr_kind_excused
            : fill(vi.zalo_pr_kind_unexcused, { n: o.multiplier });
          const text = fill(vi.zalo_pr_miss, {
            student: nameOf(o.studentId),
            date: dm(o.date),
            kind,
            used: summary.excusedUsed,
            quota: summary.excusedQuota,
          });
          const chats = await zalo.chatsForParentsOfStudents(db, [o.studentId]);
          if (chats.length) sent += await zalo.broadcastText(env, chats, text);
        } catch (err) {
          console.error('[practice] zalo pass failed', { err: String(err) });
        }
      }
    }
  }

  await deliver(db, messages);
  await push.markSent(db, doneKeys);
  return messages.length + sent;
}
