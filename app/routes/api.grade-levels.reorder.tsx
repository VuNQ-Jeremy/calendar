import { parseBody, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/grade-levels';
import { GradeLevelReorder } from '../../shared/schemas';

/** Drag-reorder on web; react-native-draggable-flatlist on mobile. Same payload. */
export const action = withAuth('admin', async ({ request, db }) => {
  const { ids } = await parseBody(request, GradeLevelReorder);
  await svc.reorder(db, ids);
  return { ok: true };
});
