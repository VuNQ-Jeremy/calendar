import { eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { staff, students, parents, classStudents, parentStudents } from '../db/schema';
import { chunk, rowsPerStatement, type TenantDb } from '../db';
import type { StudentInput, StaffInput, ParentInput } from '../../shared/schemas';
import { record, recordCreate, recordDelete } from './audit';

/** JSON-shape equality — good enough for these plain assembled rows, and how audit.ts itself
 *  decides an update was a real no-op. */
function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

// ---- Staff ----

export type StaffRow = {
  id: string;
  name: string;
  email: string | null;
  role: string;
  color: string;
  phone: string | null;
};

function mapStaff(r: typeof staff.$inferSelect): StaffRow {
  return { id: r.id, name: r.name, email: r.email, role: r.role, color: r.color, phone: r.phone };
}

export async function listStaff(db: TenantDb): Promise<StaffRow[]> {
  const rows = await db.raw.select().from(staff).where(db.own(staff));
  return rows.map(mapStaff);
}

export async function createStaff(db: TenantDb, input: StaffInput): Promise<StaffRow> {
  const id = crypto.randomUUID();
  await db.insert(staff).values({
    id,
    name: input.name,
    email: input.email ?? null,
    role: input.role,
    color: input.color,
    phone: input.phone ?? null,
  });
  const rows = await db.raw
    .select()
    .from(staff)
    .where(db.own(staff, eq(staff.id, id)));
  const row = mapStaff(rows[0]);
  recordCreate('staff', id, row);
  return row;
}

export async function updateStaff(
  db: TenantDb,
  id: string,
  patch: Partial<StaffInput>,
): Promise<StaffRow> {
  const beforeRows = await db.raw
    .select()
    .from(staff)
    .where(db.own(staff, eq(staff.id, id)));
  const before = beforeRows[0] ? mapStaff(beforeRows[0]) : undefined;

  const set: Partial<typeof staff.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.email !== undefined) set.email = patch.email ?? null;
  if (patch.role !== undefined) set.role = patch.role;
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.phone !== undefined) set.phone = patch.phone ?? null;
  if (Object.keys(set).length) await db.update(staff, set, eq(staff.id, id));
  const rows = await db.raw
    .select()
    .from(staff)
    .where(db.own(staff, eq(staff.id, id)));
  const after = mapStaff(rows[0]);
  if (!sameJson(before, after)) {
    record({ action: 'update', entityType: 'staff', entityId: id, before, after });
  }
  return after;
}

export async function removeStaff(db: TenantDb, id: string): Promise<void> {
  await recordDelete(db, 'staff', staff, id);
  await db.delete(staff, eq(staff.id, id));
}

// ---- Students ----

export type StudentRow = {
  id: string;
  name: string;
  grade: string | null;
  guardian: string | null;
  email: string | null;
  color: string;
  classIds: string[];
};

function assembleStudent(
  s: typeof students.$inferSelect,
  csRows: (typeof classStudents.$inferSelect)[],
): StudentRow {
  return {
    id: s.id,
    name: s.name,
    grade: s.grade,
    guardian: s.guardian,
    email: s.email,
    color: s.color,
    classIds: csRows.filter((cs) => cs.studentId === s.id).map((cs) => cs.classId),
  };
}

export async function listStudents(db: TenantDb): Promise<StudentRow[]> {
  const [sRows, csRows] = await db.batch([
    db.raw.select().from(students).where(db.own(students)),
    db.raw.select().from(classStudents).where(db.own(classStudents)),
  ]);
  return sRows.map((s) => assembleStudent(s, csRows));
}

