import type { LoaderFunctionArgs, ClientLoaderFunctionArgs } from 'react-router';
import { RankingsScreen } from '../../src/screens-rankings.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as rankingsSvc from '../../server/services/rankings';
import * as peopleSvc from '../../server/services/people';
import * as classesSvc from '../../server/services/classes';
import * as levelsSvc from '../../server/services/grade-levels';
import * as classLevelsSvc from '../../server/services/class-levels';
import * as checkinSvc from '../../server/services/checkin';
import { TuitionMonth } from '../../shared/schemas';
import { ictDateOf } from '../../shared/logic/tests';
import type { TuiMuMonthTally } from '../../shared/logic/checkin';
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
  // classesSvc.listLite carries each class's (gradeLevelId, classLevelId); the two level lists
  // are only needed to label the cohorts. Ranking itself is still computed on the client.
  const [
    attendance,
    scores,
    behavior,
    remarks,
    students,
    classes,
    weights,
    gradeLevels,
    classLevels,
  ] = await Promise.all([
    rankingsSvc.listMonthAttendance(db, month),
    rankingsSvc.listMonthScores(db, month),
    rankingsSvc.listMonthBehavior(db, month),
    rankingsSvc.listMonthRemarks(db, month),
    peopleSvc.listStudents(db),
    classesSvc.listLite(db),
    rankingsSvc.getRankingWeights(db),
    levelsSvc.list(db),
    classLevelsSvc.list(db),
  ]);

  // Only queried when the admin toggle is on — an off toggle costs nothing extra and rankings
  // stay byte-identical to the feature not existing (checkinByClass: null).
  const checkinSettings = await checkinSvc.getCheckinSettings(db);
  let checkinByClass: Record<string, Record<string, TuiMuMonthTally>> | null = null;
  if (checkinSettings.showRankings) {
    const entries = await Promise.all(
      classes.map(
        async (c) => [c.id, Object.fromEntries(await checkinSvc.classMonthTallies(db, c.id, month))] as const,
      ),
    );
    checkinByClass = Object.fromEntries(entries);
  }

  return {
    month,
    // The picker stops here. Sent from the server because the browser's clock is the user's, and
    // a phone left on the wrong timezone would otherwise offer a month that has not started.
    currentMonth: currentIctMonth(),
    attendance,
    scores,
    behavior,
    remarks,
    students,
    classes,
    weights,
    gradeLevels,
    classLevels,
    checkinByClass,
  };
}

export async function clientLoader({ params, serverLoader }: ClientLoaderFunctionArgs) {
  const key = params.month ? rankingsMonthKey(params.month) : K.rankings;
  return swrLoad(key, () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>);
}
clientLoader.hydrate = true as const;

export default function Rankings() {
  return <RankingsScreen />;
}
