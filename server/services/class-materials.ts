import { eq, asc } from 'drizzle-orm';
import { classMaterials } from '../db/schema';
import type { TenantDb } from '../db/index';

export async function listForClass(db: TenantDb, classId: string): Promise<string[]> {
  const rows = await db.raw
    .select()
    .from(classMaterials)
    .where(db.own(classMaterials, eq(classMaterials.classId, classId)))
    .orderBy(asc(classMaterials.sortOrder));
  return rows.map((r) => r.materialId);
}

export async function listAll(db: TenantDb): Promise<{ classId: string; materialId: string }[]> {
  const rows = await db.raw.select().from(classMaterials).where(db.own(classMaterials));
  return rows.map((r) => ({ classId: r.classId, materialId: r.materialId }));
}

// Replace-set semantics, same as setForEvent: the submitted list becomes the full set for this
// class. A material may belong to any number of classes — the library is shared, so attaching
// here never detaches it anywhere else.
export async function setForClass(
  db: TenantDb,
  classId: string,
  materialIds: string[],
): Promise<string[]> {
  const del = db.delete(classMaterials, eq(classMaterials.classId, classId));
  if (materialIds.length) {
    await db.batch([
      del,
      db
        .insert(classMaterials)
        .values(materialIds.map((materialId, i) => ({ classId, materialId, sortOrder: i }))),
    ]);
  } else {
    await del;
  }
  return listForClass(db, classId);
}
