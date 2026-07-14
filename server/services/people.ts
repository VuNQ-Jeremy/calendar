import { eq } from 'drizzle-orm';
import { staff, students, parents, classStudents, parentStudents } from '../db/schema';
import type { Db } from '../db/index';
import type { StudentInput, StaffInput, ParentInput } from '../../shared/schemas';

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

export async function listStaff(db: Db): Promise<StaffRow[]> {
  const rows = await db.select().from(staff);
  return rows.map(mapStaff);
}

export async function createStaff(db: Db, input: StaffInput): Promise<StaffRow> {
  const id = crypto.randomUUID();
  await db.insert(staff).values({
    id,
    name: input.name,
    email: input.email ?? null,
    role: input.role,
    color: input.color,
    phone: input.phone ?? null,
  });
  const rows = await db.select().from(staff).where(eq(staff.id, id));
  return mapStaff(rows[0]);
}

export async function updateStaff(
  db: Db,
  id: string,
  patch: Partial<StaffInput>,
): Promise<StaffRow> {
  const set: Partial<typeof staff.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.email !== undefined) set.email = patch.email ?? null;
  if (patch.role !== undefined) set.role = patch.role;
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.phone !== undefined) set.phone = patch.phone ?? null;
  if (Object.keys(set).length) await db.update(staff).set(set).where(eq(staff.id, id));
  const rows = await db.select().from(staff).where(eq(staff.id, id));
  return mapStaff(rows[0]);
}

export async function removeStaff(db: Db, id: string): Promise<void> {
  await db.delete(staff).where(eq(staff.id, id));
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

export async function listStudents(db: Db): Promise<StudentRow[]> {
  const [sRows, csRows] = await db.batch([
    db.select().from(students),
    db.select().from(classStudents),
  ]);
  return sRows.map((s) => assembleStudent(s, csRows));
}

export async function createStudent(db: Db, input: StudentInput): Promise<StudentRow> {
  const id = crypto.randomUUID();
  const ops: Parameters<typeof db.batch>[0] = [
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
    ops.push(
      db
        .insert(classStudents)
        .values(input.classIds.map((cid) => ({ classId: cid, studentId: id }))),
    );
  }
  await db.batch(ops as Parameters<typeof db.batch>[0]);
  const [sRows, csRows] = await db.batch([
    db.select().from(students).where(eq(students.id, id)),
    db.select().from(classStudents).where(eq(classStudents.studentId, id)),
  ]);
  return assembleStudent(sRows[0], csRows);
}

export async function updateStudent(
  db: Db,
  id: string,
  patch: Partial<StudentInput>,
): Promise<StudentRow> {
  const ops: Parameters<typeof db.batch>[0] = [];
  const set: Partial<typeof students.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.grade !== undefined) set.grade = patch.grade ?? null;
  if (patch.guardian !== undefined) set.guardian = patch.guardian ?? null;
  if (patch.email !== undefined) set.email = patch.email ?? null;
  if (patch.color !== undefined) set.color = patch.color;
  if (Object.keys(set).length) ops.push(db.update(students).set(set).where(eq(students.id, id)));
  if (patch.classIds !== undefined) {
    ops.push(db.delete(classStudents).where(eq(classStudents.studentId, id)));
    if (patch.classIds.length > 0) {
      ops.push(
        db
          .insert(classStudents)
          .values(patch.classIds.map((cid) => ({ classId: cid, studentId: id }))),
      );
    }
  }
  if (ops.length > 0) await db.batch(ops as Parameters<typeof db.batch>[0]);
  const [sRows, csRows] = await db.batch([
    db.select().from(students).where(eq(students.id, id)),
    db.select().from(classStudents).where(eq(classStudents.studentId, id)),
  ]);
  return assembleStudent(sRows[0], csRows);
}

export async function removeStudent(db: Db, id: string): Promise<void> {
  await db.batch([
    db.delete(classStudents).where(eq(classStudents.studentId, id)),
    db.delete(parentStudents).where(eq(parentStudents.studentId, id)),
    db.delete(students).where(eq(students.id, id)),
  ]);
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

export async function listParents(db: Db): Promise<ParentRow[]> {
  const [pRows, psRows] = await db.batch([
    db.select().from(parents),
    db.select().from(parentStudents),
  ]);
  return pRows.map((p) => assembleParent(p, psRows));
}

export async function createParent(db: Db, input: ParentInput): Promise<ParentRow> {
  const id = crypto.randomUUID();
  const ops: Parameters<typeof db.batch>[0] = [
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
    ops.push(
      db
        .insert(parentStudents)
        .values(input.studentIds.map((sid) => ({ parentId: id, studentId: sid }))),
    );
  }
  await db.batch(ops as Parameters<typeof db.batch>[0]);
  const [pRows, psRows] = await db.batch([
    db.select().from(parents).where(eq(parents.id, id)),
    db.select().from(parentStudents).where(eq(parentStudents.parentId, id)),
  ]);
  return assembleParent(pRows[0], psRows);
}

export async function updateParent(
  db: Db,
  id: string,
  patch: Partial<ParentInput>,
): Promise<ParentRow> {
  const ops: Parameters<typeof db.batch>[0] = [];
  const set: Partial<typeof parents.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.email !== undefined) set.email = patch.email ?? null;
  if (patch.phone !== undefined) set.phone = patch.phone ?? null;
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.relation !== undefined) set.relation = patch.relation ?? null;
  if (Object.keys(set).length) ops.push(db.update(parents).set(set).where(eq(parents.id, id)));
  if (patch.studentIds !== undefined) {
    ops.push(db.delete(parentStudents).where(eq(parentStudents.parentId, id)));
    if (patch.studentIds.length > 0) {
      ops.push(
        db
          .insert(parentStudents)
          .values(patch.studentIds.map((sid) => ({ parentId: id, studentId: sid }))),
      );
    }
  }
  if (ops.length > 0) await db.batch(ops as Parameters<typeof db.batch>[0]);
  const [pRows, psRows] = await db.batch([
    db.select().from(parents).where(eq(parents.id, id)),
    db.select().from(parentStudents).where(eq(parentStudents.parentId, id)),
  ]);
  return assembleParent(pRows[0], psRows);
}

export async function removeParent(db: Db, id: string): Promise<void> {
  await db.batch([
    db.delete(parentStudents).where(eq(parentStudents.parentId, id)),
    db.delete(parents).where(eq(parents.id, id)),
  ]);
}
