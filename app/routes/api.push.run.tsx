import { fail, withAuth } from '../../server/api/handler';
import { runClassReminders, runDailyDigest } from '../../server/services/notify';

/**
 * Run a notification job on demand. **Admin only.**
 *
 * The phase-6 plan calls for a temporary debug endpoint while developing the cron logic, on the
 * grounds that a 15-minute feedback loop is miserable — and then deleting it. This is kept
 * rather than deleted, for one reason the plan itself asks for: verifying that a send reaches a
 * physical device with the app closed requires triggering a send at a moment a human chooses.
 * Waiting up to fifteen minutes to find out whether an APK receives notifications is the same
 * miserable loop, just moved to QA.
 *
 * It is safe to keep because it is not a bypass: `withAuth('admin')` is the same gate as
 * /api/assessment-types, and it runs the identical code path the cron does — including the
 * idempotency ledger, so hammering it does NOT produce duplicate notifications. The worst an
 * admin can do with it is re-run a job that has already done its work and get `sent: 0`.
 *
 *   POST /api/push/run?job=class    — the class-starting-soon sweep
 *   POST /api/push/run?job=digest   — the daily digest
 */
export const action = withAuth('admin', async ({ request, db }) => {
  const job = new URL(request.url).searchParams.get('job');
  if (job !== 'class' && job !== 'digest') throw fail('bad_job', 400);

  const sent = job === 'digest' ? await runDailyDigest(db) : await runClassReminders(db);
  return { job, sent };
});
