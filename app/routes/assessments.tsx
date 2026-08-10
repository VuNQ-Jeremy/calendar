import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  ClientLoaderFunctionArgs,
  ClientActionFunctionArgs,
} from 'react-router';
import { AssessmentsScreen } from '../../src/screens-assessments.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as assessSvc from '../../server/services/assessments';
import * as peopleSvc from '../../server/services/people';
import * as classesSvc from '../../server/services/classes';
import * as typesSvc from '../../server/services/assessment-types';
import * as criteriaSvc from '../../server/services/remark-criteria';
import {
  ScoreRecordInput,
  BehaviorRecordInput,
  MonthlyRemarkInput,
  parsePatch,
} from '../../shared/schemas';
import { K, swrLoad, invalidateAfterMutation } from '../../src/lib/route-cache.js';
import { withLiveAction } from '../../server/live';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
  const db = createDb(env);
  const [scores, behavior, remarks, students, classes, types, criteria] = await Promise.all([
    assessSvc.listScores(db),
    assessSvc.listBehavior(db),
    assessSvc.listRemarks(db),
    peopleSvc.listStudents(db),
    classesSvc.listLite(db),
    typesSvc.list(db),
    criteriaSvc.list(db),
  ]);
  return { scores, behavior, remarks, students, classes, types, criteria };
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  return swrLoad(
    K.assessments,
    () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>,
  );
}
clientLoader.hydrate = true as const;

function preprocessRaw(raw: Record<string, unknown>) {
  const out = { ...raw };
  if (out.classId === '') delete out.classId;
  if (out.assessmentTypeId === '') out.assessmentTypeId = null;
  if (out.notes === '') delete out.notes;
  if (out.comment === '') delete out.comment;
  return out;
}

async function actionImpl({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const session = await requireStaff(request, env);
  const db = createDb(env);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;
  const id = formData.get('id') as string | null;

  if (intent === 'delete-score' || intent === 'delete-behavior' || intent === 'delete-remark') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    if (intent === 'delete-score') await assessSvc.removeScore(db, id);
    else if (intent === 'delete-behavior') await assessSvc.removeBehavior(db, id);
    else await assessSvc.removeRemark(db, id);
    return { ok: true };
  }

  const raw = preprocessRaw(Object.fromEntries(formData) as Record<string, unknown>);

  if (intent === 'create-score') {
    const parsed = ScoreRecordInput.safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await assessSvc.createScore(db, parsed.data);
    return { ok: true };
  }
  if (intent === 'update-score') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    const parsed = parsePatch(ScoreRecordInput, raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await assessSvc.updateScore(db, id, parsed.data);
    return { ok: true };
  }
  if (intent === 'create-behavior') {
    const parsed = BehaviorRecordInput.safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await assessSvc.createBehavior(db, parsed.data);
    return { ok: true };
  }
  if (intent === 'update-behavior') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    const parsed = parsePatch(BehaviorRecordInput, raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await assessSvc.updateBehavior(db, id, parsed.data);
    return { ok: true };
  }
  // create-remark upserts on (studentId, month), so a save from a screen that had not yet seen
  // an existing report updates it instead of failing the UNIQUE.
  if (intent === 'create-remark') {
    const parsed = MonthlyRemarkInput.safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await assessSvc.createRemark(db, parsed.data, session.user.id);
    return { ok: true };
  }
  if (intent === 'update-remark') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    const parsed = parsePatch(MonthlyRemarkInput, raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await assessSvc.updateRemark(db, id, parsed.data, session.user.id);
    return { ok: true };
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

export const action = withLiveAction('assessments', actionImpl);

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  try {
    return await serverAction();
  } finally {
    invalidateAfterMutation('assessments');
  }
}

export default function Assessments() {
  return <AssessmentsScreen />;
}
