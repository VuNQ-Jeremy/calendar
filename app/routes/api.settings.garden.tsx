import { fail, parseBody, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/garden';
import { GardenSettingsInput } from '../../shared/schemas';

/**
 * School-wide garden tuning: the free-study bar, how long a plant survives silence, and how many
 * stages a day it can gain. Admin only — these four numbers re-time every plant in the school.
 */
export const loader = withAuth('admin', ({ db }) => svc.getGardenSettings(db));

export const action = withAuth(
  'admin',
  async ({ db, request }) => {
    if (request.method !== 'PUT' && request.method !== 'POST') {
      throw fail('method_not_allowed', 405);
    }
    return svc.setGardenSettings(db, await parseBody(request, GardenSettingsInput));
  },
  { live: 'config' },
);
