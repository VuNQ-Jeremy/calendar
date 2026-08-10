import { eq, asc } from 'drizzle-orm';
import { classLevels } from '../db/schema';
import type { Db } from '../db/index';
import type { ClassLevelInput } from '../../shared/schemas';

/**
 * Trình độ — the managed enum that pairs with a class's grade level (khối) to form its ranking
 * cohort. Deliberately a mirror of `grade-levels.ts`: same shape, same config card contract.
 */
export type ClassLevelRow = {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
};

function map(r: typeof classLevels.$inferSelect): ClassLevelRow {
  return {
    id: r.id,
    name: r.name,
    active: Boolean(r.active),
    sortOrder: r.sortOrder,
  };
}

export async function list(db: Db): Promise<ClassLevelRow[]> {
  const rows = await db
    .select()
    .from(classLevels)
    .orderBy(asc(classLevels.sortOrder), asc(classLevels.name));
  return rows.map(map);
}

export async function create(db: Db, input: ClassLevelInput): Promise<ClassLevelRow> {
  const id = crypto.randomUUID();
  let sortOrder = input.sortOrder ?? undefined;
  if (sortOrder == null) {
    const existing = await list(db);
    sortOrder = existing.reduce((max, g) => Math.max(max, g.sortOrder), 0) + 1;
  }
  await db.insert(classLevels).values({
    id,
    name: input.name,
    active: input.active,
    sortOrder,
  });
  const rows = await db.select().from(classLevels).where(eq(classLevels.id, id));
  return map(rows[0]);
}

export async function remove(db: Db, id: string): Promise<void> {
  await db.delete(classLevels).where(eq(classLevels.id, id));
}

export async function reorder(db: Db, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i++) {
    await db
      .update(classLevels)
      .set({ sortOrder: i + 1 })
      .where(eq(classLevels.id, ids[i]));
  }
}

export async function update(
  db: Db,
  id: string,
  patch: Partial<ClassLevelInput>,
): Promise<ClassLevelRow> {
  const set: Partial<typeof classLevels.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.sortOrder !== undefined && patch.sortOrder != null) set.sortOrder = patch.sortOrder;
  if (Object.keys(set).length) {
    await db.update(classLevels).set(set).where(eq(classLevels.id, id));
  }
  const rows = await db.select().from(classLevels).where(eq(classLevels.id, id));
  return map(rows[0]);
}
