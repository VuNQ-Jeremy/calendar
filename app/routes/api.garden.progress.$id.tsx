import { fail, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/garden';

/** Who has finished one assignment and who has not. Counted from results, never stored. */
export const loader = withAuth('staff', async ({ db, params }) => {
  if (!params.id) throw fail('missing_id', 400);
  const progress = await svc.assignmentProgress(db, params.id);
  if (!progress) throw fail('not_found', 404);
  return progress;
});
