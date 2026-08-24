import { asc, eq, inArray } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { classes, classStudents, events, students } from '../db/schema';
import * as subjectsSvc from './subjects';
import { chunk, rowsPerStatement, type TenantDb } from '../db';
import type { ClassInput } from '../../shared/schemas';
import { record, recordCreate, recordDelete } from './audit';

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Which subject row a write means.
 *
 * `subjectId` is the real field. `subject` is the legacy free-text one an older mobile build
 * still sends: it is resolved to a managed row by name, and a name that matches nothing returns
 * undefined — "leave the subject alone" — so a stale client cannot blank it or invent a row.
 */
async function resolveSubjectId(
  db: TenantDb,
  input: Partial<ClassInput>,
): Promise<string | null | undefined> {
  if (input.subjectId !== undefined) return input.subjectId ?? null;
  if (input.subject === undefined) return undefined;
  if (!input.subject) return null; // an explicit clear from an older client
  return (await subjectsSvc.findByName(db, input.subject))?.id;
}

/**
 * `class_schedule` is deliberately absent from every read below. Weekly schedules were a
 * phone-only editor with no web counterpart; the field is gone from the product and the table
 * is dormant, kept only so the decision stays reversible without a migration.
 */
export type ClassRow = {
  id: string;
  name: string;
  /**
   * LEGACY free text, still returned so an older mobile build has something to show. The live
   * value is `subjectId`; this is whatever the class was called before subjects were managed.
   */
  subject: string | null;
  subjectId: string | null;
  color: string;
  /** Competition cohort (khối, trình độ). Either half null → the class sits out cohort rankings. */
  gradeLevelId: string | null;
  classLevelId: string | null;
  studentIds: string[];
};

export type ClassLite = {
  id: string;
  name: string;
  color: string;
  subjectId: string | null;
  gradeLevelId: string | null;
  classLevelId: string | null;
};

function assembleClass(
  cls: typeof classes.$inferSelect,
  csRows: (typeof classStudents.$inferSelect)[],
): ClassRow {
  return {
    id: cls.id,
    name: cls.name,
    subject: cls.subject,
    subjectId: cls.subjectId,
    color: cls.color,
    gradeLevelId: cls.gradeLevelId,
    classLevelId: cls.classLevelId,
    studentIds: csRows.filter((cs) => cs.classId === cls.id).map((cs) => cs.studentId),
  };
}

export async function list(db: TenantDb): Promise<ClassRow[]> {
  const [clsRows, csRows] = await db.batch([
    db.raw.select().from(classes).where(db.own(classes)),
    db.raw.select().from(classStudents).where(db.own(classStudents)),
  ]);
  return clsRows.map((c) => assembleClass(c, csRows));
}

export async function listLite(db: TenantDb): Promise<ClassLite[]> {
  return db.raw
    .select({
      id: classes.id,
      name: classes.name,
      color: classes.color,
      subjectId: classes.subjectId,
      gradeLevelId: classes.gradeLevelId,
      classLevelId: classes.classLevelId,
    })
    .from(classes)
    .where(db.own(classes));
}

/**
 * Every enrolment as (classId, studentId, name) — what a per-class student picker needs and
 * nothing more. Deliberately not `list()` + `listStudents()`: those hand back every column of
 * both tables, and the assign dialog only ever renders a name beside a checkbox.
 */
export async function listRosterNames(
  db: TenantDb,
): Promise<{ classId: string; id: string; name: string }[]> {
  return db.raw
    .select({ classId: classStudents.classId, id: students.id, name: students.name })
    .from(classStudents)
    .innerJoin(students, eq(students.id, classStudents.studentId))
    .where(db.own(classStudents))
    .orderBy(asc(students.name));
}

export async function get(db: TenantDb, id: string): Promise<ClassRow | null> {
  const [clsRows, csRows] = await db.batch([
    db.raw
      .select()
      .from(classes)
      .where(db.own(classes, eq(classes.id, id))),
    db.raw
      .select()
      .from(classStudents)
      .where(db.own(classStudents, eq(classStudents.classId, id))),
  ]);
  if (!clsRows[0]) return null;
  return assembleClass(clsRows[0], csRows);
}

