import { eq, asc } from 'drizzle-orm';
import { assessmentTypes } from '../db/schema';
import type { TenantDb } from '../db/index';
import type { AssessmentTypeInput } from '../../shared/schemas';
import { record, recordCreate, recordDelete } from './audit';

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

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

export async function list(db: TenantDb): Promise<AssessmentTypeRow[]> {
  const rows = await db.raw
    .select()
    .from(assessmentTypes)
    .where(db.own(assessmentTypes))
    .orderBy(asc(assessmentTypes.sortOrder), asc(assessmentTypes.name));
  return rows.map(map);
}

export async function create(db: TenantDb, input: AssessmentTypeInput): Promise<AssessmentTypeRow> {
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
  const rows = await db.raw
    .select()
    .from(assessmentTypes)
    .where(db.own(assessmentTypes, eq(assessmentTypes.id, id)));
  const row = map(rows[0]);
  recordCreate('assessment_type', id, row);
  return row;
}

export async function remove(db: TenantDb, id: string): Promise<void> {
  await recordDelete(db, 'assessment_type', assessmentTypes, id);
  await db.delete(assessmentTypes, eq(assessmentTypes.id, id));
}

/** One event for the whole reorder, with the new id order in meta — never N per-row updates. */
export async function reorder(db: TenantDb, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i++) {
    await db.update(assessmentTypes, { sortOrder: i + 1 }, eq(assessmentTypes.id, ids[i]));
  }
  record({ action: 'update', entityType: 'assessment_type', meta: { reordered: ids } });
}

export async function update(
  db: TenantDb,
  id: string,
  patch: Partial<AssessmentTypeInput>,
): Promise<AssessmentTypeRow> {
  const beforeRows = await db.raw
    .select()
    .from(assessmentTypes)
    .where(db.own(assessmentTypes, eq(assessmentTypes.id, id)));
  const before = beforeRows[0] ? map(beforeRows[0]) : undefined;
  const set: Partial<typeof assessmentTypes.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.sortOrder !== undefined && patch.sortOrder != null) set.sortOrder = patch.sortOrder;
  if (Object.keys(set).length) {
    await db.update(assessmentTypes, set, eq(assessmentTypes.id, id));
  }
  const rows = await db.raw
    .select()
    .from(assessmentTypes)
    .where(db.own(assessmentTypes, eq(assessmentTypes.id, id)));
  const after = map(rows[0]);
  if (!sameJson(before, after)) {
    record({ action: 'update', entityType: 'assessment_type', entityId: id, before, after });
  }
  return after;
}
