import { redirect } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import { ReportSlipView } from '../../src/assessments/report-slip.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireUser, homeFor } from '../../server/services/auth';
import * as parentPortalSvc from '../../server/services/parent-portal';
import { buildReportCard } from '../../server/services/report-card';
import { TuitionMonth } from '../../shared/schemas';

/**
 * Monthly report (phiếu nhận xét) for one student and one month.
 *
 * Registered OUTSIDE the `_app` layout, for the same reason as the tuition slip: a document, not
 * an app screen — no shell, no nav chrome, no route cache. The teacher copies it as an image and
 * sends it over Zalo, which is still how most families receive it.
 *
 * Two callers, two guards. Staff at `requireStaff` strength, not `requireAdmin` — every other
 * assessments surface is staff-level, and the teacher who wrote the remark has to be able to hand
 * it over. A PARENT may open it for their own child once an admin has switched the portal on;
 * `portalChild` answers both halves of that (see server/services/parent-portal.ts) and 403s
 * otherwise.
 *
 * The payload itself is `buildReportCard`, shared with /api/parent/report/* so the phone cannot
 * drift from the printed slip.
 */
export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const db = createDb(env);

  const parsedMonth = TuitionMonth.safeParse(params.month);
  if (!parsedMonth.success) throw Response.json({ error: 'bad_month' }, { status: 400 });
  const month = parsedMonth.data;
  const studentId = params.studentId!;

  const viewer = await requireUser(request, env);
  if (viewer.kind === 'parent') await parentPortalSvc.portalChild(db, viewer.user.id, studentId);
  else if (viewer.kind !== 'staff') throw redirect(homeFor(viewer.kind));

  const data = await buildReportCard(db, studentId, month);
  if (!data) throw Response.json({ error: 'unknown_student' }, { status: 404 });
  return data;
}

export default function AssessmentReportPrint() {
  return <ReportSlipView />;
}
