import { eq } from 'drizzle-orm';
import { settings } from '../db/schema';
import type { Db } from '../db/index';
import type { NotifPrefsInput } from '../../shared/schemas';

/**
 * Notification preferences, in the same `settings` k/v table that holds the calendar theme and
 * the UI prefs — and, like those, school-wide rather than per-user.
 *
 * That is a real limitation and it is deliberate for now: `settings` is keyed by a single string
 * and the app has one school in it. Per-user preferences need a `user_settings` table keyed on
 * account id, which is a migration and a service, not a screen. Written down here so the next
 * person changing this knows it is a known boundary rather than an oversight.
 */

export type NotifPrefs = NotifPrefsInput;

export const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  classReminders: true,
  /** Minutes before a class starts. The cron sweeps every 15, so anything under 15 is fiction. */
  classLeadMinutes: 30,
  homeworkReminders: true,
  studyNudges: false,
};

const KEY = 'notif-prefs';

export async function getNotifPrefs(db: Db): Promise<NotifPrefs> {
  const rows = await db.select().from(settings).where(eq(settings.key, KEY));
  const row = rows[0];
  if (!row) return { ...DEFAULT_NOTIF_PREFS };
  try {
    return { ...DEFAULT_NOTIF_PREFS, ...(JSON.parse(row.value) as Partial<NotifPrefs>) };
  } catch {
    return { ...DEFAULT_NOTIF_PREFS };
  }
}

export async function setNotifPrefs(db: Db, patch: Partial<NotifPrefs>): Promise<NotifPrefs> {
  const next = { ...(await getNotifPrefs(db)), ...patch };
  await db
    .insert(settings)
    .values({ key: KEY, value: JSON.stringify(next) })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(next) } });
  return next;
}
