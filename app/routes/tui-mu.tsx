import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  ClientLoaderFunctionArgs,
  ClientActionFunctionArgs,
} from 'react-router';
import { TuiMuBoardScreen } from '../../src/tui-mu/board.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as checkinSvc from '../../server/services/checkin';
import * as classesSvc from '../../server/services/classes';
import * as peopleSvc from '../../server/services/people';
import { GiftRedeemInput, TuitionMonth } from '../../shared/schemas';
import { ictDateOf } from '../../shared/logic/tests';
import { K, tuiMuKey, swrLoad, invalidateAfterMutation } from '../../src/lib/route-cache.js';
import { withLiveAction } from '../../server/live';

function currentIctMonth(now = new Date()): string {
  return ictDateOf(now.toISOString()).slice(0, 7);
}

function requireMonth(raw: string | undefined): string {
  const month = raw ?? currentIctMonth();
  const parsed = TuitionMonth.safeParse(month);
  if (!parsed.success) throw Response.json({ error: 'bad_month' }, { status: 400 });
  return parsed.data;
}

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
  const db = createDb(env);
  const month = requireMonth(params.month);
  const settings = await checkinSvc.getCheckinSettings(db);
  const classes = await classesSvc.listLite(db);

  if (!settings.showClassBoard) {
    return { disabled: true, classes, month, currentMonth: currentIctMonth(), classId: null };
  }

  const classId = params.classId ?? classes[0]?.id ?? null;
  const [students, redemptions] = await Promise.all([
    peopleSvc.listStudents(db),
    checkinSvc.listRedemptions(db, month),
  ]);
  const tallies = classId ? await checkinSvc.classMonthTallies(db, classId, month) : new Map();
  const roster = students
    .filter((s) => classId != null && s.classIds.includes(classId))
    .map((s) => ({ id: s.id, name: s.name, color: s.color }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    disabled: false,
    classId,
    month,
    currentMonth: currentIctMonth(),
    classes,
    roster,
    tallies: Object.fromEntries(tallies),
    tiers: settings.tiers,
    redemptions: redemptions.filter((r) => r.month === month),
  };
}

export async function clientLoader({ params, serverLoader }: ClientLoaderFunctionArgs) {
  const key = params.classId && params.month ? tuiMuKey(params.classId, params.month) : K.tuiMu;
  return swrLoad(key, () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>);
}
clientLoader.hydrate = true as const;

async function actionImpl({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const staff = await requireStaff(request, env);
  const db = createDb(env);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;
  const raw = Object.fromEntries(formData) as Record<string, unknown>;

  if (intent === 'redeem-gift') {
    const parsed = GiftRedeemInput.safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    try {
      const redemption = await checkinSvc.redeemGift(db, parsed.data, staff.user.id, new Date().toISOString());
      return { ok: true, redemption };
    } catch (err) {
      if (err instanceof Error && err.message === checkinSvc.ALREADY_REDEEMED) {
        return Response.json({ error: 'already_redeemed' }, { status: 400 });
      }
      throw err;
    }
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

export const action = withLiveAction('checkin', actionImpl);

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  try {
    return await serverAction();
  } finally {
    invalidateAfterMutation('checkin');
  }
}

export default function TuiMu() {
  return <TuiMuBoardScreen />;
}
