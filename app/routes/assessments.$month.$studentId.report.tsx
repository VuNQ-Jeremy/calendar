import type { LoaderFunctionArgs } from 'react-router';
import { ReportSlipView } from '../../src/assessments/report-slip.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as assessSvc from '../../server/services/assessments';
import * as criteriaSvc from '../../server/services/remark-criteria';
import * as peopleSvc from '../../server/services/people';
import * as classesSvc from '../../server/services/classes';
import { TuitionMonth } from '../../shared/schemas';
import { NEGATIVE_TYPES, scoreStats } from '../../shared/logic/assess';

/**
 * Monthly report (phiếu nhận xét) for one student and one month.
 *
 * Registered OUTSIDE the `_app` layout, for the same reason as the tuition slip: a document, not
 * an app screen — no shell, no nav chrome, no route cache. Parents have no login, so the teacher
 * copies this as an image and sends it over Zalo.
 *
 * `requireStaff`, not `requireAdmin` — every other assessments surface is staff-level, and the
 * teacher who wrote the remark has to be able to hand it over.
 *
 * The ratings and the comment come from the stored remark; every number next to them is computed
 * here from the month's score and behaviour records. Nothing is denormalized, so a corrected score
 * shows up on the next reload of the slip.
 */
export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
  const db = createDb(env);

  const parsedMonth = TuitionMonth.safeParse(params.month);
  if (!parsedMonth.success) throw Response.json({ error: 'bad_month' }, { status: 400 });
  const month = parsedMonth.data;
  const studentId = params.studentId!;

  const [students, classes, remark, scores, behavior, criteria] = await Promise.all([
    peopleSvc.listStudents(db),
    classesSvc.listLite(db),
    assessSvc.getRemark(db, studentId, month),
    assessSvc.listScores(db),
    assessSvc.listBehavior(db),
    criteriaSvc.list(db),
  ]);

  const student = students.find((s) => s.id === studentId);
  if (!student) throw Response.json({ error: 'unknown_student' }, { status: 404 });

  const monthScores = scores.filter((r) => r.studentId === studentId && r.date.startsWith(month));
  const monthBehavior = behavior.filter(
    (r) => r.studentId === studentId && r.date.startsWith(month),
  );

  const incidents: Record<string, number> = {};
  for (const ty of NEGATIVE_TYPES) {
    const n = monthBehavior.filter((r) => r.type === ty).length;
    if (n > 0) incidents[ty] = n;
  }

  return {
    month,
    student: { id: student.id, name: student.name },
    classNames: classes.filter((c) => student.classIds.includes(c.id)).map((c) => c.name),
    // null when the teacher has not written one yet — the slip renders empty stars and says so,
    // rather than 404ing on a URL that is perfectly valid.
    remark,
    // Active criteria only: a retired criterion disappears from newly printed slips even for
    // months whose stored ratings still carry its key.
    criteria: criteria.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name })),
    stats: {
      average: scoreStats(monthScores).average,
      testCount: monthScores.length,
      incidents,
      praiseCount: monthBehavior.filter((r) => r.type === 'praise').length,
    },
  };
}

export default function AssessmentReportPrint() {
  return <ReportSlipView />;
}
