import { eq, asc } from 'drizzle-orm';
import { remarkCriteria } from '../db/schema';
import type { TenantDb } from '../db/index';
import type { RemarkCriterionInput } from '../../shared/schemas';
import { record, recordCreate, recordDelete } from './audit';

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

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

export async function list(db: TenantDb): Promise<RemarkCriterionRow[]> {
  const rows = await db.raw
    .select()
    .from(remarkCriteria)
    .where(db.own(remarkCriteria))
    .orderBy(asc(remarkCriteria.sortOrder), asc(remarkCriteria.name));
  return rows.map(map);
}

export async function create(
  db: TenantDb,
  input: RemarkCriterionInput,
): Promise<RemarkCriterionRow> {
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
  const rows = await db.raw
    .select()
    .from(remarkCriteria)
    .where(db.own(remarkCriteria, eq(remarkCriteria.id, id)));
  const row = map(rows[0]);
  recordCreate('remark_criterion', id, row);
  return row;
}

export async function remove(db: TenantDb, id: string): Promise<void> {
  await recordDelete(db, 'remark_criterion', remarkCriteria, id);
  await db.delete(remarkCriteria, eq(remarkCriteria.id, id));
}

/** One event for the whole reorder, with the new id order in meta — never N per-row updates. */
export async function reorder(db: TenantDb, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i++) {
    await db.update(remarkCriteria, { sortOrder: i + 1 }, eq(remarkCriteria.id, ids[i]));
  }
  record({ action: 'update', entityType: 'remark_criterion', meta: { reordered: ids } });
}

export async function update(
  db: TenantDb,
  id: string,
  patch: Partial<RemarkCriterionInput>,
): Promise<RemarkCriterionRow> {
  const beforeRows = await db.raw
    .select()
    .from(remarkCriteria)
    .where(db.own(remarkCriteria, eq(remarkCriteria.id, id)));
  const before = beforeRows[0] ? map(beforeRows[0]) : undefined;
  const set: Partial<typeof remarkCriteria.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.sortOrder !== undefined && patch.sortOrder != null) set.sortOrder = patch.sortOrder;
  if (Object.keys(set).length) {
    await db.update(remarkCriteria, set, eq(remarkCriteria.id, id));
  }
  const rows = await db.raw
    .select()
    .from(remarkCriteria)
    .where(db.own(remarkCriteria, eq(remarkCriteria.id, id)));
  const after = map(rows[0]);
  if (!sameJson(before, after)) {
    record({ action: 'update', entityType: 'remark_criterion', entityId: id, before, after });
  }
  return after;
}
