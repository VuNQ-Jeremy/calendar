import type { ClientLoaderFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { PracticeSheetScreen } from '../../src/practice/practice-sheet.js';
import { tenantDbFor } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as classesSvc from '../../server/services/classes';
import * as materialsSvc from '../../server/services/materials';
import * as practiceSvc from '../../server/services/practice';
import * as zalo from '../../server/services/zalo';
import type { ClassRow } from '../../server/services/classes';
import type { MaterialRow } from '../../server/services/materials';
import type {
  ExcuseRow,
  LedgerRow,
  PracticeSettingsRow,
  StudentTaskRow,
} from '../../server/services/practice';
import { TuitionMonth } from '../../shared/schemas';
import { lastDayOfMonth } from '../../shared/logic/practice-sheet';
import { ictDateOf } from '../../shared/logic/tests';
import { practiceMonthKey, swrLoad } from '../../src/lib/route-cache.js';

export interface SheetLoaderData {
  classId: string;
  month: string;
  today: string;
  cls: ClassRow;
  settings: PracticeSettingsRow | null;
  practiceDays: string[];
  copies: StudentTaskRow[];
  roster: { classId: string; id: string; name: string }[];
  materials: MaterialRow[];
  /** Pending requests for this class and month, every student. */
  excuses: ExcuseRow[];
  /** One per enrolled student: month summary, misses, Zalo pairing. */
  ledger: LedgerRow[];
}

/**
 * The Practice sheet: one class, one month, every student's copies — the week planner, the review
 * queue and the ledger folded into a single screen (spec: docs/superpowers/specs/2026-09-04-…).
 *
 * The month is in the PATH because cacheKeyForPath only sees pathnames. The student tab is a query
 * parameter on purpose: every tab renders from THIS payload, so one cache entry per class-month is
 * right. `TuitionMonth` is reused for the YYYY-MM shape; it is a plain regex with no fee meaning.
 *
 * `hasZalo` is resolved here (one lookup per student — a class is 1–3 people) because "no pairing"
 * is the difference between a miss the family heard about and one they did not (decision #25).
 */
export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const staff = await requireStaff(request, env);
  const db = tenantDbFor(env, staff);

  const classId = params.classId!;
  const parsed = TuitionMonth.safeParse(params.month ?? '');
  if (!parsed.success) throw Response.json({ error: 'bad_month' }, { status: 400 });
  const month = parsed.data;
  const from = `${month}-01`;
  const to = lastDayOfMonth(month);

  const cls = await classesSvc.get(db, classId);
  if (!cls) throw new Response(null, { status: 404 });

  const [settings, practiceDays, copies, roster, materials, excuses, base] = await Promise.all([
    practiceSvc.getSettings(db, classId),
    practiceSvc.practiceDays(db, classId, from, to),
    practiceSvc.listStudentTasks(db, classId, from, to),
    classesSvc.listRosterNames(db).then((r) => r.filter((x) => x.classId === classId)),
    materialsSvc.list(db),
    practiceSvc.listExcuses(db, { classId, status: 'pending', from, to }),
    practiceSvc.classLedger(db, classId, month),
  ]);
  const ledger: LedgerRow[] = await Promise.all(
    base.map(async (r) => ({
      ...r,
      hasZalo: (await zalo.chatsForParentsOfStudents(db, [r.studentId])).length > 0,
    })),
  );

  const data: SheetLoaderData = {
    classId,
    month,
    today: ictDateOf(new Date().toISOString()),
    cls,
    settings,
    practiceDays,
    copies,
    roster,
    materials,
    excuses,
    ledger,
  };
  return data;
}

export async function clientLoader({ params, serverLoader }: ClientLoaderFunctionArgs) {
  return swrLoad(
    practiceMonthKey(params.classId!, params.month!),
    () => serverLoader() as Promise<SheetLoaderData>,
  );
}
clientLoader.hydrate = true as const;

export default PracticeSheetScreen;
