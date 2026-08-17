import { and, desc, eq, sql } from 'drizzle-orm';
import { usageCounters } from '../db/schema';
import { PRIMARY_TENANT_ID, type Db, type TenantDb } from '../db/index';
import { actorTenantId } from './audit';
import { AI_INPUT_METRIC, AI_OUTPUT_METRIC, type AiUsage } from '../../shared/logic/usage';

/**
 * Monthly usage counters for metered external services — the data behind /logs/usage.
 *
 * One row per (school, month, metric), incremented by a blind upsert that rides `ctx.waitUntil`
 * off the response path: a lost tick under concurrency is acceptable for a quota gauge, a slower
 * scoring call is not. Months are ICT (the app's day convention); Azure's own quota window is
 * its billing calendar month, so treat the gauge as a close estimate, not an invoice.
 *
 * Two different questions live here, and they are scoped differently on purpose. "What did THIS
 * school spend" is per-school (`listUsage`). "How close is the deployment to the provider's
 * ceiling" is platform-wide (`speechSecondsAllTenants`), because Azure's F0 allowance belongs to
 * one subscription key that every school shares.
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

/**
 * Add one call (and its quantity, in the metric's own unit) to the month's counter.
 *
 * Keeps the unscoped handle rather than taking a `TenantDb`: its callers are metering points
 * buried in resource routes (`/speech-assess`) and AI helpers that hold whatever handle their
 * own flow gave them, and threading a scoped one through them buys nothing — the school is
 * already ambient on the request. `actorTenantId()` is that ambient read; a tick raised outside
 * any request (a script, a test) lands on the original school rather than being dropped, which
 * is the same trade the activity log makes.
 */
export async function trackUsage(
  db: Db,
  metric: string,
  month: string,
  quantity: number,
): Promise<void> {
  const tenantId = actorTenantId() ?? PRIMARY_TENANT_ID;
  await db
    .insert(usageCounters)
    .values({ tenantId, month, metric, count: 1, quantity })
    .onConflictDoUpdate({
      target: [usageCounters.tenantId, usageCounters.month, usageCounters.metric],
      set: {
        count: sql`${usageCounters.count} + 1`,
        quantity: sql`${usageCounters.quantity} + ${quantity}`,
      },
    });
}

/**
 * Track one Anthropic API call: two rows per month — input and output tokens — so the Usage
 * card can price each side at its own rate. Both rows' `count` increments, so either one
 * reads as "calls this month".
 */
export async function trackAiUsage(db: Db, month: string, usage: AiUsage): Promise<void> {
  await trackUsage(db, AI_INPUT_METRIC, month, usage.inputTokens);
  await trackUsage(db, AI_OUTPUT_METRIC, month, usage.outputTokens);
}

/** This school's counter rows, newest month first. The table grows by rows-per-metric per month. */
export async function listUsage(db: TenantDb): Promise<UsageRow[]> {
  return db.raw
    .select({
      month: usageCounters.month,
      metric: usageCounters.metric,
      count: usageCounters.count,
      quantity: usageCounters.quantity,
    })
    .from(usageCounters)
    .where(db.own(usageCounters))
    .orderBy(desc(usageCounters.month), usageCounters.metric)
    .limit(120);
}

/**
 * Audio seconds assessed across EVERY school this month.
 *
 * tenant-unscoped: the F0 allowance is a property of the Azure subscription key, not of a
 * school. Azure starts refusing clips with 403 once the deployment as a whole passes 5 audio
 * hours, so a gauge that showed one school's own share would read comfortably green in the
 * month the service stopped working. This is the one number on /logs/usage that deliberately
 * spans tenants; the table beside it stays per-school.
 */
export async function speechSecondsAllTenants(db: Db, month: string): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`coalesce(sum(${usageCounters.quantity}), 0)` })
    .from(usageCounters)
    .where(and(eq(usageCounters.month, month), eq(usageCounters.metric, SPEECH_ASSESS_METRIC)));
  return rows[0]?.total ?? 0;
}