export async function create(db: TenantDb, input: ClassInput): Promise<ClassRow> {
  const id = crypto.randomUUID();
  const subjectId = await resolveSubjectId(db, input);

  const ops: BatchItem<'sqlite'>[] = [
    db.insert(classes).values({
      id,
      name: input.name,
      subjectId: subjectId ?? null,
      color: input.color,
      gradeLevelId: input.gradeLevelId ?? null,
      classLevelId: input.classLevelId ?? null,
    }),
  ];

  if (input.studentIds.length > 0) {
    // tenant_id took one of D1's 100 bound parameters per row, so the roster now fits 33 rows
    // a statement instead of 50. Chunked, still one batch, still atomic.
    for (const part of chunk(input.studentIds, rowsPerStatement(3))) {
      ops.push(
        db.insert(classStudents).values(part.map((sid) => ({ classId: id, studentId: sid }))),
      );
    }
  }

  if (ops.length > 0) await db.batch(ops as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
  const result = await get(db, id);
  recordCreate('class', id, result);
  return result!;
}

export async function update(
  db: TenantDb,
  id: string,
  input: Partial<ClassInput>,
): Promise<ClassRow> {
  const before = await get(db, id);
  const ops: BatchItem<'sqlite'>[] = [];

  const scalarSet: Partial<typeof classes.$inferInsert> = {};
  if (input.name !== undefined) scalarSet.name = input.name;
  const subjectId = await resolveSubjectId(db, input);
  if (subjectId !== undefined) scalarSet.subjectId = subjectId;
  if (input.color !== undefined) scalarSet.color = input.color;
  if (input.gradeLevelId !== undefined) scalarSet.gradeLevelId = input.gradeLevelId ?? null;
  if (input.classLevelId !== undefined) scalarSet.classLevelId = input.classLevelId ?? null;
  if (Object.keys(scalarSet).length) {
    ops.push(db.update(classes, scalarSet, eq(classes.id, id)));
  }

  if (input.studentIds !== undefined) {
    ops.push(db.delete(classStudents, eq(classStudents.classId, id)));
    if (input.studentIds.length > 0) {
      // Same 33-row ceiling as create(): see the comment there.
      for (const part of chunk(input.studentIds, rowsPerStatement(3))) {
        ops.push(
          db.insert(classStudents).values(part.map((sid) => ({ classId: id, studentId: sid }))),
        );
      }
    }
  }

  if (ops.length > 0) await db.batch(ops as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
  const result = await get(db, id);
  if (!sameJson(before, result)) {
    record({ action: 'update', entityType: 'class', entityId: id, before, after: result });
  }
  return result!;
}

export async function remove(db: TenantDb, id: string): Promise<void> {
  // ON DELETE CASCADE handles class_schedule and class_students rows (folded into `extra` via
  // the roster already on `before`). The events and tests FKs are ON DELETE SET NULL, so the
  // class's events are deleted here first — left to the FK they would survive as orphaned
  // personal events on everyone's calendar. Their ids go into `extra` so the audit row still
  // says which ones went. Rows hanging off an event (event_materials, attendance_records,
  // session_previews, checklist_items) cascade with it.
  const before = await get(db, id);
  const owned = await db.raw
    .select({ id: events.id })
    .from(events)
    .where(db.own(events, eq(events.classId, id)));
  await recordDelete(db, 'class', classes, id, {
    studentIds: before?.studentIds ?? [],
    eventIds: owned.map((r) => r.id),
  });
  await db.delete(events, eq(events.classId, id));
  await db.delete(classes, eq(classes.id, id));
}

export async function countByIds(db: TenantDb, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db.raw
    .select()
    .from(classes)
    .where(db.own(classes, inArray(classes.id, ids)));
  return rows.length;
}
