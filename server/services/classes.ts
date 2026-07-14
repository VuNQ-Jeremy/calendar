import { eq, inArray } from 'drizzle-orm';
import { classes, classSchedule, classStudents } from '../db/schema';
import type { Db } from '../db/index';
import type { ClassInput } from '../../shared/schemas';

export type ClassRow = {
  id: string;
  name: string;
  subject: string | null;
  color: string;
  room: string | null;
  schedule: { day: number; start: string; end: string }[];
  studentIds: string[];
};

export type ClassLite = { id: string; name: string; color: string };

function assembleClass(
  cls: typeof classes.$inferSelect,
  schedRows: (typeof classSchedule.$inferSelect)[],
  csRows: (typeof classStudents.$inferSelect)[],
): ClassRow {
  return {
    id: cls.id,
    name: cls.name,
    subject: cls.subject,
    color: cls.color,
    room: cls.room,
    schedule: schedRows
      .filter((s) => s.classId === cls.id)
      .map((s) => ({ day: s.day, start: s.startTime, end: s.endTime })),
    studentIds: csRows.filter((cs) => cs.classId === cls.id).map((cs) => cs.studentId),
  };
}

export async function list(db: Db): Promise<ClassRow[]> {
  const [clsRows, schedRows, csRows] = await db.batch([
    db.select().from(classes),
    db.select().from(classSchedule),
    db.select().from(classStudents),
  ]);
  return clsRows.map((c) => assembleClass(c, schedRows, csRows));
}

export async function listLite(db: Db): Promise<ClassLite[]> {
  return db.select({ id: classes.id, name: classes.name, color: classes.color }).from(classes);
}

export async function get(db: Db, id: string): Promise<ClassRow | null> {
  const [clsRows, schedRows, csRows] = await db.batch([
    db.select().from(classes).where(eq(classes.id, id)),
    db.select().from(classSchedule).where(eq(classSchedule.classId, id)),
    db.select().from(classStudents).where(eq(classStudents.classId, id)),
  ]);
  if (!clsRows[0]) return null;
  return assembleClass(clsRows[0], schedRows, csRows);
}

export async function create(db: Db, input: ClassInput): Promise<ClassRow> {
  const id = crypto.randomUUID();

  const ops: Parameters<typeof db.batch>[0] = [
    db.insert(classes).values({
      id,
      name: input.name,
      subject: input.subject ?? null,
      color: input.color,
      room: input.room ?? null,
    }),
  ];

  if (input.schedule.length > 0) {
    ops.push(
      db.insert(classSchedule).values(
        input.schedule.map((s) => ({
          classId: id,
          day: s.day,
          startTime: s.start,
          endTime: s.end,
        })),
      ),
    );
  }

  if (input.studentIds.length > 0) {
    ops.push(
      db
        .insert(classStudents)
        .values(input.studentIds.map((sid) => ({ classId: id, studentId: sid }))),
    );
  }

  await db.batch(ops as Parameters<typeof db.batch>[0]);
  const result = await get(db, id);
  return result!;
}

export async function update(db: Db, id: string, input: Partial<ClassInput>): Promise<ClassRow> {
  const ops: Parameters<typeof db.batch>[0] = [];

  const scalarSet: Partial<typeof classes.$inferInsert> = {};
  if (input.name !== undefined) scalarSet.name = input.name;
  if (input.subject !== undefined) scalarSet.subject = input.subject ?? null;
  if (input.color !== undefined) scalarSet.color = input.color;
  if (input.room !== undefined) scalarSet.room = input.room ?? null;
  if (Object.keys(scalarSet).length) {
    ops.push(db.update(classes).set(scalarSet).where(eq(classes.id, id)));
  }

  if (input.schedule !== undefined) {
    ops.push(db.delete(classSchedule).where(eq(classSchedule.classId, id)));
    if (input.schedule.length > 0) {
      ops.push(
        db.insert(classSchedule).values(
          input.schedule.map((s) => ({
            classId: id,
            day: s.day,
            startTime: s.start,
            endTime: s.end,
          })),
        ),
      );
    }
  }

  if (input.studentIds !== undefined) {
    ops.push(db.delete(classStudents).where(eq(classStudents.classId, id)));
    if (input.studentIds.length > 0) {
      ops.push(
        db
          .insert(classStudents)
          .values(input.studentIds.map((sid) => ({ classId: id, studentId: sid }))),
      );
    }
  }

  if (ops.length > 0) await db.batch(ops as Parameters<typeof db.batch>[0]);
  const result = await get(db, id);
  return result!;
}

export async function remove(db: Db, id: string): Promise<void> {
  // ON DELETE CASCADE handles class_schedule and class_students rows.
  // Events and homework FK is ON DELETE SET NULL (handled by D1 FK or we do it explicitly).
  await db.delete(classes).where(eq(classes.id, id));
}

export async function countByIds(db: Db, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db.select().from(classes).where(inArray(classes.id, ids));
  return rows.length;
}
