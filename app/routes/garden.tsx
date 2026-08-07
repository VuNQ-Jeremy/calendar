import { redirect } from 'react-router';
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  ClientLoaderFunctionArgs,
  LoaderFunctionArgs,
} from 'react-router';
import { ClassGardenScreen } from '../../src/garden/class-garden.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireAdmin, requireStaff, requireUser } from '../../server/services/auth';
import * as gardenSvc from '../../server/services/garden';
import * as classesSvc from '../../server/services/classes';
import { GardenDevInput, WaterInput } from '../../shared/schemas';
import { ictDateOf } from '../../shared/logic/tests';
import { K, gardenClassKey, swrLoad, invalidateAfterMutation } from '../../src/lib/route-cache.js';
import { withLiveAction } from '../../server/live';

/**
 * The shared class garden — /garden/:classId, for students AND staff.
 *
 * The class id lives in the PATH, not a query string, for the same reason the leaderboard's month
 * does: `cacheKeyForPath` only ever sees a pathname, so `?class=` would give every class in the
 * school the same cache entry.
 *
 * Today is the ICT day, from `ictDateOf`, never `new Date().getDate()` — the Worker clock is UTC
 * and the school is UTC+7, so between 17:00 and 24:00 UTC the two disagree about what day it is.
 * A plant's wilt and its stage drops are keyed on the ICT day, so getting this wrong would show a
 * different garden to a student at 23:00 than the one the settle logic believes in.
 *
 * Membership is enforced here, not in the component: a student may only read a class they belong
 * to, and asking for someone else's class bounces them to their own rather than 403-ing — a
 * mistyped URL is not an incident.
 */
export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const { user, kind } = await requireUser(request, env);
  const db = createDb(env);
  const vnToday = ictDateOf(new Date().toISOString());
  const isStaff = kind === 'staff';
  const asked = params.classId ?? null;

  // The classes this viewer may look at: every class for staff, their own for a student. Doubles
  // as the picker's options, so a student in two classes can switch between their gardens.
  const mine = isStaff
    ? await classesSvc.listLite(db)
    : await gardenSvc.studentClasses(db, user.id);
  const options = mine.map((c) => ({ id: c.id, name: c.name }));

  if (!asked) {
    if (isStaff) return { mode: 'picker' as const, kind, vnToday, classes: options };
    // A student with no class has nothing to look at; an empty state beats a crash.
    if (options.length === 0) return { mode: 'empty' as const, kind, vnToday };
    throw redirect(`/garden/${options[0].id}`);
  }

  if (!isStaff && !options.some((c) => c.id === asked)) {
    if (options.length === 0) return { mode: 'empty' as const, kind, vnToday };
    throw redirect(`/garden/${options[0].id}`);
  }

  const garden = await gardenSvc.classGarden(db, asked, vnToday);
  if (!garden) throw Response.json({ error: 'unknown_class' }, { status: 404 });

  const snapshots = await gardenSvc.listSnapshots(db, garden.classId);

  // Staff extras. The per-plant history is fetched HERE rather than through a lazy `history`
  // intent: the alternative is a second round trip per popover, and 20-odd small reads on a
  // teacher-only route is the cheaper trade. Students never receive it — it names the teacher who
  // watered, and it is the audit trail, not part of the game.
  type Block = NonNullable<Awaited<ReturnType<typeof gardenSvc.assignmentProgress>>>;
  let assignments: Block[] = [];
  let history: Record<string, gardenSvc.GardenEventRow[]> = {};
  if (isStaff) {
    const rows = await gardenSvc.listAssignments(db, { classId: garden.classId });
    const [blocks, pairs] = await Promise.all([
      Promise.all(rows.map((a) => gardenSvc.assignmentProgress(db, a.id))),
      Promise.all(
        garden.members.map(
          async (m) => [m.studentId, await gardenSvc.plantHistory(db, m.studentId, 20)] as const,
        ),
      ),
    ]);
    assignments = blocks.filter((b): b is Block => b !== null);
    history = Object.fromEntries(pairs);
  }

  return {
    mode: 'garden' as const,
    kind,
    vnToday,
    prevMonth: gardenSvc.previousMonth(vnToday),
    garden,
    classes: options,
    snapshots,
    assignments,
    history,
    // Lets the viewer's own plant be highlighted in a grid that is otherwise deliberately flat.
    viewerStudentId: kind === 'student' ? user.id : null,
    // Gates the test tools. Admin-only, and checked again in the action — this flag only decides
    // whether the button is drawn.
    isAdmin: isStaff && user.role === 'Admin',
  };
}

export async function clientLoader({ params, serverLoader }: ClientLoaderFunctionArgs) {
  const key = params.classId ? gardenClassKey(params.classId) : K.garden;
  return swrLoad(key, () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>);
}
clientLoader.hydrate = true as const;

async function actionImpl({ request, params, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  // Everything writable on this screen is a teacher's doing; students only ever read it.
  const { user } = await requireStaff(request, env);
  const db = createDb(env);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;

  if (intent === 'water') {
    const raw = Object.fromEntries(formData) as Record<string, unknown>;
    // An empty note field arrives as '', which would store a blank string in the audit trail.
    if (raw.note === '') raw.note = null;
    const parsed = WaterInput.safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await gardenSvc.water(db, user.id, parsed.data.studentId, parsed.data.note ?? null);
    return { ok: true };
  }

  // Writing the album by hand. The daily cron does this on the 1st, but crons do not run in the
  // e2e environment, and a teacher who wants last month's keepsake now should not have to wait a
  // month for it. `snapshotMonth` is idempotent, so pressing it twice is harmless.
  if (intent === 'snapshot-month') {
    const vnToday = ictDateOf(new Date().toISOString());
    const raw = (formData.get('month') as string | null) ?? '';
    const month = /^\d{4}-\d{2}$/.test(raw) ? raw : gardenSvc.previousMonth(vnToday);
    const classId = params.classId;
    if (!classId) return Response.json({ error: 'missing classId' }, { status: 400 });
    await gardenSvc.snapshotMonth(db, month, classId);
    return { ok: true, month };
  }

  // Admin test tools. Gated on requireAdmin rather than requireStaff: these dial a plant to any
  // stage and can wipe its history, which is a debugging affordance, not a teaching one.
  if (intent === 'dev-set' || intent === 'dev-reset') {
    const admin = await requireAdmin(request, env);
    if (intent === 'dev-reset') {
      const studentId = formData.get('studentId') as string | null;
      if (!studentId) return Response.json({ error: 'missing studentId' }, { status: 400 });
      await gardenSvc.devResetPlant(db, studentId);
      return { ok: true };
    }
    const parsed = GardenDevInput.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await gardenSvc.devSetPlant(db, admin.user.id, parsed.data);
    return { ok: true };
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

export const action = withLiveAction('garden', actionImpl);

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  try {
    return await serverAction();
  } finally {
    invalidateAfterMutation('garden');
  }
}

export default function Garden() {
  return <ClassGardenScreen />;
}
