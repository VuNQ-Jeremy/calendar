import { fail, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/garden';

/**
 * Bank the fruit and start a new seed. Students only, on their own plant.
 *
 * A double tap is safe by construction: the fruit ordinal is the event's idempotency key, so the
 * second request loses the unique index and comes back `not_ripe` rather than banking twice.
 */
export const action = withAuth(
  'user',
  async ({ user, db }) => {
    if (user.kind !== 'student') throw fail('forbidden', 403);
    const res = await svc.harvest(db, user.user.id);
    if (!res.ok) throw fail(res.error, 409);
    return res;
  },
  { live: 'garden' },
);
