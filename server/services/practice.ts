/**
 * Practice (Nhiệm vụ): the teacher's daily task plan per class, the per-student copies students
 * submit against, and the miss economy (excuses, quota, escalating ×N badge).
 *
 * Rules live in shared/logic/practice.ts. This module is the only writer of the practice_* tables;
 * the nightly finalize job in practice-notify.ts calls into it and never touches rows directly.
 * Dates are ICT 'YYYY-MM-DD'; the caller supplies "today" (the Worker clock is UTC).
 */
import { asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { chunk, rowsPerStatement, type TenantDb } from '../db';
import {
  behaviorRecords,
  classes,
  classStudents,
  events,
  materials,
  practiceDayOverrides,
  practiceExcuses,
  practiceMisses,
  practiceSettings,
  practiceStudentTasks,
  practiceTasks,
  practiceWarnings,
} from '../db/schema';
import { record, recordCreate, recordDelete } from './audit';
import * as classesSvc from './classes';
import {
  applyUnexcusedMiss,
  clearPending,
  clearWarning,
  dayIsComplete,
  defaultWeekdaysFromEvents,
  DONE_STATUSES,
  EMPTY_WARNING,
  isPracticeDay,
  monthSummary,
  nextPracticeDay,
  parseQuickAddLines,
  practiceDaysInRange,
  prevMonth,
  undoMiss,
  type MonthSummary,
  type WarningLike,
} from '../../shared/logic/practice';
import type {
  PracticeDayOverrideInput,
  PracticeExcuseDecideInput,
  PracticeExcuseMissInput,
  PracticeExcuseRequestInput,
  PracticeQuickAddInput,
  PracticeReviewInput,
  PracticeSettingsInput,
  PracticeSubmitInput,
  PracticeTaskInput,
} from '../../shared/schemas';

// ---------------------------------------------------------------------------
// Row types (the web loaders and the API return these)
// ---------------------------------------------------------------------------

export type PracticeSettingsRow = { classId: string; enabled: boolean; weekdays: string };
export type DayOverrideRow = { date: string; isPractice: boolean };
export type PracticeTaskRow = {
  id: string;
  classId: string;
  date: string;
  title: string;
  materialId: string | null;
  url: string | null;
  proofType: string;
  sortOrder: number;
};
export type StudentTaskRow = {
  id: string;
  taskId: string | null;
  classId: string;
  studentId: string;
  date: string;
  title: string;
  materialId: string | null;
  url: string | null;
  proofType: string;
  sortOrder: number;
  status: string;
  submittedAt: string | null;
  timeFrom: string | null;
  timeTo: string | null;
  mediaKey: string | null;
  mediaType: string | null;
  note: string | null;
  feedback: string | null;
  rejectReason: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  recordedByTeacher: boolean;
};
export type ExcuseRow = {
  id: string;
  classId: string;
  studentId: string;
  date: string;
  reason: string;
  status: string;
  requestedBy: string;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
};
export type MissRow = {
  id: string;
  classId: string;
  studentId: string;
  date: string;
  excused: boolean;
  multiplier: number;
  behaviorRecordId: string | null;
  createdAt: string;
};
export type WarningRow = WarningLike & {
  classId: string;
  studentId: string;
  clearedAt: string | null;
};

/** The API/task shape the phone reads — the row plus the two names it cannot resolve itself. */
export type ApiTaskRow = {
  id: string;
  classId: string;
  className: string;
  date: string;
  title: string;
  materialId: string | null;
  materialTitle: string | null;
  url: string | null;
  proofType: string;
  status: string;
  submittedAt: string | null;
  timeFrom: string | null;
  timeTo: string | null;
  mediaPath: string | null;
  mediaType: string | null;
  note: string | null;
  feedback: string | null;
  rejectReason: string | null;
  recordedByTeacher: boolean;
};

const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Settings + practice days
// ---------------------------------------------------------------------------

export async function listSettings(db: TenantDb): Promise<PracticeSettingsRow[]> {
  const rows = await db.raw.select().from(practiceSettings).where(db.own(practiceSettings));
  return rows.map((r) => ({ classId: r.classId, enabled: r.enabled, weekdays: r.weekdays }));
}

export async function getSettings(
  db: TenantDb,
  classId: string,
): Promise<PracticeSettingsRow | null> {
  const [r] = await db.raw
    .select()
    .from(practiceSettings)
    .where(db.own(practiceSettings, eq(practiceSettings.classId, classId)));
  return r ? { classId: r.classId, enabled: r.enabled, weekdays: r.weekdays } : null;
}

/**
 * Enable (or re-save) Practice for a class. On FIRST enable with no explicit weekdays the mask is
 * derived from the class's recurring events (Mon–Sat minus class days) — see shared/logic.
 */
export async function saveSettings(
  db: TenantDb,
  input: PracticeSettingsInput,
  todayIct: string,
  explicitWeekdays: boolean,
): Promise<PracticeSettingsRow> {
  const existing = await getSettings(db, input.classId);
  let weekdays = input.weekdays;
  if (!existing && !explicitWeekdays) {
    const evs = await db.raw
      .select({
        date: events.date,
        recurrence: events.recurrence,
        until: events.until,
        exdates: events.exdates,
      })
      .from(events)
      .where(db.own(events, eq(events.classId, input.classId)));
    weekdays = defaultWeekdaysFromEvents(
      evs.map((e) => ({ ...e, exdates: parseExdates(e.exdates) })),
      todayIct,
    );
  }
  if (existing) {
    await db.update(
      practiceSettings,
      { enabled: input.enabled, weekdays },
      eq(practiceSettings.classId, input.classId),
    );
    record({
      action: 'update',
      entityType: 'practice_settings',
      entityId: input.classId,
      before: existing,
      after: { classId: input.classId, enabled: input.enabled, weekdays },
    });
  } else {
    await db
      .insert(practiceSettings)
      .values({ classId: input.classId, enabled: input.enabled, weekdays, createdAt: nowIso() });
    recordCreate('practice_settings', input.classId, { ...input, weekdays });
  }
  return { classId: input.classId, enabled: input.enabled, weekdays };
}

/** `events.exdates` is TEXT holding a JSON array; a corrupt value must not break enabling. */
function parseExdates(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

export async function listOverrides(
  db: TenantDb,
  classId: string,
  from: string,
  to: string,
): Promise<DayOverrideRow[]> {
  const rows = await db.raw
    .select()
    .from(practiceDayOverrides)
    .where(
      db.own(
        practiceDayOverrides,
        eq(practiceDayOverrides.classId, classId),
        gte(practiceDayOverrides.date, from),
        lte(practiceDayOverrides.date, to),
      ),
    );
  return rows.map((r) => ({ date: r.date, isPractice: r.isPractice }));
}

export async function setOverride(db: TenantDb, input: PracticeDayOverrideInput): Promise<void> {
  await db.delete(
    practiceDayOverrides,
    eq(practiceDayOverrides.classId, input.classId),
    eq(practiceDayOverrides.date, input.date),
  );
  if (input.isPractice !== null && input.isPractice !== undefined) {
    await db
      .insert(practiceDayOverrides)
      .values({ classId: input.classId, date: input.date, isPractice: input.isPractice });
  }
  record({
    action: 'update',
    entityType: 'practice_day',
    entityId: `${input.classId}:${input.date}`,
    after: input,
  });
}

/** Practice days for a class in [from, to] — the single source for grid, cron and phone. */
export async function practiceDays(
  db: TenantDb,
  classId: string,
  from: string,
  to: string,
): Promise<string[]> {
  const [settings, overrides] = await Promise.all([
    getSettings(db, classId),
    listOverrides(db, classId, from, to),
  ]);
  return practiceDaysInRange(settings, overrides, from, to);
}

// ---------------------------------------------------------------------------
// Tasks and copies
// ---------------------------------------------------------------------------

const mapTask = (r: typeof practiceTasks.$inferSelect): PracticeTaskRow => ({
  id: r.id,
  classId: r.classId,
  date: r.date,
  title: r.title,
  materialId: r.materialId ?? null,
  url: r.url ?? null,
  proofType: r.proofType,
  sortOrder: r.sortOrder,
});

const mapStudentTask = (r: typeof practiceStudentTasks.$inferSelect): StudentTaskRow => ({
  id: r.id,
  taskId: r.taskId ?? null,
  classId: r.classId,
  studentId: r.studentId,
  date: r.date,
  title: r.title,
  materialId: r.materialId ?? null,
  url: r.url ?? null,
  proofType: r.proofType,
  sortOrder: r.sortOrder,
  status: r.status,
  submittedAt: r.submittedAt ?? null,
  timeFrom: r.timeFrom ?? null,
  timeTo: r.timeTo ?? null,
  mediaKey: r.mediaKey ?? null,
  mediaType: r.mediaType ?? null,
  note: r.note ?? null,
  feedback: r.feedback ?? null,
  rejectReason: r.rejectReason ?? null,
  reviewedAt: r.reviewedAt ?? null,
  reviewedBy: r.reviewedBy ?? null,
  recordedByTeacher: r.recordedByTeacher,
});

/** The one place a stored row becomes the phone's shape, so both practice API routes agree. */
export function toApiTask(
  row: StudentTaskRow,
  className: string,
  materialTitle: string | null,
): ApiTaskRow {
  return {
    id: row.id,
    classId: row.classId,
    className,
    date: row.date,
    title: row.title,
    materialId: row.materialId,
    materialTitle,
    url: row.url,
    proofType: row.proofType,
    status: row.status,
    submittedAt: row.submittedAt,
    timeFrom: row.timeFrom,
    timeTo: row.timeTo,
    mediaPath: row.mediaKey ? `/practice-media/${encodeURIComponent(row.mediaKey)}` : null,
    mediaType: row.mediaType,
    note: row.note,
    feedback: row.feedback,
    rejectReason: row.rejectReason,
    recordedByTeacher: row.recordedByTeacher,
  };
}

export async function listTasks(
  db: TenantDb,
  classId: string,
  from: string,
  to: string,
): Promise<PracticeTaskRow[]> {
  const rows = await db.raw
    .select()
    .from(practiceTasks)
    .where(
      db.own(
        practiceTasks,
        eq(practiceTasks.classId, classId),
        gte(practiceTasks.date, from),
        lte(practiceTasks.date, to),
      ),
    )
    .orderBy(asc(practiceTasks.date), asc(practiceTasks.sortOrder));
  return rows.map(mapTask);
}

export async function listStudentTasks(
  db: TenantDb,
  classId: string,
  from: string,
  to: string,
): Promise<StudentTaskRow[]> {
  const rows = await db.raw
    .select()
    .from(practiceStudentTasks)
    .where(
      db.own(
        practiceStudentTasks,
        eq(practiceStudentTasks.classId, classId),
        gte(practiceStudentTasks.date, from),
        lte(practiceStudentTasks.date, to),
      ),
    )
    .orderBy(asc(practiceStudentTasks.date), asc(practiceStudentTasks.sortOrder));
  return rows.map(mapStudentTask);
}

export async function listStudentTasksFor(
  db: TenantDb,
  studentId: string,
  from: string,
  to: string,
): Promise<StudentTaskRow[]> {
  const rows = await db.raw
    .select()
    .from(practiceStudentTasks)
    .where(
      db.own(
        practiceStudentTasks,
        eq(practiceStudentTasks.studentId, studentId),
        gte(practiceStudentTasks.date, from),
        lte(practiceStudentTasks.date, to),
      ),
    )
    .orderBy(asc(practiceStudentTasks.date), asc(practiceStudentTasks.sortOrder));
  return rows.map(mapStudentTask);
}

export async function getStudentTask(db: TenantDb, id: string): Promise<StudentTaskRow | null> {
  const [r] = await db.raw
    .select()
    .from(practiceStudentTasks)
    .where(db.own(practiceStudentTasks, eq(practiceStudentTasks.id, id)));
  return r ? mapStudentTask(r) : null;
}

async function rosterIds(db: TenantDb, classId: string): Promise<string[]> {
  const rows = await db.raw
    .select({ id: classStudents.studentId })
    .from(classStudents)
    .where(db.own(classStudents, eq(classStudents.classId, classId)));
  return rows.map((r) => r.id);
}

async function nextSortOrder(db: TenantDb, classId: string, date: string): Promise<number> {
  const [r] = await db.raw
    .select({ n: sql<number>`coalesce(max(${practiceTasks.sortOrder}), -1)` })
    .from(practiceTasks)
    .where(db.own(practiceTasks, eq(practiceTasks.classId, classId), eq(practiceTasks.date, date)));
  return (r?.n ?? -1) + 1;
}

/**
 * Create one task. With `studentId` it is a per-student task: one copy, no class row.
 * Otherwise a class row plus one copy per enrolled student (chunked: 12 columns → 8 rows/stmt).
 */
export async function createTask(
  db: TenantDb,
  input: PracticeTaskInput,
  staffId: string | null,
): Promise<PracticeTaskRow | StudentTaskRow> {
  const created = nowIso();
  const base = {
    classId: input.classId,
    date: input.date,
    title: input.title,
    materialId: input.materialId ?? null,
    url: input.url ?? null,
    proofType: input.proofType,
  };
  const sortOrder = await nextSortOrder(db, input.classId, input.date);
  if (input.studentId) {
    const id = crypto.randomUUID();
    await db
      .insert(practiceStudentTasks)
      .values({ id, taskId: null, studentId: input.studentId, sortOrder, ...base });
    recordCreate('practice_task', id, { ...base, studentId: input.studentId });
    return (await getStudentTask(db, id))!;
  }
  const id = crypto.randomUUID();
  const roster = await rosterIds(db, input.classId);
  const ops: BatchItem<'sqlite'>[] = [
    db.insert(practiceTasks).values({ id, staffId, sortOrder, createdAt: created, ...base }),
  ];
  for (const part of chunk(roster, rowsPerStatement(12))) {
    ops.push(
      db.insert(practiceStudentTasks).values(
        part.map((studentId) => ({
          id: crypto.randomUUID(),
          taskId: id,
          studentId,
          sortOrder,
          ...base,
        })),
      ),
    );
  }
  await db.batch(ops as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
  recordCreate('practice_task', id, { ...base, copies: roster.length });
  return { id, sortOrder, ...base };
}

export async function quickAdd(
  db: TenantDb,
  input: PracticeQuickAddInput,
  staffId: string | null,
): Promise<PracticeTaskRow[]> {
  const out: PracticeTaskRow[] = [];
  for (const title of parseQuickAddLines(input.lines)) {
    out.push(
      (await createTask(
        db,
        {
          classId: input.classId,
          date: input.date,
          title,
          materialId: input.materialId,
          url: null,
          proofType: input.proofType,
          studentId: null,
        },
        staffId,
      )) as PracticeTaskRow,
    );
  }
  return out;
}

/** Edit a class task; the change propagates to copies still `open` (decision #8). */
export async function updateTask(
  db: TenantDb,
  id: string,
  patch: Partial<Pick<PracticeTaskInput, 'title' | 'materialId' | 'url' | 'proofType'>>,
): Promise<void> {
  const set: Partial<typeof practiceTasks.$inferInsert> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.materialId !== undefined) set.materialId = patch.materialId ?? null;
  if (patch.url !== undefined) set.url = patch.url ?? null;
  if (patch.proofType !== undefined) set.proofType = patch.proofType;
  if (!Object.keys(set).length) return;
  await db.update(practiceTasks, set, eq(practiceTasks.id, id));
  await db.update(
    practiceStudentTasks,
    set,
    eq(practiceStudentTasks.taskId, id),
    eq(practiceStudentTasks.status, 'open'),
  );
  record({ action: 'update', entityType: 'practice_task', entityId: id, after: set });
}

/** Delete a class task: open copies go, submitted copies survive with task_id NULL (FK SET NULL). */
export async function deleteTask(db: TenantDb, id: string): Promise<void> {
  await recordDelete(db, 'practice_task', practiceTasks, id);
  await db.delete(
    practiceStudentTasks,
    eq(practiceStudentTasks.taskId, id),
    eq(practiceStudentTasks.status, 'open'),
  );
  await db.delete(practiceTasks, eq(practiceTasks.id, id));
}

/** Remove one student's copy (per-student override). Only `open` copies may be removed. */
export async function removeStudentTask(db: TenantDb, id: string): Promise<void> {
  await recordDelete(db, 'practice_task', practiceStudentTasks, id, { kind: 'copy' });
  await db.delete(
    practiceStudentTasks,
    eq(practiceStudentTasks.id, id),
    eq(practiceStudentTasks.status, 'open'),
  );
}

// ---------------------------------------------------------------------------
// Submission + review
// ---------------------------------------------------------------------------

export function mediaKeyFor(tenantId: string, studentTaskId: string, ext: string): string {
  return `t/${tenantId}/practice/${studentTaskId}/${crypto.randomUUID()}.${ext}`;
}

/**
 * Student submits (or resubmits after a rejection). Allowed while the task's date is >= todayIct
 * (before the 00:00 deadline). The route stores the media in R2 first and passes the key here.
 */
export async function submit(
  db: TenantDb,
  studentId: string,
  input: PracticeSubmitInput,
  media: { key: string; type: string } | null,
  todayIct: string,
): Promise<StudentTaskRow> {
  const row = await getStudentTask(db, input.studentTaskId);
  if (!row || row.studentId !== studentId) throw new Error('not_found');
  if (row.date < todayIct) throw new Error('deadline_passed');
  if (row.status === 'accepted' || row.status === 'teacher_done') throw new Error('already_done');
  if (row.proofType !== 'none' && !media && !row.mediaKey) throw new Error('proof_required');
  if (media && row.proofType === 'photo' && !media.type.startsWith('image/')) {
    throw new Error('wrong_proof');
  }
  if (media && row.proofType === 'video' && !media.type.startsWith('video/')) {
    throw new Error('wrong_proof');
  }
  await db.update(
    practiceStudentTasks,
    {
      status: 'submitted',
      submittedAt: nowIso(),
      timeFrom: input.timeFrom ?? null,
      timeTo: input.timeTo ?? null,
      note: input.note ?? null,
      rejectReason: null,
      recordedByTeacher: false,
      ...(media ? { mediaKey: media.key, mediaType: media.type } : {}),
    },
    eq(practiceStudentTasks.id, row.id),
  );
  record({
    action: 'update',
    entityType: 'practice_submission',
    entityId: row.id,
    after: { status: 'submitted' },
  });
  return (await getStudentTask(db, row.id))!;
}

export async function review(
  db: TenantDb,
  input: PracticeReviewInput,
  staffId: string,
): Promise<StudentTaskRow> {
  const row = await getStudentTask(db, input.studentTaskId);
  if (!row) throw new Error('not_found');
  const at = nowIso();
  const set: Partial<typeof practiceStudentTasks.$inferInsert> = {
    reviewedAt: at,
    reviewedBy: staffId,
  };
  if (input.decision === 'accept') set.status = 'accepted';
  if (input.decision === 'reject') {
    set.status = 'rejected';
    set.rejectReason = input.rejectReason ?? null;
  }
  if (input.decision === 'teacher_done') {
    set.status = 'teacher_done';
    set.recordedByTeacher = true;
    set.submittedAt = row.submittedAt ?? at;
  }
  if (input.feedback !== undefined) set.feedback = input.feedback ?? null;
  await db.update(practiceStudentTasks, set, eq(practiceStudentTasks.id, row.id));
  record({ action: 'update', entityType: 'practice_submission', entityId: row.id, after: set });
  return (await getStudentTask(db, row.id))!;
}

/** The review queue: submitted copies newest first, across all classes. */
export async function reviewQueue(db: TenantDb, limit = 200): Promise<StudentTaskRow[]> {
  const rows = await db.raw
    .select()
    .from(practiceStudentTasks)
    .where(db.own(practiceStudentTasks, eq(practiceStudentTasks.status, 'submitted')))
    .orderBy(desc(practiceStudentTasks.submittedAt))
    .limit(limit);
  return rows.map(mapStudentTask);
}

// ---------------------------------------------------------------------------
// Excuses
// ---------------------------------------------------------------------------

const mapExcuse = (r: typeof practiceExcuses.$inferSelect): ExcuseRow => ({
  id: r.id,
  classId: r.classId,
  studentId: r.studentId,
  date: r.date,
  reason: r.reason,
  status: r.status,
  requestedBy: r.requestedBy,
  requestedAt: r.requestedAt,
  decidedAt: r.decidedAt ?? null,
  decidedBy: r.decidedBy ?? null,
});

/** Student asks before the deadline (date >= today). One request per day; a re-request replaces a rejected one. */
export async function requestExcuse(
  db: TenantDb,
  studentId: string,
  input: PracticeExcuseRequestInput,
  todayIct: string,
): Promise<ExcuseRow> {
  if (input.date < todayIct) throw new Error('deadline_passed');
  const enrolled = (await rosterIds(db, input.classId)).includes(studentId);
  if (!enrolled) throw new Error('not_found');
  // One request per day (UNIQUE). A pending or approved one stands; only a rejected one is
  // replaced below — otherwise the insert would surface as a raw constraint error (a 500).
  const standing = (
    await listExcuses(db, { classId: input.classId, studentId, from: input.date, to: input.date })
  ).find((e) => e.status !== 'rejected');
  if (standing) throw new Error('already_requested');
  await db.delete(
    practiceExcuses,
    eq(practiceExcuses.classId, input.classId),
    eq(practiceExcuses.studentId, studentId),
    eq(practiceExcuses.date, input.date),
    eq(practiceExcuses.status, 'rejected'),
  );
  const id = crypto.randomUUID();
  await db.insert(practiceExcuses).values({
    id,
    classId: input.classId,
    studentId,
    date: input.date,
    reason: input.reason,
    status: 'pending',
    requestedBy: 'student',
    requestedAt: nowIso(),
  });
  recordCreate('practice_excuse', id, { ...input, studentId });
  const [r] = await db.raw
    .select()
    .from(practiceExcuses)
    .where(db.own(practiceExcuses, eq(practiceExcuses.id, id)));
  return mapExcuse(r);
}

export async function listExcuses(
  db: TenantDb,
  opts: { status?: string; studentId?: string; classId?: string; from?: string; to?: string },
): Promise<ExcuseRow[]> {
  const rows = await db.raw
    .select()
    .from(practiceExcuses)
    .where(
      db.own(
        practiceExcuses,
        opts.status ? eq(practiceExcuses.status, opts.status) : undefined,
        opts.studentId ? eq(practiceExcuses.studentId, opts.studentId) : undefined,
        opts.classId ? eq(practiceExcuses.classId, opts.classId) : undefined,
        opts.from ? gte(practiceExcuses.date, opts.from) : undefined,
        opts.to ? lte(practiceExcuses.date, opts.to) : undefined,
      ),
    )
    .orderBy(desc(practiceExcuses.requestedAt));
  return rows.map(mapExcuse);
}

/** Teacher decides a pending request. Approving after the miss was already finalized flips the miss too. */
export async function decideExcuse(
  db: TenantDb,
  input: PracticeExcuseDecideInput,
  staffId: string,
): Promise<ExcuseRow> {
  const [r] = await db.raw
    .select()
    .from(practiceExcuses)
    .where(db.own(practiceExcuses, eq(practiceExcuses.id, input.excuseId)));
  if (!r) throw new Error('not_found');
  const status = input.decision === 'approve' ? 'approved' : 'rejected';
  await db.update(
    practiceExcuses,
    { status, decidedAt: nowIso(), decidedBy: staffId },
    eq(practiceExcuses.id, r.id),
  );
  if (status === 'approved') {
    const [miss] = await db.raw
      .select()
      .from(practiceMisses)
      .where(
        db.own(
          practiceMisses,
          eq(practiceMisses.classId, r.classId),
          eq(practiceMisses.studentId, r.studentId),
          eq(practiceMisses.date, r.date),
        ),
      );
    if (miss && !miss.excused) await flipMissToExcused(db, miss.id);
  }
  record({ action: 'update', entityType: 'practice_excuse', entityId: r.id, after: { status } });
  return mapExcuse({ ...r, status });
}

/** Teacher excuses an existing miss directly (decision #18, after the deadline). */
export async function excuseMiss(
  db: TenantDb,
  input: PracticeExcuseMissInput,
  staffId: string,
): Promise<void> {
  const [miss] = await db.raw
    .select()
    .from(practiceMisses)
    .where(db.own(practiceMisses, eq(practiceMisses.id, input.missId)));
  if (!miss) throw new Error('not_found');
  if (miss.excused) return;
  await db.delete(
    practiceExcuses,
    eq(practiceExcuses.classId, miss.classId),
    eq(practiceExcuses.studentId, miss.studentId),
    eq(practiceExcuses.date, miss.date),
  );
  await db.insert(practiceExcuses).values({
    id: crypto.randomUUID(),
    classId: miss.classId,
    studentId: miss.studentId,
    date: miss.date,
    reason: input.reason,
    status: 'approved',
    requestedBy: 'teacher',
    requestedAt: nowIso(),
    decidedAt: nowIso(),
    decidedBy: staffId,
  });
  await flipMissToExcused(db, miss.id);
}

async function flipMissToExcused(db: TenantDb, missId: string): Promise<void> {
  const [miss] = await db.raw
    .select()
    .from(practiceMisses)
    .where(db.own(practiceMisses, eq(practiceMisses.id, missId)));
  if (!miss || miss.excused) return;
  await db.update(practiceMisses, { excused: true, multiplier: 0 }, eq(practiceMisses.id, missId));
  const w = await getWarning(db, miss.classId, miss.studentId);
  await saveWarning(db, miss.classId, miss.studentId, undoMiss(w, missId));
  // The behavior row was written for an unexcused miss; an excused one is not an incident.
  if (miss.behaviorRecordId) {
    await recordDelete(db, 'assessment', behaviorRecords, miss.behaviorRecordId, {
      kind: 'behavior',
      reason: 'practice miss excused',
    });
    await db.delete(behaviorRecords, eq(behaviorRecords.id, miss.behaviorRecordId));
    await db.update(practiceMisses, { behaviorRecordId: null }, eq(practiceMisses.id, missId));
  }
  record({
    action: 'update',
    entityType: 'practice_miss',
    entityId: missId,
    after: { excused: true },
  });
}

// ---------------------------------------------------------------------------
// Misses + warnings
// ---------------------------------------------------------------------------

const mapMiss = (r: typeof practiceMisses.$inferSelect): MissRow => ({
  id: r.id,
  classId: r.classId,
  studentId: r.studentId,
  date: r.date,
  excused: r.excused,
  multiplier: r.multiplier,
  behaviorRecordId: r.behaviorRecordId ?? null,
  createdAt: r.createdAt,
});

export async function listMisses(
  db: TenantDb,
  opts: { classId?: string; studentId?: string; from?: string; to?: string },
): Promise<MissRow[]> {
  const rows = await db.raw
    .select()
    .from(practiceMisses)
    .where(
      db.own(
        practiceMisses,
        opts.classId ? eq(practiceMisses.classId, opts.classId) : undefined,
        opts.studentId ? eq(practiceMisses.studentId, opts.studentId) : undefined,
        opts.from ? gte(practiceMisses.date, opts.from) : undefined,
        opts.to ? lte(practiceMisses.date, opts.to) : undefined,
      ),
    )
    .orderBy(asc(practiceMisses.date));
  return rows.map(mapMiss);
}

export async function getWarning(
  db: TenantDb,
  classId: string,
  studentId: string,
): Promise<WarningRow> {
  const [r] = await db.raw
    .select()
    .from(practiceWarnings)
    .where(
      db.own(
        practiceWarnings,
        eq(practiceWarnings.classId, classId),
        eq(practiceWarnings.studentId, studentId),
      ),
    );
  if (!r) return { ...EMPTY_WARNING, classId, studentId, clearedAt: null };
  return {
    classId,
    studentId,
    level: r.level,
    pendingMultiplier: r.pendingMultiplier,
    pendingForDate: r.pendingForDate ?? null,
    pendingFromMiss: r.pendingFromMiss ?? null,
    clearedAt: r.clearedAt ?? null,
  };
}

export async function listWarnings(db: TenantDb, classId: string): Promise<WarningRow[]> {
  const rows = await db.raw
    .select()
    .from(practiceWarnings)
    .where(db.own(practiceWarnings, eq(practiceWarnings.classId, classId)));
  return rows.map((r) => ({
    classId: r.classId,
    studentId: r.studentId,
    level: r.level,
    pendingMultiplier: r.pendingMultiplier,
    pendingForDate: r.pendingForDate ?? null,
    pendingFromMiss: r.pendingFromMiss ?? null,
    clearedAt: r.clearedAt ?? null,
  }));
}

async function saveWarning(
  db: TenantDb,
  classId: string,
  studentId: string,
  w: WarningLike,
  cleared?: { by: string },
): Promise<void> {
  const existing = await db.raw
    .select({ classId: practiceWarnings.classId })
    .from(practiceWarnings)
    .where(
      db.own(
        practiceWarnings,
        eq(practiceWarnings.classId, classId),
        eq(practiceWarnings.studentId, studentId),
      ),
    );
  const set = {
    level: w.level,
    pendingMultiplier: w.pendingMultiplier,
    pendingForDate: w.pendingForDate,
    pendingFromMiss: w.pendingFromMiss,
    updatedAt: nowIso(),
    ...(cleared ? { clearedAt: nowIso(), clearedBy: cleared.by } : {}),
  };
  if (existing.length) {
    await db.update(
      practiceWarnings,
      set,
      eq(practiceWarnings.classId, classId),
      eq(practiceWarnings.studentId, studentId),
    );
  } else {
    await db.insert(practiceWarnings).values({ classId, studentId, ...set });
  }
}

export async function clearStudentWarning(
  db: TenantDb,
  classId: string,
  studentId: string,
  staffId: string,
): Promise<void> {
  await saveWarning(db, classId, studentId, clearWarning(), { by: staffId });
  record({
    action: 'update',
    entityType: 'practice_warning',
    entityId: `${classId}:${studentId}`,
    after: { level: 0 },
  });
}

export type FinalizeOutcome = {
  classId: string;
  studentId: string;
  date: string;
  excused: boolean;
  multiplier: number;
  nextDay: string | null;
  missId: string;
};

/**
 * Finalize one practice day for one class (called by the nightly job with yesterday's ICT date).
 * Idempotent: a (class, student, date) that already has a miss row is skipped; a day that was
 * complete clears any pending ×N due that day. Returns the misses created this call.
 */
export async function finalizeDay(
  db: TenantDb,
  classId: string,
  date: string,
): Promise<FinalizeOutcome[]> {
  const [settings, overrides, farOverrides] = await Promise.all([
    getSettings(db, classId),
    listOverrides(db, classId, date, date),
    listOverrides(db, classId, date, addDaysStr(date, 60)),
  ]);
  // A day that cannot be judged — a day off, or a practice day the teacher left empty — must not
  // strand a ×N debt that was due on it: the debt moves to the next practice day instead.
  if (!isPracticeDay(settings, overrides, date)) {
    await shiftPendingDebts(db, classId, date, settings, farOverrides);
    return [];
  }
  const copies = await listStudentTasks(db, classId, date, date);
  if (!copies.length) {
    await shiftPendingDebts(db, classId, date, settings, farOverrides);
    return [];
  }
  const byStudent = new Map<string, StudentTaskRow[]>();
  for (const c of copies) byStudent.set(c.studentId, [...(byStudent.get(c.studentId) ?? []), c]);
  // A student with a debt due today but no copy today (e.g. removed per-student) is judged like an
  // empty day for them: the debt shifts rather than sticking to a date that will never be finalized.
  for (const w of await listWarnings(db, classId)) {
    if (w.pendingForDate === date && !byStudent.has(w.studentId)) {
      await saveWarning(db, classId, w.studentId, {
        ...w,
        pendingForDate: nextPracticeDay(settings, farOverrides, date),
      });
    }
  }
  const existing = await listMisses(db, { classId, from: date, to: date });
  const approved = new Set(
    (await listExcuses(db, { classId, status: 'approved', from: date, to: date })).map(
      (e) => e.studentId,
    ),
  );
  const out: FinalizeOutcome[] = [];
  for (const [studentId, tasks] of byStudent) {
    const w = await getWarning(db, classId, studentId);
    if (dayIsComplete(tasks, date)) {
      if (w.pendingForDate === date) await saveWarning(db, classId, studentId, clearPending(w));
      continue;
    }
    if (existing.some((m) => m.studentId === studentId)) continue;
    const excused = approved.has(studentId);
    const missId = crypto.randomUUID();
    const nextDay = nextPracticeDay(settings, farOverrides, date);
    let multiplier = 0;
    let behaviorRecordId: string | null = null;
    if (!excused) {
      const nw = applyUnexcusedMiss(w, missId, nextDay);
      multiplier = nw.pendingMultiplier;
      await saveWarning(db, classId, studentId, nw);
      behaviorRecordId = crypto.randomUUID();
      await db.insert(behaviorRecords).values({
        id: behaviorRecordId,
        studentId,
        classId,
        date,
        type: 'missing_practice',
        notes: `Practice ${date}: ${tasks.filter((t) => !DONE_STATUSES.has(t.status)).length}/${tasks.length} tasks not submitted`,
      });
      recordCreate('assessment', behaviorRecordId, {
        kind: 'behavior',
        type: 'missing_practice',
        studentId,
        date,
      });
    } else if (w.pendingForDate === date) {
      // An excused ×N day: the debt moves to the next practice day rather than being forgiven.
      await saveWarning(db, classId, studentId, { ...w, pendingForDate: nextDay });
    }
    await db.insert(practiceMisses).values({
      id: missId,
      classId,
      studentId,
      date,
      excused,
      multiplier,
      behaviorRecordId,
      createdAt: nowIso(),
    });
    recordCreate('practice_miss', missId, { classId, studentId, date, excused, multiplier });
    out.push({ classId, studentId, date, excused, multiplier, nextDay, missId });
  }
  return out;
}

/** Move every ×N debt due on `date` to the next practice day (see finalizeDay). */
async function shiftPendingDebts(
  db: TenantDb,
  classId: string,
  date: string,
  settings: PracticeSettingsRow | null,
  farOverrides: DayOverrideRow[],
): Promise<void> {
  const due = (await listWarnings(db, classId)).filter((w) => w.pendingForDate === date);
  if (!due.length) return;
  const nextDay = nextPracticeDay(settings, farOverrides, date);
  for (const w of due) {
    await saveWarning(db, classId, w.studentId, { ...w, pendingForDate: nextDay });
  }
}

function addDaysStr(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Summaries (ledger, phone, parent)
// ---------------------------------------------------------------------------

export async function studentMonthSummary(
  db: TenantDb,
  classId: string,
  studentId: string,
  month: string,
): Promise<MonthSummary> {
  const from = `${prevMonth(month)}-01`;
  const to = `${month}-31`;
  const [tasks, misses, warning, prevDays] = await Promise.all([
    listStudentTasksFor(db, studentId, `${month}-01`, to).then((r) =>
      r.filter((t) => t.classId === classId),
    ),
    listMisses(db, { classId, studentId, from, to }),
    getWarning(db, classId, studentId),
    practiceDays(db, classId, from, `${prevMonth(month)}-31`),
  ]);
  return monthSummary(month, tasks, misses, warning, prevDays.length > 0);
}

export type LedgerRow = {
  studentId: string;
  studentName: string;
  summary: MonthSummary;
  misses: MissRow[];
  hasZalo: boolean;
};

/** One row per enrolled student for the ledger page. `hasZalo` is filled by the route. */
export async function classLedger(
  db: TenantDb,
  classId: string,
  month: string,
): Promise<Omit<LedgerRow, 'hasZalo'>[]> {
  const roster = await classesSvc.listRosterNames(db);
  const mine = roster.filter((r) => r.classId === classId);
  const out: Omit<LedgerRow, 'hasZalo'>[] = [];
  for (const s of mine) {
    const [summary, misses] = await Promise.all([
      studentMonthSummary(db, classId, s.id, month),
      listMisses(db, { classId, studentId: s.id, from: `${month}-01`, to: `${month}-31` }),
    ]);
    out.push({ studentId: s.id, studentName: s.name, summary, misses });
  }
  return out;
}

/** Enabled classes the student is enrolled in. */
export async function enabledClassesFor(
  db: TenantDb,
  studentId: string,
): Promise<{ classId: string; className: string }[]> {
  return db.raw
    .select({ classId: classes.id, className: classes.name })
    .from(classStudents)
    .innerJoin(classes, eq(classes.id, classStudents.classId))
    .innerJoin(practiceSettings, eq(practiceSettings.classId, classes.id))
    .where(
      db.own(
        classStudents,
        eq(classStudents.studentId, studentId),
        eq(practiceSettings.enabled, true),
      ),
    );
}

/** Material titles for a set of ids (for row decoration). */
export async function materialTitles(db: TenantDb, ids: string[]): Promise<Map<string, string>> {
  const clean = [...new Set(ids.filter(Boolean))];
  if (!clean.length) return new Map();
  const rows = await db.raw
    .select({ id: materials.id, title: materials.title })
    .from(materials)
    .where(db.own(materials, inArray(materials.id, clean)));
  return new Map(rows.map((r) => [r.id, r.title]));
}

/** For the parent slip: summary + up to 5 recent feedback lines, or null when not enrolled anywhere. */
export async function studentPracticeForReport(
  db: TenantDb,
  studentId: string,
  month: string,
): Promise<{
  summary: MonthSummary;
  feedback: { date: string; title: string; feedback: string }[];
} | null> {
  const enabled = await enabledClassesFor(db, studentId);
  if (!enabled.length) return null;
  // One class per student is the norm; with several, sum the task counts and take the worst warning.
  const parts = await Promise.all(
    enabled.map((c) => studentMonthSummary(db, c.classId, studentId, month)),
  );
  const summary = parts.slice(1).reduce(
    (acc, p) => ({
      ...acc,
      doneTasks: acc.doneTasks + p.doneTasks,
      totalTasks: acc.totalTasks + p.totalTasks,
      excusedUsed: acc.excusedUsed + p.excusedUsed,
      excusedQuota: Math.max(acc.excusedQuota, p.excusedQuota),
      unexcused: acc.unexcused + p.unexcused,
      level: Math.max(acc.level, p.level),
      pendingMultiplier: Math.max(acc.pendingMultiplier, p.pendingMultiplier),
      pendingForDate:
        p.pendingMultiplier > acc.pendingMultiplier ? p.pendingForDate : acc.pendingForDate,
    }),
    { ...parts[0] },
  );
  const tasks = await listStudentTasksFor(db, studentId, `${month}-01`, `${month}-31`);
  const feedback = tasks
    .filter((t) => t.feedback && t.feedback.trim())
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 5)
    .map((t) => ({ date: t.date, title: t.title, feedback: t.feedback! }));
  return { summary, feedback };
}
