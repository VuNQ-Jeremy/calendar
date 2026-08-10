import { fail, withAuth } from '../../server/api/handler';
import * as parentPortalSvc from '../../server/services/parent-portal';
import * as attendanceSvc from '../../server/services/attendance';
import { TuitionMonth } from '../../shared/schemas';
import { ictDateOf } from '../../shared/logic/tests';

/**
 * One child's attendance for one month, session by session.
 *
 * `portalChild` is the whole authorization story: portal on, and this child is theirs. Without it
 * the `studentId` in the path would be a way to read any family's roll.
 *
 * `TuitionMonth` is the project's shared 'YYYY-MM' guard (the name is about where it started, not
 * what it validates). Month defaults to the ICT month, never the Worker's UTC one.
 */
export const loader = withAuth('parent', async ({ db, user, params, request }) => {
  const studentId = params.studentId;
  if (!studentId) throw fail('missing_id', 400);
  await parentPortalSvc.portalChild(db, user.user.id, studentId);

  const raw =
    new URL(request.url).searchParams.get('month') ??
    ictDateOf(new Date().toISOString()).slice(0, 7);
  const parsed = TuitionMonth.safeParse(raw);
  if (!parsed.success) throw fail('bad_month', 400);
  const month = parsed.data;

  // Month range is the project convention: `${month}-01`..`${month}-31`, compared lexically.
  const attendance = await attendanceSvc.historyForStudent(db, studentId, {
    from: `${month}-01`,
    to: `${month}-31`,
  });
  return { month, attendance };
});
