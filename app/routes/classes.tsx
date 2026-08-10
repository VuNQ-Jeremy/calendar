import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  ClientLoaderFunctionArgs,
  ClientActionFunctionArgs,
} from 'react-router';
import { ClassesScreen } from '../../src/screens-manage/index.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as classesSvc from '../../server/services/classes';
import * as peopleSvc from '../../server/services/people';
import * as materialsSvc from '../../server/services/materials';
import * as testsSvc from '../../server/services/tests';
import * as levelsSvc from '../../server/services/grade-levels';
import * as classLevelsSvc from '../../server/services/class-levels';
import { ClassInput, parsePatch } from '../../shared/schemas';
import { K, swrLoad, invalidateAfterMutation } from '../../src/lib/route-cache.js';
import { withLiveAction } from '../../server/live';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
  const db = createDb(env);
  const [classes, students, materials, tests, gradeLevels, classLevels] = await Promise.all([
    classesSvc.list(db),
    peopleSvc.listStudents(db),
    materialsSvc.list(db),
    testsSvc.list(db),
    levelsSvc.list(db),
    classLevelsSvc.list(db),
  ]);
  return { classes, students, materials, tests, gradeLevels, classLevels };
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  return swrLoad(K.classes, () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>);
}
clientLoader.hydrate = true as const;

async function actionImpl({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
  const db = createDb(env);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;
  const id = formData.get('id') as string | null;

  if (intent === 'delete') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    await classesSvc.remove(db, id);
    return { ok: true };
  }

  const studentIdsRaw = formData.get('studentIds') as string | null;
  const raw: Record<string, unknown> = {
    ...Object.fromEntries(formData),
    studentIds: studentIdsRaw ? (JSON.parse(studentIdsRaw) as string[]) : [],
  };
  // An unset cohort dropdown posts '' — store it as a real NULL so the class is simply
  // excluded from cohort rankings rather than pointing at a level id of ''.
  if (raw.gradeLevelId === '') raw.gradeLevelId = null;
  if (raw.classLevelId === '') raw.classLevelId = null;

  if (intent === 'create') {
    const parsed = ClassInput.safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await classesSvc.create(db, parsed.data);
    return { ok: true };
  }

  if (intent === 'update') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    const parsed = parsePatch(ClassInput, raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await classesSvc.update(db, id, parsed.data);
    return { ok: true };
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

export const action = withLiveAction('classes', actionImpl);

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  try {
    return await serverAction();
  } finally {
    invalidateAfterMutation('classes');
  }
}

export default function Classes() {
  return <ClassesScreen />;
}
