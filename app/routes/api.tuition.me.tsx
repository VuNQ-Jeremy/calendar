import { fail, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/tuition';

/**
 * The signed-in student's own tuition months — the list behind "Học phí" on the phone.
 *
 * Students only. Staff have the /tuition admin screen, which is a different question ("who owes
 * what"); a staff caller here would be asking for their own fees, which do not exist. Parent
 * accounts cannot sign in at all yet (server/services/auth.ts), so they never reach this either.
 *
 * Self-scoped by construction: the student id comes from the session, never from the request, so
 * there is no id to tamper with.
 *
 * Closed months only — see `listClosedMonthsForStudent` for why an open month is not a number
 * anyone should be quoted.
 */
export const loader = withAuth('user', async ({ db, user }) => {
  if (user.kind !== 'student') throw fail('forbidden', 403);
  return { months: await svc.listClosedMonthsForStudent(db, user.user.id) };
});
