import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  ClientLoaderFunctionArgs,
  ClientActionFunctionArgs,
} from 'react-router';
import { TuitionScreen } from '../../src/screens-tuition.jsx';
import { tenantDbFor } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireAdmin } from '../../server/services/auth';
import * as tuitionSvc from '../../server/services/tuition';
import * as classesSvc from '../../server/services/classes';
import * as peopleSvc from '../../server/services/people';
import {
  ClassPriceInput,
  TuitionAdjustmentInput,
  TuitionMonth,
  TuitionPaymentInput,
} from '../../shared/schemas';
import { ictDateOf } from '../../shared/logic/tests';
import { K, tuitionMonthKey, swrLoad, invalidateAfterMutation } from '../../src/lib/route-cache.js';
import { withLiveAction } from '../../server/live';

/** The ICT month we are in. The Worker's clock is UTC, so `new Date().getMonth()` would be wrong. */
export function currentIctMonth(now = new Date()): string {
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
  const admin = await requireAdmin(request, env);
  const db = tenantDbFor(env, admin);
  const month = requireMonth(params.month);
  const [report, prices, classes, students, settings] = await Promise.all([
    tuitionSvc.getMonthReport(db, month),
    tuitionSvc.listPrices(db),
    classesSvc.listLite(db),
    peopleSvc.listStudents(db),
    tuitionSvc.getTuitionSettings(db),
  ]);
  return { month, report, prices, classes, students, settings };
}

export async function clientLoader({ params, serverLoader }: ClientLoaderFunctionArgs) {
  const key = params.month ? tuitionMonthKey(params.month) : K.tuition;
  return swrLoad(key, () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>);
}
clientLoader.hydrate = true as const;

async function actionImpl({ request, params, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const admin = await requireAdmin(request, env);
  const { user } = admin;
  const db = tenantDbFor(env, admin);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;
  const raw = Object.fromEntries(formData) as Record<string, unknown>;
  const month = requireMonth((formData.get('month') as string | null) ?? params.month);

  if (intent === 'save-price') {
    const parsed = ClassPriceInput.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    }
    await tuitionSvc.setPrice(db, parsed.data);
    return { ok: true };
  }

  if (intent === 'delete-price') {
    const id = formData.get('id') as string | null;
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    await tuitionSvc.removePrice(db, id);
    return { ok: true };
  }

  if (intent === 'save-payment' || intent === 'save-adjustment') {
    const studentId = formData.get('studentId') as string | null;
    if (!studentId) return Response.json({ error: 'missing studentId' }, { status: 400 });
    const schema = intent === 'save-payment' ? TuitionPaymentInput : TuitionAdjustmentInput;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    }
    await tuitionSvc.saveStudentMonth(db, month, studentId, parsed.data);
    return { ok: true };
  }

  if (intent === 'close-month') {
    try {
      await tuitionSvc.closeMonth(db, month, user.name);
    } catch (err) {
      // The screen shows the class names, so the admin knows exactly what to price.
      if (err instanceof tuitionSvc.MissingPriceError) {
        return Response.json({ error: 'missing_price', classes: err.classes }, { status: 400 });
      }
      throw err;
    }
    return { ok: true };
  }

  if (intent === 'reopen-month') {
    await tuitionSvc.reopenMonth(db, month);
    return { ok: true };
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

export const action = withLiveAction('tuition', actionImpl);

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  try {
    return await serverAction();
  } finally {
    invalidateAfterMutation('tuition');
  }
}

export default function Tuition() {
  return <TuitionScreen />;
}
