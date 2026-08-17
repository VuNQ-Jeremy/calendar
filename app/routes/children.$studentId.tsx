import { redirect } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import { ParentChildScreen } from '../../src/parent/child.jsx';
import { tenantDbFor } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireParent } from '../../server/services/auth';
import * as parentPortalSvc from '../../server/services/parent-portal';
import * as peopleSvc from '../../server/services/people';
import * as classesSvc from '../../server/services/classes';
import * as attendanceSvc from '../../server/services/attendance';
import { TuitionMonth } from '../../shared/schemas';
import { ictDateOf } from '../../shared/logic/tests';

/**
 * One child, one month: the attendance roll, plus the way into that month's two documents.
 *
 * The ICT month, not the Worker's UTC one — duplicated from routes/rankings.tsx for the reason
 * given there (sharing a module local between route modules defeats route-chunk splitting).
 */
function currentIctMonth(now = new Date()): string {
  return ictDateOf(now.toISOString()).slice(0, 7);
}

function requireMonth(raw: string | undefined): string {
  const parsed = TuitionMonth.safeParse(raw ?? currentIctMonth());
  if (!parsed.success) throw Response.json({ error: 'bad_month' }, { status: 400 });
  return parsed.data;
}

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const parent = await requireParent(request, env);
  const { user } = parent;
  const db = tenantDbFor(env, parent);
  const studentId = params.studentId!;
  const month = requireMonth(params.month);

  // Portal off, or somebody else's child — a page, so bounce rather than show a 403 body. This is
  // the one check standing between a parent and every other family's roll; see parent-portal.ts.
  try {
    await parentPortalSvc.portalChild(db, user.id, studentId);
  } catch {
    throw redirect('/profile');
  }

  const [allStudents, classes, attendance] = await Promise.all([
    peopleSvc.listStudents(db),
    classesSvc.listLite(db),
    // Month range is the project convention: `${month}-01`..`${month}-31`, compared lexically.
    attendanceSvc.historyForStudent(db, studentId, { from: `${month}-01`, to: `${month}-31` }),
  ]);

  const student = allStudents.find((s) => s.id === studentId);
  if (!student) throw Response.json({ error: 'unknown_student' }, { status: 404 });

  return {
    month,
    student: { id: student.id, name: student.name, color: student.color },
    classNames: classes.filter((c) => student.classIds.includes(c.id)).map((c) => c.name),
    attendance,
  };
}

export default function Child() {
  return <ParentChildScreen />;
}
