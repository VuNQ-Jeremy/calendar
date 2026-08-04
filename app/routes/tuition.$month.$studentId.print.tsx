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
 * Printable tuition slip (phiếu thu) for one student and one month.
 *
 * Registered OUTSIDE the `_app` layout — a document, not an app screen: no shell, no nav chrome,
 * and no route cache (`cacheKeyForPath` only matches the single-segment month URL).
 *
 * The returned shape is deliberately flat and self-contained. Customizable slip themes are a
 * planned follow-up, and keeping the loader data stable means a theme only swaps the view.
 */
export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireAdmin(request, env);
  const db = createDb(env);

  const parsedMonth = TuitionMonth.safeParse(params.month);
  if (!parsedMonth.success) throw Response.json({ error: 'bad_month' }, { status: 400 });
  const month = parsedMonth.data;
  const studentId = params.studentId!;

  const [report, students] = await Promise.all([
    tuitionSvc.getMonthReport(db, month),
    peopleSvc.listStudents(db),
  ]);

  const student = students.find((s) => s.id === studentId);
  if (!student) throw Response.json({ error: 'unknown_student' }, { status: 404 });

  const fee = studentFees(report.lines, report.studentMonths).find(
    (f) => f.studentId === studentId,
  );

  return {
    month,
    student: { id: student.id, name: student.name, guardian: student.guardian },
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
