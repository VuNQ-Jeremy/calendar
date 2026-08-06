import { parseBody, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/remark-criteria';
import { RemarkCriteriaReorder } from '../../shared/schemas';

/** Drag-reorder on the web config screen; same payload as assessment-types reorder. */
export const action = withAuth(
  'admin',
  async ({ request, db }) => {
    const { ids } = await parseBody(request, RemarkCriteriaReorder);
    await svc.reorder(db, ids);
    return { ok: true };
  },
  { live: 'config' },
);
