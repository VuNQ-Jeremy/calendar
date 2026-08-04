import type { LoaderFunctionArgs } from 'react-router';
import { FeeSlipView } from '../../src/tuition/fee-slip.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireAdmin } from '../../server/services/auth';
import * as tuitionSvc from '../../server/services/tuition';
import * as peopleSvc from '../../server/services/people';
import { TuitionMonth } from '../../shared/schemas';
import { studentFees } from '../../shared/logic/tuition';

/**
 * Tuition slip (phiếu thu) for one student and one month.
 *
 * Registered OUTSIDE the `_app` layout — a document, not an app screen: no shell, no nav chrome,
 * and no route cache (`cacheKeyForPath` only matches the single-segment month URL).
 *
 * The slip is copied to the clipboard as an image (parents get it over Zalo), not printed, so this
 * is really a rendering surface for `src/tuition/slip-themes.tsx`. The returned shape is the theme
 * contract: flat, self-contained, and the same for every theme — adding a theme touches no server
 * code at all.
 */
export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireAdmin(request, env);
  const db = createDb(env);

  const parsedMonth = TuitionMonth.safeParse(params.month);
  if (!parsedMonth.success) throw Response.json({ error: 'bad_month' }, { status: 400 });
  const month = parsedMonth.data;
  const studentId = params.studentId!;

  const [report, students, parents] = await Promise.all([
    tuitionSvc.getMonthReport(db, month),
    peopleSvc.listStudents(db),
    peopleSvc.listParents(db),
  ]);

  const student = students.find((s) => s.id === studentId);
  if (!student) throw Response.json({ error: 'unknown_student' }, { status: 404 });

  const fee = studentFees(report.lines, report.studentMonths).find(
    (f) => f.studentId === studentId,
  );

  // The paper pads have an SĐT line. Students carry no phone of their own, so it comes from the
  // first linked parent who has one — null when nobody does, and the theme just omits the line.
  const phone = parents.find((p) => p.studentIds.includes(studentId) && p.phone)?.phone ?? null;

  return {
    month,
    student: { id: student.id, name: student.name, guardian: student.guardian, phone },
    // A student with nothing billed still gets a valid (zero) slip rather than an error page.
    fee: fee ?? {
      studentId,
      lines: [],
      billedVnd: 0,
      adjustmentVnd: 0,
      adjustmentNote: null,
      dueVnd: 0,
      paidVnd: 0,
      paidAt: null,
      paymentNote: null,
      outstandingVnd: 0,
      status: 'paid' as const,
    },
    closedAt: report.closedAt,
    isClosed: report.status === 'closed',
  };
}

export default function TuitionSlipPrint() {
  return <FeeSlipView />;
}
