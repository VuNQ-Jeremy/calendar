import { withAuth } from '../../server/api/handler';
import { currentIctMonth, monthLadder } from '../../server/services/pvp';

/**
 * This month's PvP ladder — points, wins, matches played. `user` level: staff and students both
 * read it, though only students appear in it (staff play but never rank).
 */
export const loader = withAuth('user', ({ db, request }) => {
  const month = new URL(request.url).searchParams.get('month') ?? currentIctMonth();
  return monthLadder(db, month);
});
