import { eq, asc } from 'drizzle-orm';
import { assessmentTypes } from '../db/schema';
import type { Db } from '../db/index';
import type { AssessmentTypeInput } from '../../shared/schemas';

export type AssessmentTypeRow = {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
};

function map(r: typeof assessmentTypes.$inferSelect): AssessmentTypeRow {
  return {
    id: r.id,
    name: r.name,
    active: Boolean(r.active),
    sortOrder: r.sortOrder,
  };
}

export async function list(db: Db): Promise<AssessmentTypeRow[]> {
  const rows = await db
    .select()
    .from(assessmentTypes)
    .orderBy(asc(assessmentTypes.sortOrder), asc(assessmentTypes.name));
  return rows.map(map);
}

export async function create(db: Db, input: AssessmentTypeInput): Promise<AssessmentTypeRow> {
  const id = crypto.randomUUID();
  let sortOrder = input.sortOrder ?? undefined;
  if (sortOrder == null) {
    const existing = await list(db);
    sortOrder = existing.reduce((max, t) => Math.max(max, t.sortOrder), 0) + 1;
  }
  await db.insert(assessmentTypes).values({
    id,
    name: input.name,
    active: input.active,
    sortOrder,
  });
  const rows = await db.select().from(assessmentTypes).where(eq(assessmentTypes.id, id));
  return map(rows[0]);
}

export async function remove(db: Db, id: string): Promise<void> {
  await db.delete(assessmentTypes).where(eq(assessmentTypes.id, id));
}

export async function reorder(db: Db, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i++) {
    await db
      .update(assessmentTypes)
      .set({ sortOrder: i + 1 })
      .where(eq(assessmentTypes.id, ids[i]));
  }
}

export async function update(
  db: Db,
  id: string,
  patch: Partial<AssessmentTypeInput>,
): Promise<AssessmentTypeRow> {
  const set: Partial<typeof assessmentTypes.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.sortOrder !== undefined && patch.sortOrder != null) set.sortOrder = patch.sortOrder;
  if (Object.keys(set).length) {
    await db.update(assessmentTypes).set(set).where(eq(assessmentTypes.id, id));
  }
  const rows = await db.select().from(assessmentTypes).where(eq(assessmentTypes.id, id));
  return map(rows[0]);
}
