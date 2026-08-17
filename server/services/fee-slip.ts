import type { TenantDb } from '../db/index';
import * as tuitionSvc from './tuition';
import * as peopleSvc from './people';
import { studentFees } from '../../shared/logic/tuition';

/**
 * The tuition slip (phiếu thu) for one student and one month, assembled.
 *
 * Extracted from app/routes/tuition.$month.$studentId.print.tsx so the web document route and the
 * phone's parent screen render the same numbers — a slip that disagreed with itself across two
 * clients is a support call about money. Routes carry no business logic; see server/api/handler.ts.
 *
 * Its own module rather than a function in tuition.ts: this needs `people` (for the guardian and
 * phone lines) and tuition.ts deliberately depends on nothing above the fee tables.
 *
 * @returns null when the student does not exist. Callers decide the status code — the document
 *   route 404s, the API fails with `unknown_student`.
 */
export async function buildFeeSlip(db: TenantDb, studentId: string, month: string) {
  const [report, students, parents] = await Promise.all([
    tuitionSvc.getMonthReport(db, month),
    peopleSvc.listStudents(db),
    peopleSvc.listParents(db),
  ]);

  const student = students.find((s) => s.id === studentId);
  if (!student) return null;

  const fee = studentFees(report.lines, report.studentMonths).find(
    (f) => f.studentId === studentId,
  );

  // The paper pads have an SĐT line. Students carry no phone of their own, so it comes from the
  // first linked parent who has one — null when nobody does, and the theme just omits the line.
  const phone = parents.find((p) => p.studentIds.includes(studentId) && p.phone)?.phone ?? null;

  // Same idea for the guardian line: the linked parent, falling back to the free-text
  // `guardian` column that students added before the People form dropped that field carry.
  const guardian = parents.find((p) => p.studentIds.includes(studentId))?.name ?? student.guardian;

  return {
    month,
    student: { id: student.id, name: student.name, guardian, phone },
    // A student with nothing billed still gets a valid (zero) slip rather than an error page.
    fee:
      fee ??
      ({
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
        status: 'paid',
      } as const),
    closedAt: report.closedAt,
    isClosed: report.status === 'closed',
  };
}
