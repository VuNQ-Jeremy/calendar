import { fail, withAuth } from '../../server/api/handler';
import {
  runClassReminders,
  runDailyDigest,
  runEveningPreview,
  runGardenAlerts,
} from '../../server/services/notify';
import { runPracticeFinalize, runPracticeReminders } from '../../server/services/practice-notify';

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
 *   POST /api/push/run?job=preview  — the evening "tomorrow's sessions" preview
 *   POST /api/push/run?job=garden   — the garden sweep: missed deadlines, decay, album, alerts
 *   POST /api/push/run?job=practice-remind   — the 20:00 ICT practice nudge
 *   POST /api/push/run?job=practice-finalize — the 00:00 ICT practice close (writes misses)
 *
 * `garden` does more than send: it also charges missed assignment deadlines and writes the
 * month-end album. That is deliberately on this endpoint too, because the e2e environment has its
 * crons disabled — this is the only way to exercise the sweep there.
 */
export const action = withAuth('admin', async ({ request, db, env }) => {
  const job = new URL(request.url).searchParams.get('job');
  const JOBS = [
    'class',
    'digest',
    'preview',
    'garden',
    'practice-remind',
    'practice-finalize',
  ] as const;
  if (!job || !(JOBS as readonly string[]).includes(job)) throw fail('bad_job', 400);

  // `env` is what carries the Zalo credentials, so passing it is also what makes this endpoint
  // the way to test a real Zalo delivery without waiting for 19:00 ICT.
  const sent =
    job === 'digest'
      ? await runDailyDigest(db, new Date(), env)
      : job === 'preview'
        ? await runEveningPreview(db, new Date(), env)
        : job === 'garden'
          ? await runGardenAlerts(db)
          : job === 'practice-remind'
            ? await runPracticeReminders(db, new Date(), env)
            : job === 'practice-finalize'
              ? await runPracticeFinalize(db, new Date(), env)
              : await runClassReminders(db, new Date(), env);
  return { job, sent };
});