export async function createStudent(db: TenantDb, input: StudentInput): Promise<StudentRow> {
  const id = crypto.randomUUID();
  const ops: BatchItem<'sqlite'>[] = [
    db.insert(students).values({
      id,
      name: input.name,
      grade: input.grade ?? null,
      guardian: input.guardian ?? null,
      email: input.email ?? null,
      color: input.color,
    }),
  ];
  if (input.classIds.length > 0) {
    // The junction gained `tenant_id`, so a single statement now fits 33 rows where it used to fit
    // 50 — D1 caps bound parameters at 100 (see D1_MAX_BOUND_PARAMS). A class of 34 would have
    // started failing with a bare "too many SQL variables"; chunking keeps the write atomic
    // because the pieces still go out in one batch.
    for (const part of chunk(input.classIds, rowsPerStatement(3))) {
      ops.push(
        db.insert(classStudents).values(part.map((cid) => ({ classId: cid, studentId: id }))),
      );
    }
  }
  if (ops.length > 0) await db.batch(ops as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
  const [sRows, csRows] = await db.batch([
    db.raw
      .select()
      .from(students)
      .where(db.own(students, eq(students.id, id))),
    db.raw
      .select()
      .from(classStudents)
      .where(db.own(classStudents, eq(classStudents.studentId, id))),
  ]);
  const row = assembleStudent(sRows[0], csRows);
  recordCreate('student', id, row);
  return row;
}

export async function updateStudent(
  db: TenantDb,
  id: string,
  patch: Partial<StudentInput>,
): Promise<StudentRow> {
  const [beforeSRows, beforeCsRows] = await db.batch([
    db.raw
      .select()
      .from(students)
      .where(db.own(students, eq(students.id, id))),
    db.raw
      .select()
      .from(classStudents)
      .where(db.own(classStudents, eq(classStudents.studentId, id))),
  ]);
  const before = beforeSRows[0] ? assembleStudent(beforeSRows[0], beforeCsRows) : undefined;

  const ops: BatchItem<'sqlite'>[] = [];
  const set: Partial<typeof students.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.grade !== undefined) set.grade = patch.grade ?? null;
  if (patch.guardian !== undefined) set.guardian = patch.guardian ?? null;
  if (patch.email !== undefined) set.email = patch.email ?? null;
  if (patch.color !== undefined) set.color = patch.color;
  if (Object.keys(set).length) ops.push(db.update(students, set, eq(students.id, id)));
  if (patch.classIds !== undefined) {
    ops.push(db.delete(classStudents, eq(classStudents.studentId, id)));
    if (patch.classIds.length > 0) {
      // Same 33-row ceiling as the create path above: tenant_id took a column, so a roster edit
      // of 34+ needs more than one statement.
      for (const part of chunk(patch.classIds, rowsPerStatement(3))) {
        ops.push(
          db.insert(classStudents).values(part.map((cid) => ({ classId: cid, studentId: id }))),
        );
      }
    }
  }
  if (ops.length > 0) await db.batch(ops as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
  const [sRows, csRows] = await db.batch([
    db.raw
      .select()
      .from(students)
      .where(db.own(students, eq(students.id, id))),
    db.raw
      .select()
      .from(classStudents)
      .where(db.own(classStudents, eq(classStudents.studentId, id))),
  ]);
  const after = assembleStudent(sRows[0], csRows);
  if (!sameJson(before, after)) {
    record({ action: 'update', entityType: 'student', entityId: id, before, after });
  }
  return after;
}

export async function removeStudent(db: TenantDb, id: string): Promise<void> {
  // ON DELETE CASCADE on class_students.student_id and parent_students.student_id handles
  // join-table cleanup automatically — folded into `extra` here so it survives into before_json.
  const [classRows, parentRows] = await db.batch([
    db.raw
      .select({ classId: classStudents.classId })
      .from(classStudents)
      .where(db.own(classStudents, eq(classStudents.studentId, id))),
    db.raw
      .select({ parentId: parentStudents.parentId })
      .from(parentStudents)
      .where(db.own(parentStudents, eq(parentStudents.studentId, id))),
  ]);
  await recordDelete(db, 'student', students, id, {
    classIds: classRows.map((r) => r.classId),
    parentIds: parentRows.map((r) => r.parentId),
  });
  await db.delete(students, eq(students.id, id));
}

// ---- Parents ----

export type ParentRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  color: string;
  relation: string | null;
  studentIds: string[];
};

function assembleParent(
  p: typeof parents.$inferSelect,
  psRows: (typeof parentStudents.$inferSelect)[],
): ParentRow {
  return {
    id: p.id,
    name: p.name,
    email: p.email,
    phone: p.phone,
    color: p.color,
    relation: p.relation,
    studentIds: psRows.filter((ps) => ps.parentId === p.id).map((ps) => ps.studentId),
  };
}

export async function listParents(db: TenantDb): Promise<ParentRow[]> {
  const [pRows, psRows] = await db.batch([
    db.raw.select().from(parents).where(db.own(parents)),
    db.raw.select().from(parentStudents).where(db.own(parentStudents)),
  ]);
  return pRows.map((p) => assembleParent(p, psRows));
}

