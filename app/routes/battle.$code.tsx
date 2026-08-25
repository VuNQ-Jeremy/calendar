import type { LoaderFunctionArgs } from 'react-router';
import { BattleScreen } from '../../src/flashcards/battle.jsx';
import { cloudflareCtx } from '../../app/load-context';
import { requireLearner } from '../../server/services/auth';

/**
 * The join-by-code battle screen — a full-bleed page outside the app shell, like /checkin.
 * Auth only: the room's own state lives in its GameRoom Durable Object, reached over
 * `/game-ws?code=`, never through this loader.
 */
export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const su = await requireLearner(request, env);
  return { code: (params.code ?? '').toUpperCase(), myId: su.user.id, myKind: su.kind };
}

export default function Battle() {
  return <BattleScreen />;
}
