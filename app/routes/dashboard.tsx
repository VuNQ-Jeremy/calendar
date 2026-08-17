import type { LoaderFunctionArgs, ClientLoaderFunctionArgs } from 'react-router';
import { useOutletContext, useNavigate, useLoaderData, Link } from 'react-router';
import { DashboardScreen, UPCOMING_DAYS } from '../../src/screens-core.jsx';
import type { AppContext } from './_app.js';
import { tenantDbFor } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import * as eventsSvc from '../../server/services/events';
import * as testsSvc from '../../server/services/tests';
import * as classesSvc from '../../server/services/classes';
import * as peopleSvc from '../../server/services/people';
import * as materialsSvc from '../../server/services/materials';
import * as eventMaterialsSvc from '../../server/services/event-materials';
import * as classMaterialsSvc from '../../server/services/class-materials';
import { ictDateOf } from '../../shared/logic/tests';
import { addDaysIso } from '../../server/services/notify';
import { requireStaff } from '../../server/services/auth';
import { K, swrLoad } from '../../src/lib/route-cache.js';
import { useLang } from '../../src/lib/i18n.jsx';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const staff = await requireStaff(request, env);
  const db = tenantDbFor(env, staff);
  // A fresh clock, not the module-level TODAY: a Worker isolate can outlive the day it booted on,
  // and the two windows below must agree with each other.
  //
  // The ICT day, never `iso(now)`. shared/logic/dates works in the LOCAL zone by design, and a
  // Worker's local zone is UTC — so before 07:00 in Vietnam this dated "today" to yesterday and
  // both windows below slid with it. Every other route already goes through `ictDateOf`; these
  // two dashboards were the last holdouts.
  const today = ictDateOf(new Date().toISOString());
  // Both schedule cards open the same event dialog the calendar uses, so this loader has to feed
  // it too: full classes (its attendance and check-in tabs read `studentIds`), the student and
  // material rows, and both material joins. `listLite` was enough when the cards only showed
  // a class name; it is not enough to edit an event.
  const [
    todayEvents,
    upcomingEvents,
    attemptsSummary,
    classes,
    students,
    materials,
    eventMaterials,
    classMaterials,
  ] = await Promise.all([
    eventsSvc.listForToday(db, today),
    // Tomorrow .. +UPCOMING_DAYS for the "Coming up" card. Recurring rows come back whatever
    // their stored date; the screen expands them over the same window.
    eventsSvc.listRange(db, addDaysIso(today, 1), addDaysIso(today, UPCOMING_DAYS)),
    testsSvc.attemptsSummary(db),
    classesSvc.list(db),
    peopleSvc.listStudents(db),
    materialsSvc.list(db),
    eventMaterialsSvc.listAll(db),
    classMaterialsSvc.listAll(db),
  ]);
  return {
    todayEvents,
    upcomingEvents,
    attemptsSummary,
    classes,
    students,
    materials,
    eventMaterials,
    classMaterials,
    studentCount: students.length,
    materialCount: materials.length,
  };
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  return swrLoad(K.dashboard, () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>);
}
clientLoader.hydrate = true as const;

/**
 * What a school sees on its first morning.
 *
 * A brand-new school's dashboard is structurally empty — no sessions today, no attendance, no
 * grading queue — and an empty dashboard reads as a broken one. This card replaces that silence
 * with the three moves that make the rest of the app light up, and retires itself the moment
 * either one has happened, so an established school never sees it.
 */
function GettingStarted() {
  const { t } = useLang();
  return (
    <section className="mochi-card gs-card">
      <h2 className="gs-card__title">{t('gs_title')}</h2>
      <p className="gs-card__sub">{t('gs_sub')}</p>
      <ol className="gs-card__steps">
        <li>
          <Link to="/classes">{t('gs_classes')}</Link>
        </li>
        <li>
          <Link to="/people">{t('gs_people')}</Link>
        </li>
        <li>
          <Link to="/config">{t('gs_config')}</Link>
        </li>
      </ol>
    </section>
  );
}

export default function Dashboard() {
  const { user } = useOutletContext<AppContext>();
  const { classes, students } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const empty = classes.length === 0 || students.length === 0;
  return (
    <>
      {user.role === 'Admin' && empty && <GettingStarted />}
      <DashboardScreen user={user} onNav={(id: string) => navigate('/' + id)} />
    </>
  );
}
