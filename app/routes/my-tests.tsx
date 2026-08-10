import { redirect } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import { MyTestsScreen } from '../../src/tests/student-list.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireLearner } from '../../server/services/auth';
import * as attemptsSvc from '../../server/services/attempts';

/**
 * The student's own test list.
 *
 * DELIBERATELY NO clientLoader / no route cache: every row's window ('upcoming' | 'open' |
 * 'closed') and its attempt deadline are computed against the SERVER clock at request time. A
 * cached payload — even a stale-while-revalidate one served for a few hundred ms — could show a
 * test as still open after it has closed, or offer a Start button for a test whose window has
 * passed. Correctness of the window beats the instant paint here, so this route always hits the
 * server.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const { user, kind } = await requireLearner(request, env);
  // Staff have their own screen; anything that is not a student has no test list at all.
  // (Parents cannot authenticate today — the branch is defensive, not reachable.)
  if (kind === 'staff') throw redirect('/tests');
  if (kind !== 'student') throw redirect('/profile');

  const db = createDb(env);
  const now = new Date();
  return {
    items: await attemptsSvc.listOpenForStudent(db, user.id, now),
    serverNow: now.toISOString(),
  };
}

export default function MyTests() {
  return <MyTestsScreen />;
}
