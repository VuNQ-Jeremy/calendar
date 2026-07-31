import { eq, asc } from 'drizzle-orm';
import { gradeLevels } from '../db/schema';
import type { Db } from '../db/index';
import type { GradeLevelInput } from '../../shared/schemas';

export type GradeLevelRow = {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
};

function map(r: typeof gradeLevels.$inferSelect): GradeLevelRow {
  return {
    id: r.id,
    name: r.name,
    active: Boolean(r.active),
    sortOrder: r.sortOrder,
  };
}

export async function list(db: Db): Promise<GradeLevelRow[]> {
  const rows = await db
    .select()
    .from(gradeLevels)
    .orderBy(asc(gradeLevels.sortOrder), asc(gradeLevels.name));
  return rows.map(map);
}

export async function create(db: Db, input: GradeLevelInput): Promise<GradeLevelRow> {
  const id = crypto.randomUUID();
  let sortOrder = input.sortOrder ?? undefined;
  if (sortOrder == null) {
    const existing = await list(db);
    sortOrder = existing.reduce((max, g) => Math.max(max, g.sortOrder), 0) + 1;
  }
  await db.insert(gradeLevels).values({
    id,
    name: input.name,
    active: input.active,
    sortOrder,
  });
  const rows = await db.select().from(gradeLevels).where(eq(gradeLevels.id, id));
  return map(rows[0]);
}

export async function remove(db: Db, id: string): Promise<void> {
  await db.delete(gradeLevels).where(eq(gradeLevels.id, id));
}

export async function reorder(db: Db, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i++) {
    await db
      .update(gradeLevels)
      .set({ sortOrder: i + 1 })
      .where(eq(gradeLevels.id, ids[i]));
  }
}

export async function update(
  db: Db,
  id: string,
  patch: Partial<GradeLevelInput>,
): Promise<GradeLevelRow> {
  const set: Partial<typeof gradeLevels.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.sortOrder !== undefined && patch.sortOrder != null) set.sortOrder = patch.sortOrder;
  if (Object.keys(set).length) {
    await db.update(gradeLevels).set(set).where(eq(gradeLevels.id, id));
  }
  const rows = await db.select().from(gradeLevels).where(eq(gradeLevels.id, id));
  return map(rows[0]);
}
