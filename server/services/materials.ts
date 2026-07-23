import { eq } from 'drizzle-orm';
import { materials, eventMaterials } from '../db/schema';
import type { Db } from '../db/index';
import type { MaterialInput } from '../../shared/schemas';

export type MaterialRow = {
  id: string;
  title: string;
  type: string;
  classId: string | null;
  url: string | null;
  fileName: string | null;
  fileKey: string | null;
  favorite: boolean;
  addedAt: string | null;
  scope: string;
};

function map(r: typeof materials.$inferSelect): MaterialRow {
  return {
    id: r.id,
    title: r.title,
    type: r.type,
    classId: r.classId,
    url: r.url,
    fileName: r.fileName,
    fileKey: r.fileKey,
    favorite: Boolean(r.favorite),
    addedAt: r.addedAt,
    scope: r.scope,
  };
}

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|\x00-\x1f]/g, '_').slice(0, 200);
}

export async function list(db: Db): Promise<MaterialRow[]> {
  const rows = await db.select().from(materials);
  return rows.map(map);
}

export async function create(
  db: Db,
  input: MaterialInput,
  file?: File,
  files?: R2Bucket,
): Promise<MaterialRow> {
  const id = crypto.randomUUID();
  let fileKey: string | null = null;
  let fileName = input.fileName ?? null;

  if (file && files) {
    const key = `materials/${id}/${sanitizeFilename(file.name)}`;
    await files.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
    fileKey = key;
    fileName = file.name;
  }

  try {
    await db.insert(materials).values({
      id,
      title: input.title,
      type: input.type,
      classId: input.classId ?? null,
      url: input.url ?? null,
      fileName,
      fileKey,
      favorite: input.favorite,
      addedAt: input.addedAt ?? null,
      scope: input.scope,
    });
  } catch (err) {
    if (fileKey && files) await files.delete(fileKey);
    throw err;
  }

  const rows = await db.select().from(materials).where(eq(materials.id, id));
  return map(rows[0]);
}

export async function update(
  db: Db,
  id: string,
  patch: Partial<MaterialInput>,
  file?: File,
  files?: R2Bucket,
): Promise<MaterialRow> {
  const existing = await db.select().from(materials).where(eq(materials.id, id));
  const current = existing[0];

  const set: Partial<typeof materials.$inferInsert> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.type !== undefined) set.type = patch.type;
  if (patch.classId !== undefined) set.classId = patch.classId ?? null;
  if (patch.url !== undefined) set.url = patch.url ?? null;
  if (patch.favorite !== undefined) set.favorite = patch.favorite;
  if (patch.addedAt !== undefined) set.addedAt = patch.addedAt ?? null;
  if (patch.scope !== undefined) set.scope = patch.scope;

  let newFileKey: string | null | undefined;
  if (file && files) {
    const key = `materials/${id}/${sanitizeFilename(file.name)}`;
    await files.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
    newFileKey = key;
    set.fileName = file.name;
    set.fileKey = key;
  } else {
    if (patch.fileName !== undefined) set.fileName = patch.fileName ?? null;
  }

  try {
    if (Object.keys(set).length) {
      await db.update(materials).set(set).where(eq(materials.id, id));
    }
    // A scope change resets per-event attachments: an unattached class
    // material must not resurface as an event material, and a promoted
    // class material must not keep stale per-event rows either.
    if (patch.scope !== undefined && current && patch.scope !== current.scope) {
      await db.delete(eventMaterials).where(eq(eventMaterials.materialId, id));
    }
    // Delete old R2 object after successful DB update
    if (newFileKey && files && current?.fileKey && current.fileKey !== newFileKey) {
      await files.delete(current.fileKey);
    }
  } catch (err) {
    if (newFileKey && files) await files.delete(newFileKey);
    throw err;
  }

  const rows = await db.select().from(materials).where(eq(materials.id, id));
  return map(rows[0]);
}

export async function remove(db: Db, id: string, files?: R2Bucket): Promise<void> {
  if (files) {
    const rows = await db.select().from(materials).where(eq(materials.id, id));
    const row = rows[0];
    if (row?.fileKey) await files.delete(row.fileKey);
  }
  await db.delete(materials).where(eq(materials.id, id));
}
