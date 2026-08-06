import { eq, asc } from 'drizzle-orm';
import { remarkCriteria } from '../db/schema';
import type { Db } from '../db/index';
import type { RemarkCriterionInput } from '../../shared/schemas';

export type RemarkCriterionRow = {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
};

function map(r: typeof remarkCriteria.$inferSelect): RemarkCriterionRow {
  return {
    id: r.id,
    name: r.name,
    active: Boolean(r.active),
    sortOrder: r.sortOrder,
  };
}

export async function list(db: Db): Promise<RemarkCriterionRow[]> {
  const rows = await db
    .select()
    .from(remarkCriteria)
    .orderBy(asc(remarkCriteria.sortOrder), asc(remarkCriteria.name));
  return rows.map(map);
}

export async function create(db: Db, input: RemarkCriterionInput): Promise<RemarkCriterionRow> {
  const id = crypto.randomUUID();
  let sortOrder = input.sortOrder ?? undefined;
  if (sortOrder == null) {
    const existing = await list(db);
    sortOrder = existing.reduce((max, c) => Math.max(max, c.sortOrder), 0) + 1;
  }
  await db.insert(remarkCriteria).values({
    id,
    name: input.name,
    active: input.active,
    sortOrder,
  });
  const rows = await db.select().from(remarkCriteria).where(eq(remarkCriteria.id, id));
  return map(rows[0]);
}

export async function remove(db: Db, id: string): Promise<void> {
  await db.delete(remarkCriteria).where(eq(remarkCriteria.id, id));
}

export async function reorder(db: Db, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i++) {
    await db
      .update(remarkCriteria)
      .set({ sortOrder: i + 1 })
      .where(eq(remarkCriteria.id, ids[i]));
  }
}

export async function update(
  db: Db,
  id: string,
  patch: Partial<RemarkCriterionInput>,
): Promise<RemarkCriterionRow> {
  const set: Partial<typeof remarkCriteria.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.sortOrder !== undefined && patch.sortOrder != null) set.sortOrder = patch.sortOrder;
  if (Object.keys(set).length) {
    await db.update(remarkCriteria).set(set).where(eq(remarkCriteria.id, id));
  }
  const rows = await db.select().from(remarkCriteria).where(eq(remarkCriteria.id, id));
  return map(rows[0]);
}
