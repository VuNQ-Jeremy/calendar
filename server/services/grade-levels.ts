import { eq, asc } from 'drizzle-orm';
import { gradeLevels } from '../db/schema';
import type { Db } from '../db/index';
import type { GradeLevelInput } from '../../shared/schemas';
import { record, recordCreate } from './audit';

/**
 * Khối (grade levels) — GLOBAL since migration 0049.
 *
 * Every function here takes a plain `Db`, not a `TenantDb`, and that is deliberate. Reading a global
 * table through a school-bound handle would be *safe* but *dishonest*: `TenantDb`'s whole premise is
 * that the scope is visible in the query you are reading, so a function that accepts a scoped handle
 * and then ignores the school is precisely the shape the tripwire exists to make suspicious. Taking
 * `Db` puts the globalness at every call site, which is where a reviewer will be. Callers that hold a
 * `TenantDb` pass `db.raw`.
 *
 * `grade_levels` is therefore absent from the tripwire's TENANT_TABLES and the reads below carry no
 * `own()`/`pool()` and need no `tenant-unscoped:` marker. That is correct — do not "fix" it.
 *
 * WRITES ARE PLATFORM-ADMIN-ONLY, and that is enforced at the two route layers rather than here,
 * because a service has no session: `app/routes/config.tsx` gates the four `*-level` intents, and
 * `app/routes/api.grade-levels*.tsx` use the `'platform'` auth level. Renaming Khối 6 renames it for
 * every school, on every existing class, test and question — so a third caller must gate too.
 */

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

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

const byId = (id: string) => eq(gradeLevels.id, id);

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
  const rows = await db.select().from(gradeLevels).where(byId(id));
  const row = map(rows[0]);
  recordCreate('grade_level', id, row);
  return row;
}

export async function remove(db: Db, id: string): Promise<void> {
  // Inlined rather than using `recordDelete`, which takes a TenantDb to build its own fence. Widening
  // that helper to accept `Db` would weaken it for the twenty genuinely-scoped callers to save four
  // lines here.
  const rows = await db.select().from(gradeLevels).where(byId(id)).limit(1);
  if (rows[0]) {
    record({ action: 'delete', entityType: 'grade_level', entityId: id, before: map(rows[0]) });
  }
  await db.delete(gradeLevels).where(byId(id));
}

/** One event for the whole reorder, with the new id order in meta — never N per-row updates. */
export async function reorder(db: Db, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i++) {
    await db
      .update(gradeLevels)
      .set({ sortOrder: i + 1 })
      .where(byId(ids[i]));
  }
  record({ action: 'update', entityType: 'grade_level', meta: { reordered: ids } });
}

export async function update(
  db: Db,
  id: string,
  patch: Partial<GradeLevelInput>,
): Promise<GradeLevelRow> {
  const beforeRows = await db.select().from(gradeLevels).where(byId(id));
  const before = beforeRows[0] ? map(beforeRows[0]) : undefined;
  const set: Partial<typeof gradeLevels.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.sortOrder !== undefined && patch.sortOrder != null) set.sortOrder = patch.sortOrder;
  if (Object.keys(set).length) {
    await db.update(gradeLevels).set(set).where(byId(id));
  }
  const rows = await db.select().from(gradeLevels).where(byId(id));
  const after = map(rows[0]);
  if (!sameJson(before, after)) {
    record({ action: 'update', entityType: 'grade_level', entityId: id, before, after });
  }
  return after;
}
