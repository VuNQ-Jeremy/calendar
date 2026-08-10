import { fail, withAuth } from '../../server/api/handler';
import * as parentPortalSvc from '../../server/services/parent-portal';
import { buildReportCard } from '../../server/services/report-card';
import { TuitionMonth } from '../../shared/schemas';

/**
 * One child's monthly report (phiếu nhận xét), as JSON for the phone to render natively.
 *
 * Same payload as the printable document at /assessments/:month/:studentId/report — both call
 * `buildReportCard`, so the screen a parent reads on their phone cannot drift from the slip the
 * teacher hands over.
 *
 * A month with no remark returns `remark: null` rather than 404ing: the URL is valid, the teacher
 * simply has not written one yet, and the client says so.
 */
export const loader = withAuth('parent', async ({ db, user, params }) => {
  const studentId = params.studentId;
  if (!studentId) throw fail('missing_id', 400);
  await parentPortalSvc.portalChild(db, user.user.id, studentId);

  const parsed = TuitionMonth.safeParse(params.month);
  if (!parsed.success) throw fail('bad_month', 400);

  const data = await buildReportCard(db, studentId, parsed.data);
  if (!data) throw fail('unknown_student', 404);
  return data;
});
