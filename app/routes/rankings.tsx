import type { LoaderFunctionArgs, ClientLoaderFunctionArgs } from 'react-router';
import { RankingsScreen } from '../../src/screens-rankings.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as rankingsSvc from '../../server/services/rankings';
import * as peopleSvc from '../../server/services/people';
import * as classesSvc from '../../server/services/classes';
import { TuitionMonth } from '../../shared/schemas';
import { ictDateOf } from '../../shared/logic/tests';
import { K, rankingsMonthKey, swrLoad } from '../../src/lib/route-cache.js';

/**
 * The ICT month we are in. The Worker's clock is UTC, so `new Date().getMonth()` would be wrong.
 * Deliberately duplicated from routes/tuition.tsx rather than imported: sharing a module local
 * between two route modules defeats React Router's route-chunk splitting.
 */
function currentIctMonth(now = new Date()): string {
  return ictDateOf(now.toISOString()).slice(0, 7);
}

function requireMonth(raw: string | undefined): string {
  const month = raw ?? currentIctMonth();
  const parsed = TuitionMonth.safeParse(month);
  if (!parsed.success) throw Response.json({ error: 'bad_month' }, { status: 400 });
  return parsed.data;
}

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
  const db = createDb(env);
  const month = requireMonth(params.month);
  const [attendance, scores, behavior, remarks, students, classes, weights] = await Promise.all([
    rankingsSvc.listMonthAttendance(db, month),
    rankingsSvc.listMonthScores(db, month),
    rankingsSvc.listMonthBehavior(db, month),
    rankingsSvc.listMonthRemarks(db, month),
    peopleSvc.listStudents(db),
    classesSvc.listLite(db),
    rankingsSvc.getRankingWeights(db),
  ]);
  return { month, attendance, scores, behavior, remarks, students, classes, weights };
}

export async function clientLoader({ params, serverLoader }: ClientLoaderFunctionArgs) {
  const key = params.month ? rankingsMonthKey(params.month) : K.rankings;
  return swrLoad(key, () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>);
}
clientLoader.hydrate = true as const;

export default function Rankings() {
  return <RankingsScreen />;
}
