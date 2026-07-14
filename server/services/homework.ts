import { eq, and, lte } from 'drizzle-orm';
import { homework } from '../db/schema';
import type { Db } from '../db/index';
import type { HomeworkInput } from '../../shared/schemas';

export type HomeworkRow = {
  id: string;
  title: string;
  classId: string | null;
  due: string | null;
  points: number | null;
  notes: string | null;
  color: string | null;
  done: boolean;
};

function map(r: typeof homework.$inferSelect): HomeworkRow {
  return {
    id: r.id,
    title: r.title,
    classId: r.classId,
    due: r.due,
    points: r.points,
    notes: r.notes,
    color: r.color,
    done: Boolean(r.done),
  };
}

export async function list(db: Db): Promise<HomeworkRow[]> {
  const rows = await db.select().from(homework);
  return rows.map(map);
}

export async function create(db: Db, input: HomeworkInput): Promise<HomeworkRow> {
  const id = crypto.randomUUID();
  await db.insert(homework).values({
    id,
    title: input.title,
    classId: input.classId ?? null,
    due: input.due ?? null,
    points: input.points ?? null,
    notes: input.notes ?? null,
    color: input.color ?? null,
    done: input.done,
  });
  const rows = await db.select().from(homework).where(eq(homework.id, id));
  return map(rows[0]);
}

export async function update(
  db: Db,
  id: string,
  patch: Partial<HomeworkInput>,
): Promise<HomeworkRow> {
  const set: Partial<typeof homework.$inferInsert> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.classId !== undefined) set.classId = patch.classId ?? null;
  if (patch.due !== undefined) set.due = patch.due ?? null;
  if (patch.points !== undefined) set.points = patch.points ?? null;
  if (patch.notes !== undefined) set.notes = patch.notes ?? null;
  if (patch.color !== undefined) set.color = patch.color ?? null;
  if (patch.done !== undefined) set.done = patch.done;
  if (Object.keys(set).length) {
    await db.update(homework).set(set).where(eq(homework.id, id));
  }
  const rows = await db.select().from(homework).where(eq(homework.id, id));
  return map(rows[0]);
}

export async function remove(db: Db, id: string): Promise<void> {
  await db.delete(homework).where(eq(homework.id, id));
}

export async function countDue(db: Db, todayIso: string): Promise<number> {
  const rows = await db
    .select()
    .from(homework)
    .where(and(eq(homework.done, false), lte(homework.due, todayIso)));
  return rows.length;
}

export async function listDueToday(db: Db, todayIso: string): Promise<HomeworkRow[]> {
  const rows = await db
    .select()
    .from(homework)
    .where(and(eq(homework.done, false), eq(homework.due, todayIso)));
  return rows.map(map);
}
