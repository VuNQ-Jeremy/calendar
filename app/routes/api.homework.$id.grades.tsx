import { fail, parseBody, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/homework';
import { HomeworkGradesSaveInput } from '../../shared/schemas';

/**
 * Grades for one homework. Mirrors `intent=save-grades` on the web route: the whole set is
 * saved in a single request, not one row at a time.
 *
 * Note saveGrades may also create score_records rows — see server/services/homework.ts.
 */
export const loader = withAuth('staff', async ({ params, db }) => {
  const homeworkId = params.id;
  if (!homeworkId) throw fail('missing_id', 400);
  const all = await svc.listGrades(db);
  return all.filter((g) => g.homeworkId === homeworkId);
});

export const action = withAuth('staff', async ({ request, params, db }) => {
  const homeworkId = params.id;
  if (!homeworkId) throw fail('missing_id', 400);
  const input = await parseBody(request, HomeworkGradesSaveInput);
  return svc.saveGrades(db, homeworkId, input.records);
});
