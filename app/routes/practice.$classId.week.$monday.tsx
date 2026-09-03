import type { ClientLoaderFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { redirect } from 'react-router';
import { PracticeWeekScreen } from '../../src/practice/practice-week.js';
import { tenantDbFor } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as classesSvc from '../../server/services/classes';
import * as materialsSvc from '../../server/services/materials';
import * as practiceSvc from '../../server/services/practice';
import { PracticeDate } from '../../shared/schemas';
import { addDays, iso, parseISO } from '../../shared/logic/dates';
import { weekdayOf } from '../../shared/logic/practice';
import { ictDateOf } from '../../shared/logic/tests';
import { practiceWeekKey, swrLoad } from '../../src/lib/route-cache.js';

/**
 * One class's week of practice: Mon–Sun columns, the tasks planned on each, and every copy so a
 * column can show its own done/total without a second round trip.
 *
 * The Monday is in the PATH rather than a query string so the week is linkable and the browser
 * back button walks weeks; a non-Monday is redirected rather than rendered, so there is exactly
 * one URL per week and the cache cannot hold two.
 */
export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const staff = await requireStaff(request, env);
  const db = tenantDbFor(env, staff);

  const classId = params.classId!;
  const parsed = PracticeDate.safeParse(params.monday ?? '');
  if (!parsed.success) throw Response.json({ error: 'bad_date' }, { status: 400 });
  const monday = parsed.data;
  if (weekdayOf(monday) !== 1) {
    const d = parseISO(monday);
    // getDay() is 0=Sun, so a Sunday belongs to the week that started six days earlier.
    const back = (d.getDay() + 6) % 7;
    throw redirect(`/practice/${classId}/week/${iso(addDays(d, -back))}`);
  }
  const sunday = iso(addDays(parseISO(monday), 6));

  const cls = await classesSvc.get(db, classId);
  if (!cls) throw new Response(null, { status: 404 });

  const [settings, overrides, practiceDays, tasks, copies, roster, materials] = await Promise.all([
    practiceSvc.getSettings(db, classId),
    practiceSvc.listOverrides(db, classId, monday, sunday),
    practiceSvc.practiceDays(db, classId, monday, sunday),
    practiceSvc.listTasks(db, classId, monday, sunday),
    practiceSvc.listStudentTasks(db, classId, monday, sunday),
    classesSvc.listRosterNames(db).then((r) => r.filter((x) => x.classId === classId)),
    materialsSvc.list(db),
  ]);

  return {
    classId,
    monday,
    sunday,
    today: ictDateOf(new Date().toISOString()),
    cls,
    settings,
    overrides,
    practiceDays,
    tasks,
    copies,
    roster,
    materials,
  };
}

export async function clientLoader({ params, serverLoader }: ClientLoaderFunctionArgs) {
  return swrLoad(
    practiceWeekKey(params.classId!, params.monday!),
    () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>,
  );
}
clientLoader.hydrate = true as const;

export default PracticeWeekScreen;
