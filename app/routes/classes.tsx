import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  ClientLoaderFunctionArgs,
  ClientActionFunctionArgs,
} from 'react-router';
import { ClassesScreen } from '../../src/screens-manage/index.jsx';
import { tenantDbFor } from '../../server/db';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as classesSvc from '../../server/services/classes';
import * as peopleSvc from '../../server/services/people';
import * as materialsSvc from '../../server/services/materials';
import * as classMaterialsSvc from '../../server/services/class-materials';
import * as testsSvc from '../../server/services/tests';
import * as levelsSvc from '../../server/services/grade-levels';
import * as classLevelsSvc from '../../server/services/class-levels';
import * as subjectsSvc from '../../server/services/subjects';
import { ClassInput, parsePatch } from '../../shared/schemas';
import { K, swrLoad, invalidateAfterMutation } from '../../src/lib/route-cache.js';
import { withLiveAction } from '../../server/live';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const user = await requireStaff(request, env);
  const db = tenantDbFor(env, user);
  const [classes, students, materials, classMaterials, tests, gradeLevels, classLevels, subjects] =
    await Promise.all([
      classesSvc.list(db),
      peopleSvc.listStudents(db),
      materialsSvc.list(db),
      classMaterialsSvc.listAll(db),
      testsSvc.list(db),
      levelsSvc.list(db),
      classLevelsSvc.list(db),
      subjectsSvc.list(db),
    ]);
  return {
    classes,
    students,
    materials,
    classMaterials,
    tests,
    gradeLevels,
    classLevels,
    subjects,
  };
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  return swrLoad(K.classes, () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>);
}
clientLoader.hydrate = true as const;

async function actionImpl({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const user = await requireStaff(request, env);
  const db = tenantDbFor(env, user);
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
  if (raw.subjectId === '') raw.subjectId = null;
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
