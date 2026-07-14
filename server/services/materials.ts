import { eq } from 'drizzle-orm';
import { materials } from '../db/schema';
import type { Db } from '../db/index';
import type { MaterialInput } from '../../shared/schemas';

export type MaterialRow = {
  id: string;
  title: string;
  type: string;
  classId: string | null;
  url: string | null;
  fileName: string | null;
  favorite: boolean;
  addedAt: string | null;
};

function map(r: typeof materials.$inferSelect): MaterialRow {
  return {
    id: r.id,
    title: r.title,
    type: r.type,
    classId: r.classId,
    url: r.url,
    fileName: r.fileName,
    favorite: Boolean(r.favorite),
    addedAt: r.addedAt,
  };
}

export async function list(db: Db): Promise<MaterialRow[]> {
  const rows = await db.select().from(materials);
  return rows.map(map);
}

export async function create(db: Db, input: MaterialInput): Promise<MaterialRow> {
  const id = crypto.randomUUID();
  await db.insert(materials).values({
    id,
    title: input.title,
    type: input.type,
    classId: input.classId ?? null,
    url: input.url ?? null,
    fileName: input.fileName ?? null,
    favorite: input.favorite ? 1 : (0 as unknown as boolean),
    addedAt: input.addedAt ?? null,
  });
  const rows = await db.select().from(materials).where(eq(materials.id, id));
  return map(rows[0]);
}

export async function update(
  db: Db,
  id: string,
  patch: Partial<MaterialInput>,
): Promise<MaterialRow> {
  const set: Partial<typeof materials.$inferInsert> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.type !== undefined) set.type = patch.type;
  if (patch.classId !== undefined) set.classId = patch.classId ?? null;
  if (patch.url !== undefined) set.url = patch.url ?? null;
  if (patch.fileName !== undefined) set.fileName = patch.fileName ?? null;
  if (patch.favorite !== undefined) set.favorite = patch.favorite ? 1 : (0 as unknown as boolean);
  if (patch.addedAt !== undefined) set.addedAt = patch.addedAt ?? null;
  if (Object.keys(set).length) {
    await db.update(materials).set(set).where(eq(materials.id, id));
  }
  const rows = await db.select().from(materials).where(eq(materials.id, id));
  return map(rows[0]);
}

export async function remove(db: Db, id: string): Promise<void> {
  await db.delete(materials).where(eq(materials.id, id));
}
