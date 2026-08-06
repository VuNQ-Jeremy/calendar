import { fail, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/garden';
import { ictDateOf } from '../../shared/logic/tests';

/**
 * One class's garden — every member's plant plus the cooperative class tree.
 *
 * Students may read the gardens of classes they are in, and no others: the screen is shared on
 * purpose (it is a class activity), but it still lists real children by name.
 */
export const loader = withAuth('user', async ({ user, db, params }) => {
  const classId = params.id;
  if (!classId) throw fail('missing_id', 400);

  if (user.kind === 'student') {
    const mine = await svc.studentClasses(db, user.user.id);
    if (!mine.some((c) => c.id === classId)) throw fail('forbidden', 403);
  }

  const garden = await svc.classGarden(db, classId, ictDateOf(new Date().toISOString()));
  if (!garden) throw fail('not_found', 404);
  return garden;
});
