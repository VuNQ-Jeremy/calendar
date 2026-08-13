import type { LoaderFunctionArgs, ClientLoaderFunctionArgs } from 'react-router';
import { useOutletContext, useNavigate } from 'react-router';
import { DashboardScreen, UPCOMING_DAYS } from '../../src/screens-core.jsx';
import type { AppContext } from './_app.js';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import * as eventsSvc from '../../server/services/events';
import * as testsSvc from '../../server/services/tests';
import * as classesSvc from '../../server/services/classes';
import * as peopleSvc from '../../server/services/people';
import * as materialsSvc from '../../server/services/materials';
import * as eventMaterialsSvc from '../../server/services/event-materials';
import { iso, addDays } from '../../src/lib/core.js';
import { requireStaff } from '../../server/services/auth';
import { K, swrLoad } from '../../src/lib/route-cache.js';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
  const db = createDb(env);
  // A fresh clock, not the module-level TODAY: a Worker isolate can outlive the day it booted on,
  // and the two windows below must agree with each other.
  const now = new Date();
  const today = iso(now);
  // Both schedule cards open the same event dialog the calendar uses, so this loader has to feed
  // it too: full classes (its attendance and check-in tabs read `studentIds`), the student and
  // material rows, and the event-material links. `listLite` was enough when the cards only showed
  // a class name; it is not enough to edit an event.
  const [
    todayEvents,
    upcomingEvents,
    attemptsSummary,
    classes,
    students,
    materials,
    eventMaterials,
  ] = await Promise.all([
    eventsSvc.listForToday(db, today),
    // Tomorrow .. +UPCOMING_DAYS for the "Coming up" card. Recurring rows come back whatever
    // their stored date; the screen expands them over the same window.
    eventsSvc.listRange(db, iso(addDays(now, 1)), iso(addDays(now, UPCOMING_DAYS))),
    testsSvc.attemptsSummary(db),
    classesSvc.list(db),
    peopleSvc.listStudents(db),
    materialsSvc.list(db),
    eventMaterialsSvc.listAll(db),
  ]);
  return {
    todayEvents,
    upcomingEvents,
    attemptsSummary,
    classes,
    students,
    materials,
    eventMaterials,
    studentCount: students.length,
    materialCount: materials.length,
  };
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  return swrLoad(K.dashboard, () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>);
}
clientLoader.hydrate = true as const;

export default function Dashboard() {
  const { user } = useOutletContext<AppContext>();
  const navigate = useNavigate();
  return <DashboardScreen user={user} onNav={(id: string) => navigate('/' + id)} />;
}
