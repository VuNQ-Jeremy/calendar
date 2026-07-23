import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  ClientLoaderFunctionArgs,
  ClientActionFunctionArgs,
} from 'react-router';
import { HomeworkScreen } from '../../src/screens-core.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireUser } from '../../server/services/auth';
import * as homeworkSvc from '../../server/services/homework';
import * as classesSvc from '../../server/services/classes';
import * as peopleSvc from '../../server/services/people';
import * as typesSvc from '../../server/services/assessment-types';
import { HomeworkInput, HomeworkGradesSaveInput, parsePatch } from '../../shared/schemas';
import { cacheGet, cacheSet, invalidate } from '../../src/lib/cache.js';

const CACHE_KEY = 'route:homework';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireUser(request, env);
  const db = createDb(env);
  const [homework, classes, students, grades, types] = await Promise.all([
    homeworkSvc.list(db),
    classesSvc.list(db),
    peopleSvc.listStudents(db),
    homeworkSvc.listGrades(db),
    typesSvc.list(db),
  ]);
  return { homework, classes, students, grades, types };
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  const cached = cacheGet<Awaited<ReturnType<typeof loader>>>(CACHE_KEY);
  if (cached !== undefined) return cached;
  const data = await serverLoader();
  cacheSet(CACHE_KEY, data);
  return data;
}

function preprocessHwRaw(raw: Record<string, unknown>) {
  const out = { ...raw };
  if (out.points === '') delete out.points;
  if (typeof out.done === 'string') out.done = out.done === 'true';
  if (out.assessmentTypeId === '') out.assessmentTypeId = null;
  return out;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireUser(request, env);
  const db = createDb(env);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;
  const id = formData.get('id') as string | null;

  if (intent === 'delete') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    await homeworkSvc.remove(db, id);
    return { ok: true };
  }

  if (intent === 'save-grades') {
    let recordsRaw: unknown;
    try {
      recordsRaw = JSON.parse((formData.get('records') as string) ?? '[]');
    } catch {
      return Response.json({ error: 'bad records json' }, { status: 400 });
    }
    const parsed = HomeworkGradesSaveInput.safeParse({
      homeworkId: formData.get('homeworkId'),
      records: recordsRaw,
    });
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    const grades = await homeworkSvc.saveGrades(db, parsed.data.homeworkId, parsed.data.records);
    return { ok: true, grades };
  }

  const raw = preprocessHwRaw(Object.fromEntries(formData) as Record<string, unknown>);

  if (intent === 'create') {
    const parsed = HomeworkInput.safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await homeworkSvc.create(db, parsed.data);
    return { ok: true };
  }

  if (intent === 'update') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    const parsed = parsePatch(HomeworkInput, raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await homeworkSvc.update(db, id, parsed.data);
    return { ok: true };
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  try {
    return await serverAction();
  } finally {
    invalidate('route:', 'hw:');
  }
}

export default function Homework() {
  return <HomeworkScreen />;
}
