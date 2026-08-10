import { eq, and, gte, lte, desc, isNotNull } from 'drizzle-orm';
import { attendanceRecords, classes, events } from '../db/schema';
import type { Db } from '../db/index';

export type AttendanceRow = {
  eventId: string;
  studentId: string;
  date: string;
  status: string;
};

function map(r: typeof attendanceRecords.$inferSelect): AttendanceRow {
  return {
    eventId: r.eventId,
    studentId: r.studentId,
    date: r.date,
    status: r.status,
  };
}

/** One past session as a family sees it: when it was, what it was, and whether the child came. */
export type AttendanceHistoryRow = {
  eventId: string;
  date: string;
  status: string;
  eventTitle: string;
  startTime: string | null;
  endTime: string | null;
  classId: string | null;
  className: string | null;
};

/**
 * One child's attendance over a date range, newest first — the parent portal's history list.
 *
 * The event join is what makes a row readable: `attendance_records` knows only (event, date,
 * status), so the title and time come from `events`, and the class name from a LEFT join because
 * an event need not belong to a class.
 *
 * Sibling of `studentMonthAttendance` below, which answers a different question: that one counts
 * statuses per class for the monthly report ("18 present, 1 late"), this one lists the sessions
 * themselves so a parent can see WHICH day was missed.
 *
 * Unlike `studentMonthAttendance` and `rankings.listMonthAttendance`, ad-hoc sessions with no
 * class are KEPT. Those two drop them because a summary is per-class and an ad-hoc one-off
 * belongs to no roll; here they are simply sessions the child was marked at, and hiding them
 * would make the list disagree with the family's own memory.
 *
 * `from`/`to` are inclusive ICT dates (YYYY-MM-DD) and compare as strings, like every other
 * date filter here. Covered by idx_attendance_student (student_id, date).
 */
export async function historyForStudent(
  db: Db,
  studentId: string,
  range: { from: string; to: string },
): Promise<AttendanceHistoryRow[]> {
  const rows = await db
    .select({
      eventId: attendanceRecords.eventId,
      date: attendanceRecords.date,
      status: attendanceRecords.status,
      eventTitle: events.title,
      startTime: events.startTime,
      endTime: events.endTime,
      classId: events.classId,
      className: classes.name,
    })
    .from(attendanceRecords)
    .innerJoin(events, eq(attendanceRecords.eventId, events.id))
    .leftJoin(classes, eq(events.classId, classes.id))
    .where(
      and(
        eq(attendanceRecords.studentId, studentId),
        gte(attendanceRecords.date, range.from),
        lte(attendanceRecords.date, range.to),
      ),
    )
    .orderBy(desc(attendanceRecords.date), desc(events.startTime));
  return rows;
}

export async function listForOccurrence(
  db: Db,
  eventId: string,
  date: string,
): Promise<AttendanceRow[]> {
  const rows = await db
    .select()
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.eventId, eventId), eq(attendanceRecords.date, date)));
  return rows.map(map);
}

// Delete-then-insert: lets a student be "unmarked" simply by omitting them from `records`.
// Known caveat: if a recurring event's base weekday/date is edited later, previously saved
// occurrence rows keep their old dates as harmless orphans (cascaded away on event delete).
export async function saveOccurrence(
  db: Db,
  eventId: string,
  date: string,
  records: { studentId: string; status: string }[],
): Promise<AttendanceRow[]> {
  const del = db
    .delete(attendanceRecords)
    .where(and(eq(attendanceRecords.eventId, eventId), eq(attendanceRecords.date, date)));

  if (records.length) {
    await db.batch([
      del,
      db.insert(attendanceRecords).values(
        records.map((r) => ({
          eventId,
          date,
          studentId: r.studentId,
          status: r.status,
        })),
      ),
    ]);
  } else {
    await del;
  }

  return listForOccurrence(db, eventId, date);
}

/** One student's month of roll-calls folded per class — the attendance block on the monthly report. */
export type ClassAttendanceSummary = {
  classId: string;
  className: string;
  /** status -> count; only statuses that occurred are present. */
  counts: Record<string, number>;
  total: number;
};

/**
 * `attendance_records` has no class column, so the class comes from the event — the same join
 * tuition bills from (tuition.ts computeMonthLines) and the leaderboard reads (rankings.ts
 * listMonthAttendance). Rows on an event with no class are dropped: an ad-hoc one-off is not
 * part of any class roll. Month range is the project convention `${month}-01`..`${month}-31`,
 * compared lexically (dates are zero-padded).
 */
export async function studentMonthAttendance(
  db: Db,
  studentId: string,
  month: string,
): Promise<ClassAttendanceSummary[]> {
  const rows = await db
    .select({
      classId: events.classId,
      className: classes.name,
      status: attendanceRecords.status,
    })
    .from(attendanceRecords)
    .innerJoin(events, eq(attendanceRecords.eventId, events.id))
    .innerJoin(classes, eq(classes.id, events.classId))
    .where(
      and(
        eq(attendanceRecords.studentId, studentId),
        gte(attendanceRecords.date, `${month}-01`),
        lte(attendanceRecords.date, `${month}-31`),
        isNotNull(events.classId),
      ),
    );

  const byClass = new Map<string, ClassAttendanceSummary>();
  for (const r of rows) {
    if (!r.classId) continue; // the inner join already excluded these; narrowing for TypeScript
    let s = byClass.get(r.classId);
    if (!s) {
      s = { classId: r.classId, className: r.className, counts: {}, total: 0 };
      byClass.set(r.classId, s);
    }
    s.counts[r.status] = (s.counts[r.status] ?? 0) + 1;
    s.total += 1;
  }
  return [...byClass.values()].sort((a, b) => a.className.localeCompare(b.className));
}
