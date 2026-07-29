import { eq, ne, desc } from 'drizzle-orm';
import { feedback } from '../db/schema';
import type { Db } from '../db/index';
import type { FeedbackInput } from '../../shared/schemas';

export type FeedbackRow = {
  id: string;
  message: string;
  category: string;
  author: string | null;
  status: string;
  createdAt: string | null;
  appVersion: string | null;
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
  };
}

export async function list(db: Db): Promise<FeedbackRow[]> {
  const rows = await db.select().from(feedback).orderBy(desc(feedback.createdAt));
  return rows.map(map);
}

export async function create(db: Db, input: FeedbackInput): Promise<FeedbackRow> {
  const id = crypto.randomUUID();
  await db.insert(feedback).values({
    id,
    message: input.message,
    category: input.category,
    author: input.author ?? null,
    status: input.status,
    createdAt: input.createdAt ?? null,
    appVersion: input.appVersion ?? null,
  });
  const rows = await db.select().from(feedback).where(eq(feedback.id, id));
  return map(rows[0]);
}

export async function update(
  db: Db,
  id: string,
  patch: Partial<FeedbackInput>,
): Promise<FeedbackRow> {
  const set: Partial<typeof feedback.$inferInsert> = {};
  if (patch.message !== undefined) set.message = patch.message;
  if (patch.category !== undefined) set.category = patch.category;
  if (patch.author !== undefined) set.author = patch.author ?? null;
  if (patch.status !== undefined) set.status = patch.status;
  if (Object.keys(set).length) {
    await db.update(feedback).set(set).where(eq(feedback.id, id));
  }
  const rows = await db.select().from(feedback).where(eq(feedback.id, id));
  return map(rows[0]);
}

export async function remove(db: Db, id: string): Promise<void> {
  await db.delete(feedback).where(eq(feedback.id, id));
}

/**
 * Feedback still awaiting action — anything not resolved, i.e. 'new' or 'reviewed'.
 *
 * Counting `!== 'done'` rather than `=== 'new'` is what makes the sidebar badge agree with
 * the resolve button: marking a reviewed item resolved has to move the number too.
 */
export async function countUnresolved(db: Db): Promise<number> {
  const rows = await db.select().from(feedback).where(ne(feedback.status, 'done'));
  return rows.length;
}
