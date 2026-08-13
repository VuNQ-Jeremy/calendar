import { fail, withAuth } from '../../server/api/handler';
import * as checkinSvc from '../../server/services/checkin';
import { qualifiedTier } from '../../shared/logic/checkin';
import { ictDateOf } from '../../shared/logic/tests';

/**
 * One student's own túi mù month tally — the mobile twin of the /vocabulary bag chip
 * (app/routes/flashcards.tsx's loadTuiMu). Gated the same way: `disabled: true` while
 * `checkin-settings.showStudentView` is off, so the app can hide the chip rather than
 * render a stale or misleading number.
 *
 * `?studentId=` lets staff peek at any student, same allowance as api.garden.plant.tsx;
 * a plain student call always reads their own.
 */
export const loader = withAuth('user', async ({ user, db, request }) => {
  const asked = new URL(request.url).searchParams.get('studentId');
  if (asked && user.kind !== 'staff') throw fail('forbidden', 403);
  const studentId = asked ?? (user.kind === 'student' ? user.user.id : null);
  if (!studentId) throw fail('missing_student', 400);

  const settings = await checkinSvc.getCheckinSettings(db);
  if (!settings.showStudentView) return { disabled: true };

  const month = ictDateOf(new Date().toISOString()).slice(0, 7);
  const tally = await checkinSvc.studentMonthTally(db, studentId, month);
  return { disabled: false, month, tally, tier: qualifiedTier(tally.bags, settings.tiers) };
});
