import { fail, withAuth } from '../../server/api/handler';
import * as practiceSvc from '../../server/services/practice';
import { ictDateOf } from '../../shared/logic/tests';

/**
 * GET /api/practice/my — everything the student's Practice tab renders, in one round trip.
 *
 * Student-only: a teacher's Practice screens are web-only (decision #27), and `withAuth('user')`
 * would otherwise hand a staff caller an empty list that looks like a bug.
 *
 * `serverNow`/`todayIct` are returned because the whole feature hinges on the ICT day boundary
 * and the phone's clock is not authoritative — the deadline the app draws must be the one the
 * 00:00 cron will apply.
 */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const loader = withAuth('user', async ({ db, user }) => {
  if (user.kind !== 'student') throw fail('forbidden', 403);
  const studentId = user.user.id;
  const now = new Date();
  const today = ictDateOf(now.toISOString());
  const to = addDays(today, 7);
  const from = addDays(today, -1);

  const enabled = await practiceSvc.enabledClassesFor(db, studentId);
  const classes = [];
  for (const c of enabled) {
    const [practiceDays, summary, excuses] = await Promise.all([
      practiceSvc.practiceDays(db, c.classId, today, to),
      practiceSvc.studentMonthSummary(db, c.classId, studentId, today.slice(0, 7)),
      practiceSvc.listExcuses(db, { classId: c.classId, studentId, from, to }),
    ]);
    classes.push({
      ...c,
      practiceDays,
      summary,
      excuses: excuses.map(({ id, classId, date, reason, status, requestedAt }) => ({
        id,
        classId,
        date,
        reason,
        status,
        requestedAt,
      })),
    });
  }

  // Yesterday's rows are kept only while still actionable-looking, so the student can see what
  // they missed; anything from yesterday already done drops off the list.
  const rows = (await practiceSvc.listStudentTasksFor(db, studentId, from, to)).filter(
    (t) =>
      enabled.some((c) => c.classId === t.classId) &&
      (t.date >= today || t.status === 'open' || t.status === 'rejected'),
  );
  const titles = await practiceSvc.materialTitles(
    db,
    rows.map((r) => r.materialId).filter((x): x is string => !!x),
  );
  const tasks = rows.map((t) =>
    practiceSvc.toApiTask(
      t,
      enabled.find((c) => c.classId === t.classId)?.className ?? '',
      t.materialId ? (titles.get(t.materialId) ?? null) : null,
    ),
  );

  return { serverNow: now.toISOString(), todayIct: today, classes, tasks };
});