export async function createParent(db: TenantDb, input: ParentInput): Promise<ParentRow> {
  const id = crypto.randomUUID();
  const ops: BatchItem<'sqlite'>[] = [
    db.insert(parents).values({
      id,
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      color: input.color,
      relation: input.relation ?? null,
    }),
  ];
  if (input.studentIds.length > 0) {
    // The junction gained `tenant_id`, so a single statement now fits 33 rows where it used to fit
    // 50 — D1 caps bound parameters at 100 (see D1_MAX_BOUND_PARAMS). A class of 34 would have
    // started failing with a bare "too many SQL variables"; chunking keeps the write atomic
    // because the pieces still go out in one batch.
    for (const part of chunk(input.studentIds, rowsPerStatement(3))) {
      ops.push(
        db.insert(parentStudents).values(part.map((sid) => ({ parentId: id, studentId: sid }))),
      );
    }
  }
  if (ops.length > 0) await db.batch(ops as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
  const [pRows, psRows] = await db.batch([
    db.raw
      .select()
      .from(parents)
      .where(db.own(parents, eq(parents.id, id))),
    db.raw
      .select()
      .from(parentStudents)
      .where(db.own(parentStudents, eq(parentStudents.parentId, id))),
  ]);
  const row = assembleParent(pRows[0], psRows);
  recordCreate('parent', id, row);
  return row;
}

export async function updateParent(
  db: TenantDb,
  id: string,
  patch: Partial<ParentInput>,
): Promise<ParentRow> {
  const [beforePRows, beforePsRows] = await db.batch([
    db.raw
      .select()
      .from(parents)
      .where(db.own(parents, eq(parents.id, id))),
    db.raw
      .select()
      .from(parentStudents)
      .where(db.own(parentStudents, eq(parentStudents.parentId, id))),
  ]);
  const before = beforePRows[0] ? assembleParent(beforePRows[0], beforePsRows) : undefined;

  const ops: BatchItem<'sqlite'>[] = [];
  const set: Partial<typeof parents.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.email !== undefined) set.email = patch.email ?? null;
  if (patch.phone !== undefined) set.phone = patch.phone ?? null;
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.relation !== undefined) set.relation = patch.relation ?? null;
  if (Object.keys(set).length) ops.push(db.update(parents, set, eq(parents.id, id)));
  if (patch.studentIds !== undefined) {
    ops.push(db.delete(parentStudents, eq(parentStudents.parentId, id)));
    if (patch.studentIds.length > 0) {
      // Same 33-row ceiling as the create path above: tenant_id took a column, so a roster edit
      // of 34+ needs more than one statement.
      for (const part of chunk(patch.studentIds, rowsPerStatement(3))) {
        ops.push(
          db.insert(parentStudents).values(part.map((sid) => ({ parentId: id, studentId: sid }))),
        );
      }
    }
  }
  if (ops.length > 0) await db.batch(ops as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
  const [pRows, psRows] = await db.batch([
    db.raw
      .select()
      .from(parents)
      .where(db.own(parents, eq(parents.id, id))),
    db.raw
      .select()
      .from(parentStudents)
      .where(db.own(parentStudents, eq(parentStudents.parentId, id))),
  ]);
  const after = assembleParent(pRows[0], psRows);
  if (!sameJson(before, after)) {
    record({ action: 'update', entityType: 'parent', entityId: id, before, after });
  }
  return after;
}

export async function removeParent(db: TenantDb, id: string): Promise<void> {
  // ON DELETE CASCADE on parent_students.parent_id handles join-table cleanup — folded into
  // `extra` here so the linked children survive into before_json.
  const linkRows = await db.raw
    .select({ studentId: parentStudents.studentId })
    .from(parentStudents)
    .where(db.own(parentStudents, eq(parentStudents.parentId, id)));
  await recordDelete(db, 'parent', parents, id, { studentIds: linkRows.map((r) => r.studentId) });
  await db.delete(parents, eq(parents.id, id));
}

export async function findParent(db: TenantDb, id: string): Promise<ParentRow | null> {
  const [pRows, psRows] = await db.batch([
    db.raw
      .select()
      .from(parents)
      .where(db.own(parents, eq(parents.id, id))),
    db.raw
      .select()
      .from(parentStudents)
      .where(db.own(parentStudents, eq(parentStudents.parentId, id))),
  ]);
  return pRows[0] ? assembleParent(pRows[0], psRows) : null;
}

/**
 * Just the linked children's ids. Cheaper than `findParent` when the parent's own row is not
 * needed — which is every authorization check in the parent portal, where this set IS the
 * permission list.
 */
export async function studentIdsOfParent(db: TenantDb, parentId: string): Promise<string[]> {
  const rows = await db.raw
    .select({ studentId: parentStudents.studentId })
    .from(parentStudents)
    .where(db.own(parentStudents, eq(parentStudents.parentId, parentId)));
  return rows.map((r) => r.studentId);
}

/**
 * Add one child to a parent who already exists — the sibling case.
 *
 * Deliberately not `updateParent({ studentIds })`: that replaces the whole set, so adding
 * a second child through it would unlink the first. `onConflictDoNothing` because the
 * composite primary key already forbids the duplicate, and re-linking is not an error.
 */
export async function linkParentToStudent(
  db: TenantDb,
  parentId: string,
  studentId: string,
): Promise<void> {
  await db.insert(parentStudents).values({ parentId, studentId }).onConflictDoNothing();
  // An unaudited write before this — meta'd rather than a full before/after snapshot, since the
  // join has no independent identity beyond the two ids it connects.
  record({
    action: 'update',
    entityType: 'parent',
    entityId: parentId,
    meta: { linkedStudentId: studentId },
  });
}
