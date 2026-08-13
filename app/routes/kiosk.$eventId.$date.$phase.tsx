import type { LoaderFunctionArgs } from 'react-router';
import { eq } from 'drizzle-orm';
import { KioskScreen } from '../../src/kiosk/kiosk.jsx';
import { createDb } from '../../server/db/index';
import { events } from '../../server/db/schema';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as classesSvc from '../../server/services/classes';
import * as peopleSvc from '../../server/services/people';
import * as checkinSvc from '../../server/services/checkin';
import { ictDateOf } from '../../shared/logic/tests';

/**
 * The classroom kiosk — a fullscreen shared-device screen, opened by a logged-in teacher
 * (from the event modal or the dashboard). Registered OUTSIDE the `_app` layout, the same
 * reasoning as the printable documents: no app shell, no nav chrome, and — the reason that
 * matters here — no LIVE_HUB socket (that only mounts inside `_app`), so the screen refreshes
 * by revalidating rather than by push. Kids never authenticate; every write still goes
 * through the teacher's own staff cookie via /checkin.
 */
export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
  const db = createDb(env);
  const { eventId, date, phase } = params;
  if (!eventId || !date || (phase !== 'checkin' && phase !== 'checkout')) {
    throw new Response('Not found', { status: 404 });
  }

  const evRows = await db.select().from(events).where(eq(events.id, eventId));
  const ev = evRows[0];
  if (!ev || !ev.classId) throw new Response('Not found', { status: 404 });
  const cls = await classesSvc.get(db, ev.classId);
  if (!cls) throw new Response('Not found', { status: 404 });

  const [occ, settings, tallies, allStudents] = await Promise.all([
    checkinSvc.getOccurrence(db, eventId, date),
    checkinSvc.getCheckinSettings(db),
    checkinSvc.classMonthTallies(db, ev.classId, ictDateOf(new Date().toISOString()).slice(0, 7)),
    peopleSvc.listStudents(db),
  ]);

  const roster = cls.studentIds
    .map((sid) => allStudents.find((s) => s.id === sid))
    .filter((s): s is peopleSvc.StudentRow => !!s)
    .map((s) => ({ id: s.id, name: s.name, color: s.color }));
  return {
    eventId,
    date,
    phase,
    className: cls.name,
    roster,
    items: occ.items.filter((i) => i.phase === phase),
    checks: occ.checks,
    activityTypes: occ.activityTypes,
    settings,
    bagsByStudent: Object.fromEntries(
      cls.studentIds.map((sid) => [sid, tallies.get(sid)?.bags ?? 0]),
    ),
  };
}

export default function Kiosk() {
  return <KioskScreen />;
}
