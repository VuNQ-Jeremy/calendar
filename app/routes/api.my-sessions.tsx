import { withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/session-preview';

/**
 * Upcoming sessions with their previews — what the student's "Lịch học" screen shows.
 *
 * Auth level 'user', not 'staff': this is the one session-shaped endpoint a student may read, and
 * they see only the classes they are enrolled in. A staff caller gets every class, which is the
 * teacher's own "what am I preparing" list. 'user' also excludes parents, which matters here —
 * the empty filter means "every class", so a third kind would fall into the teacher's list.
 * A parent's equivalent is /api/parent/home, which fans out per child instead.
 *
 * Tests appear as title + window only. Nothing here goes near a question or an answer key.
 *
 * Computed against the server clock, like /my-tests — clients refetch rather than cache this.
 */
export const loader = withAuth('user', async ({ db, user, request }) => {
  const raw = Number(new URL(request.url).searchParams.get('days') ?? 7);
  const days = Math.min(14, Math.max(1, Number.isFinite(raw) ? Math.trunc(raw) : 7));
  const who = user.kind === 'student' ? { studentId: user.user.id } : {};
  return svc.upcomingSessions(db, who, days);
});
