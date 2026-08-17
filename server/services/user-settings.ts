import { and, eq } from 'drizzle-orm';
import { settings, userSettings } from '../db/schema';
import type { TenantDb } from '../db/index';

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
  db: TenantDb,
  key: string,
  defaults: T,
): Promise<T> {
  const rows = await db.raw
    .select({ value: settings.value })
    .from(settings)
    .where(db.own(settings, eq(settings.key, key)));
  return merge(defaults, rows[0]?.value) ?? { ...defaults };
}

export async function readJson<T extends object>(
  db: TenantDb,
  accountId: string,
  key: string,
  defaults: T,
): Promise<T> {
  // tenant-unscoped: reached only via the scoped account (`accounts` is auth-owned and carries
  // the school; a `user_settings` row is keyed on one account id and no other school can name it).
  const mine = await db.raw
    .select({ value: userSettings.value })
    .from(userSettings)
    .where(and(eq(userSettings.accountId, accountId), eq(userSettings.key, key)));
  const own = merge(defaults, mine[0]?.value);
  if (own) return own;
  return readSchoolJson(db, key, defaults);
}

export async function writeJson<T extends object>(
  db: TenantDb,
  accountId: string,
  key: string,
  value: T,
): Promise<void> {
  const json = JSON.stringify(value);
  // tenant-unscoped: reached only via the scoped account (see readJson).
  await db.raw
    .insert(userSettings)
    .values({ accountId, key, value: json })
    .onConflictDoUpdate({
      target: [userSettings.accountId, userSettings.key],
      set: { value: json },
    });
}

export async function writeSchoolJson<T extends object>(
  db: TenantDb,
  key: string,
  value: T,
): Promise<void> {
  const json = JSON.stringify(value);
  await db
    .insert(settings)
    .values({ key, value: json })
    // The primary key is (tenant_id, key) since multi-tenancy, so BOTH columns are the conflict
    // target — targeting `key` alone would make one school's write clobber another's row.
    .onConflictDoUpdate({ target: [settings.tenantId, settings.key], set: { value: json } });
}

/**
 * Drop an account's override, so reads fall back to the school row again.
 *
 * Deliberately a delete rather than a write of the current school values: copying them would
 * freeze "follow the school" at whatever the school looked like that day.
 */
export async function deleteJson(db: TenantDb, accountId: string, key: string): Promise<void> {
  // tenant-unscoped: reached only via the scoped account (see readJson).
  await db.raw
    .delete(userSettings)
    .where(and(eq(userSettings.accountId, accountId), eq(userSettings.key, key)));
}

/**
 * Every account's value for one key, in a single query.
 *
 * For the notification cron, which needs each recipient's preferences and must not issue one
 * SELECT per account. Accounts with no row of their own are simply absent from the map — the
 * caller pairs it with `readSchoolJson` for those.
 */
export async function readJsonForAll<T extends object>(
  db: TenantDb,
  key: string,
  defaults: T,
): Promise<Map<string, T>> {
  // tenant-unscoped: `user_settings` carries no school, so this returns every account's row and
  // the caller narrows by the account ids it already resolved inside its own school.
  const rows = await db.raw
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
