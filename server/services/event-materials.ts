import { eq, asc } from 'drizzle-orm';
import { eventMaterials } from '../db/schema';
import type { Db } from '../db/index';

export async function listForEvent(db: Db, eventId: string): Promise<string[]> {
  const rows = await db
    .select()
    .from(eventMaterials)
    .where(eq(eventMaterials.eventId, eventId))
    .orderBy(asc(eventMaterials.sortOrder));
  return rows.map((r) => r.materialId);
}

// Replace-set semantics: the submitted list becomes the full attachment set.
// If the event's class changes later, previously attached materials from the old
// class are intentionally kept (harmless; still listed as attached).
export async function setForEvent(
  db: Db,
  eventId: string,
  materialIds: string[],
): Promise<string[]> {
  const del = db.delete(eventMaterials).where(eq(eventMaterials.eventId, eventId));
  if (materialIds.length) {
    await db.batch([
      del,
      db
        .insert(eventMaterials)
        .values(materialIds.map((materialId, i) => ({ eventId, materialId, sortOrder: i }))),
    ]);
  } else {
    await del;
  }
  return listForEvent(db, eventId);
}
