import type { TenantDb } from '../db/index';
import type { NotifPrefsInput } from '../../shared/schemas';
import { record } from './audit';
import {
  readJson,
  readJsonForAll,
  readSchoolJson,
  writeJson,
  writeSchoolJson,
} from './user-settings';

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Notification preferences — per account since migration 0043, with the school-wide `settings`
 * row surviving as the default for anyone who has never chosen.
 *
 * The split between what is personal and what is not is not arbitrary. The four booleans are
 * "do I want to receive this?", so the cron applies them per recipient (see notify-plan.ts).
 * `classLeadMinutes` is not a preference in the same sense — it decides WHEN a sweep fires, and
 * the ledger keys that make the cron idempotent (`class:<eventId>:<date>`, notify.ts) carry no
 * recipient, so a per-person lead would mean a per-person ledger. It is read through
 * `getSchoolNotifPrefs` and stays school-wide.
 *
 * The Zalo audience — parents and class group chats — are not accounts at all, so they keep the
 * school-wide values for the same structural reason.
 */

export type NotifPrefs = NotifPrefsInput;

export const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  classReminders: true,
  /** Minutes before a class starts. The cron sweeps every 15, so anything under 15 is fiction. */
  classLeadMinutes: 30,
  studyNudges: false,
  previewEvening: true,
  gardenAlerts: true,
};

export const NOTIF_PREFS_KEY = 'notif-prefs';

export async function getNotifPrefs(db: TenantDb, accountId: string): Promise<NotifPrefs> {
  return readJson(db, accountId, NOTIF_PREFS_KEY, DEFAULT_NOTIF_PREFS);
}

export async function setNotifPrefs(
  db: TenantDb,
  accountId: string,
  patch: Partial<NotifPrefs>,
): Promise<NotifPrefs> {
  const current = await getNotifPrefs(db, accountId);
  const next = { ...current, ...patch };
  await writeJson(db, accountId, NOTIF_PREFS_KEY, next);
  if (!sameJson(current, next)) {
    record({
      action: 'update',
      entityType: 'setting',
      entityId: NOTIF_PREFS_KEY,
      before: current,
      after: next,
    });
  }
  return next;
}

/** The school-wide baseline: what a recipient with no preferences of their own gets. */
export async function getSchoolNotifPrefs(db: TenantDb): Promise<NotifPrefs> {
  return readSchoolJson(db, NOTIF_PREFS_KEY, DEFAULT_NOTIF_PREFS);
}

export async function setSchoolNotifPrefs(
  db: TenantDb,
  patch: Partial<NotifPrefs>,
): Promise<NotifPrefs> {
  const current = await getSchoolNotifPrefs(db);
  const next = { ...current, ...patch };
  await writeSchoolJson(db, NOTIF_PREFS_KEY, next);
  if (!sameJson(current, next)) {
    record({
      action: 'update',
      entityType: 'setting',
      entityId: NOTIF_PREFS_KEY,
      before: current,
      after: next,
    });
  }
  return next;
}

/**
 * Everything the cron needs, in two queries: the school baseline, and every account that has
 * overridden it. Never one SELECT per recipient — a sweep touches the whole school.
 */
export async function getNotifPrefsByAccount(db: TenantDb): Promise<ResolvedNotifPrefs> {
  const [school, byAccount] = await Promise.all([
    getSchoolNotifPrefs(db),
    readJsonForAll(db, NOTIF_PREFS_KEY, DEFAULT_NOTIF_PREFS),
  ]);
  return { school, byAccount };
}

export type ResolvedNotifPrefs = { school: NotifPrefs; byAccount: Map<string, NotifPrefs> };

/**
 * The four switches that are genuinely personal.
 *
 * `classLeadMinutes` is deliberately not one of them: it decides when a sweep FIRES, and the
 * ledger keys carry no recipient, so a per-person lead would mean a per-person ledger.
 */
export type NotifSwitch = 'classReminders' | 'studyNudges' | 'previewEvening' | 'gardenAlerts';

/** Does this account still want `sw`? An account that never chose follows the school. */
export function wantsNotif(
  prefs: ResolvedNotifPrefs,
  accountId: string | undefined,
  sw: NotifSwitch,
): boolean {
  if (!accountId) return prefs.school[sw];
  return (prefs.byAccount.get(accountId) ?? prefs.school)[sw];
}

/**
 * Narrow a list of account ids to those still wanting `sw`.
 *
 * Both the sender (notify.ts) and the forecast (notify-plan.ts) go through this, so the row the
 * /logs/notifications page shows and the message the cron actually delivers cannot disagree
 * about who is on the list.
 */
export function accountsWanting(
  prefs: ResolvedNotifPrefs,
  accountIds: string[],
  sw: NotifSwitch,
): string[] {
  return accountIds.filter((id) => wantsNotif(prefs, id, sw));
}
