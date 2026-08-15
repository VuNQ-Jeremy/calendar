import type { LoaderFunctionArgs } from 'react-router';
import { LogsUsageScreen } from '../../src/screens-logs.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireAdmin } from '../../server/services/auth';
import { listUsage, SPEECH_FREE_SECONDS_PER_MONTH } from '../../server/services/usage';
import { ictDateOf } from '../../shared/logic/tests';

/**
 * /logs → Usage: monthly counters for metered external services, starting with Azure Speech
 * pronunciation assessment (F0 free tier: 5 audio-hours per calendar month, then Azure starts
 * refusing clips with 403 until the month resets).
 *
 * `requireAdmin` like its sibling tabs. Read-only, and — like /logs/activity — deliberately
 * uncached: the counters move on every scored clip, the read is one tiny table, and a quota
 * gauge that can show yesterday's number is a gauge you stop trusting.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireAdmin(request, env);
  const rows = await listUsage(createDb(env));
  return {
    rows,
    month: ictDateOf(new Date().toISOString()).slice(0, 7),
    speechFreeSeconds: SPEECH_FREE_SECONDS_PER_MONTH,
  };
}

export default function LogsUsageRoute() {
  return <LogsUsageScreen />;
}
