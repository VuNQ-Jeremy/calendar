import type { LoaderFunctionArgs, ClientLoaderFunctionArgs } from 'react-router';
import { useOutletContext, useNavigate } from 'react-router';
import { DashboardScreen } from '../../src/screens-core.jsx';
import type { AppContext } from './_app.js';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import * as eventsSvc from '../../server/services/events';
import * as testsSvc from '../../server/services/tests';
import * as classesSvc from '../../server/services/classes';
import * as peopleSvc from '../../server/services/people';
import * as materialsSvc from '../../server/services/materials';
import { iso, TODAY } from '../../src/lib/core.js';
import { requireStaff } from '../../server/services/auth';
import { K, swrLoad } from '../../src/lib/route-cache.js';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
  const db = createDb(env);
  const today = iso(TODAY);
  const [todayEvents, tests, attemptsSummary, classes, students, materials] = await Promise.all([
    eventsSvc.listForToday(db, today),
    testsSvc.list(db),
    testsSvc.attemptsSummary(db),
    classesSvc.listLite(db),
    peopleSvc.listStudents(db),
    materialsSvc.list(db),
  ]);
  return {
    todayEvents,
    tests,
    attemptsSummary,
    classes,
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
