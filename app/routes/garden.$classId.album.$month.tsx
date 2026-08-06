import { redirect } from 'react-router';
import type { ClientLoaderFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { GardenAlbumScreen } from '../../src/garden/class-garden.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireUser } from '../../server/services/auth';
import * as gardenSvc from '../../server/services/garden';
import { gardenAlbumKey, swrLoad } from '../../src/lib/route-cache.js';

/**
 * One frozen month of a class garden — the album page.
 *
 * Inside the `_app` layout (it is a screen, not a document) with the month in the PATH, so
 * `cacheKeyForPath` can give each month its own entry. Same membership rule as /garden: a student
 * may only read a class they belong to, and a wrong class bounces them to their own.
 *
 * A missing month renders an empty state rather than throwing a 404: the album index only ever
 * links to months that exist, so a miss here is a hand-typed or bookmarked URL for a month nobody
 * saved — and the useful answer to that is the page saying so, in the app shell, with a way back.
 */
export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const { user, kind } = await requireUser(request, env);
  const db = createDb(env);
  const classId = params.classId ?? '';
  const month = params.month ?? '';
  if (!/^\d{4}-\d{2}$/.test(month)) throw Response.json({ error: 'bad_month' }, { status: 400 });

  if (kind !== 'staff') {
    const mine = await gardenSvc.studentClasses(db, user.id);
    if (!mine.some((c) => c.id === classId)) {
      if (mine.length === 0) throw redirect('/garden');
      throw redirect(`/garden/${mine[0].id}`);
    }
  }

  // `getSnapshot` returns the frozen payload but not the row's timestamp, which the header shows
  // ("saved on ..."), so the index comes along for the ride.
  const [snap, saved] = await Promise.all([
    gardenSvc.getSnapshot(db, classId, month),
    gardenSvc.listSnapshots(db, classId),
  ]);
  if (!snap) return { found: false as const, classId, month };
  return {
    found: true as const,
    classId,
    className: snap.className,
    month: snap.month,
    createdAt: saved.find((s) => s.month === month)?.createdAt ?? '',
    data: snap.data,
  };
}

export async function clientLoader({ params, serverLoader }: ClientLoaderFunctionArgs) {
  const key = gardenAlbumKey(params.classId ?? '', params.month ?? '');
  return swrLoad(key, () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>);
}
clientLoader.hydrate = true as const;

export default function GardenAlbum() {
  return <GardenAlbumScreen />;
}
