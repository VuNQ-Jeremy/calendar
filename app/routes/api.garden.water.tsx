import { parseBody, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/garden';
import { WaterInput } from '../../shared/schemas';

/**
 * A teacher's watering: one stage, wilt cleared, daily cap bypassed.
 *
 * There is no rate limit on purpose. Every watering is logged against the staff member who did it
 * and shows up in the plant's history, which is the accountability the feature actually needs — a
 * numeric cap would only invite working around it.
 */
export const action = withAuth(
  'staff',
  async ({ user, db, request }) => {
    const input = await parseBody(request, WaterInput);
    const state = await svc.water(db, user.user.id, input.studentId, input.note ?? null);
    return { studentId: input.studentId, stage: state.stage };
  },
  { live: 'garden' },
);
