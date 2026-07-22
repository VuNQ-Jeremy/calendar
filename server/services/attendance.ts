import { eq, and } from 'drizzle-orm';
import { attendanceRecords } from '../db/schema';
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
