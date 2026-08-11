import { desc, eq, inArray, lt } from 'drizzle-orm';
import { accounts, pushTokens, sentNotifications } from '../db/schema';
import type { Db } from '../db/index';

/**
 * Expo push: the device registry, the sender, and the "already sent" ledger.
 *
 * Sending is a plain HTTPS POST to https://exp.host/--/api/v2/push/send — no SDK, no
 * credentials. It is called DIRECTLY from the Worker: unlike Anthropic, Expo has no problem with
 * Cloudflare's Hong Kong egress, so it must NOT go through TRANSLATE_DO.
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
    .values({
      id: crypto.randomUUID(),
      accountId,
      expoToken,
      platform,
      createdAt: now,
      lastSeenAt: now,
    })
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

/** Account ids for a set of student records. A student with no account has no device. */
export async function accountIdsForStudents(db: Db, studentIds: string[]): Promise<string[]> {
  if (!studentIds.length) return [];
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(inArray(accounts.studentId, studentIds));
  return rows.map((r) => r.id);
}

/**
 * Account ids for a set of staff records.
 *
 * Its one caller is `runEveningPreview`, which sends EVERY staff member the same summary of
 * tomorrow's teaching. That is not a shortcut around per-class targeting so much as the absence of
 * it: no table links a staff member to a class — `classes` has no teacher column and there is no
 * `class_staff` join — and with one or two teachers in the school there is nothing to narrow.
 * `runClassReminders` still reaches students only, for the same missing relation. When it lands,
 * both callers become a filter on this list. See docs/mobile-parity.md, "Knowingly not built".
 */
export async function accountIdsForStaff(db: Db, staffIds: string[]): Promise<string[]> {
  if (!staffIds.length) return [];
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(inArray(accounts.staffId, staffIds));
  return rows.map((r) => r.id);
}

// ---- Sending ----

/** The Android channels. Each can be muted independently in system settings. */
export type PushChannel = 'reminders' | 'study';

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  /** Consumed by the app's notification-tap handler to deep-link. Keep it small. */
  data?: Record<string, string>;
  channelId: PushChannel;
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** Expo's documented cap. A school of a few hundred accounts is one or two requests. */
const BATCH = 100;

/**
 * Send, then act on the receipts.
 *
 * Returns the tokens Expo rejected with `DeviceNotRegistered` — the app was uninstalled or the
 * token rotated. Callers pass them to `pruneTokens`. This is the piece of push plumbing that is
 * always skipped and always regretted: without it the table grows forever with tokens that can
 * never deliver, and every subsequent send pays for them.
 */
export async function sendPush(messages: ExpoPushMessage[]): Promise<{ dead: string[] }> {
  const dead: string[] = [];

  for (let i = 0; i < messages.length; i += BATCH) {
    const batch = messages.slice(i, i + BATCH);
    let tickets: ExpoPushTicket[] = [];
    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        console.error('[push] send failed', { status: res.status });
        continue;
      }
      tickets = ((await res.json()) as { data?: ExpoPushTicket[] }).data ?? [];
    } catch (err) {
      // A failed send is not worth failing the whole cron for: the next tick tries again, and
      // the idempotency ledger is only written for messages that were actually handed over.
      console.error('[push] send threw', { err: String(err) });
      continue;
    }

    // Tickets come back positionally, one per message in the batch.
    tickets.forEach((ticket, idx) => {
      if (ticket.status === 'ok') return;
      const token = batch[idx]?.to;
      if (ticket.details?.error === 'DeviceNotRegistered' && token) dead.push(token);
      else
        console.error('[push] ticket error', {
          error: ticket.details?.error,
          message: ticket.message,
        });
    });
  }

  return { dead };
}

// ---- Idempotency ledger ----

/**
 * Which of these keys have already been notified.
 *
 * Read as a set rather than one query per candidate: a 15-minute sweep over a 30-minute window
 * checks every upcoming occurrence each time it runs.
 */
export async function alreadySent(db: Db, keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const rows = await db
    .select({ key: sentNotifications.key })
    .from(sentNotifications)
    .where(inArray(sentNotifications.key, keys));
  return new Set(rows.map((r) => r.key));
}

/** Record keys as sent. `DO NOTHING` on conflict: two overlapping ticks must not throw. */
export async function markSent(db: Db, keys: string[]): Promise<void> {
  if (!keys.length) return;
  const sentAt = new Date().toISOString();
  await db
    .insert(sentNotifications)
    .values(keys.map((key) => ({ key, sentAt })))
    .onConflictDoNothing();
}

/**
 * The tail of the ledger, newest first — what the /logs Notifications tab shows as "recently sent".
 *
 * Two caveats the caller must surface, both structural rather than fixable here. The table holds
 * only `(key, sent_at)`, so the kind and subject have to be parsed back out of the key
 * (`parseLedgerKey` in ./notify-plan.ts); and a row means the job PROCESSED that key, not that
 * anybody received anything — every job marks its keys done even when zero devices or zero chats
 * resolved. Retention is whatever `pruneLedger` leaves behind: 30 days.
 */
export async function listRecentSent(
  db: Db,
  limit = 100,
): Promise<{ key: string; sentAt: string }[]> {
  return db
    .select({ key: sentNotifications.key, sentAt: sentNotifications.sentAt })
    .from(sentNotifications)
    .orderBy(desc(sentNotifications.sentAt))
    .limit(limit);
}

/**
 * Drop ledger rows older than `days`. The ledger only has to outlive the window a job can still
 * re-fire in; keeping it forever would turn an idempotency check into a growing table scan.
 */
export async function pruneLedger(db: Db, days = 30): Promise<void> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  await db.delete(sentNotifications).where(lt(sentNotifications.sentAt, cutoff));
}
