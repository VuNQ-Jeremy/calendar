import { eq, asc } from 'drizzle-orm';
import { checkinActivityTypes } from '../db/schema';
import type { TenantDb } from '../db/index';
import type { CheckinActivityTypeInput } from '../../shared/schemas';
import { record, recordCreate, recordDelete } from './audit';

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Hoạt động check-in — the managed enum the kiosk's checklist cells are built from. Mirror of
 * `subjects.ts` (same shape, same config card contract) plus an icon and a palette color, so a
 * cell looks the same to the kids week after week regardless of the per-session label.
 */
export type ActivityTypeRow = {
  id: string;
  name: string;
  icon: string;
  color: string;
  active: boolean;
  sortOrder: number;
};

function map(r: typeof checkinActivityTypes.$inferSelect): ActivityTypeRow {
  return {
    id: r.id,
    name: r.name,
    icon: r.icon,
    color: r.color,
    active: Boolean(r.active),
    sortOrder: r.sortOrder,
  };
}

export async function list(db: TenantDb): Promise<ActivityTypeRow[]> {
  const rows = await db.raw
    .select()
    .from(checkinActivityTypes)
    .where(db.own(checkinActivityTypes))
    .orderBy(asc(checkinActivityTypes.sortOrder), asc(checkinActivityTypes.name));
  return rows.map(map);
}

export async function create(
  db: TenantDb,
  input: CheckinActivityTypeInput,
): Promise<ActivityTypeRow> {
  const id = crypto.randomUUID();
  let sortOrder = input.sortOrder ?? undefined;
  if (sortOrder == null) {
    const existing = await list(db);
    sortOrder = existing.reduce((max, s) => Math.max(max, s.sortOrder), 0) + 1;
  }
  await db.insert(checkinActivityTypes).values({
    id,
    name: input.name,
    icon: input.icon,
    color: input.color,
    active: input.active,
    sortOrder,
  });
  const rows = await db.raw
    .select()
    .from(checkinActivityTypes)
    .where(db.own(checkinActivityTypes, eq(checkinActivityTypes.id, id)));
  const row = map(rows[0]);
  recordCreate('checkin_activity_type', id, row);
  return row;
}

export async function remove(db: TenantDb, id: string): Promise<void> {
  await recordDelete(db, 'checkin_activity_type', checkinActivityTypes, id);
  await db.delete(checkinActivityTypes, eq(checkinActivityTypes.id, id));
}

/** One event for the whole reorder, with the new id order in meta — never N per-row updates. */
export async function reorder(db: TenantDb, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i++) {
    await db.update(
      checkinActivityTypes,
      { sortOrder: i + 1 },
      eq(checkinActivityTypes.id, ids[i]),
    );
  }
  record({ action: 'update', entityType: 'checkin_activity_type', meta: { reordered: ids } });
}

export async function update(
  db: TenantDb,
  id: string,
  patch: Partial<CheckinActivityTypeInput>,
): Promise<ActivityTypeRow> {
  const beforeRows = await db.raw
    .select()
    .from(checkinActivityTypes)
    .where(db.own(checkinActivityTypes, eq(checkinActivityTypes.id, id)));
  const before = beforeRows[0] ? map(beforeRows[0]) : undefined;
  const set: Partial<typeof checkinActivityTypes.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.icon !== undefined) set.icon = patch.icon;
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.sortOrder !== undefined && patch.sortOrder != null) set.sortOrder = patch.sortOrder;
  if (Object.keys(set).length) {
    await db.update(checkinActivityTypes, set, eq(checkinActivityTypes.id, id));
  }
  const rows = await db.raw
    .select()
    .from(checkinActivityTypes)
    .where(db.own(checkinActivityTypes, eq(checkinActivityTypes.id, id)));
  const after = map(rows[0]);
  if (!sameJson(before, after)) {
    record({ action: 'update', entityType: 'checkin_activity_type', entityId: id, before, after });
  }
  return after;
}
