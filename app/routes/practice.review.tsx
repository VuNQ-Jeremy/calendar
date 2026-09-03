import type { ClientLoaderFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { PracticeReviewScreen } from '../../src/practice/practice-review.js';
import { tenantDbFor } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as classesSvc from '../../server/services/classes';
import * as peopleSvc from '../../server/services/people';
import * as practiceSvc from '../../server/services/practice';
import { PRACTICE_REVIEW_KEY, swrLoad } from '../../src/lib/route-cache.js';

/**
 * One review queue across every class, newest submission first, with the pending excuse requests
 * above it — a teacher marking tonight's work does not want to pick a class first.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const staff = await requireStaff(request, env);
  const db = tenantDbFor(env, staff);

  const [queue, excuses, students, classes] = await Promise.all([
    practiceSvc.reviewQueue(db),
    practiceSvc.listExcuses(db, { status: 'pending' }),
    peopleSvc.listStudents(db),
    classesSvc.listLite(db),
  ]);
  const titles = await practiceSvc.materialTitles(
    db,
    queue.map((q) => q.materialId).filter((x): x is string => !!x),
  );

  return {
    queue,
    excuses,
    students,
    classes,
    materialTitles: Object.fromEntries(titles),
  };
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  return swrLoad(
    PRACTICE_REVIEW_KEY,
    () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>,
  );
}
clientLoader.hydrate = true as const;

export default PracticeReviewScreen;
