import { fail, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/garden';
import { TuitionMonth } from '../../shared/schemas';
import { ictDateOf } from '../../shared/logic/tests';

/**
 * One student's garden month — the garden block on the assessments monthly report.
 *
 * A separate endpoint rather than part of the `/assessments` loader because both of that screen's
 * report controls (student, month) are client state behind one SWR cache key: folding this in would
 * mean loading every student's every month up front to serve one pair. The report tab fetches the
 * pair it is actually showing.
 *
 * `TuitionMonth` is the project's shared 'YYYY-MM' guard (it predates this use; the name is about
 * where it started, not what it validates). Today is the ICT day for the same reason as everywhere
 * else in the garden — the Worker clock is UTC and a plant's wilt is keyed on the ICT day.
 */
export const loader = withAuth('staff', async ({ db, params, request }) => {
  if (!params.id) throw fail('missing_id', 400);
  const raw = new URL(request.url).searchParams.get('month');
  const parsed = TuitionMonth.safeParse(raw);
  if (!parsed.success) throw fail('bad_month', 400);
  return svc.studentGardenMonth(db, params.id, parsed.data, ictDateOf(new Date().toISOString()));
});
