import { parseBody, withAuth } from '../../server/api/handler';
import { createRoom } from '../../server/services/pvp';
import { PvpRoomInput } from '../../shared/schemas';

/**
 * Create a PvP battle room from a vocab topic. `user` level — both staff and students may host
 * (a teacher-hosted classroom battle and a student duel are the same room). Returns the 4-letter
 * code players join with; the room itself lives in a `GameRoom` Durable Object, not in D1.
 */
export const action = withAuth('user', async ({ request, db, env, user }) => {
  const input = await parseBody(request, PvpRoomInput);
  return createRoom(db, env, user, input);
});
