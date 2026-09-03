import type { ClientLoaderFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { PracticeHomeScreen } from '../../src/practice/practice-home.js';
import { tenantDbFor } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as classesSvc from '../../server/services/classes';
import * as practiceSvc from '../../server/services/practice';
import { ictDateOf } from '../../shared/logic/tests';
import { K, swrLoad } from '../../src/lib/route-cache.js';

/**
 * Practice (Nhiệm vụ) landing: every class, with its opt-in switch and the two ways in.
 *
 * Any staff member, not just an Admin — planning self-study is a teacher's job (decision #4).
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const staff = await requireStaff(request, env);
  const db = tenantDbFor(env, staff);
  const [classes, settings] = await Promise.all([
    classesSvc.listLite(db),
    practiceSvc.listSettings(db),
  ]);
  return { classes, settings, today: ictDateOf(new Date().toISOString()) };
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  return swrLoad(K.practice, () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>);
}
clientLoader.hydrate = true as const;

export default PracticeHomeScreen;
