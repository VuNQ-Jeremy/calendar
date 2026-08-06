import { fail, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/garden';

/**
 * The month-end album.
 *
 * GET ?classId=…            — which months are saved
 * GET ?classId=…&month=…    — one frozen garden
 *
 * Same membership rule as the live class garden: a student may only read their own classes.
 */
export const loader = withAuth('user', async ({ user, db, request }) => {
  const url = new URL(request.url);
  const classId = url.searchParams.get('classId');
  const month = url.searchParams.get('month');
  if (!classId) throw fail('missing_class', 400);

  if (user.kind === 'student') {
    const mine = await svc.studentClasses(db, user.user.id);
    if (!mine.some((c) => c.id === classId)) throw fail('forbidden', 403);
  }

  if (!month) return svc.listSnapshots(db, classId);
  const snap = await svc.getSnapshot(db, classId, month);
  if (!snap) throw fail('not_found', 404);
  return snap;
});
