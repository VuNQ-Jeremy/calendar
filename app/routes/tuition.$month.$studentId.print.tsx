import type { LoaderFunctionArgs } from 'react-router';
import { FeeSlipView } from '../../src/tuition/fee-slip.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireUser, requireAdmin } from '../../server/services/auth';
import * as parentPortalSvc from '../../server/services/parent-portal';
import { buildFeeSlip } from '../../server/services/fee-slip';
import { TuitionMonth } from '../../shared/schemas';

/**
 * Tuition slip (phiếu thu) for one student and one month.
 *
 * Registered OUTSIDE the `_app` layout — a document, not an app screen: no shell, no nav chrome,
 * and no route cache (`cacheKeyForPath` only matches the single-segment month URL).
 *
 * The slip is copied to the clipboard as an image (parents get it over Zalo), not printed, so this
 * is really a rendering surface for `src/tuition/slip-themes.tsx`. `buildFeeSlip`'s shape is the
 * theme contract: flat, self-contained, and the same for every theme — adding a theme touches no
 * server code at all.
 *
 * Two callers, two guards. Staff still need Admin, exactly as before — money stays admin-only. A
 * PARENT may open their own child's slip once an admin has switched the portal on, which is the
 * one loosening here: `portalChild` checks both the toggle and the parent_students link, and the
 * family already receives this same slip over Zalo today.
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
  else await requireAdmin(request, env);

  const data = await buildFeeSlip(db, studentId, month);
  if (!data) throw Response.json({ error: 'unknown_student' }, { status: 404 });
  return data;
}

export default function TuitionSlipPrint() {
  return <FeeSlipView />;
}
