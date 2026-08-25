import { parseBody, withAuth } from '../../server/api/handler';
import { recordFaceoffMatch } from '../../server/services/pvp';
import { FaceoffResultInput } from '../../shared/schemas';

/**
 * Record one finished tabletop duel from the mobile app. STAFF only, matching the cookie twin in
 * `game-rooms.tsx`: the tablet (or phone) running a face-off is the teacher's, and a student's
 * device must not be able to write a match. Anonymous quick-play posts nothing at all.
 *
 * This exists because `/api/*` is bearer-only and the app has no cookie, so that cookie action is
 * unreachable from the phone. Every rule — winner ≠ loser, the mode enum, no mastery/garden write —
 * already lives in `recordFaceoffMatch` and `FaceoffResultInput`; this route adds none of its own.
 */
export const action = withAuth('staff', async ({ request, db }) => {
  await recordFaceoffMatch(db, await parseBody(request, FaceoffResultInput));
  return { ok: true };
});
