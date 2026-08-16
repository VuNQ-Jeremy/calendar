import { eq } from 'drizzle-orm';
import { materials, eventMaterials, classMaterials } from '../db/schema';
import type { Db } from '../db/index';
import type { MaterialInput } from '../../shared/schemas';
import { record, recordCreate, recordDelete } from './audit';

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export type MaterialRow = {
  id: string;
  title: string;
  type: string;
  url: string | null;
  fileName: string | null;
  fileKey: string | null;
  favorite: boolean;
  addedAt: string | null;
};

function map(r: typeof materials.$inferSelect): MaterialRow {
  return {
    id: r.id,
    title: r.title,
    type: r.type,
    url: r.url,
    fileName: r.fileName,
    fileKey: r.fileKey,
    favorite: Boolean(r.favorite),
    addedAt: r.addedAt,
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
      url: input.url ?? null,
      fileName,
      fileKey,
      favorite: input.favorite,
      addedAt: input.addedAt ?? null,
    });
  } catch (err) {
    if (fileKey && files) await files.delete(fileKey);
    throw err;
  }

  const rows = await db.select().from(materials).where(eq(materials.id, id));
  const row = map(rows[0]);
  recordCreate('material', id, row);
  return row;
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
  const before = current ? map(current) : undefined;

  const set: Partial<typeof materials.$inferInsert> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.type !== undefined) set.type = patch.type;
  if (patch.url !== undefined) set.url = patch.url ?? null;
  if (patch.favorite !== undefined) set.favorite = patch.favorite;
  if (patch.addedAt !== undefined) set.addedAt = patch.addedAt ?? null;

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
    // Delete old R2 object after successful DB update
    if (newFileKey && files && current?.fileKey && current.fileKey !== newFileKey) {
      await files.delete(current.fileKey);
    }
  } catch (err) {
    if (newFileKey && files) await files.delete(newFileKey);
    throw err;
  }

  const rows = await db.select().from(materials).where(eq(materials.id, id));
  const after = map(rows[0]);
  if (!sameJson(before, after)) {
    // Fold in the superseded-file side effect so a diff shows the whole picture, not just the
    // columns `set` touched.
    record({
      action: 'update',
      entityType: 'material',
      entityId: id,
      before,
      after,
      meta: {
        supersededFileKey:
          newFileKey && current?.fileKey !== newFileKey ? (current?.fileKey ?? null) : null,
      },
    });
  }
  return after;
}

export async function remove(db: Db, id: string, files?: R2Bucket): Promise<void> {
  const rows = await db.select().from(materials).where(eq(materials.id, id));
  const row = rows[0];
  const linked = await db
    .select({ eventId: eventMaterials.eventId })
    .from(eventMaterials)
    .where(eq(eventMaterials.materialId, id));
  const linkedClasses = await db
    .select({ classId: classMaterials.classId })
    .from(classMaterials)
    .where(eq(classMaterials.materialId, id));
  // Both joins cascade with the row; folded into `extra` so the audit entry still says which
  // classes and which sessions lost the material.
  await recordDelete(db, 'material', materials, id, {
    eventIds: linked.map((r) => r.eventId),
    classIds: linkedClasses.map((r) => r.classId),
  });
  if (files && row?.fileKey) await files.delete(row.fileKey);
  await db.delete(materials).where(eq(materials.id, id));
}
