import { parseBody, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/assessment-types';
import { AssessmentTypeReorder } from '../../shared/schemas';

/** Drag-reorder on web; react-native-draggable-flatlist on mobile. Same payload. */
export const action = withAuth(
  'admin',
  async ({ request, db }) => {
    const { ids } = await parseBody(request, AssessmentTypeReorder);
    await svc.reorder(db, ids);
    return { ok: true };
  },
  { live: 'config' },
);
