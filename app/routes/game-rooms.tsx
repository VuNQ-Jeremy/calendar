import type { ActionFunctionArgs } from 'react-router';
import { tenantDbFor } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireLearner, requireStaff } from '../../server/services/auth';
import { createRoom, recordFaceoffMatch } from '../../server/services/pvp';
import { FaceoffResultInput, PvpRoomInput } from '../../shared/schemas';

/**
 * The cookie-authed twin of `POST /api/game-rooms` — `/api/*` is bearer-only, and the web battle
 * screen has a session cookie, not a bearer token. Two intents:
 *
 *   - (none) / 'create': the room-creation flow both roles share.
 *   - 'faceoff-result': records a finished tabletop duel. Staff only — the tablet is the
 *     teacher's session, and anonymous quick-play (no students picked) never posts here at all.
 */
export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const formData = await request.formData();
  const intent = formData.get('intent') as string | null;

  if (intent === 'faceoff-result') {
    const su = await requireStaff(request, env);
    const db = tenantDbFor(env, su);
    const parsed = FaceoffResultInput.safeParse({
      mode: formData.get('mode'),
      topicId: formData.get('topicId'),
      winnerStudentId: formData.get('winnerStudentId'),
      loserStudentId: formData.get('loserStudentId'),
      winnerScore: Number(formData.get('winnerScore')),
      loserScore: Number(formData.get('loserScore')),
      total: Number(formData.get('total')),
    });
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await recordFaceoffMatch(db, parsed.data);
    return { ok: true };
  }

  const su = await requireLearner(request, env);
  const db = tenantDbFor(env, su);
  const raw: Record<string, unknown> = { slug: formData.get('slug') };
  const roundSize = formData.get('roundSize');
  const secondsPerQuestion = formData.get('secondsPerQuestion');
  if (roundSize) raw.roundSize = Number(roundSize);
  if (secondsPerQuestion) raw.secondsPerQuestion = Number(secondsPerQuestion);
  const parsed = PvpRoomInput.safeParse(raw);
  if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  return createRoom(db, env, su, parsed.data);
}
