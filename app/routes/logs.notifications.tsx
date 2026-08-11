import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  ClientLoaderFunctionArgs,
  ClientActionFunctionArgs,
} from 'react-router';
import { LogsNotificationsScreen } from '../../src/screens-logs-notifications.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireAdmin } from '../../server/services/auth';
import * as notifyPlan from '../../server/services/notify-plan';
import {
  runClassReminders,
  runDailyDigest,
  runEveningPreview,
  runGardenAlerts,
} from '../../server/services/notify';
import { invalidate } from '../../src/lib/cache.js';
import { K, swrLoad } from '../../src/lib/route-cache.js';

/**
 * /logs → Notifications: what the cron is going to send, and what it recently sent.
 *
 * `requireAdmin`, like the schedule tab beside it: this reads every student's devices and every
 * family's Zalo pairing at once, which is a school-wide view rather than a teacher's.
 *
 * **The one write on the /logs page, deliberately.** The schedule tab is read-only by design, and
 * this route keeps that for everything it *displays* — the forecast never calls a job, because
 * `runDailyDigest` carries the daily housekeeping and would prune the very ledger shown below. What
 * it does add is a trigger per job, which is a different thing from an editor: it runs the identical
 * code path the cron runs, including the idempotency ledger, so pressing it twice cannot duplicate a
 * notification. That is the same argument api.push.run.tsx makes for existing at all.
 *
 * It needs its own action rather than posting to `/api/push/run` because that route is
 * `withAuth('admin')` — bearer-only, and a browser has a cookie. Same cookie-authed-twin pattern as
 * `event-previews` and `garden-month`.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireAdmin(request, env);
  const db = createDb(env);
  const [plan, recent] = await Promise.all([
    notifyPlan.planNotifications(db, env),
    notifyPlan.listSentLog(db),
  ]);
  return { plan, recent };
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  return swrLoad(
    K.logsNotifications,
    () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>,
  );
}
clientLoader.hydrate = true as const;

/**
 * Run one job now. Not wrapped in `withLiveAction`: a job sends notifications, it does not change
 * anything another open tab is displaying, and the ledger rows it writes are picked up by this
 * route's own revalidation.
 */
export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireAdmin(request, env);
  const db = createDb(env);
  const form = await request.formData();
  if (form.get('intent') !== 'run-job') {
    return Response.json({ error: 'bad_intent' }, { status: 400 });
  }
  const job = String(form.get('job') ?? '');
  if (job !== 'class' && job !== 'digest' && job !== 'preview' && job !== 'garden') {
    return Response.json({ error: 'bad_job' }, { status: 400 });
  }
  // `env` carries the Zalo credentials, so passing it is what makes these buttons exercise the real
  // Zalo delivery. `garden` takes none — that job has never had a Zalo channel.
  const sent =
    job === 'digest'
      ? await runDailyDigest(db, new Date(), env)
      : job === 'preview'
        ? await runEveningPreview(db, new Date(), env)
        : job === 'garden'
          ? await runGardenAlerts(db)
          : await runClassReminders(db, new Date(), env);
  return { job, sent };
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  const result = await serverAction();
  // The run just wrote ledger rows, so every `alreadySent` on screen is out of date.
  invalidate(K.logsNotifications);
  return result;
}

export default function LogsNotifications() {
  return <LogsNotificationsScreen />;
}
