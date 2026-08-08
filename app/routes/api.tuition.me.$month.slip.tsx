import { fail, withAuth } from '../../server/api/handler';
import * as tuitionSvc from '../../server/services/tuition';
import * as peopleSvc from '../../server/services/people';
import { renderSlipPng } from '../../server/slip/render';
import { isSlipThemeId } from '../../server/slip/themes';
import { TuitionMonth } from '../../shared/schemas';

/**
 * The student's own fee slip (phiếu thu) as a PNG, for the phone's share sheet.
 *
 * Rendered on the server because the browser path (html-to-image) needs a DOM that React Native
 * does not have. Same visibility rules as the month detail: closed months only, self-scoped, and
 * open/missing/empty all answer 404.
 *
 * Returns a raw Response rather than the `{ data }` envelope — `withAuth` passes a Response
 * through untouched.
 */
export const loader = withAuth('user', async ({ db, env, user, params, request }) => {
  if (user.kind !== 'student') throw fail('forbidden', 403);

  const parsedMonth = TuitionMonth.safeParse(params.month);
  if (!parsedMonth.success) throw fail('bad_month', 400);

  const themeParam = new URL(request.url).searchParams.get('theme') ?? 'minimal';
  if (!isSlipThemeId(themeParam)) throw fail('bad_theme', 400);

  const detail = await tuitionSvc.getStudentMonthDetail(db, user.user.id, parsedMonth.data);
  if (!detail) throw fail('not_found', 404);

  // The paper pads carry an SĐT line. Students have no phone column, so it comes from the first
  // linked parent who has one — same rule as the admin print route.
  const parents = await peopleSvc.listParents(db);
  const phone = parents.find((p) => p.studentIds.includes(user.user.id) && p.phone)?.phone ?? null;

  const png = await renderSlipPng(
    env,
    {
      month: detail.month,
      student: { id: user.user.id, name: user.user.name, guardian: null, phone },
      fee: detail.fee,
    },
    themeParam,
  );

  return new Response(png as unknown as BodyInit, {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': `inline; filename="phieu-thu-${detail.month}.png"`,
      // One student's money — never a shared cache.
      'Cache-Control': 'private, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
});
