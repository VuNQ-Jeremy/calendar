import { parseBody, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/grade-levels';
import { GradeLevelReorder } from '../../shared/schemas';

/**
 * Drag-reorder on web; react-native-draggable-flatlist on mobile. Same payload.
 *
 * Platform-level: khối is global since 0049, so reordering it reorders every school's picker.
 */
export const action = withAuth(
  'platform',
  async ({ request, db }) => {
    const { ids } = await parseBody(request, GradeLevelReorder);
    await svc.reorder(db.raw, ids);
    return { ok: true };
  },
  { live: 'config' },
);
