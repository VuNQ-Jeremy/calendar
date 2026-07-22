import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { AssessmentsScreen } from '../../src/screens-assessments.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireUser } from '../../server/services/auth';
import * as assessSvc from '../../server/services/assessments';
import * as peopleSvc from '../../server/services/people';
import * as classesSvc from '../../server/services/classes';
import * as typesSvc from '../../server/services/assessment-types';
import { ScoreRecordInput, BehaviorRecordInput } from '../../shared/schemas';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireUser(request, env);
  const db = createDb(env);
  const [scores, behavior, students, classes, types] = await Promise.all([
    assessSvc.listScores(db),
    assessSvc.listBehavior(db),
    peopleSvc.listStudents(db),
    classesSvc.listLite(db),
    typesSvc.list(db),
  ]);
  return { scores, behavior, students, classes, types };
}

function preprocessRaw(raw: Record<string, unknown>) {
  const out = { ...raw };
  if (out.classId === '') delete out.classId;
  if (out.assessmentTypeId === '') out.assessmentTypeId = null;
  if (out.notes === '') delete out.notes;
  return out;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireUser(request, env);
  const db = createDb(env);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;
  const id = formData.get('id') as string | null;

  if (intent === 'delete-score' || intent === 'delete-behavior') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    if (intent === 'delete-score') await assessSvc.removeScore(db, id);
    else await assessSvc.removeBehavior(db, id);
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
    const parsed = ScoreRecordInput.partial().safeParse(raw);
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
    const parsed = BehaviorRecordInput.partial().safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await assessSvc.updateBehavior(db, id, parsed.data);
    return { ok: true };
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

export default function Assessments() {
  return <AssessmentsScreen />;
}
