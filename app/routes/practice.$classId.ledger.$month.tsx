import type { ClientLoaderFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { PracticeLedgerScreen } from '../../src/practice/practice-ledger.js';
import { tenantDbFor } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as classesSvc from '../../server/services/classes';
import * as practiceSvc from '../../server/services/practice';
import * as zalo from '../../server/services/zalo';
import { TuitionMonth } from '../../shared/schemas';
import { K, practiceLedgerKey, swrLoad } from '../../src/lib/route-cache.js';

/**
 * The month's ledger for one class: per student, what got done, how much of the excused quota is
 * spent, and whether anything can actually reach a parent.
 *
 * `hasZalo` is resolved here rather than in the screen because "no pairing" is the difference
 * between a miss the family heard about and one they did not — the row has to say so even though
 * the pairing lives in a different table (decision #25).
 *
 * `TuitionMonth` is reused for the YYYY-MM shape; it is a plain regex schema with no fee meaning.
 */
export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const staff = await requireStaff(request, env);
  const db = tenantDbFor(env, staff);

  const classId = params.classId!;
  const parsed = TuitionMonth.safeParse(params.month ?? '');
  if (!parsed.success) throw Response.json({ error: 'bad_month' }, { status: 400 });
  const month = parsed.data;

  const cls = await classesSvc.get(db, classId);
  if (!cls) throw new Response(null, { status: 404 });

  const [base, pendingExcuses] = await Promise.all([
    practiceSvc.classLedger(db, classId, month),
    practiceSvc.listExcuses(db, { classId, status: 'pending' }),
  ]);
  // One lookup per student: a class is ≤ 40 people, and batching would mean a second index.
  const rows = await Promise.all(
    base.map(async (r) => ({
      ...r,
      hasZalo: (await zalo.chatsForParentsOfStudents(db, [r.studentId])).length > 0,
    })),
  );

  return { classId, cls, month, rows, pendingExcuses };
}

export async function clientLoader({ params, serverLoader }: ClientLoaderFunctionArgs) {
  const key =
    params.classId && params.month ? practiceLedgerKey(params.classId, params.month) : K.practice;
  return swrLoad(key, () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>);
}
clientLoader.hydrate = true as const;

export default PracticeLedgerScreen;
