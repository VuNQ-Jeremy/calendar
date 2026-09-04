import { fail, parseBody, withAuth } from '../../server/api/handler';
import * as practiceSvc from '../../server/services/practice';
import { PracticeExcuseRequestInput } from '../../shared/schemas';
import { ictDateOf } from '../../shared/logic/tests';

/**
 * POST /api/practice/excuse — the student asks to be let off one practice day.
 *
 * Only before that day's deadline (decision #18): once the 00:00 cron has judged the day, an
 * excuse is a teacher action on the resulting miss, not a request. 409 rather than 422 for that
 * case, because the payload was fine — the moment was not.
 */
export const action = withAuth(
  'user',
  async ({ db, request, user }) => {
    if (user.kind !== 'student') throw fail('forbidden', 403);
    if (request.method !== 'POST') throw fail('method_not_allowed', 405);
    const input = await parseBody(request, PracticeExcuseRequestInput);
    const today = ictDateOf(new Date().toISOString());
    try {
      const row = await practiceSvc.requestExcuse(db, user.user.id, input, today);
      return {
        id: row.id,
        classId: row.classId,
        date: row.date,
        reason: row.reason,
        status: row.status,
        requestedAt: row.requestedAt,
      };
    } catch (err) {
      const code = err instanceof Error ? err.message : 'internal_error';
      const status =
        code === 'deadline_passed' || code === 'already_requested'
          ? 409
          : code === 'not_found'
            ? 404
            : 500;
      throw fail(code, status);
    }
  },
  { live: 'practice' },
);
