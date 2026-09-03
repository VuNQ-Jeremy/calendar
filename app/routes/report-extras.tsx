import type { LoaderFunctionArgs } from 'react-router';
import { tenantDbFor } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as attendanceSvc from '../../server/services/attendance';
import * as gardenSvc from '../../server/services/garden';
import * as checkinSvc from '../../server/services/checkin';
import * as practiceSvc from '../../server/services/practice';
import { TuitionMonth } from '../../shared/schemas';

/**
 * Attendance, vocabulary homework and practice for one (student, month) — the report rail.
 *
 * Cookie-authenticated twin pattern of routes/garden-month.tsx, for the same reason: everything
 * under /api/* authenticates by `Authorization: Bearer` only, so a browser `useFetcher().load`
 * (cookie, no header) would 401 and the cards would silently vanish. Query params over path
 * segments, matching that twin. The `{ data }` envelope matches it too, so the card's `error`
 * branch (drop the cards, keep the report) works the same way.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const session = await requireStaff(request, env);
  const db = tenantDbFor(env, session);

  const url = new URL(request.url);
  const studentId = url.searchParams.get('student');
  if (!studentId) return Response.json({ error: 'missing_student' }, { status: 400 });
  const parsed = TuitionMonth.safeParse(url.searchParams.get('month'));
  if (!parsed.success) return Response.json({ error: 'bad_month' }, { status: 400 });

  const checkinSettings = await checkinSvc.getCheckinSettings(db);
  const [attendance, homework, tuiMu, practice] = await Promise.all([
    attendanceSvc.studentMonthAttendance(db, studentId, parsed.data),
    gardenSvc.studentAssignmentsInMonth(db, studentId, parsed.data),
    checkinSettings.showParentReport
      ? checkinSvc.studentMonthTally(db, studentId, parsed.data)
      : Promise.resolve(null),
    practiceSvc.studentPracticeForReport(db, studentId, parsed.data).catch(() => null),
  ]);
  return { data: { attendance, homework, tuiMu, practice } };
}
