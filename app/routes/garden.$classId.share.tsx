import type { LoaderFunctionArgs } from 'react-router';
import { ClassShareCard } from '../../src/garden/share-card.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as gardenSvc from '../../server/services/garden';
import { ictDateOf } from '../../shared/logic/tests';

/**
 * The class-garden share card for the class Zalo group.
 *
 * Registered OUTSIDE the `_app` layout — a document, not an app screen: no shell, no nav chrome,
 * and no route cache (`cacheKeyForPath` matches single trailing segments only, so this
 * multi-segment path falls through to null).
 *
 * `requireStaff`, like the session-preview card: any teacher makes these, and the image goes to a
 * group of parents, so it is not a student's to publish.
 *
 * Today is the ICT day from `ictDateOf` — the date printed on the card, and the day the plants are
 * settled against. `new Date()` on a UTC Worker would date the card yesterday all evening.
 */
export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
  const db = createDb(env);
  const vnToday = ictDateOf(new Date().toISOString());
  const garden = await gardenSvc.classGarden(db, params.classId ?? '', vnToday);
  if (!garden) throw Response.json({ error: 'unknown_class' }, { status: 404 });
  return { vnToday, garden };
}

export default function GardenShare() {
  return <ClassShareCard />;
}
