import { redirect } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import { StudentScheduleScreen } from '../../src/schedule/student-schedule.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireUser } from '../../server/services/auth';
import * as previewSvc from '../../server/services/session-preview';

/**
 * The student's own upcoming sessions, with what each one will cover.
 *
 * DELIBERATELY NO clientLoader / no route cache, for the same reason as my-tests.tsx: a session
 * leaves this list once it has ended, computed against the SERVER clock at request time. A cached
 * payload would keep showing a class that finished an hour ago. Correctness beats the instant
 * paint, so this route always hits the server — and there is no `cacheKeyForPath` entry for it.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const { user, kind } = await requireUser(request, env);
  // Staff have the calendar; anything that is not a student has no schedule of its own.
  // (Parents cannot authenticate today — the branch is defensive, not reachable.)
  if (kind === 'staff') throw redirect('/calendar');
  if (kind !== 'student') throw redirect('/profile');

  const db = createDb(env);
  return previewSvc.upcomingSessions(db, { studentId: user.id }, 7);
}

export default function MySchedule() {
  return <StudentScheduleScreen />;
}
