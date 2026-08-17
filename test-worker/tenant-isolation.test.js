import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { createRawDb } from '../server/db/internal';
import { TenantDb, PRIMARY_TENANT_ID } from '../server/db/index';
import { classes, settings, students, subjects, tenants } from '../server/db/schema';
import * as classesSvc from '../server/services/classes';
import * as peopleSvc from '../server/services/people';
import * as subjectsSvc from '../server/services/subjects';
import { readSchoolJson, writeSchoolJson } from '../server/services/user-settings';

/**
 * The tenancy fence, against real D1.
 *
 * `test/tenant-scope.test.ts` proves every service *spells* the predicate; this proves the
 * predicate actually holds once two schools' rows share a table. Everything below runs through
 * the ordinary service functions rather than hand-written SQL, because the fence is only worth
 * anything if it survives the assembly steps (`classes.list` fetches the whole junction and
 * joins in JS — exactly the shape that leaks if `class_students` is read unscoped).
 *
 * School A is the original school every other spec in this suite acts as; school B is created
 * here and torn down at the end.
 */

/** Unique per run so a leaked row from an earlier run can never make this pass by accident. */
const OTHER_TENANT_ID = `tnt_e2e_${crypto.randomUUID().slice(0, 8)}`;

const raw = () => createRawDb(env);
/** School A — the original school. */
const dbA = () => new TenantDb(raw(), PRIMARY_TENANT_ID);
/** School B — the neighbour that must never see anything of A's, nor A of its. */
const dbB = () => new TenantDb(raw(), OTHER_TENANT_ID);

/** Names carry the run id so assertions can scope past whatever else the file has seeded. */
const stamp = crypto.randomUUID().slice(0, 8);
const SHARED_SUBJECT_NAME = `Toán ${stamp}`;

let aClass;
let aStudent;
let bClass;
let bStudent;

beforeAll(async () => {
  // The six managed enums and the k/v tables have a real FK to `tenants(id)`, so the school row
  // has to exist before anything can be inserted for it.
  await raw()
    .insert(tenants)
    .values({
      id: OTHER_TENANT_ID,
      slug: `e2e-${stamp}`,
      name: 'Other School',
      status: 'active',
      verified: false,
      createdAt: new Date().toISOString(),
    });

  aStudent = await peopleSvc.createStudent(dbA(), {
    name: `A Student ${stamp}`,
    color: 'blue',
    classIds: [],
  });
  aClass = await classesSvc.create(dbA(), {
    name: `A Class ${stamp}`,
    color: 'green',
    studentIds: [aStudent.id],
  });

  bStudent = await peopleSvc.createStudent(dbB(), {
    name: `B Student ${stamp}`,
    color: 'rose',
    classIds: [],
  });
  bClass = await classesSvc.create(dbB(), {
    name: `B Class ${stamp}`,
    color: 'violet',
    studentIds: [bStudent.id],
  });
});

afterAll(async () => {
  // B's own rows first — `classes`/`students` carry no FK to `tenants`, so the cascade on the
  // school row would leave them behind as orphans that the next run's assertions would see.
  const b = dbB();
  await b.delete(classes);
  await b.delete(students);
  await b.delete(subjects);
  await b.delete(settings);
  await raw().delete(tenants).where(eq(tenants.id, OTHER_TENANT_ID));

  const a = dbA();
  await a.delete(classes, eq(classes.id, aClass.id));
  await a.delete(students, eq(students.id, aStudent.id));
  await a.delete(subjects, eq(subjects.name, SHARED_SUBJECT_NAME));
  await a.delete(settings, eq(settings.key, `iso-${stamp}`));
});

