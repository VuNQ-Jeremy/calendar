import { fail, withAuth } from '../../server/api/handler';
import { parsePatchBody } from '../../server/api/handler';
import * as svc from '../../server/services/garden';
import { PlantPatchInput } from '../../shared/schemas';
import { monthOfVn, plantView } from '../../shared/logic/garden';
import { ictDateOf } from '../../shared/logic/tests';

/**
 * One student's plant, settled to today.
 *
 * GET   — the caller's own plant (staff may pass `?studentId=` to read anyone's)
 * PATCH — rename the plant / repaint the pot. Students only, and only their own.
 *
 * The plant is DERIVED on read (`plantView`): a wilt or a stage drop lands at ICT midnight for
 * every caller at once, and this endpoint writes nothing.
 *
 * `today` is the server's ICT day, and it is here so a client never has to ask its own clock: every
 * deadline chip and drop warning is a comparison against it. A phone set to Sydney must not see a
 * deadline a day early. `hasPlant` and `fruitMonth` complete the set the web's own loader assembles
 * (app/routes/flashcards.tsx), so the widget renders identically on either client.
 */
async function loadPlant(db: Parameters<typeof svc.getPlant>[0], studentId: string) {
  const nowIso = new Date().toISOString();
  const vnToday = ictDateOf(nowIso);
  const [settings, plant, assignments, classes] = await Promise.all([
    svc.getGardenSettings(db),
    svc.getPlant(db, studentId),
    // The instant, not the day: an assignment with a clock time closes when that time passes.
    svc.studentAssignments(db, studentId, nowIso),
    svc.studentClasses(db, studentId),
  ]);
  const view = plantView(plant?.state ?? null, settings, vnToday);
  // Fruit-this-month comes from the event log rather than a column, and a plant that has never
  // fruited cannot have fruited this month — so the read is skipped entirely.
  const fruitMonth = view.fruitsTotal
    ? (await svc.plantHistory(db, studentId, 200)).filter(
        (e) => e.type === 'harvest' && e.vnDay.startsWith(monthOfVn(vnToday)),
      ).length
    : 0;
  return {
    studentId,
    today: vnToday,
    hasPlant: plant !== null,
    plantName: plant?.plantName ?? null,
    potColor: plant?.potColor ?? 'orange',
    species: plant?.species ?? 'classic',
    ...view,
    fruitMonth,
    assignments,
    classes,
    settings,
  };
}

export const loader = withAuth('user', async ({ user, db, request }) => {
  const asked = new URL(request.url).searchParams.get('studentId');
  if (asked && user.kind !== 'staff') throw fail('forbidden', 403);
  const studentId = asked ?? (user.kind === 'student' ? user.user.id : null);
  if (!studentId) throw fail('missing_student', 400);
  return loadPlant(db, studentId);
});

export const action = withAuth(
  'user',
  async ({ user, db, request }) => {
    if (request.method !== 'PATCH') throw fail('method_not_allowed', 405);
    // A plant belongs to the student who grew it; there is no reason for staff to rename it.
    if (user.kind !== 'student') throw fail('forbidden', 403);
    const patch = await parsePatchBody(request, PlantPatchInput);
    const updated = await svc.updatePlant(db, user.user.id, patch);
    // 409, like harvest: a species refused because the plant is mid-growth or not yet earned is a
    // state conflict. Returning the plant with a 200 would tell the client its write succeeded.
    if (!updated.ok) throw fail(updated.error, 409);
    return loadPlant(db, user.user.id);
  },
  { live: 'garden' },
);
