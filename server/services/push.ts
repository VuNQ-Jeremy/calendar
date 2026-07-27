import { eq, inArray } from 'drizzle-orm';
import { pushTokens } from '../db/schema';
import type { Db } from '../db/index';

/**
 * Expo push token registry.
 *
 * Sending happens in phase 6 (a Cron Trigger in workers/app.ts POSTing to
 * https://exp.host/--/api/v2/push/send). This module is just the registry, so phase 2 has
 * somewhere to register a device on login.
 *
 * Note: Expo's push service is called DIRECTLY from the Worker — unlike Anthropic, it has no
 * Cloudflare-egress restriction, so it must not go through TRANSLATE_DO.
 */

export type PushTokenRow = {
  id: string;
  accountId: string;
  expoToken: string;
  platform: string;
};

/**
 * Register (or re-register) a device.
 *
 * Upserts on expo_token, so re-installing the app or signing in as a different user on the
 * same handset MOVES the token to the new account instead of leaving a stale duplicate that
 * would push another user's notifications to this device.
 */
export async function registerToken(
  db: Db,
  accountId: string,
  expoToken: string,
  platform: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(pushTokens)
    .values({ id: crypto.randomUUID(), accountId, expoToken, platform, createdAt: now, lastSeenAt: now })
    .onConflictDoUpdate({
      target: pushTokens.expoToken,
      set: { accountId, platform, lastSeenAt: now },
    });
}

export async function unregisterToken(db: Db, expoToken: string): Promise<void> {
  await db.delete(pushTokens).where(eq(pushTokens.expoToken, expoToken));
}

/** Every device belonging to the given accounts. Used by the phase-6 cron jobs. */
export async function tokensForAccounts(db: Db, accountIds: string[]): Promise<string[]> {
  if (!accountIds.length) return [];
  const rows = await db
    .select({ expoToken: pushTokens.expoToken })
    .from(pushTokens)
    .where(inArray(pushTokens.accountId, accountIds));
  return rows.map((r) => r.expoToken);
}

/**
 * Drop tokens Expo reported as DeviceNotRegistered. Called after a send; without it the
 * table fills with dead tokens from uninstalled apps and every send gets slower.
 */
export async function pruneTokens(db: Db, expoTokens: string[]): Promise<void> {
  if (!expoTokens.length) return;
  await db.delete(pushTokens).where(inArray(pushTokens.expoToken, expoTokens));
}
