import { redirect } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import { ParentChildrenScreen } from '../../src/parent/children.jsx';
import { tenantDbFor } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireParent } from '../../server/services/auth';
import * as parentPortalSvc from '../../server/services/parent-portal';
import * as peopleSvc from '../../server/services/people';
import * as classesSvc from '../../server/services/classes';
import * as previewSvc from '../../server/services/session-preview';

/**
 * A parent's home: their children, and what each one has coming up.
 *
 * DELIBERATELY NO clientLoader / no route cache, for the same reason as my-schedule.tsx — a
 * session leaves the list once it has ended, computed against the SERVER clock, and a cached
 * payload would keep showing a class that finished an hour ago.
 *
 * The portal's 403 becomes a redirect here: this is a page, and a parent who arrives with the
 * portal switched off should land on the app they do have rather than read an error. The
 * document routes and /api/parent/* keep the 403 — a machine caller wants the status code.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const parent = await requireParent(request, env);
  const { user } = parent;
  const db = tenantDbFor(env, parent);

  let studentIds: string[];
  try {
    studentIds = await parentPortalSvc.portalChildIds(db, user.id);
  } catch {
    throw redirect('/profile');
  }

  const [allStudents, classes] = await Promise.all([
    peopleSvc.listStudents(db),
    classesSvc.listLite(db),
  ]);
  const mine = allStudents.filter((s) => studentIds.includes(s.id));

  // One call per child rather than a multi-student query: families have one to three children,
  // and per-child calls give the per-child grouping this screen shows for free. `UpcomingSession`
  // carries no studentId, so a single combined call could not be split back apart.
  const schedules = await Promise.all(
    mine.map((s) => previewSvc.upcomingSessions(db, { studentId: s.id }, 7)),
  );

  return {
    serverNow: schedules[0]?.serverNow ?? new Date().toISOString(),
    children: mine.map((s, i) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      classNames: classes.filter((c) => s.classIds.includes(c.id)).map((c) => c.name),
      items: schedules[i].items,
    })),
  };
}

export default function Children() {
  return <ParentChildrenScreen />;
}
