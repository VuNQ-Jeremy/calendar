import { desc, sql } from 'drizzle-orm';
import { usageCounters } from '../db/schema';
import type { Db } from '../db/index';

/**
 * Monthly usage counters for metered external services — the data behind /logs/usage.
 *
 * One row per (month, metric), incremented by a blind upsert that rides `ctx.waitUntil` off
 * the response path: a lost tick under concurrency is acceptable for a quota gauge, a slower
 * scoring call is not. Months are ICT (the app's day convention); Azure's own quota window is
 * its billing calendar month, so treat the gauge as a close estimate, not an invoice.
 */

/** Azure Speech pronunciation assessment via /speech-assess. Quantity = audio seconds. */
export const SPEECH_ASSESS_METRIC = 'speech-assess';

/** Azure F0 free tier: 5 audio-hours of speech-to-text per calendar month, not adjustable. */
export const SPEECH_FREE_SECONDS_PER_MONTH = 5 * 3600;

export type UsageRow = {
  month: string;
  metric: string;
  count: number;
  quantity: number;
};

/** Add one call (and its quantity, in the metric's own unit) to the month's counter. */
export async function trackUsage(
  db: Db,
  metric: string,
  month: string,
  quantity: number,
): Promise<void> {
  await db
    .insert(usageCounters)
    .values({ month, metric, count: 1, quantity })
    .onConflictDoUpdate({
      target: [usageCounters.month, usageCounters.metric],
      set: {
        count: sql`${usageCounters.count} + 1`,
        quantity: sql`${usageCounters.quantity} + ${quantity}`,
      },
    });
}

/** Every counter row, newest month first. The table grows by rows-per-metric per month. */
export async function listUsage(db: Db): Promise<UsageRow[]> {
  return db
    .select()
    .from(usageCounters)
    .orderBy(desc(usageCounters.month), usageCounters.metric)
    .limit(120);
}