describe('a scoped handle never returns the other school’s rows', () => {
  it('classes.list is fenced in both directions', async () => {
    const fromA = await classesSvc.list(dbA());
    expect(fromA.map((c) => c.id)).toContain(aClass.id);
    expect(fromA.map((c) => c.id)).not.toContain(bClass.id);

    const fromB = await classesSvc.list(dbB());
    expect(fromB.map((c) => c.id)).toEqual([bClass.id]);
  });

  it('the roster assembled from class_students does not leak across the fence', async () => {
    // The junction is fetched whole and joined in JS, so an unscoped read here would show up as
    // B's student appearing on A's class rather than as an extra row in the list.
    const [aRow] = (await classesSvc.list(dbA())).filter((c) => c.id === aClass.id);
    expect(aRow.studentIds).toEqual([aStudent.id]);
    const [bRow] = await classesSvc.list(dbB());
    expect(bRow.studentIds).toEqual([bStudent.id]);
  });

  it('people.listStudents is fenced in both directions', async () => {
    const fromA = (await peopleSvc.listStudents(dbA())).map((s) => s.id);
    expect(fromA).toContain(aStudent.id);
    expect(fromA).not.toContain(bStudent.id);

    const fromB = await peopleSvc.listStudents(dbB());
    expect(fromB.map((s) => s.id)).toEqual([bStudent.id]);
  });

  it('classes.get on the other school’s id returns null, not the row', async () => {
    // The ids are real and guessable — a class id travels in URLs — so this is the case an
    // attacker actually has: a valid id, the wrong school.
    expect(await classesSvc.get(dbA(), bClass.id)).toBeNull();
    expect(await classesSvc.get(dbB(), aClass.id)).toBeNull();
  });
});

describe('a write aimed at the other school hits nothing', () => {
  it('update leaves the other school’s class exactly as it was', async () => {
    await classesSvc.update(dbA(), bClass.id, { name: 'Hijacked', color: 'cocoa' });

    const survivor = await classesSvc.get(dbB(), bClass.id);
    expect(survivor).not.toBeNull();
    expect(survivor.name).toBe(`B Class ${stamp}`);
    expect(survivor.color).toBe('violet');
  });

  it('remove leaves the other school’s class and its roster in place', async () => {
    await classesSvc.remove(dbA(), bClass.id);

    const survivor = await classesSvc.get(dbB(), bClass.id);
    expect(survivor).not.toBeNull();
    expect(survivor.studentIds).toEqual([bStudent.id]);
  });

  it('removeStudent cannot reach the other school’s student', async () => {
    await peopleSvc.removeStudent(dbA(), bStudent.id);
    expect((await peopleSvc.listStudents(dbB())).map((s) => s.id)).toEqual([bStudent.id]);
  });
});

describe('the composite constraints', () => {
  it('lets both schools have a subject of the same name', async () => {
    // This is what UNIQUE(tenant_id, name) bought: before the rebuild, the second insert would
    // have failed on the sqlite_autoindex and the second school could never have a "Toán".
    const inA = await subjectsSvc.create(dbA(), { name: SHARED_SUBJECT_NAME, active: true });
    const inB = await subjectsSvc.create(dbB(), { name: SHARED_SUBJECT_NAME, active: true });
    expect(inA.id).not.toBe(inB.id);

    // ...and each school sees exactly one of them.
    const namedInA = (await subjectsSvc.list(dbA())).filter((s) => s.name === SHARED_SUBJECT_NAME);
    const namedInB = (await subjectsSvc.list(dbB())).filter((s) => s.name === SHARED_SUBJECT_NAME);
    expect(namedInA.map((s) => s.id)).toEqual([inA.id]);
    expect(namedInB.map((s) => s.id)).toEqual([inB.id]);
  });

  it('keeps a settings row private to the school that wrote it', async () => {
    // `settings` is PK (tenant_id, key) now. Same key, two schools, two independent values —
    // and the second write must not clobber the first.
    const key = `iso-${stamp}`;
    const fallback = { note: 'default' };

    await writeSchoolJson(dbA(), key, { note: 'A only' });
    expect(await readSchoolJson(dbB(), key, fallback)).toEqual(fallback);

    await writeSchoolJson(dbB(), key, { note: 'B only' });
    expect(await readSchoolJson(dbA(), key, fallback)).toEqual({ note: 'A only' });
    expect(await readSchoolJson(dbB(), key, fallback)).toEqual({ note: 'B only' });
  });
});
