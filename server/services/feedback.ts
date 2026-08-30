import { eq, inArray, desc, max } from 'drizzle-orm';
import { feedback } from '../db/schema';
import type { TenantDb } from '../db/index';
import type { FeedbackInput } from '../../shared/schemas';
import { record, recordCreate, recordDelete } from './audit';

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export type FeedbackRow = {
  id: string;
  message: string;
  category: string;
  author: string | null;
  status: string;
  createdAt: string | null;
  appVersion: string | null;
  ref: number | null;
  issueNumber: number | null;
};

function map(r: typeof feedback.$inferSelect): FeedbackRow {
  return {
    id: r.id,
    message: r.message,
    category: r.category,
    author: r.author,
    status: r.status,
    createdAt: r.createdAt,
    appVersion: r.appVersion,
    ref: r.ref,
    issueNumber: r.issueNumber,
  };
}

export async function list(db: TenantDb): Promise<FeedbackRow[]> {
  const rows = await db.raw
    .select()
    .from(feedback)
    .where(db.own(feedback))
    .orderBy(desc(feedback.createdAt));
  return rows.map(map);
}

/**
 * The next short handle: one past the highest in use.
 *
 * tenant-unscoped: refs are handles on issues in one GitHub repo, so they must be globally
 * unique. Two schools filing a report each must not both be told "F-12" when only one issue
 * can carry that title, and `idx_feedback_ref` is a global unique index that would reject the
 * second write anyway. So the high-water mark is read across every school even though the
 * inbox that displays it is not.
 *
 * Deliberately not a UNIQUE-violating race worry in practice — this is a handful of reports a
 * day across the deployment, and D1 serialises writes. Deleting the newest report does free its
 * number for reuse, which is fine: no two *live* rows ever share one, and the audit log keeps the
 * deleted row with the ref it had.
 */
async function nextRef(db: TenantDb): Promise<number> {
  const rows = await db.raw.select({ max: max(feedback.ref) }).from(feedback);
  return (rows[0]?.max ?? 0) + 1;
}

export async function create(db: TenantDb, input: FeedbackInput): Promise<FeedbackRow> {
  const id = crypto.randomUUID();
  await db.insert(feedback).values({
    id,
    ref: await nextRef(db),
    message: input.message,
    category: input.category,
    author: input.author ?? null,
    status: input.status,
    // Stamped here, and `input.createdAt` is deliberately ignored: web and mobile both wanted
    // "now", and the server is the one clock they agree on. Older clients post a bare
    // 'YYYY-MM-DD' — a phone keeps doing so until the OTA reaches it — and honouring that is
    // what produced rows the inbox could not show a time for. A full ISO timestamp, always.
    createdAt: new Date().toISOString(),
    appVersion: input.appVersion ?? null,
  });
  const rows = await db.raw
    .select()
    .from(feedback)
    .where(db.own(feedback, eq(feedback.id, id)));
  const row = map(rows[0]);
  recordCreate('feedback', id, row);
  return row;
}

export async function update(
  db: TenantDb,
  id: string,
  patch: Partial<FeedbackInput>,
): Promise<FeedbackRow> {
  const beforeRows = await db.raw
    .select()
    .from(feedback)
    .where(db.own(feedback, eq(feedback.id, id)));
  const before = beforeRows[0] ? map(beforeRows[0]) : undefined;
  const set: Partial<typeof feedback.$inferInsert> = {};
  if (patch.message !== undefined) set.message = patch.message;
  if (patch.category !== undefined) set.category = patch.category;
  if (patch.author !== undefined) set.author = patch.author ?? null;
  if (patch.status !== undefined) set.status = patch.status;
  if (Object.keys(set).length) {
    await db.update(feedback, set, eq(feedback.id, id));
  }
  const rows = await db.raw
    .select()
    .from(feedback)
    .where(db.own(feedback, eq(feedback.id, id)));
  const after = map(rows[0]);
  if (!sameJson(before, after)) {
    record({ action: 'update', entityType: 'feedback', entityId: id, before, after });
  }
  return after;
}

/**
 * Record which GitHub issue this report became.
 *
 * Written from the same `waitUntil` that opens the issue, so it lands after the response the
 * reporter already saw. No audit entry: nobody chose this, and it would double every feedback
 * create in the log.
 */
export async function setIssueNumber(db: TenantDb, id: string, issueNumber: number): Promise<void> {
  await db.update(feedback, { issueNumber }, eq(feedback.id, id));
}

export async function remove(db: TenantDb, id: string): Promise<void> {
  await recordDelete(db, 'feedback', feedback, id);
  await db.delete(feedback, eq(feedback.id, id));
}

/**
 * Feedback still awaiting action — 'new' or 'reviewed'.
 *
 * Counting both rather than `=== 'new'` is what makes the sidebar badge agree with the board:
 * resolving a reviewed item has to move the number too. 'backlog' and 'on_hold' are deliberately
 * OUT — both mean "parked on purpose" (deferred before starting / paused midway), and a badge
 * that keeps nagging about parked items would train everyone to ignore it.
 */
export async function countUnresolved(db: TenantDb): Promise<number> {
  const rows = await db.raw
    .select({ id: feedback.id })
    .from(feedback)
    .where(db.own(feedback, inArray(feedback.status, ['new', 'reviewed'])));
  return rows.length;
}
