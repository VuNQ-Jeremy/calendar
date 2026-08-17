import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { eq } from 'drizzle-orm';
import { tenantDbFor, type TenantDb } from '../../server/db/index';
import { classStudents, events } from '../../server/db/schema';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as checkinSvc from '../../server/services/checkin';
import { CheckInput, ChecklistItemInput, parsePatch } from '../../shared/schemas';
import { monthOfVn } from '../../shared/logic/garden';
import { withLiveAction } from '../../server/live';

/**
 * Cookie-authed resource route for the check-in/check-out feature — the ONE mutation
 * surface. Both the event modal's authoring tab and the kiosk submit here. NOT under
 * /api/ (bearer-only; a browser fetcher there 401s silently — the garden-month trap).
 */

/**
 * The scoped event read here is also the fence for the whole kiosk payload: another school's
 * eventId resolves to no class, so the roster comes back empty and the checklist service —
 * which fences on the same read — has nothing to hand back either.
 */
async function rosterOf(
  db: TenantDb,
  eventId: string,
): Promise<{ classId: string | null; studentIds: string[] }> {
  const ev = await db.raw
    .select({ classId: events.classId })
    .from(events)
    .where(db.own(events, eq(events.id, eventId)));
  const classId = ev[0]?.classId ?? null;
  if (!classId) return { classId: null, studentIds: [] };
  const rows = await db.raw
    .select({ studentId: classStudents.studentId })
    .from(classStudents)
    .where(db.own(classStudents, eq(classStudents.classId, classId)));
  return { classId, studentIds: rows.map((r) => r.studentId) };
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const user = await requireStaff(request, env);
  const db = tenantDbFor(env, user);
  const url = new URL(request.url);
  const eventId = url.searchParams.get('eventId');
  const date = url.searchParams.get('date');
  if (!eventId || !date) return Response.json({ error: 'missing params' }, { status: 400 });
  const [occ, roster] = await Promise.all([
    checkinSvc.getOccurrence(db, eventId, date),
    rosterOf(db, eventId),
  ]);
  const flags = await checkinSvc.occurrenceFlags(db, eventId, date, roster.studentIds);
  // Only the kiosk asks for bag counts — its name grid badges each kid's month so far. The
  // authoring tab shares this route and opens far more often, and has no use for a whole-class
  // month aggregate, so it does not pay for one.
  if (url.searchParams.get('kiosk') !== '1' || !roster.classId) return { ...occ, flags };
  const tallies = await checkinSvc.classMonthTallies(db, roster.classId, monthOfVn(date));
  return {
    ...occ,
    flags,
    bagsByStudent: Object.fromEntries(
      roster.studentIds.map((sid) => [sid, tallies.get(sid)?.bags ?? 0]),
    ),
  };
}

async function actionImpl({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const staff = await requireStaff(request, env);
  const db = tenantDbFor(env, staff);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;
  const id = formData.get('id') as string | null;
  const raw = Object.fromEntries(formData) as Record<string, unknown>;
  const now = new Date().toISOString();

  if (intent === 'create-item') {
    const parsed = ChecklistItemInput.safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    const item = await checkinSvc.createItem(db, parsed.data, staff.user.id, now);
    // null = the eventId names an occurrence outside this school; same answer as a missing one.
    if (!item) return Response.json({ error: 'not found' }, { status: 404 });
    return { ok: true, item };
  }

  if (intent === 'update-item') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    const parsed = parsePatch(ChecklistItemInput, raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    const item = await checkinSvc.updateItem(db, id, {
      activityTypeId: parsed.data.activityTypeId,
      label: parsed.data.label,
    });
    if (!item) return Response.json({ error: 'not found' }, { status: 404 });
    return { ok: true, item };
  }

  if (intent === 'delete-item') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    await checkinSvc.deleteItem(db, id);
    return { ok: true };
  }

  if (intent === 'reorder-items') {
    let ids: unknown;
    try {
      ids = JSON.parse((formData.get('ids') as string) ?? '');
    } catch {
      return Response.json({ error: 'invalid ids' }, { status: 400 });
    }
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string' && x)) {
      return Response.json({ error: 'invalid ids' }, { status: 400 });
    }
    await checkinSvc.reorderItems(db, ids);
    return { ok: true };
  }

  if (intent === 'check') {
    const parsed = CheckInput.safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    const result = await checkinSvc.setCheck(db, parsed.data, now);
    if (!result) return Response.json({ error: 'not found' }, { status: 404 });
    return { ok: true, ...result };
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

// A kiosk 'check' also writes attendance (auto-present), so other tabs must refresh
// their attendance-derived views too; item authoring touches only checkin surfaces.
export const action = withLiveAction(
  (intent) => (intent === 'check' ? (['checkin', 'attendance'] as const) : 'checkin'),
  actionImpl,
);
