import { eq, asc } from 'drizzle-orm';
import { subjects } from '../db/schema';
import type { Db } from '../db/index';
import type { SubjectInput } from '../../shared/schemas';
import { record, recordCreate, recordDelete } from './audit';

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Môn học — the managed enum a class's subject is picked from. Mirror of `grade-levels.ts` and
 * `class-levels.ts`: same shape, same config card contract.
 */
export type SubjectRow = {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
};

function map(r: typeof subjects.$inferSelect): SubjectRow {
  return {
    id: r.id,
    name: r.name,
    active: Boolean(r.active),
    sortOrder: r.sortOrder,
  };
}

export async function list(db: Db): Promise<SubjectRow[]> {
  const rows = await db
    .select()
    .from(subjects)
    .orderBy(asc(subjects.sortOrder), asc(subjects.name));
  return rows.map(map);
}

/**
 * Resolve a free-text subject name to its managed row. Used only for older mobile builds, which
 * still send `subject` as a string — an unknown name resolves to null and the class keeps the
 * subject it had, rather than a typo quietly entering the managed list.
 */
export async function findByName(db: Db, name: string): Promise<SubjectRow | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const rows = await db.select().from(subjects).where(eq(subjects.name, trimmed));
  return rows[0] ? map(rows[0]) : null;
}

export async function create(db: Db, input: SubjectInput): Promise<SubjectRow> {
  const id = crypto.randomUUID();
  let sortOrder = input.sortOrder ?? undefined;
  if (sortOrder == null) {
    const existing = await list(db);
    sortOrder = existing.reduce((max, s) => Math.max(max, s.sortOrder), 0) + 1;
  }
  await db.insert(subjects).values({
    id,
    name: input.name,
    active: input.active,
    sortOrder,
  });
  const rows = await db.select().from(subjects).where(eq(subjects.id, id));
  const row = map(rows[0]);
  recordCreate('subject', id, row);
  return row;
}

export async function remove(db: Db, id: string): Promise<void> {
  await recordDelete(db, 'subject', subjects, id);
  await db.delete(subjects).where(eq(subjects.id, id));
}

/** One event for the whole reorder, with the new id order in meta — never N per-row updates. */
export async function reorder(db: Db, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i++) {
    await db
      .update(subjects)
      .set({ sortOrder: i + 1 })
      .where(eq(subjects.id, ids[i]));
  }
  record({ action: 'update', entityType: 'subject', meta: { reordered: ids } });
}

export async function update(
  db: Db,
  id: string,
  patch: Partial<SubjectInput>,
): Promise<SubjectRow> {
  const beforeRows = await db.select().from(subjects).where(eq(subjects.id, id));
  const before = beforeRows[0] ? map(beforeRows[0]) : undefined;
  const set: Partial<typeof subjects.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.sortOrder !== undefined && patch.sortOrder != null) set.sortOrder = patch.sortOrder;
  if (Object.keys(set).length) {
    await db.update(subjects).set(set).where(eq(subjects.id, id));
  }
  const rows = await db.select().from(subjects).where(eq(subjects.id, id));
  const after = map(rows[0]);
  if (!sameJson(before, after)) {
    record({ action: 'update', entityType: 'subject', entityId: id, before, after });
  }
  return after;
}
