import { withAuth } from '../../server/api/handler';
import * as parentPortalSvc from '../../server/services/parent-portal';
import * as peopleSvc from '../../server/services/people';
import * as classesSvc from '../../server/services/classes';
import * as previewSvc from '../../server/services/session-preview';

/**
 * The parent app's cold start: every child, their classes, and the week ahead — in one round trip.
 *
 * Same reasoning as /api/bootstrap: a phone on mobile data pays for round trips, and a screen that
 * needs three of them before it can draw anything shows three spinners. The web twin is the loader
 * in app/routes/children.tsx.
 *
 * `portalChildIds` is the gate: it 403s when an admin has the portal switched off, and it returns
 * the authorization set (`parent_students`) rather than trusting anything from the request.
 *
 * Computed against the server clock — a session drops off once it has ended, so clients refetch
 * rather than cache this. `serverNow` is what the day labels are computed against.
 */
export const loader = withAuth('parent', async ({ db, user, request }) => {
  const raw = Number(new URL(request.url).searchParams.get('days') ?? 7);
  const days = Math.min(14, Math.max(1, Number.isFinite(raw) ? Math.trunc(raw) : 7));

  const studentIds = await parentPortalSvc.portalChildIds(db, user.user.id);
  const [allStudents, classes] = await Promise.all([
    peopleSvc.listStudents(db),
    classesSvc.listLite(db),
  ]);
  const mine = allStudents.filter((s) => studentIds.includes(s.id));

  // One call per child: `UpcomingSession` carries no studentId, so a single combined call could
  // not be split back apart, and a family has one to three children.
  const schedules = await Promise.all(
    mine.map((s) => previewSvc.upcomingSessions(db, { studentId: s.id }, days)),
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
});
