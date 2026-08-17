import type { LoaderFunctionArgs } from 'react-router';
import { LogsUsageScreen } from '../../src/screens-logs.jsx';
import { tenantDbFor } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireAdmin } from '../../server/services/auth';
import {
  listUsage,
  speechSecondsAllTenants,
  SPEECH_FREE_SECONDS_PER_MONTH,
} from '../../server/services/usage';
import { ictDateOf } from '../../shared/logic/tests';

/**
 * /logs → Usage: monthly counters for metered external services, starting with Azure Speech
 * pronunciation assessment (F0 free tier: 5 audio-hours per calendar month, then Azure starts
 * refusing clips with 403 until the month resets).
 *
 * `requireAdmin` like its sibling tabs. Read-only, and — like /logs/activity — deliberately
 * uncached: the counters move on every scored clip, the read is one tiny table, and a quota
 * gauge that can show yesterday's number is a gauge you stop trusting.
 *
 * The two numbers on this page answer different questions and are scoped differently. The table
 * is this school's own consumption. The gauge underneath it is the deployment's, because the F0
 * allowance belongs to one Azure key that every school draws on — a per-school gauge would read
 * green in the month Azure started refusing clips.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const admin = await requireAdmin(request, env);
  const db = tenantDbFor(env, admin);
  const month = ictDateOf(new Date().toISOString()).slice(0, 7);
  const [rows, speechUsedSeconds] = await Promise.all([
    listUsage(db),
    speechSecondsAllTenants(db.raw, month),
  ]);
  return {
    rows,
    month,
    speechFreeSeconds: SPEECH_FREE_SECONDS_PER_MONTH,
    speechUsedSeconds,
  };
}

export default function LogsUsageRoute() {
  return <LogsUsageScreen />;
}
