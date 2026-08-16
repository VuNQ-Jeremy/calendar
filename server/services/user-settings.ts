import { and, eq } from 'drizzle-orm';
import { settings, userSettings } from '../db/schema';
import type { Db } from '../db/index';

/**
 * Per-account preferences, one JSON blob per (account, key).
 *
 * The per-user twin of the school-wide `settings` table, and the only place that knows the
 * fallback chain: the account's own row, then the `settings` row of the same key, then the
 * caller's defaults. That middle step is deliberate — it is what let per-user preferences ship
 * without migrating any data, and it keeps the existing global row meaningful as the school
 * default for anyone who has never chosen.
 *
 * Blobs are always merged shallowly over `defaults`, so adding a field to a preference type
 * needs no migration of what is already stored.
 */

function merge<T extends object>(defaults: T, raw: string | undefined): T | null {
  if (raw === undefined) return null;
  try {
    return { ...defaults, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    // A corrupt blob is not worth failing a page load over — fall through to the next step of
    // the chain, which is what the three services this replaced already did.
    return null;
  }
}

/** The school-wide value: the legacy `settings` row, merged over defaults. */
export async function readSchoolJson<T extends object>(
  db: Db,
  key: string,
  defaults: T,
): Promise<T> {
  const rows = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key));
  return merge(defaults, rows[0]?.value) ?? { ...defaults };
}

export async function readJson<T extends object>(
  db: Db,
  accountId: string,
  key: string,
  defaults: T,
): Promise<T> {
  const mine = await db
    .select({ value: userSettings.value })
    .from(userSettings)
    .where(and(eq(userSettings.accountId, accountId), eq(userSettings.key, key)));
  const own = merge(defaults, mine[0]?.value);
  if (own) return own;
  return readSchoolJson(db, key, defaults);
}

export async function writeJson<T extends object>(
  db: Db,
  accountId: string,
  key: string,
  value: T,
): Promise<void> {
  const json = JSON.stringify(value);
  await db
    .insert(userSettings)
    .values({ accountId, key, value: json })
    .onConflictDoUpdate({
      target: [userSettings.accountId, userSettings.key],
      set: { value: json },
    });
}

export async function writeSchoolJson<T extends object>(
  db: Db,
  key: string,
  value: T,
): Promise<void> {
  const json = JSON.stringify(value);
  await db
    .insert(settings)
    .values({ key, value: json })
    .onConflictDoUpdate({ target: settings.key, set: { value: json } });
}

/**
 * Every account's value for one key, in a single query.
 *
 * For the notification cron, which needs each recipient's preferences and must not issue one
 * SELECT per account. Accounts with no row of their own are simply absent from the map — the
 * caller pairs it with `readSchoolJson` for those.
 */
export async function readJsonForAll<T extends object>(
  db: Db,
  key: string,
  defaults: T,
): Promise<Map<string, T>> {
  const rows = await db
    .select({ accountId: userSettings.accountId, value: userSettings.value })
    .from(userSettings)
    .where(eq(userSettings.key, key));
  const out = new Map<string, T>();
  for (const r of rows) {
    const v = merge(defaults, r.value);
    if (v) out.set(r.accountId, v);
  }
  return out;
}
