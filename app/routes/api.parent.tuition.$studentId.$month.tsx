import { fail, withAuth } from '../../server/api/handler';
import * as parentPortalSvc from '../../server/services/parent-portal';
import { buildFeeSlip } from '../../server/services/fee-slip';
import { TuitionMonth } from '../../shared/schemas';

/**
 * One child's tuition slip (phiếu thu), as JSON for the phone to render natively.
 *
 * This deliberately revisits a removal. `/api/tuition/me*` was deleted in Aug 2026 (see
 * docs/api.md) because tuition has no STUDENT self-view: a family is told what it owes by the
 * office and the printed slip, not by a child's app screen. That reasoning does not extend to
 * parents — they are the audience the slip was always for, and they already receive this exact
 * document over Zalo. So the surface returns for parents only, behind the portal toggle and the
 * `parent_students` link, and stays gone for students.
 *
 * Same payload as the printable document at /tuition/:month/:studentId/print — both call
 * `buildFeeSlip`, including the payment and adjustment notes the printed slip carries.
 */
export const loader = withAuth('parent', async ({ db, user, params }) => {
  const studentId = params.studentId;
  if (!studentId) throw fail('missing_id', 400);
  await parentPortalSvc.portalChild(db, user.user.id, studentId);

  const parsed = TuitionMonth.safeParse(params.month);
  if (!parsed.success) throw fail('bad_month', 400);

  const data = await buildFeeSlip(db, studentId, parsed.data);
  if (!data) throw fail('unknown_student', 404);
  return data;
});
